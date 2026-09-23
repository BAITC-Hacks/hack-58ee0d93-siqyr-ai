import importlib.util
from pathlib import Path

from backend.app.db import Database

SECRET = "a-long-local-test-secret-with-more-than-32-characters"
PASSWORD = "test-users-password"

spec = importlib.util.spec_from_file_location("seed_test_users", Path(__file__).resolve().parents[1] / "scripts" / "seed_test_users.py")
seed_test_users = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_test_users)


def login(client, username, password=PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def bearer(client, username, password=PASSWORD):
    response = login(client, username, password)
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def test_every_role_gets_its_own_rights(client_factory):
    client = client_factory(auth_mode="local", jwt_secret=SECRET)
    db = Database(client.settings)
    report = seed_test_users.seed(db, PASSWORD)
    assert [status for _, _, status in report] == ["создана"] * len(seed_test_users.USERS)

    admin = bearer(client, "test.admin")
    assert client.get("/api/auth/me", headers=admin).json()["is_system_admin"] is True
    assert client.get("/api/auth/me", headers=bearer(client, "test.secretary")).json()["departments"] == {"default": "secretary"}

    created = client.post("/api/runs", data={"sample": "demo"}, headers=bearer(client, "test.editor"))
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]
    viewer = bearer(client, "test.viewer")
    assert client.get(f"/api/runs/{run_id}", headers=viewer).status_code == 200
    assert client.post("/api/runs", data={"sample": "demo"}, headers=viewer).status_code == 403
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True}, headers=viewer).status_code == 403
    assert client.get(f"/api/runs/{run_id}", headers=bearer(client, "test.legal")).status_code == 404
    assert client.post("/api/admin/departments", json={"id": "sales", "name": "Продажи"}, headers=bearer(client, "test.dept_admin")).status_code == 403
    db.close()


def test_rerun_keeps_passwords_and_disable_revokes_access(client_factory):
    client = client_factory(auth_mode="local", jwt_secret=SECRET)
    db = Database(client.settings)
    seed_test_users.seed(db, PASSWORD)
    secretary = bearer(client, "test.secretary")

    assert {status for _, _, status in seed_test_users.seed(db, "another-long-password")} == {"уже есть"}
    assert login(client, "test.secretary").status_code == 200

    seed_test_users.seed(db, "another-long-password", reset_password=True)
    assert login(client, "test.secretary").status_code == 401
    assert client.get("/api/auth/me", headers=secretary).status_code == 401
    secretary = bearer(client, "test.secretary", "another-long-password")

    assert len(seed_test_users.disable(db)) == len(seed_test_users.USERS)
    assert client.get("/api/auth/me", headers=secretary).status_code == 401
    assert login(client, "test.secretary", "another-long-password").status_code == 401
    assert seed_test_users.seed(db, PASSWORD)[0][2] == "уже есть, включена"
    db.close()
