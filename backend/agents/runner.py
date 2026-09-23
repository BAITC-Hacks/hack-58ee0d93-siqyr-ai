"""One-call, source-checked proposal and deterministic post-approval excerpts."""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from backend.app import llm
from backend.shared.schemas import AssignmentDraft, Emit, Excerpt, Proposal, Result, RunInput, StepEvent

_PROMPT = (Path(__file__).parent / "prompts" / "extract.md").read_text(encoding="utf-8")
_UNKNOWN_OWNER = "Не указан"  # v0.1 requires str; replace with null after schema migration.
_OUTPUT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "decisions", "speakers", "assignments"],
    "properties": {
        "summary": {"type": "string"},
        "decisions": {"type": "array", "items": {"type": "string"}},
        # v0.1 has no evidence for speaker mappings; leave mapping to human review.
        "speakers": {"type": "object", "additionalProperties": False, "properties": {}},
        "assignments": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["assignee", "task", "deadline_text", "deadline", "source_segments", "evidence"],
            "properties": {
                "assignee": {"type": ["string", "null"]},
                "task": {"type": "string"},
                "deadline_text": {"type": ["string", "null"]},
                "deadline": {"type": ["string", "null"]},
                "source_segments": {"type": "array", "items": {"type": "integer"}},
                "evidence": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["segment_index", "quote", "field"],
                    "properties": {
                        "segment_index": {"type": "integer"},
                        "quote": {"type": "string"},
                        "field": {"type": "string", "enum": ["task", "assignee", "deadline", "context"]},
                    },
                }},
            },
        }},
    },
}
_CALL_OPTIONS = {
    "response_format": {"type": "json_schema", "json_schema": {
        "name": "meeting_proposal", "strict": True, "schema": _OUTPUT_SCHEMA,
    }},
    "reasoning_effort": "none",
    "extra_headers": {"Accept-Encoding": "identity"},
}


def _completion_options() -> dict[str, Any]:
    """Use the token-limit spelling supported by the configured endpoint."""
    options = dict(_CALL_OPTIONS)
    active_settings = getattr(getattr(llm, "_service", None), "settings", None)
    endpoint = getattr(active_settings, "llm_base_url", "")
    if urlparse(endpoint).hostname == "api.openai.com":
        # A full meeting needs room for several assignments and their quotes.
        options["max_completion_tokens"] = 4096
    else:
        # Ollama's OpenAI-compatible chat endpoint documents max_tokens.
        options["max_tokens"] = 1024
    return options
_DATE_ISO = re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)")
_DATE_DMY = re.compile(r"(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)")
_MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
    "мая": 5, "июня": 6, "июля": 7, "августа": 8,
    "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
    "қаңтар": 1, "ақпан": 2, "наурыз": 3, "сәуір": 4,
    "мамыр": 5, "маусым": 6, "шілде": 7, "тамыз": 8,
    "қыркүйек": 9, "қазан": 10, "қараша": 11, "желтоқсан": 12,
}


async def _emit(emit: Emit, run_id: str, kind: str, agent: str, content: str, **data: Any) -> None:
    tokens = data.pop("tokens", 0)
    cost_usd = data.pop("cost_usd", 0.0)
    await emit(StepEvent(run_id=run_id, type=kind, agent=agent, content=content, data=data,
                         tokens=tokens, cost_usd=cost_usd))


def _normalized(text: str) -> str:
    return " ".join("".join(
        char.casefold() if char.isalnum() else " " for char in unicodedata.normalize("NFKC", text)
    ).split())


def _has_phrase(text: str, phrase: str) -> bool:
    """Match complete normalized words, not name fragments."""
    return f" {_normalized(phrase)} " in f" {_normalized(text)} "


def _owner_from_quotes(owner: str, quotes: list[str], source: RunInput) -> str:
    quoted = " ".join(quotes)
    names = [person.name.strip() for person in source.participants]
    owner_key = _normalized(owner)
    exact = next((name for name in names if _normalized(name) == owner_key), None)
    if _has_phrase(quoted, owner):
        # A spoken short name cannot distinguish two participants with that alias.
        if len(owner_key.split()) == 1:
            matches = [name for name in names if owner_key in _normalized(name).split()]
            if len(matches) > 1:
                raise ValueError("Короткое имя исполнителя неоднозначно.")
            if len(matches) == 1:
                return matches[0]
        return exact or owner.strip()
    if exact is None:
        raise ValueError("Имя исполнителя отсутствует в цитате.")
    # Only a unique first-name alias can justify expanding to a full participant name.
    first = owner_key.split()[0]
    if first in {"отдел", "департамент", "управление", "группа", "команда"} or len(first) < 3:
        raise ValueError("Исполнитель не подтверждён полным названием.")
    matches = [name for name in names if _normalized(name).split()[0] == first]
    if len(matches) != 1 or not _has_phrase(quoted, first):
        raise ValueError("Имя исполнителя отсутствует в цитате или неоднозначно.")
    return exact


