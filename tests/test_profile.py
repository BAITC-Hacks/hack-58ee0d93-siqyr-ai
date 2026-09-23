import io

from PIL import Image


SECRET = "profile-test-secret-with-more-than-32-characters"


def _client(client_factory):
    client = client_factory(auth_mode="local", jwt_secret=SECRET,
        bootstrap_admin_user="admin", bootstrap_admin_password="strong-admin-password")
    login = client.post("/api/auth/login", json={"username": "admin", "password": "strong-admin-password"})
    assert login.status_code == 200
    client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
    return client


def test_profile_settings_persist_and_password_revokes_previous_token(client_factory):
    client = _client(client_factory)
    old_token = client.headers["Authorization"]
    profile = client.get("/api/profile").json()
    assert profile["username"] == "admin"
    assert profile["settings"] == {"language": "ru", "theme": "system", "notifications_enabled": True}
    assert profile["avatar_url"] is None
    changed = client.patch("/api/profile", json={"display_name": "  Секретарь  ",
        "language": "kk", "theme": "dark", "notifications_enabled": False})
    assert changed.status_code == 200, changed.text
    assert changed.json()["display_name"] == "Секретарь"
    assert changed.json()["settings"] == {"language": "kk", "theme": "dark", "notifications_enabled": False}
    assert client.get("/api/profile").json()["settings"] == changed.json()["settings"]
    assert client.patch("/api/profile", json={"language": "de"}).status_code == 400
    assert client.patch("/api/profile", json={"display_name": "   "}).status_code == 400
    assert client.patch("/api/profile", json={}).status_code == 400
    assert client.post("/api/profile/password", json={
        "current_password": "wrong", "new_password": "another-strong-password"}).status_code == 401
    response = client.post("/api/profile/password", json={
        "current_password": "strong-admin-password", "new_password": "another-strong-password"})
    assert response.status_code == 200, response.text
    assert client.get("/api/profile", headers={"Authorization": old_token}).status_code == 401
    client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
    assert client.get("/api/profile").status_code == 200
    assert client.post("/api/auth/login", json={"username": "admin", "password": "strong-admin-password"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": "another-strong-password"}).status_code == 200


def test_avatar_is_sanitized_and_private(client_factory):
    client = _client(client_factory)
    image = Image.new("RGB", (600, 300), "red")
    source = io.BytesIO()
    image.save(source, format="PNG")
    response = client.put("/api/profile/avatar", files={"file": ("avatar.png", source.getvalue(), "image/png")})
    assert response.status_code == 200, response.text
    avatar = client.get("/api/profile/avatar")
    assert avatar.status_code == 200
    assert avatar.headers["content-type"] == "image/webp"
    assert avatar.headers["cache-control"].startswith("private")
    with Image.open(io.BytesIO(avatar.content)) as normalized:
        assert normalized.format == "WEBP"
        assert normalized.size == (256, 256)
    assert client.get("/api/profile").json()["avatar_url"] == "/api/profile/avatar"
    assert client.put("/api/profile/avatar", files={"file": ("fake.png", b"not an image", "image/png")}).status_code == 415
    assert client.put("/api/profile/avatar", files={"file": ("big.png", b"x" * (2 * 1024 * 1024 + 1), "image/png")}).status_code == 413

    new_user = client.post("/api/admin/users", json={"username": "colleague", "display_name": "Colleague",
        "password": "colleague-password"}).json()
    assert new_user["username"] == "colleague"
    colleague = client.post("/api/auth/login", json={"username": "colleague", "password": "colleague-password"}).json()
    own_header = {"Authorization": "Bearer " + colleague["access_token"]}
    assert client.get("/api/profile/avatar", headers=own_header).status_code == 404
    assert client.delete("/api/profile/avatar").status_code == 204
    assert client.get("/api/profile/avatar").status_code == 404


def test_profile_requires_auth_and_demo_is_read_only(client_factory):
    client = _client(client_factory)
    client.headers.clear()
    assert client.get("/api/profile").status_code == 401
    assert client.patch("/api/profile", json={"theme": "dark"}).status_code == 401
    demo = client_factory(auth_mode="disabled")
    assert demo.get("/api/profile").json()["username"] == "demo"
    assert demo.patch("/api/profile", json={"theme": "dark"}).status_code == 403
