export interface Person {
  id: string;
  name: string;
  role: string;
}

export interface Segment {
  id: string;
  speaker: string;
  role: string;
  text: string;
  section?: string;
}

export interface Meeting {
  id: string;
  title: string;
  organization: string;
  date: string | null;
  language: 'ru' | 'kk' | 'mixed';
  kind: 'example' | 'local';
  status: 'draft' | 'ready' | 'pending';
  summary: string;
  participants: Person[];
  transcript: Segment[];
  createdAt: string;
  number?: number;
  source?: {
    name: string;
    size: number;
    type: string;
    blob?: Blob;
  };
}

export interface Task {
  id: string;
  meetingId: string;
  title: string;
  assignee: string;
  deadlineText: string;
  dueDate: string | null;
  status: 'todo' | 'in-progress' | 'done';
  note: string;
}

export interface Settings {
  displayName: string;
  organization: string;
  defaultLanguage: 'ru' | 'kk' | 'mixed';
  reminderDays: number;
}
