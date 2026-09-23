"""CONTRACT v0.2: revisions, immutable raw transcript, approved snapshot, evidence, audio, stages."""
import io
import zipfile
from dataclasses import replace
from datetime import date

import pytest

from backend.app.models import Assignment, Run
from test_api import create, wait_for


def pending(client, **data):
    run_id = create(client, **data)
    return run_id, wait_for(client, run_id, "awaiting_approval")["proposal"]


def save(client, run_id, proposal, revision):
    return client.put(f"/api/runs/{run_id}/proposal", json={"expected_revision": revision, "proposal": proposal})


def test_save_revision_and_raw_transcript_immutable(client):
    run_id, proposal = pending(client)
    raw_text = proposal["segments"][1]["text"]
    proposal["segments"][1]["text"] = "подменённый текст"
    proposal["segments"][1]["corrected_text"] = "Ерлан, подготовь отчёт до пятницы."
    proposal["assignments"][0].update(assignee="Отдел аналитики", review_status="corrected")
    response = save(client, run_id, proposal, 1)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["revision"] == 2
    segment = saved["proposal"]["segments"][1]
    assert segment["text"] == raw_text and segment["corrected_text"] == "Ерлан, подготовь отчёт до пятницы."
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["revision"] == 2 and detail["transcript"]["segments"][1]["text"] == raw_text
    assert detail["proposal"]["assignments"][0]["assignee"] == "Отдел аналитики"
    # Stale editor loses; nothing is overwritten.
    assert save(client, run_id, proposal, 1).status_code == 409
    assert client.get(f"/api/runs/{run_id}").json()["revision"] == 2


@pytest.mark.parametrize("change, fragment", [
    (lambda p: p["assignments"][0].update(source_segments=[999]), "несуществующую"),
    (lambda p: p["assignments"][0].update(evidence=[{"segment_index": 1, "quote": "этого не говорили"}]), "не найдена"),
    (lambda p: p.update(segments=p["segments"][:-1]), "реплики"),
])
def test_save_rejects_unverifiable_edits(client, change, fragment):
    run_id, proposal = pending(client)
    change(proposal)
    response = save(client, run_id, proposal, 1)
    assert response.status_code == 422 and fragment in response.json()["detail"]


def test_evidence_times_come_from_segment(client):
    run_id, proposal = pending(client)
    proposal["assignments"][0]["evidence"] = [{"segment_index": 1, "quote": "ЖҰМАҒА ДЕЙІН!", "start": 999, "end": 1000, "field": "deadline"}]
    saved = save(client, run_id, proposal, 1).json()["proposal"]
    evidence = saved["assignments"][0]["evidence"][0]
    assert (evidence["start"], evidence["end"]) == (proposal["segments"][1]["start"], proposal["segments"][1]["end"])


def test_approve_snapshot_idempotent_and_exports(client):
    run_id, proposal = pending(client)
    proposal["summary"] = "Утверждённая редакция ә ғ қ ң ө ұ ү һ і"
    assert save(client, run_id, proposal, 1).json()["revision"] == 2
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 1}).status_code == 409
    first = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2})
    assert first.json() == {"status": "executing", "revision": 2}
    detail = wait_for(client, run_id, "done")
    again = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2})
    assert again.status_code == 200 and again.json() == {"status": "done", "revision": 2}
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 3}).status_code == 409
    assert save(client, run_id, detail["proposal"], 2).status_code == 409
    assert detail["approved"]["revision"] == 2 and detail["approved_at"]
    assert all(a["review_status"] == "confirmed" for a in detail["approved"]["assignments"])
    with zipfile.ZipFile(io.BytesIO(client.get(detail["files"]["docx"]).content)) as archive:
        assert "Утверждённая редакция" in archive.read("word/document.xml").decode()
    stages = [s["data"].get("stage") for s in detail["steps"]]
    for stage in ("transcribe", "validate", "review", "approve", "export", "complete"):
        assert stage in stages, stage
    assert stages.index("approve") < stages.index("export") < stages.index("complete")


