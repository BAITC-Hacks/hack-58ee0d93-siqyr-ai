import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserMeetingExporter } from '../src/modules/meetings/infrastructure/BrowserMeetingExporter.ts';
import type { Meeting } from '../src/modules/meetings/domain/meeting.types.ts';
import type { Task } from '../src/modules/tasks/domain/task.types.ts';
import { workingRecords } from '../src/modules/workspace/domain/workingRecords.ts';

const baseMeeting: Meeting = {
  id: 'working', title: 'Планёрка', organization: 'Команда', date: null,
  language: 'ru', kind: 'local', status: 'draft', summary: '', participants: [],
  transcript: [], createdAt: '2026-09-23T10:00:00Z',
};
const baseTask: Task = {
  id: 'task', meetingId: 'working', title: 'Подготовить отчёт', assignee: '',
  deadlineText: '', dueDate: null, status: 'todo', note: '',
};

test('demonstration assignments stay outside working counts and chat input', () => {
  const example: Meeting = { ...baseMeeting, id: 'example', kind: 'example' };
  const { meetings, tasks } = workingRecords(
    [baseMeeting, example],
    [baseTask, { ...baseTask, id: 'sample-task', meetingId: example.id }],
  );
  assert.deepEqual(meetings.map((meeting) => meeting.id), ['working']);
  assert.deepEqual(tasks.map((task) => task.id), ['task']);
});

test('browser exporter rejects a server meeting without an approved snapshot', async () => {
  const exporter = new BrowserMeetingExporter();
  const serverMeeting: Meeting = { ...baseMeeting, backendRunId: 'run-1' };
  await assert.rejects(exporter.download(serverMeeting, []), /утверждённого протокола/);
  assert.throws(() => exporter.print(serverMeeting, []), /утверждённого протокола/);
});
