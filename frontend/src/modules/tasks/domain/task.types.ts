export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface Task {
  readonly id: string;
  meetingId: string;
  title: string;
  assignee: string;
  deadlineText: string;
  dueDate: string | null;
  status: TaskStatus;
  note: string;
  /** Assignment of an approved server protocol: its text is fixed, only the status travels back. */
  readonly serverId?: string;
}

export type CreateTaskInput = Omit<Task, 'id' | 'serverId'>;
export type TaskChanges = Partial<CreateTaskInput>;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'todo' || value === 'in-progress' || value === 'done';
}
