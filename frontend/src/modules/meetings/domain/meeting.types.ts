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
}

export type CreateMeetingInput = Pick<Meeting, 'title' | 'organization' | 'date' | 'language' | 'source'>;
export type MeetingChanges = Partial<Pick<Meeting, 'title' | 'organization' | 'date' | 'language' | 'summary'>>;
export type SegmentInput = Omit<Segment, 'id'> & { id?: string };

export function isMeetingLanguage(value: unknown): value is MeetingLanguage {
  return value === 'ru' || value === 'kk' || value === 'mixed';
}
