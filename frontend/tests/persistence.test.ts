import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceDatabase } from '../src/infrastructure/persistence/WorkspaceDatabase.ts';
import { DexieWorkspaceRepository } from '../src/infrastructure/persistence/DexieWorkspaceRepository.ts';
import { MeetingService } from '../src/modules/meetings/application/MeetingService.ts';
import { TaskService } from '../src/modules/tasks/application/TaskService.ts';
import { SettingsService } from '../src/modules/settings/application/SettingsService.ts';
import type { Meeting } from '../src/modules/meetings/domain/meeting.types.ts';
import type { Task } from '../src/modules/tasks/domain/task.types.ts';

const example: Meeting = { id: 'example-1', title: 'Example', organization: '', date: null, language: 'ru', kind: 'example', status: 'ready', summary: 'Original', participants: [], transcript: [], createdAt: '2026-09-20T00:00:00Z' };
const exampleTask: Task = { id: 'example-1-task-1', meetingId: example.id, title: 'Example task', assignee: '', deadlineText: '', dueDate: null, status: 'todo', note: '' };
const seed = () => ({ meetings: [example], tasks: [exampleTask] });
const meetingInput = { title: 'Local', organization: 'Team', date: null, language: 'ru' as const };

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const db = new WorkspaceDatabase(`test-${crypto.randomUUID()}`);
  t.after(() => db.delete());
  const repository = new DexieWorkspaceRepository(db, seed);
  const identity = { nextId: () => crypto.randomUUID(), now: () => new Date('2026-09-23T00:00:00Z') };
  await repository.initialize();
  return { db, repository, meetings: new MeetingService(repository, identity), tasks: new TaskService(repository, identity), settings: new SettingsService(repository) };
}

test('initialization is idempotent and reopens existing v1 data without reseeding', async (t) => {
  const { db, repository, meetings } = await fixture(t);
  await meetings.update(example.id, { summary: 'Edited' });
  await Promise.all([repository.initialize(), repository.initialize()]);
  db.close();
  const reopened = new WorkspaceDatabase(db.name);
  const next = new DexieWorkspaceRepository(reopened, seed);
  await next.initialize();
  assert.equal((await next.getMeeting(example.id)).summary, 'Edited');
  assert.equal((await next.readSnapshot()).tasks.length, 1);
  assert.equal('id' in (await next.readSnapshot()).settings, false);
  reopened.close();
});

test('meeting deletion cascades atomically and rejects orphan task creation and reassignment', async (t) => {
  const { repository, meetings, tasks } = await fixture(t);
  const id = await meetings.create(meetingInput);
  const taskId = await tasks.create({ ...exampleTask, meetingId: id });
  await assert.rejects(() => tasks.update(taskId, { meetingId: 'missing' }), /Совещание/);
  assert.equal((await repository.getTask(taskId)).meetingId, id);
  await meetings.remove(id);
  await assert.rejects(() => repository.getTask(taskId), /не найдено/);
  await assert.rejects(() => tasks.create({ ...exampleTask, meetingId: id }), /Совещание/);
  assert.equal((await repository.readSnapshot()).tasks.length, 1);
});

test('demo restore preserves local meetings, blobs, tasks and settings', async (t) => {
  const { repository, meetings, tasks, settings } = await fixture(t);
  const blob = new Blob(['audio'], { type: 'audio/webm' });
  const id = await meetings.create({ ...meetingInput, source: { name: 'audio.webm', size: blob.size, type: blob.type, blob } });
  const taskId = await tasks.create({ ...exampleTask, meetingId: id });
  await settings.update({ displayName: 'Алия', reminderDays: 7 });
  await meetings.update(example.id, { summary: 'Edited' });
  await repository.restoreDemo();
  assert.equal((await repository.getMeeting(example.id)).summary, 'Original');
  assert.equal(await (await repository.getMeeting(id)).source?.blob?.text(), 'audio');
  assert.equal((await repository.getTask(taskId)).meetingId, id);
  assert.equal((await repository.getSettings()).displayName, 'Алия');
});

test('concurrent partial updates and transcript additions preserve unrelated fields', async (t) => {
  const { repository, meetings, tasks, settings } = await fixture(t);
  await Promise.all([meetings.update(example.id, { title: 'New' }), meetings.update(example.id, { summary: 'Summary' })]);
  const meeting = await repository.getMeeting(example.id);
  assert.equal(meeting.title, 'New');
  assert.equal(meeting.summary, 'Summary');
  await Promise.all(['one', 'two'].map((text) => meetings.saveSegment(example.id, { speaker: 'Алия', text, role: '' })));
  assert.equal((await repository.getMeeting(example.id)).transcript.length, 2);
  await Promise.all([tasks.update(exampleTask.id, { status: 'done' }), tasks.update(exampleTask.id, { note: 'Note' })]);
  assert.equal((await repository.getTask(exampleTask.id)).status, 'done');
  assert.equal((await repository.getTask(exampleTask.id)).note, 'Note');
  await Promise.all([settings.update({ displayName: 'Name' }), settings.update({ reminderDays: 5 })]);
  assert.equal((await repository.getSettings()).displayName, 'Name');
  assert.equal((await repository.getSettings()).reminderDays, 5);
});

test('validation failure leaves persisted settings and task unchanged', async (t) => {
  const { repository, settings, tasks } = await fixture(t);
  await assert.rejects(() => settings.update({ reminderDays: -1 }));
  await assert.rejects(() => tasks.update(exampleTask.id, { title: ' ' }));
  assert.equal((await repository.getSettings()).reminderDays, 3);
  assert.equal((await repository.getTask(exampleTask.id)).title, 'Example task');
});

test('failed seeding rolls back and can retry', async (t) => {
  const db = new WorkspaceDatabase(`retry-${crypto.randomUUID()}`);
  t.after(() => db.delete());
  let fail = true;
  const repository = new DexieWorkspaceRepository(db, () => fail ? { meetings: [example, example], tasks: [] } : seed());
  await assert.rejects(() => repository.initialize());
  assert.equal(await db.meetings.count(), 0);
  assert.equal(await db.meta.count(), 0);
  fail = false;
  await repository.initialize();
  assert.equal(await db.meetings.count(), 1);
});

test('live observation publishes changes and unsubscribes cleanly', async (t) => {
  const { repository, meetings } = await fixture(t);
  let unsubscribe = () => {};
  const updated = new Promise<void>((resolve, reject) => {
    unsubscribe = repository.observe((snapshot) => {
      if (snapshot.meetings.some((meeting) => meeting.title === 'Observed')) resolve();
    }, reject);
  });
  t.after(async () => unsubscribe());
  await meetings.update(example.id, { title: 'Observed' });
  await Promise.race([updated, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Live query timeout')), 1500); timer.unref(); })]);
});