def _agreed_revision(text: str) -> bool:
    normalized = _normalized(text)
    if any(phrase in normalized for phrase in (
        "не согласовано", "не согласован", "не договорились", "келіскен жоқ", "келіспедік",
    )):
        return False
    return any(phrase in normalized for phrase in (
        "согласовано", "согласовали", "утвердили", "келісілді", "бекіттік",
    ))


def _deadline_matches_quotes(value: str, quotes: list[tuple[int, str]], source: RunInput) -> bool:
    # Multiple conflicting phrases may be joined with ';' or newlines. Each must
    # be a verbatim normalized span of a cited raw segment, and every quote used.
    parts = [_normalized(part) for part in re.split(r"[;\n]+", value)]
    if not parts or any(not part for part in parts):
        return False
    normalized_quotes = [(index, _normalized(quote)) for index, quote in quotes]
    if not all(any(_has_phrase(quote, part) for _, quote in normalized_quotes) for part in parts):
        return False
    if all(any(_has_phrase(part, quote) or _has_phrase(quote, part) for part in parts)
           for _, quote in normalized_quotes):
        return True
    # A confirmed later revision may replace, rather than concatenate, an old date.
    if len(parts) != 1:
        return False
    selected = [index for index, quote in normalized_quotes if _has_phrase(quote, parts[0])]
    return any(
        all(old_index < index for old_index, quote in normalized_quotes
            if not _has_phrase(quote, parts[0]))
        and _agreed_revision(source.segments[index].text)
        for index in selected
    )


def _absolute_dates(text: str) -> set[date]:
    """Only dates with an explicit year qualify; never infer a meeting year."""
    found: set[date] = set()
    for match in _DATE_ISO.finditer(text):
        try:
            found.add(date.fromisoformat(match.group(1)))
        except ValueError:
            pass
    for match in _DATE_DMY.finditer(text):
        try:
            found.add(date(int(match.group(3)), int(match.group(2)), int(match.group(1))))
        except ValueError:
            pass
    for name, month in _MONTHS.items():
        pattern = rf"(?<!\d)(\d{{1,2}})\s+{name}(?:\s+|\s+года\s+)(\d{{4}})(?!\d)"
        for match in re.finditer(pattern, text.casefold()):
            try:
                found.add(date(int(match.group(2)), month, int(match.group(1))))
            except ValueError:
                pass
    return found


def _index(value: Any, count: int) -> int:
    if type(value) is not int or not 0 <= value < count:
        raise ValueError("Некорректный индекс источника.")
    return value


