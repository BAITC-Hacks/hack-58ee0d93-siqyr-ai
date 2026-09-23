"""Fail closed before accepting work: missing weights -> 503, full single-worker queue -> 429."""
from datetime import date

from backend.app.models import Run
from backend.app.readiness import environment_checks, model_checks


def test_health_ready_in_mock(client):
    health = client.get("/api/health").json()
    assert health["ready"] is True and health["problems"] == []


def test_missing_weights_block_real_run(client_factory, tmp_path):
    client = client_factory(stt_mode="real", stt_model_dir=tmp_path / "none", diarization_model_dir=tmp_path / "none-d")
    health = client.get("/api/health").json()
    assert health["ready"] is False and {p["name"] for p in health["problems"]} >= {"stt_weights", "diarization_weights"}
    response = client.post("/api/runs", files={"file": ("meeting.wav", b"RIFF")}, data={"meeting_date": "2026-09-23"})
    assert response.status_code == 503 and "setup.sh" in response.json()["detail"]
    assert not list(client.settings.uploads_dir.iterdir())


def test_real_agents_need_explicit_local_endpoint(client_factory):
    names = lambda s: {c.name: c.level for c in model_checks(s)}
    client = client_factory(agent_mode="real", llm_base_url="")
    assert names(client.settings)["llm_endpoint"] == "fail"
    assert client.post("/api/runs", data={"sample": "demo"}).status_code == 503
    remote = client_factory(agent_mode="real", llm_base_url="http://10.0.0.5:8000/v1").settings
    assert names(remote)["llm_endpoint"] == "fail"
    allowed = client_factory(agent_mode="real", llm_base_url="http://10.0.0.5:8000/v1",
        llm_allowed_hosts=["10.0.0.5"]).settings
    assert names(allowed)["llm_endpoint"] == "warn"
    local = client_factory(agent_mode="real", llm_base_url="http://127.0.0.1:11434/v1").settings
    assert names(local)["llm_endpoint"] == "ok"


def test_queue_limit(client_factory):
    client = client_factory(max_queue=1)
    with client.app.state.runtime.db.session() as session:
        session.add(Run(title="Ждёт worker", meeting_date=date(2026, 9, 23), status="queued"))
        session.commit()
    response = client.post("/api/runs", data={"sample": "demo"})
    assert response.status_code == 429 and response.headers["retry-after"] == "30"


def test_environment_checks_pass_here(client):
    levels = {c.name: c.level for c in environment_checks(client.settings)}
    assert levels["api_packages"] == levels["data_dir"] == "ok"
