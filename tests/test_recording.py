def test_recording_streams_chunks_then_starts_pipeline(client):
    response = client.post("/api/runs/recordings", data={
        "title": "Совещание с микрофона", "lang": "rukk", "meeting_date": "2026-09-23",
    })
    assert response.status_code == 201, response.text
    run_id = response.json()["run_id"]
    chunk_url = f"/api/runs/{run_id}/chunks"
    assert client.get(f"/api/runs/{run_id}").json()["run"]["status"] == "recording"
    assert client.post(f"/api/runs/{run_id}/finish").status_code == 400

    first = client.post(chunk_url, headers={"X-Chunk-Offset": "0"}, content=b"webm")
    assert first.status_code == 200 and first.json()["offset"] == 4
    retry = client.post(chunk_url, headers={"X-Chunk-Offset": "0"}, content=b"webm")
    assert retry.status_code == 200 and retry.json()["offset"] == 4
    assert client.post(chunk_url, headers={"X-Chunk-Offset": "0"}, content=b"bad").status_code == 409
    second = client.post(chunk_url, headers={"X-Chunk-Offset": "4"}, content=b"-audio")
    assert second.status_code == 200 and second.json()["offset"] == 10
    assert (client.settings.uploads_dir / f"{run_id}.webm").read_bytes() == b"webm-audio"

    finished = client.post(f"/api/runs/{run_id}/finish")
    assert finished.status_code == 200 and finished.json() == {"run_id": run_id, "status": "queued"}
    assert client.post(chunk_url, headers={"X-Chunk-Offset": "10"}, content=b"late").status_code == 409
    assert client.post(f"/api/runs/{run_id}/finish").status_code == 409


def test_recording_chunk_size_limit(client_factory):
    client = client_factory(max_upload_mb=0)
    run_id = client.post("/api/runs/recordings", data={"title": "Лимит"}).json()["run_id"]
    response = client.post(f"/api/runs/{run_id}/chunks", headers={"X-Chunk-Offset": "0"}, content=b"audio")
    assert response.status_code == 413
    assert (client.settings.uploads_dir / f"{run_id}.webm").read_bytes() == b""