def test_conflict_blocks_approval_until_excluded(client):
    run_id, proposal = pending(client)
    proposal["assignments"][1]["deadline_candidates"] = ["завтра до обеда", "до пятницы"]
    saved = save(client, run_id, proposal, 1).json()["proposal"]
    assert "deadline_conflict" in saved["assignments"][1]["review_reasons"]
    blocked = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2})
    assert blocked.status_code == 409 and blocked.json()["code"] == "review_required" and blocked.json()["assignments"] == [2]
    assert client.get(f"/api/runs/{run_id}").json()["run"]["status"] == "awaiting_approval"
    saved["assignments"][1]["review_status"] = "excluded"
    approved = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": 2, "proposal": saved})
    assert approved.json() == {"status": "executing", "revision": 3}
    wait_for(client, run_id, "done")
    tasks = {a["task"] for a in client.get("/api/assignments", params={"run_id": run_id}).json()}
    assert len(tasks) == 3 and proposal["assignments"][1]["task"] not in tasks


def test_unknown_meeting_date_is_not_today(client):
    response = client.post("/api/runs", files={"file": ("meeting.wav", b"RIFF-demo-bytes")}, data={"title": "Без даты"})
    run_id = response.json()["run_id"]
    detail = wait_for(client, run_id, "awaiting_approval")
    assert detail["run"]["meeting_date"] is None and detail["run"]["meeting_date_verified"] is False
    for item in detail["proposal"]["assignments"]:
        assert item["deadline"] is None and "deadline_unknown" in item["review_reasons"] and item["deadline_text"]
    client.post(f"/api/runs/{run_id}/approve", json={"approved": True})
    done = wait_for(client, run_id, "done")
    with zipfile.ZipFile(io.BytesIO(client.get(done["files"]["docx"]).content)) as archive:
        assert "Дата: не указана" in archive.read("word/document.xml").decode()


def test_audio_supports_range(client):
    payload = bytes(range(256)) * 4
    run_id = client.post("/api/runs", files={"file": ("meeting.wav", payload)}, data={"meeting_date": "2026-09-23"}).json()["run_id"]
    detail = wait_for(client, run_id, "awaiting_approval")
    assert detail["audio"] == f"/api/runs/{run_id}/audio"
    full = client.get(detail["audio"])
    assert full.status_code == 200 and full.content == payload and full.headers["content-type"].startswith("audio/")
    part = client.get(detail["audio"], headers={"Range": "bytes=10-19"})
    assert part.status_code == 206 and part.content == payload[10:20]
    sample_id, _ = pending(client)
    assert client.get(f"/api/runs/{sample_id}/audio").status_code == 404


def test_model_output_with_bad_refs_goes_to_review(client, monkeypatch):
    from backend.agents import runner_mock
    original = runner_mock.propose

    async def sloppy(run_input, emit):
        proposal = await original(run_input, emit)
        first = proposal.assignments[0].model_copy(update={"source_segments": [999], "evidence": [], "assignee": None})
        return proposal.model_copy(update={"assignments": [first, *proposal.assignments[1:]], "source_mode": "real", "revision": 7})
    monkeypatch.setattr(runner_mock, "propose", sloppy)
    run_id, proposal = pending(client)
    item = proposal["assignments"][0]
    assert item["source_segments"] == [] and item["evidence"] == []
    assert {"evidence_missing", "owner_uncertain"} <= set(item["review_reasons"])
    assert proposal["source_mode"] == "mock" and proposal["revision"] == 1  # the runner cannot claim these
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True}).json()["code"] == "review_required"


def test_llm_profiles_fail_closed(client):
    runtime = client.app.state.runtime
    real = Run(title="Реальная встреча", meeting_date=date(2026, 9, 23), synthetic=False)
    synthetic = Run(title="Синтетика", meeting_date=date(2026, 9, 23), synthetic=True)
    runtime.settings = replace(runtime.settings, agent_mode="real", llm_provider="dev_openai", llm_base_url="https://api.openai.com/v1")
    with pytest.raises(ValueError, match="синтетических"):
        runtime.guard_llm_destination(real)
    runtime.guard_llm_destination(synthetic)
    runtime.settings = replace(runtime.settings, llm_provider="local")
    with pytest.raises(ValueError, match="local"):
        runtime.guard_llm_destination(synthetic)
    runtime.settings = replace(runtime.settings, llm_base_url="http://127.0.0.1:11434/v1")
    runtime.guard_llm_destination(real)
    health = client.get("/api/health").json()
    assert health["llm_provider"] == "local" and health["llm_model"] == "qwen3:4b"
