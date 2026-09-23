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
}

export type CreateTaskInput = Omit<Task, 'id'>;
export type TaskChanges = Partial<CreateTaskInput>;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'todo' || value === 'in-progress' || value === 'done';
}
