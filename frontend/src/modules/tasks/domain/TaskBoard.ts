import { addCalendarDays, parseLocalDate, startOfDay } from '../../../shared/domain/LocalDate.ts';
import type { Task, TaskStatus } from './task.types.ts';

export type TaskStatusFilter = 'all' | TaskStatus;
export type TaskGroup = 'overdue' | 'soon' | 'later' | 'undated' | 'done';
export interface TaskFilters { query: string; status: TaskStatusFilter; owner: string | null; meetingId: string | null }

export class TaskBoard {
  private readonly tasks: readonly Task[];
  private readonly today: number;
  private readonly reminderEnd: number;

  constructor(tasks: readonly Task[], reminderDays: number, now: Date) {
    this.tasks = tasks;
    this.today = startOfDay(now).getTime();
    this.reminderEnd = addCalendarDays(now, Math.max(0, Number.isFinite(reminderDays) ? reminderDays : 0)).getTime();
  }

  groupFor(task: Task): TaskGroup {
    if (task.status === 'done') return 'done';
    const date = task.dueDate ? parseLocalDate(task.dueDate) : null;
    if (!date) return 'undated';
    if (date.getTime() < this.today) return 'overdue';
    return date.getTime() <= this.reminderEnd ? 'soon' : 'later';
  }

  filter({ query, status, owner, meetingId }: TaskFilters): Task[] {
    const needle = query.trim().toLocaleLowerCase('ru');
    return this.tasks.filter((task) =>
      (!needle || `${task.title} ${task.assignee}`.toLocaleLowerCase('ru').includes(needle)) &&
      (status === 'all' || task.status === status) &&
      (!owner || (owner === '__unassigned__' ? !task.assignee.trim() : task.assignee.trim() === owner)) &&
      (!meetingId || task.meetingId === meetingId),
    );
  }

  groups(tasks: readonly Task[]): { id: TaskGroup; items: Task[] }[] {
    const order: TaskGroup[] = ['overdue', 'soon', 'later', 'undated', 'done'];
    return order.map((id) => ({ id, items: tasks.filter((task) => this.groupFor(task) === id)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.title.localeCompare(b.title, 'ru')),
    })).filter((group) => group.items.length > 0);
  }

  get reminders(): Task[] {
    return this.tasks.filter((task) => ['overdue', 'soon'].includes(this.groupFor(task)))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }

  get missingDates(): Task[] { return this.tasks.filter((task) => task.status !== 'done' && !task.dueDate && Boolean(task.deadlineText.trim())); }
  get owners(): string[] { return [...new Set(this.tasks.map((task) => task.assignee.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')); }
  get counts(): Record<TaskStatusFilter, number> {
    return { all: this.tasks.length, todo: this.tasks.filter((task) => task.status === 'todo').length,
      'in-progress': this.tasks.filter((task) => task.status === 'in-progress').length, done: this.tasks.filter((task) => task.status === 'done').length };
  }
}
