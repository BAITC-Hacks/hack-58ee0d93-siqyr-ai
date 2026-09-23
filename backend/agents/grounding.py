"""Conservative raw-text grounding for names and voice identity suggestions."""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

from backend.shared.schemas import Evidence, RunInput, Speaker


def normalized(text: str) -> str:
    return " ".join("".join(
        char.casefold() if char.isalnum() else " " for char in unicodedata.normalize("NFKC", text)
    ).split())


def has_phrase(text: str, phrase: str) -> bool:
    return bool(normalized(phrase)) and f" {normalized(phrase)} " in f" {normalized(text)} "


def raw_spans(text: str, quote: str) -> list[tuple[int, int]]:
    """Locate whole token spans while retaining raw spelling and punctuation."""
    tokens = [(normalized(m.group()), m.start(), m.end()) for m in re.finditer(r"[^\W_]+", text)]
    wanted = normalized(quote).split()
    if not wanted:
        return []
    return [(tokens[i][1], tokens[i + len(wanted) - 1][2])
            for i in range(len(tokens) - len(wanted) + 1)
            if [token[0] for token in tokens[i:i + len(wanted)]] == wanted]


def raw_evidence(index: int, quote: str, field: str, source: RunInput) -> Evidence:
    segment = source.segments[index]
    spans = raw_spans(segment.text, quote)
    if not spans:
        raise ValueError(f"Цитата отсутствует в raw-транскрипте (сегмент {index}, поле {field}).")
    start, end = spans[0]
    return Evidence(segment_index=index, quote=segment.text[start:end], field=field,
                    start=segment.start, end=segment.end)


def name_candidates(spoken: str, source: RunInput) -> list[str]:
    """Fuzzy matches are candidates for review only, never identity decisions."""
    key = normalized(spoken)
    if len(key) < 4:
        return []
    return [person.name for person in source.participants if person.kind == "person" and normalized(person.name) and any(
        len(alias) >= 4 and SequenceMatcher(None, key, alias).ratio() >= .78
        for alias in (normalized(person.name), normalized(person.name).split()[0])
    )]


def exact_names(spoken: str, source: RunInput) -> list[str]:
    key = normalized(spoken)
    return list(dict.fromkeys(person.name for person in source.participants
                             if normalized(person.name) and (normalized(person.name) == key or
                             (person.kind == "person" and len(key.split()) == 1 and
                              normalized(person.name).split()[0] == key))))


_INTRO = re.compile(
    r"(?:^|[.!?;\n]\s*)(?:(?:здравствуйте|сәлеметсіздер ме|добрый день)[,\s]+)?"
    r"(?P<marker>меня зовут|мо[её] имя|менің атым|я|мен)\s+(?P<name>[^\W\d_]+)", re.I,
)
_SELF = re.compile(r"(?<!\w)(?:я|мен|өзім|сам|сама)(?!\w)", re.I)
_UNSAFE_LABELS = {"UNKNOWN", "OVERLAP"}


def self_reference(text: str) -> bool:
    return bool(_SELF.search(text))


