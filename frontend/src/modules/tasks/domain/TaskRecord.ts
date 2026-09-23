import { DomainError } from '../../../shared/domain/DomainError.ts';
import { parseLocalDate } from '../../../shared/domain/LocalDate.ts';
import { isTaskStatus, type CreateTaskInput, type Task, type TaskChanges } from './task.types.ts';

export class TaskRecord {
  private readonly data: Task;

  constructor(data: Task) {
    this.data = { ...data };
  }

  static create(input: CreateTaskInput, id: string): TaskRecord {
    return new TaskRecord({ ...input, id }).change({});
  }

  change(changes: TaskChanges): TaskRecord {
    const next = { ...this.data };
    for (const key of ['title', 'assignee', 'deadlineText', 'note', 'meetingId'] as const) {
      next[key] = (changes[key] ?? next[key]).trim();
    }
    if (changes.dueDate !== undefined) next.dueDate = changes.dueDate;
    if (changes.status !== undefined) next.status = changes.status;
    if (!next.title) throw new DomainError('Введите поручение');
    if (!next.meetingId) throw new DomainError('Выберите встречу');
    if (!isTaskStatus(next.status)) throw new DomainError('Выберите статус поручения.');
    if (next.dueDate !== null && !parseLocalDate(next.dueDate)) throw new DomainError('Укажите корректную дату поручения.');
    return new TaskRecord(next);
  }

  toSnapshot(): Task {
    return { ...this.data };
  }
}
