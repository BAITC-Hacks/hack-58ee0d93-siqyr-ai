import assert from 'node:assert/strict';
import test from 'node:test';
import { MeetingRecord } from '../src/modules/meetings/domain/MeetingRecord.ts';
import type { CreateMeetingInput, MeetingChanges } from '../src/modules/meetings/domain/meeting.types.ts';
import { TaskRecord } from '../src/modules/tasks/domain/TaskRecord.ts';
import { TaskBoard } from '../src/modules/tasks/domain/TaskBoard.ts';
import type { Task, TaskChanges } from '../src/modules/tasks/domain/task.types.ts';
import { mediaSourceError } from '../src/modules/meetings/domain/mediaSource.ts';
import { parseLocalDate } from '../src/shared/domain/LocalDate.ts';

const identity = { nextId: () => 'new-id', now: () => new Date('2026-09-23T10:00:00Z') };
const input: CreateMeetingInput = { title: '  Планирование  ', organization: ' Команда ', date: null, language: 'ru' };
const task: Task = { id: 'task-1', meetingId: 'meeting-1', title: 'Проверить отчёт', assignee: '', deadlineText: '', dueDate: null, status: 'todo', note: '' };

test('meeting creation owns identity and workflow state; snapshots are isolated', () => {
  const record = MeetingRecord.create(input, identity);
  const snapshot = record.toSnapshot();
  assert.equal(snapshot.title, 'Планирование');
  assert.equal(snapshot.status, 'draft');
  assert.equal(snapshot.createdAt, identity.now().toISOString());
  snapshot.participants.push({ id: 'fake', name: 'Wrong', role: '' });
  assert.equal(record.toSnapshot().participants.length, 0);
  const source = { name: 'voice.webm', type: 'audio/webm', size: 3, blob: new Blob(['abc']) };
  assert.equal(MeetingRecord.create({ ...input, source }, identity).toSnapshot().status, 'pending');
});

test('commands cannot overwrite persisted identity even when runtime payload contains extra fields', () => {
  const record = MeetingRecord.create(input, identity);
  const next = record.change({ title: 'Changed', id: 'injected', createdAt: 'wrong', kind: 'example' } as MeetingChanges).toSnapshot();
  assert.equal(next.id, 'new-id');
  assert.equal(next.kind, 'local');
  assert.equal(next.createdAt, identity.now().toISOString());
  assert.equal(TaskRecord.create(task, task.id).change({ status: 'done', id: 'injected' } as TaskChanges).toSnapshot().id, task.id);
});

test('validation rejects impossible dates, empty titles and invalid statuses', () => {
  assert.equal(parseLocalDate('2026-02-30'), null);
  assert.ok(parseLocalDate('2024-02-29'));
  assert.equal(parseLocalDate('2026-9-23'), null);
  assert.throws(() => MeetingRecord.create({ ...input, title: ' ' }, identity));
  assert.throws(() => MeetingRecord.create({ ...input, date: '2026-02-30' }, identity));
  assert.throws(() => TaskRecord.create({ ...task, status: 'bad' } as unknown as Task, task.id));
});

test('transcript changes preserve identity and reject unknown edited segments', () => {
  const initial = MeetingRecord.create(input, identity);
  const first = initial.withSegment({ speaker: ' Алия ', role: '', text: ' Решение ', section: '' }, identity);
  assert.equal(first.toSnapshot().transcript[0]?.text, 'Решение');
  assert.equal(initial.toSnapshot().transcript.length, 0);
  assert.equal(first.withSegment({ id: 'new-id', speaker: 'Алия', role: '', text: 'Обновлено' }, identity).toSnapshot().transcript.length, 1);
  assert.throws(() => first.withSegment({ id: 'missing', speaker: 'Алия', role: '', text: 'Text' }, identity));
});

test('deadline grouping and reminders include exact boundary days but exclude completed tasks', () => {
  const tasks = [
    { ...task, id: 'old', dueDate: '2026-09-22' },
    { ...task, id: 'today', dueDate: '2026-09-23' },
    { ...task, id: 'edge', dueDate: '2026-09-26' },
    { ...task, id: 'later', dueDate: '2026-09-27' },
    { ...task, id: 'text', deadlineText: 'к пятнице' },
    { ...task, id: 'done', dueDate: '2026-09-22', status: 'done' as const },
  ];
  const board = new TaskBoard(tasks, 3, new Date(2026, 8, 23, 17));
  assert.deepEqual(board.groups(tasks).map(({ id, items }) => [id, items.length]), [['overdue', 1], ['soon', 2], ['later', 1], ['undated', 1], ['done', 1]]);
  assert.deepEqual(board.reminders.map((item) => item.id), ['old', 'today', 'edge']);
  assert.deepEqual(board.missingDates.map((item) => item.id), ['text']);
  assert.equal(new TaskBoard(tasks, 0, new Date(2026, 8, 23)).groupFor(tasks[2]!), 'later');
});

test('board filtering composes all criteria without mutating the input', () => {
  const tasks = [task, { ...task, id: 'other', assignee: ' Алия ', meetingId: 'meeting-2' }];
  const board = new TaskBoard(tasks, 3, new Date());
  assert.deepEqual(board.filter({ query: ' ОТЧЁТ ', status: 'todo', owner: '__unassigned__', meetingId: 'meeting-1' }), [task]);
  assert.deepEqual(board.owners, ['Алия']);
  board.groups(tasks);
  assert.equal(tasks[0]?.id, 'task-1');
});

test('source validation accepts media extensions and enforces empty and size limits', () => {
  assert.equal(mediaSourceError({ name: 'voice.M4A', type: '', size: 100 }), null);
  assert.ok(mediaSourceError({ name: 'file.txt', type: 'text/plain', size: 100 }));
  assert.ok(mediaSourceError({ name: 'voice.wav', type: 'audio/wav', size: 0 }));
  assert.ok(mediaSourceError({ name: 'voice.wav', type: 'audio/wav', size: 100 * 1024 * 1024 + 1 }));
});
