import Dexie, { type EntityTable } from 'dexie';
import type { Meeting, Settings, Task } from '../domain/types';
import { demoRecords } from './demo';

interface StoredSettings extends Settings {
  id: 'workspace';
}

interface Meta {
  key: string;
  value: string;
}

class WorkspaceDatabase extends Dexie {
  meetings!: EntityTable<Meeting, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  settings!: EntityTable<StoredSettings, 'id'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor() {
    super('hackalem-workspace');
    this.version(1).stores({
      meetings: 'id, kind, createdAt',
      tasks: 'id, meetingId, status, dueDate',
      settings: 'id',
      meta: 'key',
    });
  }
}

export const db = new WorkspaceDatabase();

export const defaultSettings: Settings = {
  displayName: '',
  organization: '',
  defaultLanguage: 'ru',
  reminderDays: 3,
};

let initialization: Promise<void> | null = null;

export function initializeWorkspace(): Promise<void> {
  if (!initialization) {
    initialization = db.transaction('rw', db.meetings, db.tasks, db.settings, db.meta, async () => {
      const seeded = await db.meta.get('demo-seeded-v1');
      if (!seeded) {
        const demo = demoRecords();
        await db.meetings.bulkAdd(demo.meetings);
        await db.tasks.bulkAdd(demo.tasks);
        await db.meta.put({ key: 'demo-seeded-v1', value: 'true' });
      }

      if (!(await db.settings.get('workspace'))) {
        await db.settings.put({ id: 'workspace', ...defaultSettings });
      }
    }).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

export async function restoreDemo(): Promise<void> {
  const demo = demoRecords();
  await db.transaction('rw', db.meetings, db.tasks, async () => {
    await db.tasks.where('meetingId').anyOf(demo.meetings.map((meeting) => meeting.id)).delete();
    await db.meetings.bulkPut(demo.meetings);
    await db.tasks.bulkPut(demo.tasks);
  });
}
