import io
import json
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest

from backend.app.demo import demo_meeting
from backend.app.models import Assignment, Run
from backend.shared.schemas import StepEvent


def wait_for(client, run_id, status):
    end = time.monotonic() + 15
    while time.monotonic() < end:
        detail = client.get(f"/api/runs/{run_id}").json()
        current = detail["run"]["status"]
        if current == status:
            return detail
        assert current != "error", detail["steps"]
        time.sleep(0.01)
    pytest.fail(f"Run did not reach {status}: {detail}")


def create(client, **data):
    response = client.post("/api/runs", data={"sample": "demo", "meeting_date": "2026-09-23", **data})
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "queued"
    return response.json()["run_id"]


def finish(client, run_id):
    wait_for(client, run_id, "awaiting_approval")
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True}).json() == {"status": "executing"}
    return wait_for(client, run_id, "done")


def test_demo_flow(client):
    health = client.get("/api/health").json()
    assert health["today"] == "2026-09-23"
    assert health["agent_mode"] == health["stt_mode"] == "mock"
    sample = client.get("/api/samples").json()[0]
    assert set(sample) == {"id", "title", "description", "lang", "synthetic", "participants"}
    assert sample["synthetic"] is True
    run_id = create(client)
    pending = wait_for(client, run_id, "awaiting_approval")
    assert pending["run"]["synthetic"] is True
    assert pending["proposal"]["assignments"] == [dict(item, category=None) for item in demo_meeting()["expected"]["assignments"]]
    assert pending["files"] == {"docx": None, "pdf": None}
    assert client.get(f"/api/runs/{run_id}/protocol.docx").status_code == 409
    assert client.get("/api/assignments").json() == []
    detail = finish(client, run_id)
    assert len(detail["result"]["excerpts"]) == 3
    assert detail["steps"][-1]["type"] == "final"
    for step in detail["steps"]:
        StepEvent.model_validate(step)
        if step["type"] == "handoff":
            assert "to" in step["data"]
    assert [s["seq"] for s in detail["steps"]] == list(range(1, len(detail["steps"]) + 1))
    assert client.get("/api/runs").json()[0]["assignments_count"] == 4
    docx = client.get(detail["files"]["docx"])
    assert docx.content.startswith(b"PK")
    with zipfile.ZipFile(io.BytesIO(docx.content)) as archive:
        xml = archive.read("word/document.xml").decode()
        assert "Синтетические" in xml and "жұмаға дейін" in xml
    pdf = client.get(detail["files"]["pdf"])
    assert pdf.content.startswith(b"%PDF")
    for kind in ("docx", "pdf"):
        (client.settings.exports_dir / run_id / f"protocol.{kind}").unlink()
        assert client.get(detail["files"][kind]).status_code == 200
    stream = client.get(f"/api/runs/{run_id}/events")
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert '"type": "needs_approval"' in stream.text
    assert stream.text.index('"type": "final"') < stream.text.index('"status": "done"')
    seq = detail["steps"][-2]["seq"]
    replay = client.get(f"/api/runs/{run_id}/events", headers={"Last-Event-ID": str(seq)}).text
    assert replay.count("event: step") == 1 and '"type": "final"' in replay
    notes = client.get("/api/notifications").json()
    assert len(notes) == 3 and all(n["kind"] == "excerpt" for n in notes)
    assert len(client.get("/api/notifications", params={"recipient": notes[0]["recipient"]}).json()) == 1


@pytest.mark.parametrize("participants", ["Алия,Бек,Дана", json.dumps(["Алия", "Бек", "Дана"]), json.dumps([{"name": "Алия"}, {"name": "Бек"}, {"name": "Дана"}])])
def test_upload_and_participants(client, participants):
    response = client.post("/api/runs", files={"file": ("../../meeting.WAV", b"RIFF synthetic audio", "audio/wav")},
                           data={"title": "Тест", "meeting_date": "2027-09-24", "participants": participants, "lang": "kk"})
    assert response.status_code == 201, response.text
    run_id = response.json()["run_id"]
    pending = wait_for(client, run_id, "awaiting_approval")
    assert pending["run"]["synthetic"] is False
    assert list(pending["proposal"]["speakers"].values()) == ["Алия", "Бек", "Дана"]
    assert [a["deadline"] for a in pending["proposal"]["assignments"]] == ["2027-10-01", "2027-09-25", "2027-09-30", "2027-10-05"]
    assert (client.settings.uploads_dir / f"{run_id}.wav").is_file()
    finish(client, run_id)


def test_edited_approval_and_double_submit(client):
    run_id = create(client)
    proposal = wait_for(client, run_id, "awaiting_approval")["proposal"]
    proposal["summary"] = "ә ғ қ ң ө ұ ү һ і"
    proposal["assignments"][0].update(task="Исправленное поручение", deadline=None)
    response = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "proposal": proposal, "comment": "Проверено"})
    assert response.status_code == 200
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True}).status_code == 409
    result = wait_for(client, run_id, "done")
    assert result["proposal"]["summary"] == proposal["summary"]
    assignments = client.get("/api/assignments").json()
    item = next(a for a in assignments if a["task"] == "Исправленное поручение")
    assert item["days_left"] is None and item["status"] == "in_progress"
    with client.app.state.runtime.db.session() as session:
        saved = session.get(Assignment, item["id"])
        assert saved.source_segments == proposal["assignments"][0]["source_segments"]
    assert any("Исправленное поручение" in n["message"] for n in client.get("/api/notifications").json())


