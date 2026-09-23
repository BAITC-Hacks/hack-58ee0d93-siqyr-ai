/** Server run of one meeting recording (docs/CONTRACT.md v0.2). Field names follow the API. */
export type RunStatus = 'recording' | 'queued' | 'transcribing' | 'running' | 'awaiting_approval' | 'executing' | 'done' | 'rejected' | 'error';
export type SourceMode = 'real' | 'mock' | 'replay';
export type ReviewStatus = 'unreviewed' | 'confirmed' | 'corrected' | 'excluded';
export type EvidenceField = 'task' | 'assignee' | 'deadline' | 'context';

export interface Evidence {
  segment_index: number;
  quote: string;
  start?: number | null;
  end?: number | null;
  field?: EvidenceField;
  kind?: 'raw_transcript' | 'human_audio_correction';
}

export interface RunSegment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
  corrected_text?: string | null;
  review_reasons?: string[];
}

export interface AssignmentDraft {
  assignee: string | null;
  task: string;
  deadline: string | null;
  deadline_text: string | null;
  priority?: 'high' | 'normal' | 'low';
  source_segments: number[];
  deadline_candidates?: string[];
  assignee_candidates?: string[];
  evidence: Evidence[];
  review_status: ReviewStatus;
  review_reasons: string[];
  review_note?: string | null;
}

export interface SpeakerRecord {
  label: string;
  participant_name: string | null;
  mapping_status: 'unmapped' | 'suggested' | 'confirmed';
  source_segments: number[];
  candidate_names?: string[];
}

/** Draft protocol; the server owns revision and source_mode, raw segment text is immutable. */
export interface Proposal {
  run_id: string;
  summary: string;
  decisions: string[];
  speakers: Record<string, string>;
  segments: RunSegment[];
  assignments: AssignmentDraft[];
  revision: number;
  source_mode: SourceMode;
  speaker_records: SpeakerRecord[];
}

export interface RunParticipant {
  name: string;
  role?: string | null;
}

export interface RunSummary {
  id: string;
  title: string;
  meetingDate: string | null;
  meetingDateVerified: boolean;
  language: 'ru' | 'kk' | 'mixed';
  status: RunStatus;
  synthetic: boolean;
  sourceMode: SourceMode;
  assignmentsCount: number;
  createdAt: string;
}

export interface RunDetail {
  run: RunSummary;
  /** Current draft, or the approved snapshot once the protocol is approved. */
  proposal: Proposal | null;
  approved: boolean;
  approvedAt: string | null;
  participants: RunParticipant[];
  hasAudio: boolean;
  filesReady: boolean;
}

/** Row of the server assignment register: only approved protocols produce them. */
export interface ServerAssignment {
  id: string;
  runId: string;
  runTitle: string;
  assignee: string;
  task: string;
  deadline: string | null;
  deadlineText: string | null;
  status: 'in_progress' | 'overdue' | 'done';
}

export interface JiraIssue {
  position: number;
  key: string;
  url: string;
  assigned: boolean;
}

export interface JiraState {
  configured: boolean;
  project: string | null;
  issues: JiraIssue[];
}

export const processingStatuses: ReadonlySet<RunStatus> = new Set(['recording', 'queued', 'transcribing', 'running', 'executing']);

const runStatuses: ReadonlySet<string> = new Set(['recording', 'queued', 'transcribing', 'running', 'awaiting_approval', 'executing', 'done', 'rejected', 'error']);

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && runStatuses.has(value);
}
