"""Synthetic regressions for AI evidence across review, approval and persistence."""
import sqlite3

import pytest
from sqlmodel import select

from backend.app.config import Settings
from backend.app.db import Database
from backend.app.models import Assignment
from backend.app.review import blocking, check_proposal
from backend.shared.schemas import AssignmentDraft, Evidence, Proposal, Segment
from test_api import create, wait_for


def test_metadata_survives_save_approve_register_and_restart(client_factory):
    client = client_factory()
    run_id = create(client)
    proposal = wait_for(client, run_id, "awaiting_approval")["proposal"]
    item = proposal["assignments"][0]
    item.update(review_reasons=["scope_incomplete"], review_status="confirmed", review_note="Вымышленная проверка: сверено вручную.",
                assignee_candidates=["Демо Айбар"])
    saved = client.put(f"/api/runs/{run_id}/proposal", json={"expected_revision": 1, "proposal": proposal})
    assert saved.status_code == 200, saved.text
    expected = saved.json()["proposal"]["assignments"][0]
    approval = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2})
    assert approval.status_code == 200, approval.text
    done = wait_for(client, run_id, "done")
    assert done["approved"]["assignments"][0]["evidence"] == expected["evidence"]
    for current in (client, client_factory()):
        rows = current.get("/api/assignments", params={"run_id": run_id}).json()
        stored = next(a for a in rows if a["task"] == item["task"])
        for field in ("evidence", "review_reasons", "review_note", "assignee_candidates", "deadline_candidates"):
            assert stored[field] == expected[field], field
        assert stored["review_status"] == "confirmed"
    with client.app.state.runtime.db.session() as session:
        stored = session.exec(select(Assignment).where(Assignment.run_id == run_id, Assignment.task == item["task"])).one()
        assert stored.evidence == expected["evidence"]


def test_legacy_assignment_database_is_migrated_without_data_loss(tmp_path):
    settings = Settings(data_dir=tmp_path, seed=False)
    with sqlite3.connect(settings.db_path) as connection:
        connection.execute("CREATE TABLE assignments (id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL, assignee VARCHAR NOT NULL, task VARCHAR NOT NULL, deadline DATE, deadline_text VARCHAR, priority VARCHAR NOT NULL, category VARCHAR, source_segments JSON NOT NULL, done BOOLEAN NOT NULL)")
        connection.execute("INSERT INTO assignments VALUES ('old-task', 'old-run', 'Демо Айбар', 'Вымышленное поручение', NULL, NULL, 'normal', NULL, '[0]', 0)")
    db = Database(settings)
    try:
        with db.session() as session:
            stored = session.get(Assignment, "old-task")
            assert stored.task == "Вымышленное поручение" and stored.source_segments == [0]
            assert stored.evidence == stored.review_reasons == stored.assignee_candidates == []
            assert stored.review_status == "unreviewed"
    finally:
        db.close()


@pytest.mark.parametrize("quote", ["!!!", " ", "порт"])
def test_empty_or_fragment_evidence_is_not_accepted(client, quote):
    run_id = create(client)
    proposal = wait_for(client, run_id, "awaiting_approval")["proposal"]
    proposal["assignments"][0]["evidence"] = [{"segment_index": 0, "quote": quote}]
    response = client.put(f"/api/runs/{run_id}/proposal", json={"expected_revision": 1, "proposal": proposal})
    assert response.status_code == 422, response.text


def test_unchanged_resave_does_not_clear_model_review_flags():
    raw = [Segment(start=0, end=3, speaker="SPEAKER_00", text="Демо Айбар подготовит отчёт.")]
    draft = Proposal(run_id="synthetic", summary="Синтетика", segments=raw, assignments=[AssignmentDraft(
        assignee="Демо Айбар", task="Подготовить отчёт", source_segments=[0],
        evidence=[Evidence(segment_index=0, quote="несуществующая цитата", field="task")],
        review_reasons=["owner_uncertain", "deadline_conflict"],
    )])
    checked = check_proposal(draft, raw, strict=False)
    assert {"evidence_missing", "owner_uncertain", "deadline_conflict"} <= set(checked.assignments[0].review_reasons)
    saved = check_proposal(checked, raw, strict=True)
    assert saved.assignments[0].review_reasons == checked.assignments[0].review_reasons
    assert blocking(saved) == [1]