def _parse(content: str, source: RunInput) -> Proposal:
    if not content.strip():
        raise ValueError("LLM вернула пустой ответ.")
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError("LLM вернула неполный или некорректный JSON.") from exc
    if not isinstance(data, dict):
        raise ValueError("Ответ LLM должен быть объектом JSON.")
    if "refusal" in data or "error" in data:
        raise ValueError("LLM отказалась подготовить протокол.")
    summary = data.get("summary")
    decisions = data.get("decisions")
    speakers = data.get("speakers")
    items = data.get("assignments")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("Нет содержательного резюме.")
    if re.match(r"^\s*(?:sorry|i cannot|i can't|не могу|извините|кешіріңіз)\b", summary.casefold()):
        raise ValueError("LLM отказалась подготовить протокол.")
    if not isinstance(decisions, list) or any(not isinstance(v, str) or not v.strip() for v in decisions):
        raise ValueError("Некорректный список решений.")
    if not isinstance(speakers, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in speakers.items()):
        raise ValueError("Некорректная карта говорящих.")
    if not isinstance(items, list):
        raise ValueError("Нет списка поручений.")
    # Report all unsupported quotes together. A long meeting can contain more
    # than one transcription mismatch, and propose() allows only one repair.
    invalid_quotes: list[str] = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("evidence"), list):
            continue
        for quoted in item["evidence"]:
            if not isinstance(quoted, dict):
                continue
            index, quote, field = (quoted.get(key) for key in ("segment_index", "quote", "field"))
            if (type(index) is int and 0 <= index < len(source.segments)
                    and isinstance(quote, str) and _normalized(quote)
                    and _normalized(quote) not in _normalized(source.segments[index].text)):
                invalid_quotes.append(f"сегмент {index}, поле {field}")
    if invalid_quotes:
        raise ValueError("Цитата отсутствует в raw-транскрипте: " + "; ".join(dict.fromkeys(invalid_quotes)))
    labels = {segment.speaker for segment in source.segments}
    people = {person.name for person in source.participants}
    # v0.1 cannot attach evidence to speaker mappings, so unsupported guesses are discarded.
    speakers = {k: v for k, v in speakers.items() if k in labels and v in people and any(
        segment.speaker == k and _normalized(v) in _normalized(segment.text)
        for segment in source.segments
    )}
    assignments: list[AssignmentDraft] = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Некорректное поручение.")
        task = item.get("task")
        if not isinstance(task, str) or not task.strip():
            raise ValueError("Поручение без действия.")
        owner = item.get("assignee")
        if owner is not None and (not isinstance(owner, str) or not owner.strip()):
            raise ValueError("Некорректный исполнитель.")
        indices = item.get("source_segments")
        evidence = item.get("evidence")
        if not isinstance(indices, list) or not indices or not isinstance(evidence, list) or not evidence:
            raise ValueError("Поручение без источников или цитат.")
        checked = [_index(index, len(source.segments)) for index in indices]
        if len(set(checked)) != len(checked):
            raise ValueError("Повторный индекс источника.")
        fields: set[str] = set()
        quoted_segments: set[int] = set()
        date_quotes: list[tuple[int, str]] = []
        owner_quotes: list[str] = []
        for evidence_item in evidence:
            if not isinstance(evidence_item, dict):
                raise ValueError("Некорректная цитата.")
            index = _index(evidence_item.get("segment_index"), len(source.segments))
            quote = evidence_item.get("quote")
            field = evidence_item.get("field")
            if index not in checked or not isinstance(quote, str) or not _normalized(quote):
                raise ValueError("Цитата не связана с источником.")
            if field not in {"task", "assignee", "deadline", "context"}:
                raise ValueError("Некорректное поле цитаты.")
            if _normalized(quote) not in _normalized(source.segments[index].text):
                raise ValueError(
                    f"Цитата отсутствует в raw-транскрипте (сегмент {index}, поле {field}). "
                    "Выбери короткую непрерывную подстроку без пропуска слов."
                )
            quoted_segments.add(index)
            fields.add(field)
            if field == "deadline":
                date_quotes.append((index, quote))
            elif field == "assignee":
                owner_quotes.append(quote)
        if "task" not in fields or set(checked) != quoted_segments:
            raise ValueError("Не все источники поручения подтверждены цитатами действия.")
        # Keep the task for human review, but never publish an unquoted owner.
        resolved_owner = (_owner_from_quotes(owner, owner_quotes, source)
                          if owner is not None and "assignee" in fields else _UNKNOWN_OWNER)
        deadline_text = item.get("deadline_text")
        if deadline_text is not None and (not isinstance(deadline_text, str) or not deadline_text.strip()):
            raise ValueError("Некорректный исходный текст срока.")
        if deadline_text and "deadline" not in fields:
            raise ValueError("Срок не подтверждён цитатой.")
        if deadline_text and not _deadline_matches_quotes(deadline_text, date_quotes, source):
            raise ValueError("Текст срока не совпадает с цитатами.")
        proposed_date = item.get("deadline")
        if proposed_date is not None and (not isinstance(proposed_date, str) or not _DATE_ISO.fullmatch(proposed_date)):
            raise ValueError("Некорректный формат срока.")
        try:
            parsed_date = date.fromisoformat(proposed_date) if proposed_date else None
        except ValueError as exc:
            raise ValueError("Несуществующая дата срока.") from exc
        cited_dates = set().union(*(_absolute_dates(quote) for _, quote in date_quotes))
        source_dates = set().union(*(
            _absolute_dates(source.segments[index].text) for index in checked
        ))
        if source_dates and not deadline_text:
            raise ValueError("Дата в источнике поручения не отражена в тексте срока.")
        if source_dates - cited_dates:
            raise ValueError("Не все даты из источников поручения подтверждены цитатами.")
        agreed_final: list[tuple[int, date]] = []
        if deadline_text:
            text_dates = _absolute_dates(deadline_text)
            for index, quote in date_quotes:
                quote_dates = _absolute_dates(quote)
                if len(quote_dates) != 1 or not _agreed_revision(source.segments[index].text):
                    continue
                candidate = next(iter(quote_dates))
                if candidate in text_dates and all(
                    old_index < index for old_index, old_quote in date_quotes
                    if candidate not in _absolute_dates(old_quote)
                ):
                    agreed_final.append((index, candidate))
        latest_agreement = max((index for index, _ in agreed_final), default=None)
        final_dates = {value for index, value in agreed_final if index == latest_agreement}
        if len(final_dates) == 1:
            # An explicit later agreement in raw speech resolves the model's
            # null or stale date without inferring from the meeting date.
            parsed_date = next(iter(final_dates))
        elif parsed_date and (not deadline_text or parsed_date not in cited_dates or
                              len(cited_dates) != 1):
            # Date of meeting is not verified in v0.1: relative dates stay as text.
            parsed_date = None
        assignments.append(AssignmentDraft(
            assignee=resolved_owner,
            task=task.strip(), deadline=parsed_date, deadline_text=deadline_text,
            source_segments=checked,
        ))
    return Proposal(
        run_id=source.run_id, summary=summary.strip(), decisions=[value.strip() for value in decisions],
        speakers=speakers, segments=source.segments, assignments=assignments,
    )


