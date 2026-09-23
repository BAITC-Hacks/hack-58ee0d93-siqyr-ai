import type { Identity } from '../../../shared/domain/Identity.ts';
import { TaskRecord } from '../domain/TaskRecord.ts';
import type { CreateTaskInput, TaskChanges } from '../domain/task.types.ts';
import type { TaskRepository } from './TaskRepository.ts';

export class TaskService {
  private readonly repository: TaskRepository;
  private readonly identity: Identity;

  constructor(repository: TaskRepository, identity: Identity) {
    this.repository = repository;
    this.identity = identity;
  }

  create = async (input: CreateTaskInput): Promise<string> => {
    const task = TaskRecord.create(input, this.identity.nextId()).toSnapshot();
    await this.repository.addTask(task);
    return task.id;
  };

  update = async (id: string, changes: TaskChanges): Promise<void> => {
    const current = await this.repository.getTask(id);
    const next = new TaskRecord(current).change(changes).toSnapshot();
    const patch: TaskChanges = {};
    for (const key of ['title', 'assignee', 'deadlineText', 'note', 'meetingId'] as const) {
      if (changes[key] !== undefined) patch[key] = next[key];
    }
    if (changes.status !== undefined) patch.status = next.status;
    if (changes.dueDate !== undefined) patch.dueDate = next.dueDate;
    await this.repository.updateTask(id, patch);
  };

  remove = (id: string): Promise<void> => this.repository.deleteTask(id);
}
