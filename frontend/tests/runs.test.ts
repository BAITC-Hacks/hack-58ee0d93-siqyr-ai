import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import { AxiosHttpClient } from '../src/infrastructure/http/AxiosHttpClient.ts';
import { DexieWorkspaceRepository } from '../src/infrastructure/persistence/DexieWorkspaceRepository.ts';
import { WorkspaceDatabase } from '../src/infrastructure/persistence/WorkspaceDatabase.ts';
import { ApiRecordingGateway } from '../src/modules/recording/infrastructure/ApiRecordingGateway.ts';
import type { RunProgress } from '../src/modules/recording/application/RecordingGateway.ts';
import { RunError } from '../src/modules/runs/application/RunError.ts';
import { RunSync } from '../src/modules/runs/application/RunSync.ts';
import type { RunGateway } from '../src/modules/runs/application/RunGateway.ts';
import { blockingAssignments, confirmSpeaker, correctAssignment, needsReview, unconfirmedSpeakers } from '../src/modules/runs/domain/review.ts';
import type { AssignmentDraft, Proposal, RunSummary, ServerAssignment } from '../src/modules/runs/domain/run.types.ts';
import { ApiRunGateway } from '../src/modules/runs/infrastructure/ApiRunGateway.ts';
import { TaskService } from '../src/modules/tasks/application/TaskService.ts';
import { HttpError, type HttpClient, type HttpRequest } from '../src/shared/application/HttpClient.ts';

function client(reply: (request: HttpRequest) => unknown): HttpClient & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return { requests, request: async <T>(request: HttpRequest) => { requests.push(request); return reply(request) as T; } };
}

const assignment = (patch: Partial<AssignmentDraft> = {}): AssignmentDraft => ({
  assignee: 'Алия', task: 'Подготовить отчёт', deadline: null, deadline_text: 'до пятницы', source_segments: [0],
  evidence: [{ segment_index: 0, quote: 'отчёт', field: 'task' }], review_status: 'unreviewed', review_reasons: [], ...patch,
});

const proposal = (patch: Partial<Proposal> = {}): Proposal => ({
  run_id: 'run-1', summary: 'Итоги', decisions: [], speakers: { SPEAKER_00: 'Алия' },
  segments: [{ start: 12, end: 15, speaker: 'SPEAKER_00', text: 'алия подготовит отчёт до пятницы' }],
  assignments: [assignment()], revision: 3, source_mode: 'real',
  speaker_records: [{ label: 'SPEAKER_00', participant_name: 'Алия', mapping_status: 'suggested', source_segments: [0] }], ...patch,
});

const runRow = { id: 'run-1', department_id: 'default', title: 'Планёрка', meeting_date: '2026-09-23', meeting_date_verified: true, lang: 'rukk', status: 'awaiting_approval', synthetic: false, source_mode: 'real', assignments_count: 0, created_at: '2026-09-23T10:00:00' };

test('run detail shows the draft while reviewing and the approved snapshot once done', async () => {
  const draft = proposal();
  const approved = proposal({ revision: 4, summary: 'Утверждено' });
  let status = 'awaiting_approval';
  const http = client(() => ({ run: { ...runRow, status }, proposal: draft, approved: status === 'done' ? approved : null, approved_at: null,
    files: { docx: status === 'done' ? '/x.docx' : null, pdf: null }, participants: [{ name: 'Алия', role: 'инженер' }, { name: ' ' }], audio: '/api/runs/run-1/audio' }));
  const gateway = new ApiRunGateway(http);
  const reviewing = await gateway.get('run-1');
  assert.equal(http.requests[0]?.path, '/api/runs/run-1');
  assert.equal(reviewing.proposal?.revision, 3);
  assert.equal(reviewing.run.language, 'mixed');
  assert.deepEqual(reviewing.participants, [{ name: 'Алия', role: 'инженер' }]);
  assert.equal(reviewing.hasAudio, true);
  assert.equal(reviewing.filesReady, false);
  status = 'done';
  const done = await gateway.get('run-1');
  assert.equal(done.proposal?.summary, 'Утверждено');
  assert.equal(done.approved, true);
  assert.equal(done.filesReady, true);
});

