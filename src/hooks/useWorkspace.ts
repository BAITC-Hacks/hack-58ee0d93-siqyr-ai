import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Meeting, Settings, Task } from '../domain/types';
import { db, defaultSettings, initializeWorkspace, restoreDemo } from '../data/database';

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message === 'Совещание для поручения не найдено') return error.message;
  return 'Локальное хранилище недоступно. Проверьте настройки браузера и обновите страницу.';
}

function orderExampleTasks(tasks: Task[]): Task[] {
  return tasks.sort((left, right) => {
    if (left.meetingId !== right.meetingId) return 0;
    const leftNumber = /^example-\d+-task-(\d+)$/.exec(left.id);
    const rightNumber = /^example-\d+-task-(\d+)$/.exec(right.id);
    if (!leftNumber || !rightNumber) return 0;
    return Number(leftNumber[1]) - Number(rightNumber[1]);
  });
}

export function useWorkspace(): {
  meetings: Meeting[];
  tasks: Task[];
  settings: Settings;
  loading: boolean;
  error: string | null;
  createMeeting: (input: Omit<Meeting, 'id' | 'createdAt'>) => Promise<string>;
  updateMeeting: (id: string, patch: Partial<Meeting>) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
  createTask: (input: Omit<Task, 'id'>) => Promise<string>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  resetDemo: () => Promise<void>;
} {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    initializeWorkspace()
      .then(() => { if (active) setReady(true); })
      .catch((cause: unknown) => { if (active) setError(messageFrom(cause)); });
    return () => { active = false; };
  }, []);

  const snapshot = useLiveQuery(async () => {
    try {
      const [meetings, tasks, storedSettings] = await Promise.all([
        db.meetings.orderBy('createdAt').reverse().toArray(),
        db.tasks.toArray(),
        db.settings.get('workspace'),
      ]);
      return { meetings, tasks: orderExampleTasks(tasks), settings: storedSettings ?? defaultSettings, queryError: null as string | null };
    } catch (cause) {
      return { meetings: [] as Meeting[], tasks: [] as Task[], settings: defaultSettings, queryError: messageFrom(cause) };
    }
  }, []);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      setError(null);
      return await operation();
    } catch (cause) {
      setError(messageFrom(cause));
      throw cause;
    }
  }, []);

  const createMeeting = useCallback((input: Omit<Meeting, 'id' | 'createdAt'>) => run(async () => {
    const id = crypto.randomUUID();
    await db.meetings.add({ ...input, id, createdAt: new Date().toISOString() });
    return id;
  }), [run]);

  const updateMeeting = useCallback((id: string, patch: Partial<Meeting>) => run(async () => {
    const { id: _id, createdAt: _createdAt, ...changes } = patch;
    void _id;
    void _createdAt;
    await db.meetings.update(id, changes);
  }), [run]);

  const deleteMeeting = useCallback((id: string) => run(async () => {
    await db.transaction('rw', db.meetings, db.tasks, async () => {
      await db.tasks.where('meetingId').equals(id).delete();
      await db.meetings.delete(id);
    });
  }), [run]);

  const createTask = useCallback((input: Omit<Task, 'id'>) => run(async () => {
    if (!(await db.meetings.get(input.meetingId))) throw new Error('Совещание для поручения не найдено');
    const id = crypto.randomUUID();
    await db.tasks.add({ ...input, id });
    return id;
  }), [run]);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => run(async () => {
    const { id: _id, ...changes } = patch;
    void _id;
    await db.tasks.update(id, changes);
  }), [run]);

  const deleteTask = useCallback((id: string) => run(async () => {
    await db.tasks.delete(id);
  }), [run]);

  const updateSettings = useCallback((patch: Partial<Settings>) => run(async () => {
    await db.settings.update('workspace', patch);
  }), [run]);

  const resetDemo = useCallback(() => run(restoreDemo), [run]);

  return {
    meetings: snapshot?.meetings ?? [],
    tasks: snapshot?.tasks ?? [],
    settings: snapshot?.settings ?? defaultSettings,
    loading: !error && !snapshot?.queryError && (!ready || snapshot === undefined),
    error: error ?? snapshot?.queryError ?? null,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    createTask,
    updateTask,
    deleteTask,
    updateSettings,
    resetDemo,
  };
}
