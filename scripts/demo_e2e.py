"""Exercise a running API through live SSE: create -> review -> approve revision -> DOCX + PDF.

    python scripts/demo_e2e.py                                   # synthetic sample
    python scripts/demo_e2e.py --file rec.wav --meeting-date 2026-09-23 --lang rukk
"""
import argparse
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, help="own recording instead of the synthetic sample")
    parser.add_argument("--meeting-date")
    parser.add_argument("--lang", default="rukk")
    parser.add_argument("--sample", default="demo")
    parser.add_argument("--mode", help="expected source_mode: real | mock | replay")
    parser.add_argument("--jira", action="store_true", help="after export, create Jira issues (POST /api/runs/{id}/jira)")
    args = parser.parse_args()
    base_url = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
    with httpx.Client(base_url=base_url, timeout=120, trust_env=False) as client:
        username = os.environ.get("DEMO_USER") or os.environ.get("BOOTSTRAP_ADMIN_USER")
        password = os.environ.get("DEMO_PASSWORD") or os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
        if username and password:
            login = client.post("/api/auth/login", json={"username": username, "password": password})
            login.raise_for_status()
            client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        form = {"lang": (None, args.lang)}
        if args.meeting_date:
            form["meeting_date"] = (None, args.meeting_date)
        if args.file:
            form["file"] = (args.file.name, args.file.read_bytes())
        else:
            form["sample"] = (None, args.sample)
        response = client.post("/api/runs", files=form)
        if response.status_code >= 400:
            raise RuntimeError(f"{response.status_code}: {response.json().get('detail')}")
        run_id = response.json()["run_id"]
        print(f"Run: {run_id} ({'file ' + args.file.name if args.file else 'synthetic sample'})")
        last_id = read_until(client, run_id, "awaiting_approval")
        detail = client.get(f"/api/runs/{run_id}").json()
        proposal = detail["proposal"]
        print(f"source_mode={proposal['source_mode']} revision={proposal['revision']} assignments={len(proposal['assignments'])}")
        if args.mode and proposal["source_mode"] != args.mode:
            raise RuntimeError(f"Expected source_mode={args.mode}, got {proposal['source_mode']}")
        for item in proposal["assignments"]:
            print(f"  - {item['assignee'] or 'не указан'}: {item['task']} | срок {item['deadline'] or item['deadline_text'] or '—'}"
                  f" | review: {', '.join(item['review_reasons']) or 'нет'}")
        approval = client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "expected_revision": proposal["revision"]})
        if approval.status_code == 409 and approval.json().get("code") == "review_required":
            raise RuntimeError(f"Нужна ручная проверка поручений {approval.json()['assignments']}: откройте UI.")
        approval.raise_for_status()
        read_until(client, run_id, "done", last_id)
        output = Path(os.environ.get("DEMO_OUTPUT_DIR", "data/runtime/demo_e2e"))
        output.mkdir(parents=True, exist_ok=True)
        for kind, magic in (("docx", b"PK"), ("pdf", b"%PDF")):
            document = client.get(f"/api/runs/{run_id}/protocol.{kind}")
            document.raise_for_status()
            if not document.content.startswith(magic):
                raise RuntimeError(f"Invalid {kind.upper()} header")
            destination = output / f"protocol-{run_id}.{kind}"
            destination.write_bytes(document.content)
            print(f"OK: {destination}")
        if args.jira:
            pushed = client.post(f"/api/runs/{run_id}/jira")
            if pushed.status_code >= 400:
                raise RuntimeError(f"Jira {pushed.status_code}: {pushed.json().get('detail')}")
            body = pushed.json()
            print(f"Jira {body['project']}: создано {len(body['created'])}, спринт {body['sprint'] or '—'}")
            for issue in body["issues"]:
                print(f"  - {issue['url']}{'' if issue['assigned'] else '  (исполнитель не сопоставлен)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