def speaker_records(source: RunInput) -> list[Speaker]:
    records: list[Speaker] = []
    for label in dict.fromkeys(segment.speaker for segment in source.segments):
        if not label:
            continue
        indices = [i for i, segment in enumerate(source.segments) if segment.speaker == label]
        exact: set[str] = set()
        candidates: set[str] = set()
        evidence: list[Evidence] = []
        ambiguous = label in _UNSAFE_LABELS
        overlap = label == "OVERLAP" or any("overlap" in source.segments[i].review_reasons for i in indices)
        for index in indices:
            text = source.segments[index].text
            for match in _INTRO.finditer(text):
                spoken = match.group("name")
                end = match.end()
                # Prefer a complete listed name immediately after the self-introduction.
                remaining = text[match.start("name"):]
                full = [person.name for person in source.participants
                        if person.kind == "person" and raw_spans(remaining, person.name)
                        and raw_spans(remaining, person.name)[0][0] == 0]
                if full:
                    longest = max(full, key=lambda name: len(normalized(name)))
                    span = raw_spans(remaining, longest)[0]
                    spoken = remaining[:span[1]]
                    end = match.start("name") + span[1]
                elif match.group("marker").casefold() == "мен":
                    # Kazakh introduces oneself as «мен Демоаймын/Демогүлмін».
                    for suffix in ("мын", "мін", "бын", "бін", "пын", "пін"):
                        if spoken.casefold().endswith(suffix) and exact_names(spoken[:-len(suffix)], source):
                            spoken = spoken[:-len(suffix)]
                            break
                matches = exact_names(spoken, source)
                fuzzy = name_candidates(spoken, source) if not matches else []
                if not matches and not fuzzy:
                    continue
                evidence.append(raw_evidence(index, text[match.start():end], "context", source))
                candidates.update(matches or fuzzy)
                eligible = [name for name in matches if any(
                    p.name == name and p.present and p.kind == "person" for p in source.participants)]
                if len(matches) != 1 or len(eligible) != 1 or fuzzy:
                    ambiguous = True
                else:
                    exact.add(eligible[0])
        name = next(iter(exact)) if len(exact) == 1 and not ambiguous and not overlap else None
        records.append(Speaker(
            label=label, participant_name=name,
            mapping_status="suggested" if name else "unmapped", source_segments=indices,
            candidate_names=sorted(candidates), evidence=evidence,
            review_reasons=["speaker_uncertain"] + (["overlap"] if overlap else []),
        ))
    # A merged/fragmented diarization cannot establish a one-to-one identity by itself.
    for record in records:
        if record.participant_name and sum(r.participant_name == record.participant_name for r in records) > 1:
            duplicate = record.participant_name
            for other in records:
                if other.participant_name == duplicate:
                    other.participant_name = None
                    other.mapping_status = "unmapped"
    return records


def resolve_owner(owner: str | None, evidence: list[Evidence], source: RunInput,
                  records: list[Speaker]) -> tuple[str | None, list[str], list[str], list[Evidence]]:
    owner_quotes = [ev for ev in evidence if ev.field == "assignee"]
    tasks = [ev for ev in evidence if ev.field == "task"]
    task_labels = {source.segments[ev.segment_index].speaker for ev in tasks}
    # A first-person phrase elsewhere in a long segment is not this action's owner.
    task_text = " ".join(ev.quote for ev in tasks)
    candidates: set[str] = set()
    if owner and owner_quotes:
        quoted = " ".join(ev.quote for ev in owner_quotes)
        supported = has_phrase(quoted, owner)
        exact = exact_names(owner, source)
        first = normalized(owner).split()[0]
        if not supported and len(exact) == 1 and len(exact_names(first, source)) == 1 and has_phrase(quoted, first):
            supported = True
        # An introduction of another voice cannot explain «я/мен» in this task.
        intros = [ev for ev in owner_quotes if _INTRO.search(ev.quote)]
        if intros and (not self_reference(task_text) or any(
            source.segments[ev.segment_index].speaker not in task_labels for ev in intros)):
            return None, ["owner_uncertain", "speaker_uncertain"], exact, []
        if supported and len(exact) <= 1:
            resolved = exact[0] if exact else owner.strip()
            candidates.update(name_candidates(owner, source) if not exact else [])
            return resolved, ["owner_uncertain"] if candidates else [], sorted(candidates), []
        candidates.update(exact)
        candidates.update(name_candidates(owner, source))
        for quote in owner_quotes:
            for word in normalized(quote.quote).split():
                candidates.update(name_candidates(word, source))
        return None, ["owner_uncertain"], sorted(candidates), []
    if len(task_labels) == 1:
        label = next(iter(task_labels))
        record = next((record for record in records if record.label == label), None)
        if record and record.participant_name and self_reference(task_text):
            return record.participant_name, ["speaker_uncertain"], record.candidate_names, record.evidence
        if record:
            candidates.update(record.candidate_names)
            if candidates:
                # Candidate evidence remains useful even when the task quote omits «я/мен».
                # It never upgrades an ambiguous or unquoted identity to an assignee.
                return None, ["owner_uncertain", "speaker_uncertain"], sorted(candidates), record.evidence
    return None, ["owner_uncertain"], sorted(candidates), []


def generic_action(task: str) -> bool:
    """An action made only of a generic verb/modality has lost its object."""
    words = normalized(task).split()
    generic = {"подготовить", "подготовь", "подготовлю", "подготовим", "сделать", "сделай",
               "сделаю", "выполнить", "составить", "отправить", "передать", "нужно", "надо",
               "необходимо", "должен", "должна", "дайындау", "дайында", "дайындаймын",
               "дайындаңыз", "жасау", "жаса", "орындау", "керек", "қажет", "жіберу"}
    return bool(words) and len(words) <= 4 and all(word in generic for word in words)
