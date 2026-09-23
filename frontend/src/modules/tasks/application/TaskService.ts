import { DomainError } from '../../../shared/domain/DomainError.ts';
import type { Identity } from '../../../shared/domain/Identity.ts';
import type { RunGateway } from '../../runs/application/RunGateway.ts';
import { TaskRecord } from '../domain/TaskRecord.ts';
import type { CreateTaskInput, TaskChanges } from '../domain/task.types.ts';
import type { TaskRepository } from './TaskRepository.ts';

// Wording, owner and deadline of an approved protocol belong to its snapshot on the server.
const lockedFields = ['title', 'assignee', 'deadlineText', 'dueDate', 'meetingId'] as const;

export class TaskService {
  private readonly repository: TaskRepository;
  private readonly identity: Identity;
  private readonly server: Pick<RunGateway, 'setAssignmentDone'> | null;

  constructor(repository: TaskRepository, identity: Identity, server: Pick<RunGateway, 'setAssignmentDone'> | null = null) {
    this.repository = repository;
    this.identity = identity;
    this.server = server;
  }

  create = async (input: CreateTaskInput): Promise<string> => {
    const task = TaskRecord.create(input, this.identity.nextId()).toSnapshot();
    await this.repository.addTask(task);
    return task.id;
  };

  update = async (id: string, changes: TaskChanges): Promise<void> => {
    const current = await this.repository.getTask(id);
    const next = new TaskRecord(current).change(changes).toSnapshot();
    if (current.serverId) {
      if (lockedFields.some((key) => changes[key] !== undefined && next[key] !== current[key])) {
        throw new DomainError('Текст, ответственный и срок утверждённого поручения меняются только в протоколе. Здесь доступны статус и примечание.');
      }
      if ((next.status === 'done') !== (current.status === 'done')) {
        if (!this.server) throw new DomainError('Сервер недоступен: статус утверждённого поручения сейчас изменить нельзя.');
        await this.server.setAssignmentDone(current.serverId, next.status === 'done');
      }
    }
    const patch: TaskChanges = {};
    for (const key of ['title', 'assignee', 'deadlineText', 'note', 'meetingId'] as const) {
      if (changes[key] !== undefined) patch[key] = next[key];
    }
    if (changes.status !== undefined) patch.status = next.status;
    if (changes.dueDate !== undefined) patch.dueDate = next.dueDate;
    await this.repository.updateTask(id, patch);
  };

  remove = async (id: string): Promise<void> => {
    const current = await this.repository.getTask(id);
    if (current.serverId) throw new DomainError('Поручение утверждённого протокола нельзя удалить. Отметьте его выполненным.');
    await this.repository.deleteTask(id);
  };
}