def test_speaker_evidence_cannot_reference_another_voice(client):
    run_id = create(client)
    proposal = wait_for(client, run_id, "awaiting_approval")["proposal"]
    speaker = proposal["speaker_records"][0]
    other_index = next(i for i, segment in enumerate(proposal["segments"]) if segment["speaker"] != speaker["label"])
    speaker["evidence"] = [{"segment_index": other_index, "quote": proposal["segments"][other_index]["text"], "field": "context"}]
    response = client.put(f"/api/runs/{run_id}/proposal", json={"expected_revision": 1, "proposal": proposal})
    assert response.status_code == 422 and "другому голосу" in response.json()["detail"]


@pytest.mark.parametrize("omit", [False, True])
def test_client_cannot_clear_server_evidence_flag_by_resaving(client, monkeypatch, omit):
    from backend.agents import runner_mock
    original = runner_mock.propose

    async def bad_quote(run_input, emit):
        proposal = await original(run_input, emit)
        first = proposal.assignments[0].model_copy(update={"evidence": [
            Evidence(segment_index=1, quote="Вымышленная отсутствующая цитата", field="task")
        ]})
        return proposal.model_copy(update={"assignments": [first, *proposal.assignments[1:]]})

    monkeypatch.setattr(runner_mock, "propose", bad_quote)
    run_id = create(client)
    proposal = wait_for(client, run_id, "awaiting_approval")["proposal"]
    assert "evidence_missing" in proposal["assignments"][0]["review_reasons"]
    if omit:
        del proposal["assignments"][0]["review_reasons"]
    else:
        proposal["assignments"][0]["review_reasons"] = []
    saved = client.put(f"/api/runs/{run_id}/proposal", json={"expected_revision": 1, "proposal": proposal})
    assert saved.status_code == 200, saved.text
    assert "evidence_missing" in saved.json()["proposal"]["assignments"][0]["review_reasons"]
    response = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2})
    assert response.status_code == 409 and response.json()["code"] == "review_required"


def test_explicit_absolute_deadline_survives_unknown_meeting_date():
    from datetime import date
    raw = [Segment(start=0, end=2, speaker="SPEAKER_00", text="Демо Айбар, отчёт до 2027-03-04.")]
    draft = Proposal(run_id="synthetic", summary="Синтетика", segments=raw, assignments=[AssignmentDraft(
        assignee="Демо Айбар", task="Подготовить отчёт", deadline=date(2027, 3, 4),
        deadline_text="до 2027-03-04", source_segments=[0],
        evidence=[Evidence(segment_index=0, quote="до 2027-03-04", field="deadline")],
    )])
    checked = check_proposal(draft, raw, strict=False, date_verified=False)
    assert checked.assignments[0].deadline == date(2027, 3, 4)


def test_incomplete_action_requires_explicit_human_review(client):
    run_id = create(client)
    proposal = wait_for(client, run_id, "awaiting_approval")["proposal"]
    original_task = proposal["assignments"][0]["task"]
    proposal["assignments"][0].update(task="Подготовить", review_reasons=["scope_incomplete"])
    saved = client.put(f"/api/runs/{run_id}/proposal", json={"expected_revision": 1, "proposal": proposal})
    assert saved.status_code == 200
    blocked = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2})
    assert blocked.status_code == 409 and blocked.json()["assignments"] == [1]
    draft = saved.json()["proposal"]
    draft["assignments"][0].update(task=original_task, review_status="corrected", review_note="Объект поручения восстановлен по цитате.")
    response = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2, "proposal": draft})
    assert response.status_code == 200, response.text
    wait_for(client, run_id, "done")