test('save and approve send the revision the secretary saw; review refusals keep the server explanation', async () => {
  const draft = proposal();
  const http = client((request) => {
    if (request.method === 'PUT') return { revision: 4, proposal: { ...draft, revision: 4 } };
    throw new HttpError('generic', 409, 'ERR_BAD_REQUEST', 'Нужно решение секретаря по поручениям 1: подтвердите, исправьте или исключите.', 'review_required');
  });
  const gateway = new ApiRunGateway(http);
  assert.equal((await gateway.saveProposal('run-1', draft, 3)).revision, 4);
  assert.deepEqual(http.requests[0]?.body, { expected_revision: 3, proposal: draft });
  await assert.rejects(gateway.approve('run-1', { approved: true, expectedRevision: 4, comment: '  ' }), (error: unknown) => {
    assert.ok(error instanceof RunError);
    assert.equal(error.reason, 'review_required');
    assert.equal(error.stale, false);
    assert.match(error.message, /поручениям 1/);
    return true;
  });
  assert.deepEqual(http.requests[1]?.body, { approved: true, expected_revision: 4 });

  const stale = new ApiRunGateway(client(() => { throw new HttpError('generic', 409, undefined, 'Черновик уже изменён: текущая редакция 5. Обновите страницу.'); }));
  await assert.rejects(stale.approve('run-1', { approved: false, expectedRevision: 4 }), (error: unknown) => error instanceof RunError && error.stale);
  const down = new ApiRunGateway(client(() => { throw new HttpError('generic'); }));
  await assert.rejects(down.list(), /Сервер недоступен/);
  const crashed = new ApiRunGateway(client(() => { throw new HttpError('generic', 500, undefined, 'Traceback secret'); }));
  await assert.rejects(crashed.get('run-1'), (error: unknown) => error instanceof Error && !error.message.includes('secret'));
});

test('files, register and Jira use their API routes', async () => {
  const http = client((request) => {
    if (request.path === '/api/assignments') return [{ id: 'a1', run_id: 'run-1', run_title: 'Планёрка', assignee: 'Алия', task: 'Отчёт', deadline: '2026-09-30', deadline_text: 'до конца месяца', status: 'overdue' }, { broken: true }];
    if (request.path.endsWith('/jira') && request.method === 'POST') return { project: 'SCRUM', created: ['SCRUM-1'], sprint: 'Sprint 1', issues: [{ position: 0, key: 'SCRUM-1', url: 'https://jira/browse/SCRUM-1', assigned: true }] };
    if (request.path.endsWith('/jira')) return { configured: false, project: null, issues: [] };
    return new Blob(['file']);
  });
  const gateway = new ApiRunGateway(http);
  assert.deepEqual(await gateway.assignments(), [{ id: 'a1', runId: 'run-1', runTitle: 'Планёрка', assignee: 'Алия', task: 'Отчёт', deadline: '2026-09-30', deadlineText: 'до конца месяца', status: 'overdue' }]);
  await gateway.setAssignmentDone('a1', true);
  assert.deepEqual(http.requests.at(-1), { method: 'PATCH', path: '/api/assignments/a1', body: { done: true } });
  await gateway.protocolFile('run-1', 'pdf');
  assert.equal(http.requests.at(-1)?.path, '/api/runs/run-1/protocol.pdf');
  assert.equal(http.requests.at(-1)?.responseType, 'blob');
  assert.equal((await gateway.jira('run-1')).configured, false);
  const pushed = await gateway.pushToJira('run-1');
  assert.deepEqual(pushed.created, ['SCRUM-1']);
  assert.equal(pushed.state.issues[0]?.key, 'SCRUM-1');
});

test('HTTP errors carry only the API detail and code, also from blob responses', async () => {
  const detail = new AxiosHttpClient('http://api', axios.create({ adapter: async (config) => {
    throw new AxiosError('boom', 'ERR_BAD_REQUEST', config, undefined, { data: { detail: 'Протокол доступен после утверждения.', code: 'x', secret: 's' }, status: 409, statusText: '', headers: {}, config });
  } }));
  await assert.rejects(detail.request({ method: 'GET', path: '/a' }), (error: unknown) => error instanceof HttpError && error.detail === 'Протокол доступен после утверждения.' && error.reason === 'x' && !error.message.includes('Протокол'));
  const blob = new AxiosHttpClient('http://api', axios.create({ adapter: async (config) => {
    throw new AxiosError('boom', 'ERR_BAD_REQUEST', config, undefined, { data: new Blob([JSON.stringify({ detail: 'Нет файла' })]), status: 409, statusText: '', headers: {}, config });
  } }));
  await assert.rejects(blob.request({ method: 'GET', path: '/f', responseType: 'blob' }), (error: unknown) => error instanceof HttpError && error.detail === 'Нет файла');
});