async def propose(run_input: RunInput, emit: Emit) -> Proposal:
    rid = run_input.run_id
    try:
        if not run_input.segments or not any(segment.text.strip() for segment in run_input.segments):
            raise ValueError("Транскрипт пуст.")
        await _emit(emit, rid, "agent_start", "orchestrator", "Готовлю черновик протокола.", stage="extract")
        participants = ", ".join(person.name for person in run_input.participants) or "не указаны"
        lines = [f"Название: {run_input.title}", f"Язык: {run_input.lang}",
                 f"Участники (не определяют говорящих): {participants}", "Реплики:"]
        lines.extend(f"{index} [{segment.speaker}]: {segment.text}"
                     for index, segment in enumerate(run_input.segments))
        # Meeting date is intentionally omitted until RunInput has meeting_date_verified.
        messages = [{"role": "system", "content": _PROMPT}, {"role": "user", "content": "\n".join(lines)}]
        for attempt in range(2):
            await _emit(emit, rid, "tool_call", "orchestrator", "Извлекаю поручения, решения и резюме." if not attempt else "Повторно запрашиваю корректный JSON.", stage="extract", attempt=attempt + 1)
            completion = await llm.complete(messages, **_completion_options())
            try:
                proposal = _parse(completion.content, run_input)
            except ValueError as exc:
                if attempt:
                    raise
                mismatched = [int(value) for value in re.findall(r"сегмент (\d+), поле", str(exc))]
                raw_examples = "\n".join(
                    f"Реплика {index} дословно: {run_input.segments[index].text}"
                    for index in dict.fromkeys(mismatched)
                )
                messages.extend([
                    {"role": "assistant", "content": completion.content[:12000]},
                    {"role": "user", "content":
                        f"Ответ не прошёл проверку: {exc}.\n{raw_examples}\n"
                        "Верни исправленный полный JSON по исходному транскрипту. "
                        "Проверь каждую цитату с её номером реплики. Если имя исполнителя "
                        "не произнесено, поставь assignee=null и не добавляй цитату имени."},
                ])
                continue
            await _emit(emit, rid, "tool_result", "orchestrator", "Черновик проверен по исходным репликам.", stage="validate", assignments=len(proposal.assignments), usage_available=completion.tokens > 0, tokens=completion.tokens, cost_usd=completion.cost_usd)
            return proposal
        raise ValueError("Не удалось получить корректный ответ LLM.")
    except Exception as exc:
        await _emit(emit, rid, "error", "orchestrator", "Не удалось подготовить протокол.", stage="extract", code=type(exc).__name__)
        raise


async def execute(proposal: Proposal, emit: Emit) -> Result:
    """Prepare local excerpts only; backend owns approval, export and delivery."""
    grouped: dict[str, list[str]] = {}
    for item in proposal.assignments:
        if item.assignee == _UNKNOWN_OWNER:
            continue
        deadline = item.deadline_text or (item.deadline.isoformat() if item.deadline else "не указан")
        grouped.setdefault(item.assignee, []).append(f"{item.task}. Срок: {deadline}.")
    excerpts = [Excerpt(recipient=person, message="Поручения из утверждённого протокола:\n" + "\n".join(tasks)) for person, tasks in grouped.items()]
    await _emit(emit, proposal.run_id, "tool_result", "orchestrator", "Выдержки подготовлены локально.", stage="execute", excerpts=len(excerpts))
    return Result(run_id=proposal.run_id, excerpts=excerpts)
