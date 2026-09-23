/** Server protocol of a meeting run (CONTRACT v0.2): draft review, approval, files and the assignment registry. */

export type ReviewStatus = 'unreviewed' | 'confirmed' | 'corrected' | 'excluded';

export interface Evidence {
  segment_index: number;
  quote: string;
  start?: number | null;
  end?: number | null;
  field?: string;
  kind?: string;
}

export interface ServerSegment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
  lang?: string | null;
  corrected_text?: string | null;
  review_reasons?: string[];
}

export interface AssignmentDraft {
  assignee: string | null;
  task: string;
  deadline: string | null;
  deadline_text: string | null;
  priority: string;
  category: string | null;
  source_segments: number[];
  deadline_candidates: string[];
  evidence: Evidence[];
  review_status: ReviewStatus;
  review_reasons: string[];
  review_note?: string | null;
  assignee_candidates?: string[];
}

export interface SpeakerRecord {
  label: string;
  participant_name: string | null;
  mapping_status: 'unmapped' | 'suggested' | 'confirmed';
  source_segments: number[];
}

export interface Proposal {
  run_id: string;
  summary: string;
  decisions: string[];
  speakers: Record<string, string>;
  segments: ServerSegment[];
  assignments: AssignmentDraft[];
  revision: number;
  source_mode: string;
  speaker_records: SpeakerRecord[];
}

export interface RunDetail {
  status: string;
  title: string;
  sourceMode: string;
  /** Draft while awaiting approval; after approval the immutable snapshot. */
  proposal: Proposal | null;
  approved: boolean;
  segments: ServerSegment[];
}

export interface ServerAssignment {
  id: string;
  run_id: string;
  run_title: string;
  assignee: string;
  task: string;
  deadline: string | null;
  deadline_text: string | null;
  priority: string;
  category: string | null;
  status: 'in_progress' | 'overdue' | 'done' | string;
  days_left: number | null;
}

export interface JiraIssue { position: number; key: string; url: string; assigned: boolean }

export class ProtocolError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ProtocolError';
    this.status = status;
    this.code = code;
  }
}

export interface ProtocolGateway {
  run(runId: string): Promise<RunDetail>;
  /** Saves a secretary edit; the server bumps and returns the revision. */
  save(runId: string, proposal: Proposal): Promise<Proposal>;
  approve(runId: string, proposal: Proposal, approved: boolean): Promise<string>;
  download(runId: string, kind: 'docx' | 'pdf'): Promise<Blob>;
  jira(runId: string): Promise<JiraIssue[]>;
  assignments(status?: string): Promise<ServerAssignment[]>;
  setDone(assignmentId: string, done: boolean): Promise<void>;
}
