import Dexie, { type EntityTable } from 'dexie';
import type { Meeting } from '../../modules/meetings/domain/meeting.types.ts';
import type { Settings } from '../../modules/settings/domain/settings.types.ts';
import type { Task } from '../../modules/tasks/domain/task.types.ts';

export interface StoredSettings extends Settings { id: 'workspace' }
interface MetaRecord { key: string; value: string }

export class WorkspaceDatabase extends Dexie {
  meetings!: EntityTable<Meeting, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  settings!: EntityTable<StoredSettings, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;

  constructor(name = 'hackalem-workspace') {
    super(name);
    this.version(1).stores({
      meetings: 'id, kind, createdAt',
      tasks: 'id, meetingId, status, dueDate',
      settings: 'id',
      meta: 'key',
    });
  }
}
