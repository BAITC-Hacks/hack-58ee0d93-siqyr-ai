"""/events?token=: EventSource cannot send Authorization, so it opens the stream with a short-lived run token."""
import logging
from datetime import datetime, timedelta, timezone

import jwt

from backend.app.main import HideStreamToken
from test_api import wait_for
from test_auth import SECRET, admin_client


def done_run(client) -> str:
    run_id = client.post("/api/runs", data={"sample": "demo"}).json()["run_id"]
    wait_for(client, run_id, "awaiting_approval")
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True}).status_code == 200
    wait_for(client, run_id, "done")
    return run_id


def stream_token(client, run_id: str) -> str:
    response = client.post(f"/api/runs/{run_id}/events/token")
    assert response.status_code == 200, response.text
    assert response.json()["expires_in"] == 300
    return response.json()["token"]


def test_events_open_with_stream_token_without_authorization(client_factory):
    client = admin_client(client_factory)
    run_id = done_run(client)
    token = stream_token(client, run_id)
    bearer = client.headers.pop("Authorization")

    assert client.get(f"/api/runs/{run_id}/events").status_code == 401
    assert client.post(f"/api/runs/{run_id}/events/token").status_code == 401
    stream = client.get(f"/api/runs/{run_id}/events", params={"token": token})
    assert stream.status_code == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert "event: step" in stream.text and '"status": "done"' in stream.text
    # Last-Event-ID still applies: EventSource resends it on reconnect with the same URL.
    replay = client.get(f"/api/runs/{run_id}/events", params={"token": token}, headers={"Last-Event-ID": "1000"})
    assert "event: step" not in replay.text and '"status": "done"' in replay.text
    # The header keeps working for fetch-based clients and scripts.
    assert client.get(f"/api/runs/{run_id}/events", headers={"Authorization": bearer}).status_code == 200


def test_stream_token_is_bound_to_run_and_useless_as_bearer(client_factory):
    client = admin_client(client_factory)
    run_id, other_id = done_run(client), done_run(client)
    token = stream_token(client, run_id)
    access = client.headers.pop("Authorization")[7:]

    assert client.get(f"/api/runs/{other_id}/events", params={"token": token}).status_code == 401
    assert client.get(f"/api/runs/{run_id}/events", params={"token": access}).status_code == 401
    assert client.get("/api/runs", headers={"Authorization": "Bearer " + token}).status_code == 401
    assert client.get(f"/api/runs/{run_id}/events", params={"token": "garbage"}).status_code == 401


def test_expired_revoked_and_foreign_stream_tokens(client_factory):
    client = admin_client(client_factory)
    run_id = done_run(client)
    admin_id = client.get("/api/auth/me").json()["id"]
    created = client.post("/api/admin/users", json={"username": "outsider", "display_name": "Outsider",
                                                    "password": "strong-outsider-password"})
    assert created.status_code == 201
    login = client.post("/api/auth/login", json={"username": "outsider", "password": "strong-outsider-password"})
    outsider = {"Authorization": "Bearer " + login.json()["access_token"]}
    client.headers.pop("Authorization")

    now = datetime.now(timezone.utc)
    claims = {"sub": admin_id, "iss": "siqyr-ai", "aud": "siqyr-sse", "run": run_id, "iat": now,
              "exp": now + timedelta(minutes=5), "ver": 0}
    expired = jwt.encode({**claims, "exp": now - timedelta(seconds=1)}, SECRET, algorithm="HS256")
    revoked = jwt.encode({**claims, "ver": 7}, SECRET, algorithm="HS256")  # password changed after issue
    forged = jwt.encode(claims, "x" * 40, algorithm="HS256")
    for token in (expired, revoked, forged):
        assert client.get(f"/api/runs/{run_id}/events", params={"token": token}).status_code == 401

    # Department access is checked on connect too: no token for an outsider, and a valid one does not open the run.
    assert client.post(f"/api/runs/{run_id}/events/token", headers=outsider).status_code == 404
    outsider_token = jwt.encode({**claims, "sub": created.json()["id"]}, SECRET, algorithm="HS256")
    assert client.get(f"/api/runs/{run_id}/events", params={"token": outsider_token}).status_code == 404


def test_stream_token_in_disabled_auth_mode(client):
    run_id = done_run(client)
    token = client.post(f"/api/runs/{run_id}/events/token").json()["token"]
    assert client.get(f"/api/runs/{run_id}/events", params={"token": token}).status_code == 200


def test_access_log_hides_stream_token():
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1:5000", "GET", "/api/runs/r1/events?token=eyJ.secret.sig&x=1", "1.1", 200), None)
    assert HideStreamToken().filter(record)
    assert record.getMessage() == '127.0.0.1:5000 - "GET /api/runs/r1/events?token=***&x=1 HTTP/1.1" 200'
