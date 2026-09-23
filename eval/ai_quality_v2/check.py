"""Independent, fully fictional v0.2 evaluation of the product agent runner.

`run` reads only inputs and manifest. `score` opens expected only after a raw
result file exists. No hosted transport is implemented here.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import unicodedata
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
INPUTS = HERE / "inputs.json"
EXPECTED = HERE / "expected.json"
MANIFEST = HERE / "manifest.json"


def load_inputs() -> dict:
    raw = INPUTS.read_bytes()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    cases = json.loads(raw)
    if not (manifest.get("synthetic") is True
            and manifest.get("origin") == "manually_scripted_fiction"
            and manifest.get("audio_path") is None
            and manifest.get("inputs_sha256") == hashlib.sha256(raw).hexdigest()
            and set(manifest.get("case_ids", [])) == set(cases)):
        raise ValueError("Synthetic manifest or input SHA mismatch; review fixtures before any run")
    for case_id, case in cases.items():
        if not case["run_id"].startswith("synthetic-v2-") or case["lang"] not in {"ru", "kk", "rukk"}:
            raise ValueError(f"Unverified synthetic case {case_id}")
        if not case["segments"] or any(not isinstance(s.get("text"), str) or not s["text"] for s in case["segments"]):
            raise ValueError(f"Empty text in {case_id}")
    return cases


def select_cases(cases: dict, requested: list[str] | None) -> list[str]:
    selected = requested or list(cases)
    if len(selected) != len(set(selected)) or not set(selected) <= set(cases):
        raise ValueError("Unknown or repeated --cases ID")
    return selected


def norm(value: str | None) -> str:
    return " ".join("".join(c.casefold() if c.isalnum() else " " for c in
                            unicodedata.normalize("NFKC", value or "")).split())


def has_candidate_date(candidates: list[str], iso: str) -> bool:
    """A candidate may keep the spoken date words rather than an ISO string."""
    year, month, day = iso.split("-")
    months = {"01": "января", "02": "февраля", "03": "марта", "04": "апреля",
              "05": "мая", "06": "июня", "07": "июля", "08": "августа",
              "09": "сентября", "10": "октября", "11": "ноября", "12": "декабря"}
    for candidate in candidates:
        if iso in candidate:
            return True
        if re.search(rf"\b{int(day)}\s+{months[month]}\s+{year}\b", candidate.casefold()):
            return True
    return False


def evidence_errors(assignment: dict, source: dict) -> list[str]:
    errors = []
    segments = source["segments"]
    refs = assignment.get("source_segments", [])
    if not refs or len(refs) != len(set(refs)) or any(type(i) is not int or i < 0 or i >= len(segments) for i in refs):
        return ["invalid source_segments"]
    citations = assignment.get("evidence", [])
    if not citations:
        return ["missing evidence"]
    cited = set()
    task_cited = False
    for citation in citations:
        index = citation.get("segment_index")
        quote = citation.get("quote")
        field = citation.get("field")
        if type(index) is not int or index not in refs:
            errors.append("invalid evidence index")
            continue
        if not isinstance(quote, str) or not norm(quote) or norm(quote) not in norm(segments[index]["text"]):
            errors.append(f"unsupported quote at {index}")
        if field not in {"task", "assignee", "deadline", "context"}:
            errors.append("invalid evidence field")
        cited.add(index)
        task_cited |= field == "task"
    if cited != set(refs):
        errors.append("uncited source index")
    if not task_cited:
        errors.append("missing task quote")
    return errors


def score_case(result: dict, expected: dict, source: dict, strict: bool = False) -> list[str]:
    if "error" in result:
        return [f"runner error: {result['error']}"]
    proposal = result.get("proposal") or {}
    actual = proposal.get("assignments") or []
    gold = expected["assignments"]
    errors: list[str] = []
    if len(actual) != len(gold):
        errors.append(f"assignment count {len(actual)} != {len(gold)}")
    unused = set(range(len(actual)))
    for ordinal, item in enumerate(gold, 1):
        matches = [i for i in unused if all(norm(term) in norm(actual[i].get("task")) for term in item["task_terms"])]
        if not matches:
            errors.append(f"task {ordinal} missing: {item['task_terms']}")
            continue
        index = max(matches, key=lambda i: len(set(actual[i].get("source_segments", [])) & set(item["source_segments"])))
        unused.remove(index)
        found = actual[index]
        for field in ("assignee", "deadline"):
            if norm(found.get(field)) != norm(item[field]):
                errors.append(f"task {ordinal} {field}: {found.get(field)!r} != {item[field]!r}")
        if set(found.get("source_segments", [])) != set(item["source_segments"]):
            errors.append(f"task {ordinal} source_segments: {found.get('source_segments')!r}")
        reasons = set(found.get("review_reasons") or [])
        if strict and reasons != set(item["review_reasons"]):
            errors.append(f"task {ordinal} review_reasons: {sorted(reasons)} != {item['review_reasons']}")
        elif not strict and not set(item["review_reasons"]) <= reasons:
            errors.append(f"task {ordinal} review_reasons missing: {sorted(set(item['review_reasons']) - reasons)}")
        if not reasons <= {"owner_uncertain", "deadline_conflict", "deadline_unknown", "location_uncertain",
                           "scope_incomplete", "speaker_uncertain", "overlap", "evidence_missing",
                           "audio_protocol_mismatch"}:
            errors.append(f"task {ordinal} invalid review reason: {sorted(reasons)}")
        if "deadline_candidates" in item:
            candidates = found.get("deadline_candidates") or []
            if not all((date in " ".join(candidates) if strict else has_candidate_date(candidates, date))
                       for date in item["deadline_candidates"]):
                errors.append(f"task {ordinal} deadline_candidates missing: {item['deadline_candidates']}")
        if "assignee_candidates" in item:
            candidates = set(found.get("assignee_candidates") or [])
            if not candidates or not candidates <= set(item["assignee_candidates"]):
                errors.append(f"task {ordinal} assignee_candidates missing or unsupported: {sorted(candidates)}")
        errors += [f"task {ordinal} {error}" for error in evidence_errors(found, source)]
    if unused:
        errors.append(f"unmatched assignments: {sorted(unused)}")

    labels = {segment["speaker"] for segment in source["segments"] if segment["speaker"] is not None}
    records = {item["label"]: item for item in proposal.get("speaker_records") or []}
    legacy = proposal.get("speakers") or {}
    if not set(records) <= labels or not set(legacy) <= labels:
        errors.append("invented speaker label")
    for label, name in expected["speaker"].items():
        record = records.get(label)
        if record is None:
            errors.append(f"speaker {label} missing speaker_record")
        mapped = record.get("participant_name") if record else legacy.get(label)
        if mapped != name:
            errors.append(f"speaker {label}: {mapped!r} != {name!r}")
        if record and name is not None:
            if record.get("mapping_status") != "suggested":
                errors.append(f"speaker {label} mapping_status must be suggested")
            actual_sources = set(record.get("source_segments") or [])
            if not actual_sources or any(type(i) is not int or not 0 <= i < len(source["segments"])
                                         or source["segments"][i]["speaker"] != label for i in actual_sources):
                errors.append(f"speaker {label} unsupported source_segments")
        if record and name is None and record.get("mapping_status") != "unmapped":
            errors.append(f"speaker {label} mapping_status must be unmapped")
    forbidden = set(expected.get("forbidden_speaker_names") or [])
    if forbidden & ({r.get("participant_name") for r in records.values()} | set(legacy.values())):
        errors.append("external assignee mapped as speaker")
    for label, candidates in (expected.get("speaker_candidates") or {}).items():
        record = records.get(label) or {}
        actual_candidates = set(record.get("candidate_names") or [])
        if not actual_candidates or not actual_candidates <= set(candidates):
            errors.append(f"speaker {label} candidates missing or unsupported: {sorted(actual_candidates)}")
        if "speaker_uncertain" not in set(record.get("review_reasons") or []):
            errors.append(f"speaker {label} missing speaker_uncertain review")
    returned_segments = proposal.get("segments") or []
    for index, segment in enumerate(source["segments"]):
        required = set(segment.get("review_reasons") or [])
        if required and (index >= len(returned_segments) or
                         not required <= set(returned_segments[index].get("review_reasons") or [])):
            errors.append(f"segment {index} lost input review reasons: {sorted(required)}")
    return errors


async def guard_sources() -> int:
    """Feed two malformed model answers through propose(), expecting fail closed."""
    cases = load_inputs()  # no expected answers enter the runner
    sys.path.insert(0, str(ROOT))
    from backend.agents import runner
    from backend.app import llm
    from backend.shared.schemas import RunInput

    original = llm.complete
    failures = 0
    source = cases["ru_self"]
    task = {"assignee": None, "task": "Подготовить макет бумажного маяка",
            "deadline": None, "deadline_text": None, "source_segments": [0],
            "evidence": [{"segment_index": 0, "quote": "подготовлю макет бумажного маяка", "field": "task"}]}
    for name, mutation in (("bad_source_index", "index"), ("unsupported_quote", "quote")):
        damaged = json.loads(json.dumps(task, ensure_ascii=False))
        if mutation == "index":
            damaged["source_segments"] = [99]
            damaged["evidence"][0]["segment_index"] = 99
        else:
            damaged["evidence"][0]["quote"] = "подготовлю настоящий космический корабль"
        response = json.dumps({"summary": "Обсудили вымышленный маяк.", "decisions": [],
                               "speakers": {}, "assignments": [damaged]}, ensure_ascii=False)
        events = []

        async def fake(messages, **kwargs):
            return llm.Completion(content=response, tokens=0, cost_usd=0)

        async def capture(event):
            events.append(event)
            return event

        llm.complete = fake
        error = None
        try:
            await runner.propose(RunInput.model_validate(source), capture)
        except Exception as exc:
            error = exc
        good = error is not None and any(event.type == "error" for event in events)
        failures += not good
        print(f"{'PASS' if good else 'FAIL'} {name}: {type(error).__name__ if error else 'accepted'}")
    llm.complete = original
    return 1 if failures else 0


async def run_product(base_url: str, model: str, output: Path, hosted: bool,
                      requested: list[str] | None) -> None:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    parsed = urlsplit(base_url)
    if hosted:
        if base_url.rstrip("/") != "https://api.openai.com/v1" or model != "gpt-6-luna":
            raise ValueError("Hosted eval permits only explicit OpenAI Luna endpoint and model")
        api_key = os.environ.get("LLM_API_KEY", "")
        if not api_key or api_key.casefold() in {"local", "test", "dummy", "changeme"}:
            raise ValueError("A non-placeholder LLM_API_KEY must be present in the process environment")
    else:
        if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Only an explicit loopback HTTP endpoint is allowed")
        if not model:
            raise ValueError("--model is required; model names are not guessed")
        api_key = ""
    cases = load_inputs()  # expected.json is never read in this function
    selected = select_cases(cases, requested)
    sys.path.insert(0, str(ROOT))
    from backend.agents import runner
    from backend.app import llm
    from backend.app.config import settings
    from backend.shared.schemas import RunInput

    config = replace(settings, llm_provider="dev_openai" if hosted else "local", llm_base_url=base_url,
                     llm_api_key=api_key, model_main=model, model_fast=model)
    service = llm.LLM(None, config)
    original = llm.complete
    previous_service = llm._service
    llm.configure(service)
    calls = 0

    async def uncached(messages, **kwargs):
        nonlocal calls
        if calls >= 24:
            raise RuntimeError("Evaluation call cap reached")
        calls += 1
        return await service.complete(messages, use_cache=False, **kwargs)

    llm.complete = uncached
    raw: dict[str, dict] = {}
    try:
        for case_id in selected:
            value = cases[case_id]
            events = []

            async def capture(event):
                events.append(event.model_dump(mode="json"))
                return event

            try:
                proposal = await runner.propose(RunInput.model_validate(value), capture)
                raw[case_id] = {"proposal": proposal.model_dump(mode="json"), "events": events}
            except Exception as exc:
                safe_error = str(exc).replace(api_key, "[redacted]") if api_key else str(exc)
                raw[case_id] = {"error": f"{type(exc).__name__}: {safe_error}", "events": events}
            print(f"{case_id}: {'proposal' if 'proposal' in raw[case_id] else raw[case_id]['error']}", flush=True)
            output.write_text(json.dumps({"synthetic_only": True, "model": model,
                                          "provider": "openai" if hosted else "local", "calls": calls,
                                          "selected_cases": selected,
                                          "input_sha256": hashlib.sha256(INPUTS.read_bytes()).hexdigest(),
                                          "raw": raw}, ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        llm.complete = original
        llm.configure(previous_service)
        await service.close()


def score_output(path: Path, strict: bool = False, requested: list[str] | None = None) -> int:
    cases = load_inputs()
    result = json.loads(path.read_text(encoding="utf-8"))
    if result.get("input_sha256") != hashlib.sha256(INPUTS.read_bytes()).hexdigest():
        raise ValueError("Result input hash differs from frozen fixtures")
    selected = select_cases(cases, requested or result.get("selected_cases"))
    if requested and result.get("selected_cases") and requested != result["selected_cases"]:
        raise ValueError("Requested cases differ from those recorded in raw results")
    gold = json.loads(EXPECTED.read_text(encoding="utf-8"))
    if set(gold) != set(cases):
        raise ValueError("Expected case IDs differ from inputs")
    failures = 0
    for case_id in selected:
        errors = score_case(result.get("raw", {}).get(case_id, {"error": "missing result"}),
                            gold[case_id], cases[case_id], strict=strict)
        failures += bool(errors)
        print(f"{'FAIL' if errors else 'PASS'} {case_id}")
        for error in errors:
            print(f"  - {error}")
    print(f"PASS {len(selected)-failures}/{len(selected)} cases")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["validate", "guard", "run", "score"])
    parser.add_argument("--base-url", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--hosted", action="store_true")
    parser.add_argument("--cases", nargs="+", help="case IDs for a labelled regression subset")
    parser.add_argument("--strict", action="store_true", help="reproduce original exact-string baseline")
    parser.add_argument("--output", type=Path, default=HERE / "first_local_raw.json")
    args = parser.parse_args()
    if args.mode == "validate":
        cases = load_inputs()
        expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
        if set(cases) != set(expected):
            raise ValueError("Inputs and expected case IDs differ")
        for case_id, gold in expected.items():
            source = cases[case_id]
            labels = {segment["speaker"] for segment in source["segments"] if segment["speaker"] is not None}
            participants = {person["name"] for person in source["participants"]}
            if not set(gold["speaker"]) <= labels or any(
                name is not None and name not in participants for name in gold["speaker"].values()
            ):
                raise ValueError(f"Invalid speaker gold in {case_id}")
            for assignment in gold["assignments"]:
                if (not assignment["source_segments"] or any(
                    type(i) is not int or not 0 <= i < len(source["segments"])
                    for i in assignment["source_segments"]
                ) or (assignment["assignee"] is not None and assignment["assignee"] not in participants)):
                    raise ValueError(f"Invalid assignment gold in {case_id}")
        print(f"Validated {len(cases)} fictional cases and manifest")
        return 0
    if args.mode == "run":
        asyncio.run(run_product(args.base_url, args.model, args.output, args.hosted, args.cases))
        return 0
    if args.mode == "guard":
        return asyncio.run(guard_sources())
    return score_output(args.output, strict=args.strict, requested=args.cases)


if __name__ == "__main__":
    raise SystemExit(main())
