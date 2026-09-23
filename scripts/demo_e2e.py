"""Exercise a running API through live SSE; only synthetic sample data is used."""
import json
import os
import sys
from pathlib import Path

import httpx


def read_until(client, run_id, target, last_id=0):
    with client.stream("GET", f"/api/runs/{run_id}/events", headers={"Last-Event-ID": str(last_id)}) as response:
        response.raise_for_status()
        kind, payload = "", ""
        for line in response.iter_lines():
            if line.startswith("event: "):
                kind = line[7:]
            elif line.startswith("id: "):
                last_id = int(line[4:])
            elif line.startswith("data: "):
                payload = line[6:]
            elif not line and payload:
                data = json.loads(payload)
                if kind == "step":
                    print(f"[{data['seq']:02d}] {data['agent']} / {data['type']}: {data['content']}", flush=True)
                elif kind == "status":
                    print(f"status: {data['status']}", flush=True)
                    if data["status"] == target:
                        return last_id
                    if data["status"] in {"error", "rejected", "done"}:
                        raise RuntimeError(f"Unexpected terminal status: {data['status']}")
                kind, payload = "", ""
    raise RuntimeError(f"SSE closed before {target}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    base_url = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
    with httpx.Client(base_url=base_url, timeout=120, trust_env=False) as client:
        response = client.post("/api/runs", files={"sample": (None, "demo")})
        response.raise_for_status()
        run_id = response.json()["run_id"]
        print(f"Synthetic run: {run_id}")
        last_id = read_until(client, run_id, "awaiting_approval")
        client.post(f"/api/runs/{run_id}/approve", json={"approved": True}).raise_for_status()
        read_until(client, run_id, "done", last_id)
        document = client.get(f"/api/runs/{run_id}/protocol.docx")
        document.raise_for_status()
        if not document.content.startswith(b"PK"):
            raise RuntimeError("Invalid DOCX header")
        output = Path(os.environ.get("DEMO_OUTPUT_DIR", "data/runtime/demo_e2e"))
        output.mkdir(parents=True, exist_ok=True)
        destination = output / f"protocol-{run_id}.docx"
        destination.write_bytes(document.content)
        print(f"OK: {destination}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
