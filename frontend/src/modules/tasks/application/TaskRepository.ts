import type { Task, TaskChanges } from '../domain/task.types.ts';

export interface TaskRepository {
  /** The meeting existence check and write must share one transaction. */
  addTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task>;
  updateTask(id: string, changes: TaskChanges): Promise<void>;
  deleteTask(id: string): Promise<void>;
}
