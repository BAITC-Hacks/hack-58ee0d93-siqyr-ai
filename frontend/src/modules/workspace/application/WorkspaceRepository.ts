import type { Meeting } from '../../meetings/domain/meeting.types.ts';
import type { Settings } from '../../settings/domain/settings.types.ts';
import type { Task } from '../../tasks/domain/task.types.ts';

export interface WorkspaceSnapshot {
  meetings: Meeting[];
  tasks: Task[];
  settings: Settings;
}

export interface WorkspaceRepository {
  initialize(): Promise<void>;
  readSnapshot(signal?: AbortSignal): Promise<WorkspaceSnapshot>;
  restoreDemo(): Promise<void>;
  readonly networkMode: 'always' | 'online';
  observe?(next: (snapshot: WorkspaceSnapshot) => void, error: (cause: unknown) => void): () => void;
}
