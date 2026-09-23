import type { RunStatus } from '../../runs/domain/run.types.ts';

export type MeetingLanguage = 'ru' | 'kk' | 'mixed';
export type MeetingKind = 'example' | 'local';
export type MeetingStatus = 'draft' | 'ready' | 'pending';

export interface Person {
  readonly id: string;
  name: string;
  role: string;
}

export interface Segment {
  readonly id: string;
  speaker: string;
  role: string;
  text: string;
  section?: string;
  offsetMs?: number;
}

export interface MeetingSource {
  name: string;
  size: number;
  type: string;
  blob?: Blob;
}

export interface Meeting {
  readonly id: string;
  title: string;
  organization: string;
  date: string | null;
  language: MeetingLanguage;
  readonly kind: MeetingKind;
  status: MeetingStatus;
  summary: string;
  participants: Person[];
  transcript: Segment[];
  readonly createdAt: string;
  readonly number?: number;
  source?: MeetingSource;
  /** Server run that transcribes the recording streamed from this browser. */
  readonly backendRunId?: string;
  /** Captured from the live conversation screen, including browser-only recordings. */
  readonly captureKind?: 'conversation';
  /** Last server status seen by the sync; status above is its local register projection. */
  runStatus?: RunStatus;
}

export type CreateMeetingInput = Pick<Meeting, 'title' | 'organization' | 'date' | 'language' | 'source' | 'backendRunId' | 'captureKind'>
  & Partial<Pick<Meeting, 'participants' | 'transcript'>>;
export type MeetingChanges = Partial<Pick<Meeting, 'title' | 'organization' | 'date' | 'language' | 'summary'>>;
export type SegmentInput = Omit<Segment, 'id'> & { id?: string };

export function isMeetingLanguage(value: unknown): value is MeetingLanguage {
  return value === 'ru' || value === 'kk' || value === 'mixed';
}