test('review rules match the server: structural reasons block until corrected, a chosen deadline ends a conflict', () => {
  const conflict = assignment({ review_reasons: ['deadline_conflict'], deadline_candidates: ['до пятницы', 'до понедельника'] });
  const unknownOwner = assignment({ review_reasons: ['owner_uncertain'] });
  const unclear = assignment({ review_reasons: ['scope_incomplete'] });
  assert.equal(needsReview(conflict), true);
  assert.equal(needsReview({ ...conflict, review_status: 'confirmed' }), true);
  assert.equal(needsReview({ ...conflict, review_status: 'excluded' }), false);
  assert.equal(needsReview(unknownOwner), false);
  assert.equal(needsReview(unclear), true);
  assert.equal(needsReview({ ...unclear, review_status: 'confirmed' }), false);
  assert.deepEqual(blockingAssignments(proposal({ assignments: [unknownOwner, conflict, unclear] })), [2, 3]);

  const fixed = correctAssignment(conflict, { task: ' Отчёт ', assignee: '', deadlineText: 'до понедельника', deadline: '2026-09-28', note: '' });
  assert.equal(fixed.review_status, 'corrected');
  assert.deepEqual(fixed.deadline_candidates, ['до понедельника']);
  assert.equal(fixed.assignee, null);
  assert.equal(fixed.task, 'Отчёт');
});

test('an assignment that names a voice needs that voice confirmed', () => {
  const draft = proposal();
  assert.deepEqual(unconfirmedSpeakers(draft), ['SPEAKER_00']);
  const confirmed = confirmSpeaker(draft, 'SPEAKER_00', 'Алия');
  assert.equal(confirmed.speaker_records[0]?.mapping_status, 'confirmed');
  assert.deepEqual(unconfirmedSpeakers(confirmed), []);
  const renamed = confirmSpeaker(draft, 'SPEAKER_00', 'Бекзат');
  assert.equal(renamed.speakers.SPEAKER_00, 'Бекзат');
  assert.equal(renamed.speaker_records[0]?.participant_name, 'Бекзат');
});

const summary = (patch: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-1', title: 'Планёрка', meetingDate: '2026-09-23', meetingDateVerified: true, language: 'mixed', status: 'awaiting_approval',
  synthetic: false, sourceMode: 'real', assignmentsCount: 0, createdAt: '2026-09-23T10:00:00Z', ...patch,
});
const serverTask = (patch: Partial<ServerAssignment> = {}): ServerAssignment => ({
  id: 'a1', runId: 'run-1', runTitle: 'Планёрка', assignee: 'Алия', task: 'Отчёт', deadline: '2026-09-30', deadlineText: 'до конца месяца', status: 'in_progress', ...patch,
});

