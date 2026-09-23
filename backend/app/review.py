"""Server-side proposal checks (CONTRACT v0.2): raw transcript stays immutable, evidence is verifiable."""
import re

from backend.shared.schemas import AssignmentDraft, Evidence, Proposal, Segment

# Approval needs a human decision on these; «unknown» can be confirmed, a conflict cannot be skipped.
BLOCKING = {"deadline_conflict", "evidence_missing", "speaker_uncertain", "overlap", "audio_protocol_mismatch", "scope_incomplete"}


class ProposalError(ValueError):
    """Client-supplied draft references data that does not exist in the raw transcript."""


def normalize(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", text.lower().replace("ё", "е")).split())


def preserve_review_metadata(draft: Proposal, current: Proposal) -> Proposal:
    """Older editors may omit review fields; a save must not silently clear server flags."""
    assignments = []
    for index, item in enumerate(draft.assignments):
        matches = [old for old in current.assignments
                   if old.task == item.task and old.source_segments == item.source_segments]
        previous = matches[0] if len(matches) == 1 else None
        if previous is None and len(draft.assignments) == len(current.assignments):
            candidate = current.assignments[index]
            if candidate.source_segments == item.source_segments:
                previous = candidate
        if previous is None:
            if item.review_status == "unreviewed" and any(
                old.review_reasons and set(old.source_segments) & set(item.source_segments)
                for old in current.assignments
            ):
                raise ProposalError("Изменённую структуру поручений с замечаниями нужно проверить и пометить corrected.")
            assignments.append(item)
            continue
        updates = {"review_reasons": sorted(set(item.review_reasons) | set(previous.review_reasons))}
        for field in ("evidence", "assignee_candidates", "deadline_candidates", "review_note"):
            if field not in item.model_fields_set:
                updates[field] = getattr(previous, field)
        assignments.append(item.model_copy(update=updates))
    updates = {"assignments": assignments}
    if "speaker_records" not in draft.model_fields_set:
        updates["speaker_records"] = current.speaker_records
    return draft.model_copy(update=updates)


def check_assignment(item: AssignmentDraft, raw: list[Segment], *, strict: bool, date_verified: bool) -> AssignmentDraft:
    """strict=True rejects bad references (human edit); False drops them and flags review (model output)."""
    indices = []
    for index in item.source_segments:
        if 0 <= index < len(raw):
            indices.append(index)
        elif strict:
            raise ProposalError(f"Поручение «{item.task}» ссылается на несуществующую реплику {index}.")
    evidence, missing = [], False
    for ev in item.evidence:
        segment = raw[ev.segment_index] if 0 <= ev.segment_index < len(raw) else None
        source = segment and (segment.corrected_text if ev.kind == "human_audio_correction" else segment.text)
        quote = normalize(ev.quote)
        if not source or not quote or f" {quote} " not in f" {normalize(source)} ":
            if strict:
                raise ProposalError(f"Цитата «{ev.quote[:60]}» не найдена в реплике {ev.segment_index}.")
            missing = True
            continue
        evidence.append(ev.model_copy(update={"start": segment.start, "end": segment.end}))
    if not evidence:
        # The model named source lines but no quotes: the whole line is the verifiable source.
        evidence = [Evidence(segment_index=i, quote=raw[i].text, start=raw[i].start, end=raw[i].end, field="context")
                    for i in indices if raw[i].text.strip()]
    for ev in evidence:
        if ev.segment_index not in indices:
            indices.append(ev.segment_index)
    item = item.model_copy(update={"source_segments": sorted(set(indices)), "evidence": evidence, "confidence": None})
    reasons = set(item.review_reasons)
    if missing or not evidence:
        reasons.add("evidence_missing")
    elif strict and item.review_status == "corrected":
        reasons.discard("evidence_missing")
    if not item.assignee:
        reasons.add("owner_uncertain")
        item = item.model_copy(update={"assignee": None})
    elif strict and item.review_status in {"confirmed", "corrected"}:
        reasons.discard("owner_uncertain")
    if len(set(item.deadline_candidates)) > 1:
        reasons.add("deadline_conflict")
    elif strict and item.review_status in {"confirmed", "corrected"}:
        reasons.discard("deadline_conflict")
    if item.deadline is None and item.deadline_text:
        reasons.add("deadline_unknown")
    if item.deadline is not None and not date_verified:
        # An explicitly cited year/date does not depend on the unknown meeting date.
        from backend.agents.runner import _absolute_dates
        dates = set().union(*(_absolute_dates(ev.quote) for ev in evidence if ev.field == "deadline"))
        if dates != {item.deadline}:
            item = item.model_copy(update={"deadline": None})
            reasons.add("deadline_unknown")
    if item.deadline is not None:
        reasons.discard("deadline_unknown")
    return item.model_copy(update={"review_reasons": sorted(reasons)})


def check_proposal(proposal: Proposal, raw: list[Segment], *, strict: bool, date_verified: bool = True) -> Proposal:
    """strict=True: human edit of an existing draft. strict=False: model output, raw transcript wins."""
    if strict and proposal.segments and len(proposal.segments) != len(raw):
        raise ProposalError("Нельзя добавлять или удалять реплики исходного транскрипта.")
    # Raw text/timing always come from storage; only human fields survive from an edited draft.
    segments = [
        seg.model_copy(update={
            "corrected_text": (edited.corrected_text or None) if edited.corrected_text != seg.text else None,
            "speaker": edited.speaker if edited.speaker is not None else seg.speaker,
            "review_reasons": edited.review_reasons or seg.review_reasons,
        })
        for seg, edited in zip(raw, proposal.segments if strict and proposal.segments else raw)
    ]
    assignments = [check_assignment(a, segments, strict=strict, date_verified=date_verified) for a in proposal.assignments]
    if strict and proposal.speaker_records:
        labels = {segment.speaker for segment in segments if segment.speaker}
        for record in proposal.speaker_records:
            if record.label not in labels or record.participant_name != proposal.speakers.get(record.label):
                raise ProposalError("Связь голоса с участником не совпадает с транскриптом.")
            actual = [i for i, segment in enumerate(segments) if segment.speaker == record.label]
            if sorted(record.source_segments) != actual:
                raise ProposalError("Индексы реплик говорящего не совпадают с транскриптом.")
            for ev in record.evidence:
                if ev.segment_index not in actual:
                    raise ProposalError("Источник имени относится к другому голосу.")
                segment = segments[ev.segment_index]
                source = segment.corrected_text if ev.kind == "human_audio_correction" else segment.text
                quote = normalize(ev.quote)
                if not source or not quote or f" {quote} " not in f" {normalize(source)} ":
                    raise ProposalError("Цитата для имени не найдена в исходной реплике.")
                ev.start, ev.end = segment.start, segment.end
    return proposal.model_copy(update={"segments": segments, "assignments": assignments})


def blocking(proposal: Proposal) -> list[int]:
    """1-based numbers of assignments that still need a human decision before approval."""
    structural = {"evidence_missing", "deadline_conflict"}
    return [i for i, a in enumerate(proposal.assignments, 1)
            if a.review_status != "excluded" and
            (structural.intersection(a.review_reasons) or
             (a.review_status == "unreviewed" and BLOCKING.intersection(a.review_reasons)))]


def unconfirmed_speakers(proposal: Proposal) -> list[str]:
    """Real voice-to-person links used by assignments require an explicit human confirmation."""
    records = {record.label: record for record in proposal.speaker_records}
    pending = set()
    for assignment in proposal.assignments:
        if assignment.review_status == "excluded" or not assignment.assignee:
            continue
        for index in assignment.source_segments:
            if 0 <= index < len(proposal.segments):
                label = proposal.segments[index].speaker
                record = records.get(label)
                if label and proposal.speakers.get(label) == assignment.assignee and (record is None or record.mapping_status != "confirmed"):
                    pending.add(label)
    return sorted(pending)


def confirm_reviewed(proposal: Proposal) -> Proposal:
    """On approval the secretary accepts every remaining non-blocking item as shown."""
    return proposal.model_copy(update={"assignments": [
        a.model_copy(update={"review_status": "confirmed"}) if a.review_status == "unreviewed" else a
        for a in proposal.assignments
    ]})
