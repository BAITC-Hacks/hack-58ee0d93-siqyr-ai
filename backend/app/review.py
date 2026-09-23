"""Server-side proposal checks (CONTRACT v0.2): raw transcript stays immutable, evidence is verifiable."""
import re

from backend.shared.schemas import AssignmentDraft, Evidence, Proposal, Segment

# Approval needs a human decision on these; «unknown» can be confirmed, a conflict cannot be skipped.
BLOCKING = {"deadline_conflict", "evidence_missing", "speaker_uncertain", "overlap", "audio_protocol_mismatch"}


class ProposalError(ValueError):
    """Client-supplied draft references data that does not exist in the raw transcript."""


def normalize(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", text.lower().replace("ё", "е")).split())


def _reason(item: AssignmentDraft, reason: str) -> list[str]:
    return item.review_reasons if reason in item.review_reasons else [*item.review_reasons, reason]


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
        segment = raw[ev.segment_index] if ev.segment_index < len(raw) else None
        source = segment and (segment.corrected_text if ev.kind == "human_audio_correction" else segment.text)
        if not source or normalize(ev.quote) not in normalize(source):
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
    if item.review_status in {"confirmed", "corrected", "excluded"}:
        return item
    if missing or not evidence:
        item = item.model_copy(update={"review_reasons": _reason(item, "evidence_missing")})
    if not item.assignee:
        item = item.model_copy(update={"assignee": None, "review_reasons": _reason(item, "owner_uncertain")})
    if len(set(item.deadline_candidates)) > 1:
        item = item.model_copy(update={"review_reasons": _reason(item, "deadline_conflict")})
    if item.deadline is None and item.deadline_text:
        item = item.model_copy(update={"review_reasons": _reason(item, "deadline_unknown")})
    if item.deadline is not None and not date_verified:
        # Relative deadlines need a confirmed meeting date; keep the phrase, drop the guess.
        item = item.model_copy(update={"deadline": None, "review_reasons": _reason(item, "deadline_unknown")})
    return item


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
    return proposal.model_copy(update={"segments": segments, "assignments": assignments})


def blocking(proposal: Proposal) -> list[int]:
    """1-based numbers of assignments that still need a human decision before approval."""
    return [i for i, a in enumerate(proposal.assignments, 1)
            if a.review_status == "unreviewed" and BLOCKING.intersection(a.review_reasons)]


def confirm_reviewed(proposal: Proposal) -> Proposal:
    """On approval the secretary accepts every remaining non-blocking item as shown."""
    return proposal.model_copy(update={"assignments": [
        a.model_copy(update={"review_status": "confirmed"}) if a.review_status == "unreviewed" else a
        for a in proposal.assignments
    ]})
