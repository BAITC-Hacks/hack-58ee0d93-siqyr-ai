"""Independent synthetic evaluation for backend.agents.runner.

Guard mode stubs the LLM and tests validation/retry/execute. Local mode sends
ONLY inputs.json to a loopback OpenAI-compatible endpoint; expected.json is
loaded only after all proposals have been produced. No real recordings here.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.agents import runner  # noqa: E402
from backend.app import llm  # noqa: E402
from backend.app.config import settings as app_settings  # noqa: E402
from backend.shared.schemas import RunInput  # noqa: E402

HERE = Path(__file__).resolve().parent


def _input(case_id: str) -> RunInput:
    raw = json.loads((HERE / "inputs.json").read_text(encoding="utf-8"))[case_id]
    return RunInput.model_validate({k: v for k, v in raw.items() if k != "split"})


def _synthetic_cases(split: str) -> list[str]:
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    inputs = json.loads((HERE / "inputs.json").read_text(encoding="utf-8"))
    records = {item["id"]: item for item in manifest["cases"]}
    if not manifest.get("synthetic") or set(records) != set(inputs):
        raise ValueError("Synthetic manifest is missing or does not match inputs")
    for case_id, value in inputs.items():
        record = records[case_id]
        if (not case_id.startswith(("d", "h")) or not value["run_id"].startswith("synthetic-")
                or not record.get("synthetic") or record.get("origin") != "scripted"
                or record.get("audio_path") is not None
                or record.get("split") != value["split"] or record.get("language") != value["lang"]):
            raise ValueError(f"Unverified synthetic case: {case_id}")
    return [key for key, value in inputs.items() if value["split"] == split]


def _reply(assignments: list[dict], summary: str = "Обсудили вымышленный рабочий вопрос.") -> str:
    return json.dumps({"summary": summary, "decisions": [], "speakers": {}, "assignments": assignments}, ensure_ascii=False)


def _e(index: int, quote: str, field: str) -> dict:
    return {"segment_index": index, "quote": quote, "field": field}


def _d04_valid() -> str:
    return _reply([{"assignee": "Томирис", "task": "Подготовить смету для бумажных драконов",
                    "deadline_text": "5 октября 2026 года", "deadline": "2026-10-05",
                    "source_segments": [0, 1],
                    "evidence": [_e(0, "Томирис, подготовь смету", "task"),
                                 _e(0, "Томирис", "assignee"),
                                 _e(1, "5 октября 2026 года", "deadline")] }])


async def _emit(event):
    return event


async def guard() -> int:
    """Deterministic tests of the current parser and post-approval behavior."""
    original = llm.complete
    failures = 0
    passed = 0

    async def exercise(name: str, case_id: str, responses: list[str], *, ok: bool,
                       expected_calls: int, contains: str = "", inspect=None):
        nonlocal failures, passed
        calls = []
        events = []

        async def fake(messages, **kwargs):
            calls.append(messages)
            return llm.Completion(content=responses[min(len(calls) - 1, len(responses) - 1)],
                                  tokens=0, cost_usd=0)

        async def capture(event):
            events.append(event)
            return event

        llm.complete = fake
        proposal = None
        error = None
        try:
            proposal = await runner.propose(_input(case_id), capture)
        except Exception as exc:
            error = exc
        good = (proposal is not None) == ok and len(calls) == expected_calls
        if contains:
            good = good and (contains in str(error) if error else False)
        if inspect and proposal is not None:
            good = good and inspect(proposal, events)
        if not ok:
            good = good and any(event.type == "error" for event in events)
        passed += bool(good)
        failures += not good
        print(f"{'PASS' if good else 'FAIL'} {name}: calls={len(calls)}, "
              f"assignments={len(proposal.assignments) if proposal else '-'}, error={error}")

    try:
        await exercise("no_assignment", "d01", [_reply([], "Цвет обсудили, поручений нет.")],
                       ok=True, expected_calls=1, inspect=lambda p, e: len(p.assignments) == 0)
        await exercise("valid_revision", "d04", [_d04_valid()], ok=True, expected_calls=1,
                       inspect=lambda p, e: len(p.assignments) == 1 and
                       str(p.assignments[0].deadline) == "2026-10-05" and
                       p.assignments[0].source_segments == [0, 1])
        await exercise("unknown_owner_v01", "d02", [_reply([{
            "assignee": None, "task": "Хаттаманы әзірлеу", "deadline": None,
            "deadline_text": "жұмаға дейін", "source_segments": [1],
            "evidence": [_e(1, "Хаттаманы", "task"), _e(1, "жұмаға дейін", "deadline")]}])],
            ok=True, expected_calls=1,
            inspect=lambda p, e: p.assignments[0].assignee == "Не указан")
        await exercise("external_non_speaker_owner", "d03", [_reply([{
            "assignee": "Жұлдыз бөлімі", "task": "макетін жіберсін", "deadline": "2026-10-02",
            "deadline_text": "2026-10-02", "source_segments": [0],
            "evidence": [_e(0, "макетін", "task"), _e(0, "Жұлдыз бөлімі", "assignee"),
                         _e(0, "2026-10-02", "deadline")]}])],
            ok=True, expected_calls=1,
            inspect=lambda p, e: p.assignments[0].assignee == "Жұлдыз бөлімі")
        await exercise("conflict_keeps_null_date", "d05", [_reply([{
            "assignee": "Айбар", "task": "шамдардың тізімін жаса", "deadline": None,
            "deadline_text": "3 қазан 2026; 6 қазан 2026",
            "source_segments": [0, 1],
            "evidence": [_e(0, "Айбар", "assignee"), _e(0, "шамдардың тізімін жаса", "task"),
                         _e(0, "3 қазан 2026", "deadline"), _e(1, "6 қазан 2026", "deadline")]}])],
            ok=True, expected_calls=1,
            inspect=lambda p, e: p.assignments[0].deadline is None)
        await exercise("repair_after_empty", "d04", ["", _d04_valid()],
                       ok=True, expected_calls=2, inspect=lambda p, e: len(p.assignments) == 1)
        await exercise("bad_source_index", "d04", [_reply([{
            "assignee": None, "task": "Смету", "deadline": None, "deadline_text": None,
            "source_segments": [99], "evidence": [_e(99, "смету", "task")]}])],
            ok=False, expected_calls=2, contains="Некорректный индекс источника")
        await exercise("quote_not_in_raw", "d04", [_reply([{
            "assignee": None, "task": "Смету", "deadline": None, "deadline_text": None,
            "source_segments": [0], "evidence": [_e(0, "вымышленная цитата", "task")]}])],
            ok=False, expected_calls=2, contains="Цитата отсутствует")
        await exercise("duplicate_source", "d04", [_reply([{
            "assignee": None, "task": "Смету", "deadline": None, "deadline_text": None,
            "source_segments": [0, 0], "evidence": [_e(0, "смету", "task")]}])],
            ok=False, expected_calls=2, contains="Повторный индекс")
        await exercise("missing_evidence", "d04", [_reply([{
            "assignee": None, "task": "Смету", "deadline": None, "deadline_text": None,
            "source_segments": [0], "evidence": []}])],
            ok=False, expected_calls=2, contains="без источников или цитат")
        await exercise("empty_response", "d01", [""], ok=False, expected_calls=2,
                       contains="пустой ответ")
        await exercise("truncated_json", "d01", ['{"summary":"Нача'], ok=False,
                       expected_calls=2, contains="JSON")
        await exercise("broken_json", "d01", ["{bad json}"], ok=False,
                       expected_calls=2, contains="JSON")
        await exercise("model_refusal", "d01", ['{"refusal":"no"}'], ok=False,
                       expected_calls=2, contains="отказалась")
        # Semantic checks intentionally expose what validation cannot guarantee.
        false_positive = _reply([{"assignee": None, "task": "Сделать синий фон",
                                 "deadline": None, "deadline_text": None,
                                 "source_segments": [1],
                                 "evidence": [_e(1, "Синий нравится", "task")]}])
        await exercise("semantic_false_positive_detected_by_gold", "d01", [false_positive],
                       ok=True, expected_calls=1,
                       inspect=lambda p, e: score({"proposal": p.model_dump(mode="json")},
                                                  {"assignments": []})["false_positives"] == 1)
        unresolved_as_agreed = _reply([{
            "assignee": "Айбар", "task": "шамдардың тізімін жаса", "deadline": "2026-10-06",
            "deadline_text": "6 қазан 2026", "source_segments": [0, 1],
            "evidence": [_e(0, "Айбар", "assignee"), _e(0, "шамдардың тізімін жаса", "task"),
                         _e(1, "6 қазан 2026", "deadline")]}])
        await exercise("unagreed_deadline_detected_by_gold", "d05", [unresolved_as_agreed],
                       ok=True, expected_calls=1,
                       inspect=lambda p, e: p.assignments[0].deadline is not None and
                       not score({"proposal": p.model_dump(mode="json")},
                                 json.loads((HERE / "expected.json").read_text(encoding="utf-8"))["d05"])
                       ["cases"][0]["deadline_ok"])

        # execute must not call the model, and unknown owners must not get excerpts.
        async def forbidden(*args, **kwargs):
            raise AssertionError("execute called LLM")

        llm.complete = forbidden
        proposal = runner._parse(_d04_valid(), _input("d04"))
        result = await runner.execute(proposal, _emit)
        good = len(result.excerpts) == 1 and result.excerpts[0].recipient == "Томирис"
        print(f"{'PASS' if good else 'FAIL'} execute_no_llm: excerpts={len(result.excerpts)}")
        failures += not good
        passed += bool(good)
        print(f"Guard: {passed} passed, {failures} failed. These are validation tests, not model accuracy.")
        return 1 if failures else 0
    finally:
        llm.complete = original


async def local(split: str, base_url: str, model: str, output: Path) -> int:
    """First measure on synthetic transcript inputs; score after inference only."""
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite prior measurement: {output}")
    parsed = urlparse(base_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Only an explicit loopback HTTP LLM endpoint is allowed")
    if not model:
        raise ValueError("--model is required; model names are never guessed")
    case_ids = _synthetic_cases(split)
    original = llm.complete
    prompt_sha256 = hashlib.sha256(runner._PROMPT.encode()).hexdigest()
    completions: dict[str, list[str]] = {}
    active_id = ""
    format_used = "json"

    async def complete(messages, **kwargs):
        nonlocal format_used
        response_format = kwargs.get("response_format", {})
        schema = response_format.get("json_schema", {}).get("schema")
        format_used = "product_schema" if schema else "json"
        body = json.dumps({"model": model, "messages": messages, "stream": False,
                           "format": schema or "json", "think": False,
                           "options": {"num_predict": 1024}}, ensure_ascii=False).encode()
        endpoint = f"{parsed.scheme}://{parsed.netloc}/api/chat"

        def request_local():
            request = Request(endpoint, data=body, headers={"Content-Type": "application/json"})
            with urlopen(request, timeout=90) as response:
                return json.load(response)

        answer = await asyncio.to_thread(request_local)
        content = answer["message"].get("content") or ""
        completions.setdefault(active_id, []).append(content)
        return llm.Completion(content=content, tokens=0, cost_usd=0)

    llm.complete = complete
    raw = {}
    try:
        for case_id in case_ids:
            active_id = case_id
            events = []

            async def capture(event):
                events.append(event.model_dump(mode="json"))
                return event

            try:
                proposal = await runner.propose(_input(case_id), capture)
                raw[case_id] = {"proposal": proposal.model_dump(mode="json"),
                                "model_responses": completions.get(case_id, []), "events": events}
            except Exception as exc:
                raw[case_id] = {"error": f"{type(exc).__name__}: {exc}",
                                "model_responses": completions.get(case_id, []), "events": events}
            print(f"completed {case_id}: " + ("ok" if "proposal" in raw[case_id] else raw[case_id]["error"]),
                  flush=True)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps({"split": split, "model": model, "base_url": base_url,
                                          "api": "ollama_native", "format": format_used,
                                          "think": False, "prompt_sha256": prompt_sha256,
                                          "num_predict": 1024,
                                          "raw": raw}, ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        llm.complete = original

    # Persist model output before opening the answer key; no expected values
    # are placed in the prompt, LLM completion, repair prompt, or cache.
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"split": split, "model": model, "base_url": base_url,
                                  "api": "ollama_native", "format": format_used,
                                  "think": False, "prompt_sha256": prompt_sha256,
                                  "num_predict": 1024, "raw": raw},
                                 ensure_ascii=False, indent=2), encoding="utf-8")
    gold = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))
    scores = {case_id: score(raw[case_id], gold[case_id]) for case_id in case_ids}
    for case_id in case_ids:
        print(f"{case_id}: {scores[case_id]}")
    score_path = output.with_name(output.stem + "_scores.json")
    score_path.write_text(json.dumps(scores, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Raw: {output}; scores: {score_path}")
    return 0


async def hosted(split: str, output: Path) -> int:
    """Measure synthetic cases via the production llm.complete transport only."""
    from dotenv import dotenv_values

    if output.exists():
        raise FileExistsError(f"Refusing to overwrite prior measurement: {output}")
    case_ids = _synthetic_cases(split)
    source_env = Path("/Users/user/Desktop/hack-58ee0d93-siqyr-ai/.env")
    api_key = dotenv_values(source_env).get("OPENAI_API_KEY") if source_env.exists() else None
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is absent in the source .env")
    config = replace(app_settings, llm_base_url="https://api.openai.com/v1", llm_api_key=api_key,
                     model_main="gpt-6-luna", model_fast="gpt-6-luna",
                     price_in_per_1m=0.10, price_out_per_1m=0.50)
    service = llm.LLM(None, config)  # cache disabled for every request: no DB or product data
    prompt_sha256 = hashlib.sha256(runner._PROMPT.encode()).hexdigest()
    llm.configure(service)
    original = llm.complete
    raw: dict[str, dict] = {}
    completions: dict[str, list[dict]] = {}
    spent = 0.0
    calls = 0
    active_id = ""

    async def bounded_complete(messages, **kwargs):
        nonlocal spent, calls
        if calls >= 2 * len(case_ids) or spent >= 5.0:
            raise RuntimeError("Hosted eval call or $5 budget limit reached")
        calls += 1
        request_kwargs = {**kwargs, "model": "gpt-6-luna", "use_cache": False,
                          "max_completion_tokens": 1024, "reasoning_effort": "none"}
        result = await original(messages, **request_kwargs)
        spent += result.cost_usd
        completions.setdefault(active_id, []).append({"content": result.content,
                                                        "tokens": result.tokens,
                                                        "cost_usd": result.cost_usd})
        return result

    llm.complete = bounded_complete
    try:
        for case_id in case_ids:
            active_id = case_id
            events = []

            async def capture(event):
                events.append(event.model_dump(mode="json"))
                return event

            try:
                proposal = await runner.propose(_input(case_id), capture)
                raw[case_id] = {"proposal": proposal.model_dump(mode="json"),
                                "model_responses": completions.get(case_id, []), "events": events}
            except Exception as exc:
                raw[case_id] = {"error": f"{type(exc).__name__}: {exc}",
                                "model_responses": completions.get(case_id, []), "events": events}
            print(f"completed {case_id}: " + ("ok" if "proposal" in raw[case_id] else raw[case_id]["error"]),
                  flush=True)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps({"split": split, "model": "gpt-6-luna", "provider": "openai",
                                          "synthetic_only": True, "max_completion_tokens": 1024,
                                          "reasoning_effort": "none", "prompt_sha256": prompt_sha256,
                                          "calls": calls,
                                          "cost_usd": spent, "raw": raw},
                                         ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        llm.complete = original
        llm.configure(None)
        await service.close()

    # Expected answers are loaded only after all raw responses are persisted.
    gold = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))
    scores = {case_id: score(raw[case_id], gold[case_id]) for case_id in case_ids}
    for case_id in case_ids:
        print(f"{case_id}: {scores[case_id]}")
    score_path = output.with_name(output.stem + "_scores.json")
    score_path.write_text(json.dumps(scores, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Raw: {output}; scores: {score_path}; calls={calls}; cost_usd={spent:.6f}")
    return 0


def _norm(value: str | None) -> str:
    return " ".join((value or "").casefold().replace("ё", "е").split())


def score(result: dict, gold: dict) -> dict:
    """One-to-one source-overlap matching; retain field errors separately."""
    if "error" in result:
        return {"error": result["error"], "gold": len(gold["assignments"]), "found": 0}
    found = result["proposal"]["assignments"]
    expected = gold["assignments"]
    remaining = list(range(len(found)))
    details = []
    for item in expected:
        best = max(remaining, key=lambda i: len(set(item["source_segments"]) &
                                                set(found[i]["source_segments"])), default=None)
        if best is None or not set(item["source_segments"]) & set(found[best]["source_segments"]):
            details.append({"matched": False})
            continue
        remaining.remove(best)
        actual = found[best]
        task = _norm(actual["task"])
        deadline_text = _norm(actual.get("deadline_text"))
        details.append({"matched": True,
                        "task_terms_ok": all(_norm(term) in task for term in item["task_terms"]),
                        "assignee_ok": (_norm(actual["assignee"]) == _norm(item["assignee"]) or
                                        (item["assignee"] is None and actual["assignee"] == "Не указан")),
                        "legacy_unknown_owner_sentinel": item["assignee"] is None and
                                                         actual["assignee"] == "Не указан",
                        "deadline_ok": actual["deadline"] == item["deadline"],
                        "deadline_text_ok": all(_norm(term) in deadline_text for term in item["deadline_text_terms"]),
                        "source_segments_ok": set(actual["source_segments"]) == set(item["source_segments"]),
                        "review_reasons_available": "review_reasons" in actual,
                        "expected_review_reasons": item.get("review_reasons", [])})
    return {"gold": len(expected), "found": len(found), "matched": sum(x["matched"] for x in details),
            "false_positives": len(remaining), "cases": details}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["guard", "local", "hosted"])
    parser.add_argument("--split", choices=["dev", "holdout"], default="dev")
    parser.add_argument("--base-url", default="http://127.0.0.1:11434/v1")
    parser.add_argument("--model", default="")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.mode == "guard":
        return asyncio.run(guard())
    if args.mode == "hosted":
        output = args.output or HERE / f"hosted_{args.split}.json"
        return asyncio.run(hosted(args.split, output))
    output = args.output or HERE / f"local_{args.split}.json"
    return asyncio.run(local(args.split, args.base_url, args.model, output))


if __name__ == "__main__":
    raise SystemExit(main())
