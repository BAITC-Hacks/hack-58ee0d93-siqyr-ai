import base64
import json
from datetime import datetime, timedelta, timezone

import jwt
import httpx
from cryptography.hazmat.primitives.asymmetric import rsa

from backend.app.models import ExternalIdentity, User


SECRET = "a-long-local-test-secret-with-more-than-32-characters"


def test_cors_allows_localhost_on_any_port_but_rejects_lookalikes(client_factory):
    client = client_factory()
    for origin in ("http://localhost:5184", "http://127.0.0.1:5184", "https://localhost:5184"):
        response = client.options("/api/auth/login", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
    rejected = client.options("/api/auth/login", headers={
        "Origin": "http://localhost.evil.test:5184", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def admin_client(client_factory):
    client = client_factory(auth_mode="local", jwt_secret=SECRET,
        bootstrap_admin_user="admin", bootstrap_admin_password="strong-admin-password")
    response = client.post("/api/auth/login", json={"username": "admin", "password": "strong-admin-password"})
    assert response.status_code == 200, response.text
    client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
    return client


def test_local_login_and_department_isolation(client_factory):
    client = admin_client(client_factory)
    assert client.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    assert client.get("/api/auth/me").json()["is_system_admin"] is True
    for department in ("finance", "legal"):
        assert client.post("/api/admin/departments", json={"id": department, "name": department}).status_code == 201
    response = client.post("/api/admin/users", json={
        "username": "analyst", "display_name": "Analyst", "password": "strong-analyst-password"})
    assert response.status_code == 201
    user_id = response.json()["id"]
    assert client.post("/api/admin/memberships", json={
        "user_id": user_id, "department_id": "finance", "role": "viewer"}).status_code == 201
    created = client.post("/api/runs", data={"sample": "demo", "department_id": "legal"})
    assert created.status_code == 201
    legal_id = created.json()["run_id"]
    analyst_login = client.post("/api/auth/login", json={"username": "analyst", "password": "strong-analyst-password"})
    analyst = {"Authorization": "Bearer " + analyst_login.json()["access_token"]}
    assert client.get("/api/runs", headers=analyst).json() == []
    assert client.get(f"/api/runs/{legal_id}", headers=analyst).status_code == 404
    assert client.get(f"/api/runs/{legal_id}/events", headers=analyst).status_code == 404
    assert client.get(f"/api/runs/{legal_id}/protocol.pdf", headers=analyst).status_code == 404
    assert client.post("/api/runs", data={"sample": "demo", "department_id": "finance"}, headers=analyst).status_code == 403
    assert client.post(f"/api/runs/{legal_id}/approve", json={"approved": True}, headers=analyst).status_code == 404
    assert client.get("/api/assignments", headers=analyst).json() == []
    assert client.get("/api/notifications", headers=analyst).json() == []
    assert client.post("/api/reminders/run", headers=analyst).status_code == 403
    assert client.get("/api/runs").json()[0]["department_id"] == "legal"
    assert client.get("/api/runs").status_code == 200
    assert client.patch(f"/api/admin/users/{user_id}", json={"active": False}).status_code == 200
    assert client.get("/api/auth/me", headers=analyst).status_code == 401


def test_missing_and_expired_token(client_factory):
    client = admin_client(client_factory)
    client.headers.clear()
    assert client.get("/api/runs").status_code == 401
    now = datetime.now(timezone.utc)
    expired = jwt.encode({"sub": "missing", "iss": "siqyr-ai", "aud": "siqyr-api",
        "exp": now - timedelta(seconds=1)}, SECRET, algorithm="HS256")
    assert client.get("/api/runs", headers={"Authorization": "Bearer " + expired}).status_code == 401


def test_keycloak_token_requires_registered_identity(client_factory):
    issuer = "https://sso.example.test/realms/samruk"
    client = client_factory(auth_mode="keycloak", jwt_secret=SECRET,
        keycloak_issuer=issuer, keycloak_audience="siqyr-api")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class Keys:
        def get_signing_key_from_jwt(self, token):
            class Result:
                pass
            result = Result()
            result.key = key.public_key()
            return result

    client.app.state.auth.jwks = Keys()
    now = datetime.now(timezone.utc)
    token = jwt.encode({"sub": "keycloak-user-1", "iss": issuer, "aud": "siqyr-api",
        "iat": now, "exp": now + timedelta(minutes=5)}, key, algorithm="RS256")
    header = {"Authorization": "Bearer " + token}
    assert client.get("/api/auth/me", headers=header).status_code == 401
    with client.app.state.runtime.db.session() as session:
        user = User(username="kc", display_name="Keycloak User")
        session.add(user)
        session.commit()
        session.add(ExternalIdentity(user_id=user.id, provider="keycloak", subject="keycloak-user-1"))
        session.commit()
    assert client.get("/api/auth/me", headers=header).json()["username"] == "kc"
    assert client.post("/api/auth/login", json={"username": "kc", "password": "x"}).status_code == 404


def test_ecp_disabled_without_verifier(client_factory):
    client = admin_client(client_factory)
    assert client.post("/api/auth/ecp/challenge").status_code == 503
    assert client.post("/api/auth/ecp/verify", json={"challenge_id": "x", "cms": "x"}).status_code == 503


def test_ecp_verified_challenge_is_single_use(client_factory, monkeypatch):
    client = client_factory(auth_mode="local", jwt_secret=SECRET, ecp_verify_url="http://verifier.internal/verify")
    with client.app.state.runtime.db.session() as session:
        user = User(username="ecp", display_name="ECP User")
        session.add(user)
        session.commit()
        session.add(ExternalIdentity(user_id=user.id, provider="ecp", subject="certificate:123"))
        session.commit()
    original_client = httpx.AsyncClient

    def verified(request):
        payload = json.loads(request.content)["payload"]
        return httpx.Response(200, json={"valid": True, "certificate_valid": True,
            "revocation_checked": True, "payload": payload, "subject": "certificate:123"})

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(verified), **kwargs))
    challenge = client.post("/api/auth/ecp/challenge").json()
    assert base64.b64decode(challenge["data_base64"]).startswith(b"siqyr-ai:login:")
    body = {"challenge_id": challenge["challenge_id"], "cms": "signed-cms"}
    response = client.post("/api/auth/ecp/verify", json=body)
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer " + token}).json()["username"] == "ecp"
    assert client.post("/api/auth/ecp/verify", json=body).status_code == 401
