"""Scope deadline validation to disjoint, grounded tasks within an STT segment."""
from __future__ import annotations

import re
from typing import Any

from backend.agents.grounding import raw_spans
from backend.shared.schemas import RunInput


def task_scope(item: dict[str, Any], items: list[dict[str, Any]], index: int,
               source: RunInput) -> tuple[int, int]:
    text = source.segments[index].text

    def spans(candidate: dict[str, Any], field: str) -> list[tuple[int, int]]:
        result: list[tuple[int, int]] = []
        for ev in candidate.get("evidence", []):
            if ev.get("segment_index") == index and ev.get("field") == field:
                found = raw_spans(text, ev["quote"])
                if len(found) != 1:
                    raise ValueError("Цитата срока или действия неоднозначна: включи соседние слова в evidence.")
                result.extend(found)
        return result

    own_tasks, own_dates = spans(item, "task"), spans(item, "deadline")
    own = own_tasks + own_dates
    if not own:
        return 0, len(text)
    own_start, own_end = min(a for a, _ in own), max(b for _, b in own)
    left, right = 0, len(text)
    for sibling in items:
        if sibling is item:
            continue
        other_tasks = spans(sibling, "task")
        if not other_tasks:
            continue
        other_dates = spans(sibling, "deadline")
        # A single shared deadline may apply to several actions; it cannot divide them.
        if own_dates and other_dates and set(own_dates) == set(other_dates):
            continue
        other = other_tasks + other_dates
        start, end = min(a for a, _ in other), max(b for _, b in other)
        if end <= own_start:
            left = max(left, end)
        elif start >= own_end:
            right = min(right, start)
        else:
            raise ValueError("Источники разных поручений пересекаются: проверь связь действия со своим сроком.")
    return left, right


def deadline_context(index: int, quote: str, all_quotes: list[tuple[int, str]],
                     source: RunInput, scopes: dict[int, tuple[int, int]]) -> tuple[tuple[int, int], str]:
    """An agreement/proposal marker belongs to its own date, never a sibling task."""
    text = source.segments[index].text
    lo, hi = scopes[index]
    candidates = [(a, b) for a, b in raw_spans(text, quote) if a >= lo and b <= hi]
    if len(candidates) != 1:
        raise ValueError("Нельзя однозначно связать срок с цитатой поручения.")
    start, end = candidates[0]
    for other_index, other_quote in all_quotes:
        if other_index != index or other_quote == quote:
            continue
        for a, b in raw_spans(text, other_quote):
            if b <= start:
                lo = max(lo, b)
            elif a >= end:
                hi = min(hi, a)
    # Sentence separators constrain the modality prefix. Numeric dates keep their dots.
    breaks = list(re.finditer(r"[!?;\n]|(?<!\d)\.(?!\d)|\.(?=\s+[А-ЯA-ZӘҒҚҢӨҰҮҺІ])", text[lo:start]))
    if breaks:
        lo += breaks[-1].end()
    context = text[lo:end]
    # Postfix confirmations/negations also occur, but do not borrow the next proposal.
    suffix = re.match(
        r"\s*(?:года\s*)?[,—–-]?\s*(?:не\s+)?(?:согласовано|согласован|утвердили|"
        r"срок не утвержд[её]н|келісілді|келісілген жоқ|бекітілмеді)\b", text[end:hi], re.I,
    )
    if suffix:
        context += suffix.group()
    return (index, start), context