test('sync copies server runs and approved assignments into the local register', async () => {
  const db = new WorkspaceDatabase(`runs-mirror-${crypto.randomUUID()}`);
  const repository = new DexieWorkspaceRepository(db, () => ({ meetings: [], tasks: [] }));
  await repository.initialize();
  let runs = [summary(), summary({ id: 'run-2', status: 'error' })];
  let assignments: ServerAssignment[] = [];
  const gateway = { list: async () => runs, assignments: async () => assignments } as unknown as RunGateway;
  const sync = new RunSync(gateway, repository);

  await sync.sync();
  let snapshot = await repository.readSnapshot();
  const card = snapshot.meetings.find((meeting) => meeting.backendRunId === 'run-1');
  assert.equal(card?.status, 'draft');
  assert.equal(card?.runStatus, 'awaiting_approval');

  runs = [summary({ status: 'done', assignmentsCount: 1 }), summary({ id: 'run-2', status: 'error' })];
  assignments = [serverTask()];
  await sync.sync();
  snapshot = await repository.readSnapshot();
  assert.equal(snapshot.meetings.find((meeting) => meeting.backendRunId === 'run-1')?.status, 'ready');
  const [task] = snapshot.tasks;
  assert.equal(task?.serverId, 'a1');
  assert.equal(task?.meetingId, card?.id);
  assert.equal(task?.dueDate, '2026-09-30');

  // «В работе» and the note are local refinements the server does not store.
  await repository.updateTask(task!.id, { status: 'in-progress', note: 'Черновик у Алии' });
  await sync.sync();
  assert.deepEqual((await repository.getTask(task!.id)).status, 'in-progress');
  assert.equal((await repository.getTask(task!.id)).note, 'Черновик у Алии');
  assignments = [serverTask({ status: 'done' })];
  await sync.sync();
  assert.equal((await repository.getTask(task!.id)).status, 'done');

  // A card deleted here stays deleted; a run the server no longer lists disappears.
  const failed = (await repository.readSnapshot()).meetings.find((meeting) => meeting.backendRunId === 'run-2');
  await repository.deleteMeetingWithTasks(failed!.id);
  runs = [summary({ status: 'done' })];
  await sync.sync();
  assert.equal((await repository.readSnapshot()).meetings.some((meeting) => meeting.backendRunId === 'run-2'), false);
  runs = [];
  assignments = [];
  await sync.sync();
  snapshot = await repository.readSnapshot();
  assert.equal(snapshot.meetings.length, 0);
  assert.equal(snapshot.tasks.length, 0);
  db.close();
});

test('an approved assignment changes only its status on the server and cannot be deleted', async () => {
  const db = new WorkspaceDatabase(`runs-tasks-${crypto.randomUUID()}`);
  const repository = new DexieWorkspaceRepository(db, () => ({ meetings: [], tasks: [] }));
  await repository.initialize();
  await repository.mirrorRuns([summary({ status: 'done' })]);
  await repository.mirrorAssignments([serverTask()]);
  const calls: [string, boolean][] = [];
  const service = new TaskService(repository, { nextId: () => 'x', now: () => new Date() }, { setAssignmentDone: async (id, done) => { calls.push([id, done]); } });
  const [task] = (await repository.readSnapshot()).tasks;
  await service.update(task!.id, { status: 'in-progress' });
  assert.deepEqual(calls, []);
  await service.update(task!.id, { status: 'done', note: 'Сдано' });
  assert.deepEqual(calls, [['a1', true]]);
  await assert.rejects(service.update(task!.id, { title: 'Другое' }), /меняются только в протоколе/);
  await assert.rejects(service.remove(task!.id), /нельзя удалить/);

  const offline = new TaskService(repository, { nextId: () => 'x', now: () => new Date() }, { setAssignmentDone: async () => { throw new RunError('Сервер недоступен.'); } });
  await assert.rejects(offline.update(task!.id, { status: 'todo' }), /Сервер недоступен/);
  assert.equal((await repository.getTask(task!.id)).status, 'done');
  db.close();
});

test('the live trace reads the event stream with the Bearer token and stops at a final status', async () => {
  const seen: RequestInit[] = [];
  const frames = [
    'id: 1\nevent: step\ndata: {"seq":1,"content":"Распознаю запись"}\n\n',
    ': ping\n\n',
    'id: 2\nevent: step\ndata: {"seq":2,"content":"Протокол сохранён"}\n\nevent: status\ndata: {"status":"done"}\n\n',
  ];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    seen.push(init);
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(encoder.encode(frame)); controller.close(); } }), { status: 200 });
  }) as unknown as typeof fetch;
  const http = client(() => ({ run: { status: 'running' }, steps: [] }));
  const gateway = new ApiRecordingGateway(http, 'http://api/', () => 'jwt-1', fakeFetch);
  const updates: RunProgress[] = [];
  await new Promise<void>((resolve) => {
    const stop = gateway.watch('run-1', (progress) => { updates.push(progress); if (progress.status === 'done') { stop(); resolve(); } }, () => resolve());
  });
  assert.equal((seen[0]?.headers as Record<string, string>).Authorization, 'Bearer jwt-1');
  const last = updates.at(-1);
  assert.equal(last?.status, 'done');
  assert.deepEqual(last?.steps.map((step) => step.content), ['Распознаю запись', 'Протокол сохранён']);
});
