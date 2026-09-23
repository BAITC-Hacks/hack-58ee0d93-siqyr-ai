import type { AssignmentDraft, Proposal, RunSegment, SpeakerRecord } from './run.types.ts';

export const reviewReasonLabels: Record<string, string> = {
  owner_uncertain: 'Ответственный не определён',
  deadline_conflict: 'Названы разные сроки',
  deadline_unknown: 'Срок без точной даты',
  location_uncertain: 'Неясно место',
  scope_incomplete: 'Поручение сформулировано не полностью',
  speaker_uncertain: 'Неясно, кто говорил',
  overlap: 'Реплики перекрываются',
  evidence_missing: 'Нет подтверждающей цитаты',
  audio_protocol_mismatch: 'Запись расходится с протоколом',
};

export const reviewStatusLabels: Record<AssignmentDraft['review_status'], string> = {
  unreviewed: 'Не проверено', confirmed: 'Подтверждено', corrected: 'Исправлено', excluded: 'Исключено',
};

// Same rules as backend/app/review.py: approval is refused while any of these stay open.
const needsDecision = new Set(['deadline_conflict', 'evidence_missing', 'speaker_uncertain', 'overlap', 'audio_protocol_mismatch', 'scope_incomplete']);
const structural = new Set(['evidence_missing', 'deadline_conflict']);

/** Whether the secretary still has to confirm, correct or exclude this assignment. */
export function needsReview(item: AssignmentDraft): boolean {
  if (item.review_status === 'excluded') return false;
  return item.review_reasons.some((reason) => structural.has(reason))
    || (item.review_status === 'unreviewed' && item.review_reasons.some((reason) => needsDecision.has(reason)));
}

/** 1-based assignment numbers that block approval, as the server reports them. */
export function blockingAssignments(proposal: Proposal): number[] {
  return proposal.assignments.flatMap((item, index) => needsReview(item) ? [index + 1] : []);
}

/** Voices whose name an assignment relies on but nobody confirmed yet. */
export function unconfirmedSpeakers(proposal: Proposal): string[] {
  const records = new Map(proposal.speaker_records.map((record) => [record.label, record]));
  const pending = new Set<string>();
  for (const item of proposal.assignments) {
    if (item.review_status === 'excluded' || !item.assignee) continue;
    for (const index of item.source_segments) {
      const label = proposal.segments[index]?.speaker;
      if (label && proposal.speakers[label] === item.assignee && records.get(label)?.mapping_status !== 'confirmed') pending.add(label);
    }
  }
  return [...pending].sort();
}

export function voiceLabel(label: string): string {
  const number = /^SPEAKER_(\d+)$/.exec(label)?.[1];
  return number === undefined ? label : `Голос ${Number(number) + 1}`;
}

export function speakerName(proposal: Proposal, label: string | null): string {
  if (!label) return 'Голос не определён';
  return proposal.speakers[label] || voiceLabel(label);
}

export function segmentText(segment: RunSegment): string {
  return segment.corrected_text || segment.text;
}

export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const rest = `${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${rest}` : rest;
}

export interface AssignmentEdit {
  task: string;
  assignee: string;
  deadlineText: string;
  deadline: string | null;
  note: string;
}

/** A human edit: the item becomes «corrected», a single chosen deadline resolves a conflict. */
export function correctAssignment(item: AssignmentDraft, edit: AssignmentEdit): AssignmentDraft {
  const deadlineText = edit.deadlineText.trim() || null;
  const candidates = item.deadline_candidates ?? [];
  return {
    ...item,
    task: edit.task.trim() || item.task,
    assignee: edit.assignee.trim() || null,
    deadline_text: deadlineText,
    deadline: edit.deadline,
    // Several spoken deadlines stay a conflict on the server until one of them is chosen.
    deadline_candidates: new Set(candidates).size > 1 ? (deadlineText ? [deadlineText] : []) : candidates,
    review_status: 'corrected',
    review_note: edit.note.trim() || null,
  };
}

export function setReviewStatus(item: AssignmentDraft, status: AssignmentDraft['review_status']): AssignmentDraft {
  return { ...item, review_status: status };
}

/** Links a voice to a participant; the server checks the record against proposal.speakers. */
export function confirmSpeaker(proposal: Proposal, label: string, name: string): Proposal {
  const cleaned = name.trim();
  const speakers = { ...proposal.speakers };
  if (cleaned) speakers[label] = cleaned;
  else delete speakers[label];
  const speaker_records = proposal.speaker_records.map((record): SpeakerRecord => record.label === label
    ? { ...record, participant_name: cleaned || null, mapping_status: cleaned ? 'confirmed' : 'unmapped' }
    : record);
  return { ...proposal, speakers, speaker_records };
}

export function reviewProgress(proposal: Proposal): { total: number; decided: number; blocking: number } {
  const total = proposal.assignments.length;
  const decided = proposal.assignments.filter((item) => item.review_status !== 'unreviewed').length;
  return { total, decided, blocking: blockingAssignments(proposal).length };
}
