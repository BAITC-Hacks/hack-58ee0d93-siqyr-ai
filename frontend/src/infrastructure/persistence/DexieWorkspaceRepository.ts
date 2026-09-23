import { liveQuery } from 'dexie';
import type { MeetingRepository } from '../../modules/meetings/application/MeetingRepository.ts';
import type { RunMirror } from '../../modules/runs/application/RunGateway.ts';
import { meetingFromRun, meetingStatusFor, runMeetingPrefix, taskFromAssignment } from '../../modules/runs/domain/mirror.ts';
import type { RunSummary, ServerAssignment } from '../../modules/runs/domain/run.types.ts';
import type { Meeting, MeetingChanges, Person, Segment } from '../../modules/meetings/domain/meeting.types.ts';
import type { SettingsRepository } from '../../modules/settings/application/SettingsRepository.ts';
import { defaultSettings, type Settings } from '../../modules/settings/domain/settings.types.ts';
import type { TaskRepository } from '../../modules/tasks/application/TaskRepository.ts';
import type { Task, TaskChanges } from '../../modules/tasks/domain/task.types.ts';
import type { WorkspaceRepository, WorkspaceSnapshot } from '../../modules/workspace/application/WorkspaceRepository.ts';
import { DomainError } from '../../shared/domain/DomainError.ts';
import type { WorkspaceDatabase } from './WorkspaceDatabase.ts';

type DemoFactory = () => Pick<WorkspaceSnapshot, 'meetings' | 'tasks'>;

// Server runs whose local card the user deleted: the sync must not bring them back.
const dismissedRunsKey = 'dismissed-runs';

function sameTask(left: Task, right: Task): boolean {
  return left.meetingId === right.meetingId && left.title === right.title && left.assignee === right.assignee
    && left.deadlineText === right.deadlineText && left.dueDate === right.dueDate && left.status === right.status && left.note === right.note;
}

export class DexieWorkspaceRepository implements MeetingRepository, TaskRepository, SettingsRepository, WorkspaceRepository, RunMirror {
  readonly networkMode = 'always';
  private readonly db: WorkspaceDatabase;
  private readonly createDemo: DemoFactory;
  private initialization: Promise<void> | undefined;

