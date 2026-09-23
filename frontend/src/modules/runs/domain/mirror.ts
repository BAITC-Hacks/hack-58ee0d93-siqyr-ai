import type { Meeting, MeetingStatus } from '../../meetings/domain/meeting.types.ts';
import type { Task } from '../../tasks/domain/task.types.ts';
import type { RunStatus, RunSummary, ServerAssignment } from './run.types.ts';

/** Local register status of a server run: «draft» is the review queue, «pending» still processes. */
export function meetingStatusFor(status: RunStatus): MeetingStatus {
  if (status === 'done') return 'ready';
  if (status === 'awaiting_approval' || status === 'rejected' || status === 'error') return 'draft';
  return 'pending';
}

export const runStatusLabels: Record<RunStatus, string> = {
  recording: 'Идёт запись', queued: 'В очереди', transcribing: 'Распознавание речи', running: 'Подготовка протокола',
  awaiting_approval: 'Нужна проверка', executing: 'Формирование файлов', done: 'Протокол утверждён',
  rejected: 'Протокол отклонён', error: 'Ошибка обработки',
};

export const runMeetingPrefix = 'run-';

/** Card for a run that was started elsewhere (another browser, the demo sample or seed history). */
export function meetingFromRun(run: RunSummary): Meeting {
  return {
    id: `${runMeetingPrefix}${run.id}`, title: run.title, organization: '', date: run.meetingDate, language: run.language,
    kind: 'local', status: meetingStatusFor(run.status), summary: '', participants: [], transcript: [],
    createdAt: run.createdAt, backendRunId: run.id, runStatus: run.status,
  };
}

export const serverTaskPrefix = 'server-';

/**
 * Local copy of a server assignment. The server knows only done/not done, so «в работе»
 * set in this browser survives a sync, and the local note is kept.
 */
export function taskFromAssignment(item: ServerAssignment, meetingId: string, current?: Task): Task {
  const done = item.status === 'done';
  return {
    id: current?.id ?? `${serverTaskPrefix}${item.id}`,
    serverId: item.id,
    meetingId,
    title: item.task,
    assignee: item.assignee === 'Не указан' ? '' : item.assignee,
    deadlineText: item.deadlineText ?? '',
    dueDate: item.deadline,
    status: done ? 'done' : current?.status === 'in-progress' ? 'in-progress' : 'todo',
    note: current?.note ?? '',
  };
}
