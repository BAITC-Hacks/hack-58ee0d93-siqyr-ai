import { liveQuery } from 'dexie';
import type { MeetingRepository } from '../../modules/meetings/application/MeetingRepository.ts';
import type { Meeting, MeetingChanges, Person, Segment } from '../../modules/meetings/domain/meeting.types.ts';
import type { SettingsRepository } from '../../modules/settings/application/SettingsRepository.ts';
import { defaultSettings, type Settings } from '../../modules/settings/domain/settings.types.ts';
import type { TaskRepository } from '../../modules/tasks/application/TaskRepository.ts';
import type { Task, TaskChanges } from '../../modules/tasks/domain/task.types.ts';
import type { WorkspaceRepository, WorkspaceSnapshot } from '../../modules/workspace/application/WorkspaceRepository.ts';
import { DomainError } from '../../shared/domain/DomainError.ts';
import type { WorkspaceDatabase } from './WorkspaceDatabase.ts';

type DemoFactory = () => Pick<WorkspaceSnapshot, 'meetings' | 'tasks'>;

export class DexieWorkspaceRepository implements MeetingRepository, TaskRepository, SettingsRepository, WorkspaceRepository {
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
    await this.db.transaction('rw', this.db.meetings, this.db.tasks, async () => {
      await this.db.tasks.where('meetingId').equals(id).delete();
      await this.db.meetings.delete(id);
    });
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