def test_reject(client):
    run_id = create(client)
    wait_for(client, run_id, "awaiting_approval")
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": False}).json() == {"status": "rejected"}
    stream = client.get(f"/api/runs/{run_id}/events").text
    assert '"status": "rejected"' in stream and '"type": "final"' not in stream
    assert client.get("/api/assignments").json() == client.get("/api/notifications").json() == []
    assert client.get(f"/api/runs/{run_id}/protocol.pdf").status_code == 409


def test_dashboard_reminders_seed(client_factory):
    client = client_factory(seed=True)
    items = client.get("/api/assignments").json()
    assert {a["status"] for a in items} == {"overdue", "in_progress", "done"}
    assert {a["days_left"] for a in items} == {-3, 0, -1}
    run = client.get("/api/runs").json()[0]
    assert run["synthetic"]
    for status in ("overdue", "in_progress", "done"):
        assert len(client.get("/api/assignments", params={"status": status}).json()) == 1
    target = next(a for a in items if a["status"] == "overdue")
    filtered = client.get("/api/assignments", params={"run_id": run["id"], "assignee": target["assignee"]}).json()
    assert target in filtered
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(lambda _: client.post("/api/reminders/run").json(), range(2)))
    assert sum(r["created"] for r in responses) == 2
    assert {n["kind"] for n in client.get("/api/notifications").json()} == {"overdue", "due_soon"}
    assert client.post("/api/reminders/run").json() == {"created": 0, "today": "2026-09-23"}
    assert client.patch(f"/api/assignments/{target['id']}", json={"done": True}).json()["status"] == "done"
    assert client.patch(f"/api/assignments/{target['id']}", json={"done": False}).json()["status"] == "overdue"
    from backend.app.seed import seed_history
    seed_history(client.app.state.runtime.db, client.settings)
    assert len(client.get("/api/assignments").json()) == 3


@pytest.mark.parametrize("data", [{}, {"sample": "unknown"}, {"sample": "demo", "lang": "en"},
    {"sample": "demo", "meeting_date": "2026-02-30"}, {"sample": "demo", "meeting_date": "20260923"},
    {"sample": "demo", "participants": "[broken"}, {"sample": "demo", "participants": "{}"},
    {"sample": "demo", "participants": '[{"name":" "}]'}, {"sample": "demo", "title": " "}])
def test_bad_input(client, data):
    response = client.post("/api/runs", data=data)
    assert response.status_code == 400 and isinstance(response.json()["detail"], str)


def test_errors(client):
    assert client.post("/api/runs", files={"file": ("x.exe", b"x")}).status_code == 415
    assert client.post("/api/runs", files={"file": ("x.wav", b"")}).status_code == 400
    assert client.post("/api/runs", data={"sample": "demo"}, files={"file": ("x.wav", b"x")}).status_code == 400
    for suffix in ("", "/events", "/protocol.docx", "/protocol.pdf"):
        assert client.get("/api/runs/missing" + suffix).status_code == 404
    assert client.post("/api/runs/missing/approve", json={"approved": True}).status_code == 404
    assert client.patch("/api/assignments/missing", json={"done": True}).status_code == 404
    assert client.get("/api/assignments?status=bad").status_code == 400
    run_id = create(client)
    proposal = wait_for(client, run_id, "awaiting_approval")["proposal"]
    proposal["run_id"] = "different"
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "proposal": proposal}).status_code == 400
    assert client.post(f"/api/runs/{run_id}/approve", json={}).status_code == 400
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": "yes"}).status_code == 400
    assert client.get(f"/api/runs/{run_id}/events", headers={"Last-Event-ID": "invalid"}).status_code == 400


def test_size_rate_limit(client_factory):
    client = client_factory(max_upload_mb=0, rate_limit_per_min=2)
    assert client.post("/api/runs", files={"file": ("x.wav", b"x")}).status_code == 413
    assert not list(client.settings.uploads_dir.iterdir())
    create(client)
    limited = client.post("/api/runs", data={"sample": "demo"})
    assert limited.status_code == 429 and limited.headers["retry-after"] == "60"
    assert client.post("/api/runs", data={"sample": "demo"}, headers={"X-Forwarded-For": "192.0.2.1, 192.0.2.2"}).status_code == 201


def test_pipeline_error(client, monkeypatch):
    from backend import stt
    def broken(*args):
        raise ValueError("Не удалось прочитать запись.")
    monkeypatch.setattr(stt, "transcribe", broken)
    run_id = create(client)
    result = wait_for(client, run_id, "error")
    assert result["steps"][-1]["type"] == "error"
    assert '"status": "error"' in client.get(f"/api/runs/{run_id}/events").text
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True}).status_code == 409