  constructor(db: WorkspaceDatabase, createDemo: DemoFactory) {
    this.db = db;
    this.createDemo = createDemo;
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.db.transaction('rw', this.db.meetings, this.db.tasks, this.db.settings, this.db.meta, async () => {
        if (!(await this.db.meta.get('demo-seeded-v1'))) {
          const demo = this.createDemo();
          await this.db.meetings.bulkAdd(demo.meetings);
          await this.db.tasks.bulkAdd(demo.tasks);
          await this.db.meta.put({ key: 'demo-seeded-v1', value: 'true' });
        }
        if (!(await this.db.settings.get('workspace'))) await this.db.settings.put({ ...defaultSettings, id: 'workspace' });
      }).catch((cause: unknown) => { this.initialization = undefined; throw cause; });
    }
    return this.initialization;
  }

  async restoreDemo(): Promise<void> {
    const demo = this.createDemo();
    await this.db.transaction('rw', this.db.meetings, this.db.tasks, async () => {
      await this.db.tasks.where('meetingId').anyOf(demo.meetings.map((meeting) => meeting.id)).delete();
      await this.db.meetings.bulkPut(demo.meetings);
      await this.db.tasks.bulkPut(demo.tasks);
    });
  }

  observe(next: (snapshot: WorkspaceSnapshot) => void, error: (cause: unknown) => void): () => void {
    const subscription = liveQuery(() => this.readSnapshot()).subscribe({ next, error });
    return () => subscription.unsubscribe();
  }

  async readSnapshot(): Promise<WorkspaceSnapshot> {
    return this.db.transaction('r', this.db.meetings, this.db.tasks, this.db.settings, async () => {
      const [meetings, tasks, settings] = await Promise.all([
        this.db.meetings.orderBy('createdAt').reverse().toArray(), this.db.tasks.toArray(), this.db.settings.get('workspace'),
      ]);
      tasks.sort((left, right) => {
        const group = left.meetingId.localeCompare(right.meetingId);
        if (group) return group;
        const a = /^example-\d+-task-(\d+)$/.exec(left.id);
        const b = /^example-\d+-task-(\d+)$/.exec(right.id);
        return a && b ? Number(a[1]) - Number(b[1]) : left.id.localeCompare(right.id);
      });
      return { meetings, tasks, settings: settings ? this.settingsSnapshot(settings) : { ...defaultSettings } };
    });
  }

  async addMeeting(meeting: Meeting): Promise<void> { await this.db.meetings.add(meeting); }

  async getMeeting(id: string): Promise<Meeting> {
    const meeting = await this.db.meetings.get(id);
    if (!meeting) throw new DomainError('Встреча не найдена.');
    return meeting;
  }

  async updateMeeting(id: string, changes: MeetingChanges): Promise<void> {
    await this.patchMeeting(id, changes);
  }

  async replaceParticipants(id: string, participants: Person[]): Promise<void> {
    await this.patchMeeting(id, { participants });
  }

  async saveSegment(id: string, segment: Segment, replace: boolean): Promise<void> {
    await this.db.transaction('rw', this.db.meetings, async () => {
      const current = await this.getMeeting(id);
      if (replace && !current.transcript.some((item) => item.id === segment.id)) throw new DomainError('Реплика не найдена.');
      const transcript = replace ? current.transcript.map((item) => item.id === segment.id ? segment : item) : [...current.transcript, segment];
      await this.db.meetings.update(id, { transcript });
    });
  }

  private async patchMeeting(id: string, changes: MeetingChanges & { participants?: Person[] }): Promise<void> {
    await this.db.transaction('rw', this.db.meetings, async () => {
      await this.getMeeting(id);
      await this.db.meetings.update(id, changes);
    });
  }

  async deleteMeetingWithTasks(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.meetings, this.db.tasks, this.db.meta, async () => {
      const runId = (await this.db.meetings.get(id))?.backendRunId;
      if (runId) {
        const dismissed = await this.dismissedRuns();
        dismissed.add(runId);
        await this.db.meta.put({ key: dismissedRunsKey, value: JSON.stringify([...dismissed]) });
      }
      await this.db.tasks.where('meetingId').equals(id).delete();
      await this.db.meetings.delete(id);
    });
  }

  async mirrorRuns(runs: RunSummary[]): Promise<void> {
    await this.db.transaction('rw', this.db.meetings, this.db.tasks, this.db.meta, async () => {
      const dismissed = await this.dismissedRuns();
      const known = new Map((await this.db.meetings.toArray()).flatMap((meeting) => meeting.backendRunId ? [[meeting.backendRunId, meeting] as const] : []));
      const listed = new Set(runs.map((run) => run.id));
      for (const run of runs) {
        const current = known.get(run.id);
        const status = meetingStatusFor(run.status);
        if (!current) {
          if (!dismissed.has(run.id)) await this.db.meetings.add(meetingFromRun(run));
        } else if (current.runStatus !== run.status || current.status !== status) {
          await this.db.meetings.update(current.id, { runStatus: run.status, status });
        }
      }
      // A card that only mirrored a run the server no longer lists has nothing left to show.
      const orphaned = [...known.values()].filter((meeting) => meeting.id.startsWith(runMeetingPrefix) && !listed.has(meeting.backendRunId ?? '')).map((meeting) => meeting.id);
      if (orphaned.length) {
        await this.db.tasks.where('meetingId').anyOf(orphaned).delete();
        await this.db.meetings.bulkDelete(orphaned);
      }
    });
  }

  async mirrorAssignments(items: ServerAssignment[]): Promise<void> {
    await this.db.transaction('rw', this.db.meetings, this.db.tasks, async () => {
      const meetingByRun = new Map((await this.db.meetings.toArray()).flatMap((meeting) => meeting.backendRunId ? [[meeting.backendRunId, meeting.id] as const] : []));
      const mirrored = (await this.db.tasks.toArray()).filter((task) => task.serverId);
      const byServerId = new Map(mirrored.map((task) => [task.serverId, task]));
      const seen = new Set<string>();
      for (const item of items) {
        const meetingId = meetingByRun.get(item.runId);
        if (!meetingId) continue;
        seen.add(item.id);
        const current = byServerId.get(item.id);
        const next = taskFromAssignment(item, meetingId, current);
        // Unchanged rows are not rewritten, so the live query does not re-render every page on each sync.
        if (!current || !sameTask(current, next)) await this.db.tasks.put(next);
      }
      const gone = mirrored.filter((task) => !seen.has(task.serverId ?? '')).map((task) => task.id);
      if (gone.length) await this.db.tasks.bulkDelete(gone);
    });
  }

  private async dismissedRuns(): Promise<Set<string>> {
    try {
      const value: unknown = JSON.parse((await this.db.meta.get(dismissedRunsKey))?.value ?? '[]');
      return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    } catch {
      return new Set();
    }
  }

  async addTask(task: Task): Promise<void> {
    await this.db.transaction('rw', this.db.meetings, this.db.tasks, async () => {
      await this.assertMeetingExists(task.meetingId);
      await this.db.tasks.add(task);
    });
  }

  async getTask(id: string): Promise<Task> {
    const task = await this.db.tasks.get(id);
    if (!task) throw new DomainError('Поручение не найдено.');
    return task;
  }

  async updateTask(id: string, changes: TaskChanges): Promise<void> {
    await this.db.transaction('rw', this.db.meetings, this.db.tasks, async () => {
      const current = await this.getTask(id);
      await this.assertMeetingExists(changes.meetingId ?? current.meetingId);
      await this.db.tasks.update(id, changes);
    });
  }

  async deleteTask(id: string): Promise<void> { await this.db.tasks.delete(id); }

  async getSettings(): Promise<Settings> {
    const stored = await this.db.settings.get('workspace');
    return stored ? this.settingsSnapshot(stored) : { ...defaultSettings };
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const current = await this.getSettings();
      await this.db.settings.put({ ...current, ...patch, id: 'workspace' });
    });
  }

  private async assertMeetingExists(id: string): Promise<void> {
    if (!(await this.db.meetings.get(id))) throw new DomainError('Совещание для поручения не найдено');
  }

  private settingsSnapshot(stored: Settings): Settings {
    return { displayName: stored.displayName, organization: stored.organization, defaultLanguage: stored.defaultLanguage, reminderDays: stored.reminderDays };
  }
}
