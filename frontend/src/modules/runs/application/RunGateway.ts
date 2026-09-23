import type { JiraState, Proposal, RunDetail, RunSummary, ServerAssignment } from '../domain/run.types.ts';

export interface ApprovalInput {
  approved: boolean;
  /** Revision the secretary looked at: the server refuses to approve a newer one unseen. */
  expectedRevision: number;
  /** Unsaved edits are sent with the approval and validated in the same request. */
  proposal?: Proposal;
  comment?: string;
}

/** Server side of a meeting after upload: draft review, approval, files and the assignment register. */
export interface RunGateway {
  list(signal?: AbortSignal): Promise<RunSummary[]>;
  get(runId: string, signal?: AbortSignal): Promise<RunDetail>;
  /** Saves a draft edit and returns the server's new revision of it. */
  saveProposal(runId: string, proposal: Proposal, expectedRevision: number): Promise<Proposal>;
  approve(runId: string, input: ApprovalInput): Promise<void>;
  protocolFile(runId: string, kind: 'docx' | 'pdf'): Promise<Blob>;
  audio(runId: string): Promise<Blob>;
  assignments(signal?: AbortSignal): Promise<ServerAssignment[]>;
  setAssignmentDone(assignmentId: string, done: boolean): Promise<void>;
  jira(runId: string, signal?: AbortSignal): Promise<JiraState>;
  pushToJira(runId: string): Promise<{ created: string[]; sprint: string | null; state: JiraState }>;
}

/** Local register the server data is copied into, so meetings and tasks pages show it offline too. */
export interface RunMirror {
  mirrorRuns(runs: RunSummary[]): Promise<void>;
  mirrorAssignments(items: ServerAssignment[]): Promise<void>;
}
