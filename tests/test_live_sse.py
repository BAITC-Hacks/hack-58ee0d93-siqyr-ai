"""A real socket is necessary: TestClient buffers an open SSE response."""
import socket
import threading
import time

import httpx
import uvicorn

from backend.app.main import create_app
from scripts.demo_e2e import read_until


def test_live_sse_approval_and_reconnect(client_factory):
    configured = client_factory()
    app = create_app(configured.settings)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error", ws="none"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            assert thread.is_alive() and time.monotonic() < deadline
            time.sleep(0.01)
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=15, trust_env=False) as client:
            response = client.post("/api/runs", files={"sample": (None, "demo")})
            assert response.status_code == 201
            run_id = response.json()["run_id"]
            last_id = read_until(client, run_id, "awaiting_approval")
            assert last_id > 0
            assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True}).status_code == 200
            final_id = read_until(client, run_id, "done", last_id)
            assert final_id > last_id
            assert client.get(f"/api/runs/{run_id}/protocol.docx").content.startswith(b"PK")
            assert client.get(f"/api/runs/{run_id}/protocol.pdf").content.startswith(b"%PDF")
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()
        assert not thread.is_alive()
