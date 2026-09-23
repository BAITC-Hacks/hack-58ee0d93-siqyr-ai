import { HttpError, type HttpClient } from '../../../shared/application/HttpClient.ts';
import type { ApprovalInput, RunGateway } from '../application/RunGateway.ts';
import { RunError } from '../application/RunError.ts';
import { isRunStatus, type JiraIssue, type JiraState, type Proposal, type RunDetail, type RunParticipant, type RunSummary, type ServerAssignment, type SourceMode } from '../domain/run.types.ts';

type Json = Record<string, unknown>;

const fileTimeoutMs = 10 * 60_000;
const fallback: Record<number, string> = {
  400: 'Сервер отклонил запрос. Обновите страницу и повторите.',
  401: 'Сессия истекла. Войдите снова.',
  403: 'Недостаточно прав для этого действия в подразделении встречи.',
  404: 'Встреча не найдена на сервере или недоступна вашему подразделению.',
  409: 'Состояние встречи изменилось. Обновите страницу.',
  422: 'Сервер не принял правку: она не совпадает с исходной расшифровкой.',
  502: 'Внешняя система вернула ошибку.',
  503: 'Сервис на сервере сейчас недоступен.',
};

function runError(cause: unknown, action: string): RunError {
  if (!(cause instanceof HttpError)) return new RunError(cause instanceof Error ? cause.message : action);
  if (cause.status === undefined) return new RunError('Сервер недоступен. Проверьте, что бэкенд запущен, и повторите.');
  // The API words its 4xx/502/503 details for users; a 500 carries no safe explanation.
  const detail = cause.status !== 500 ? cause.detail : undefined;
  return new RunError(detail ?? fallback[cause.status] ?? action, cause.status, cause.reason);
}

function object(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const languages = { ru: 'ru', kk: 'kk', rukk: 'mixed' } as const;
const sourceModes: ReadonlySet<string> = new Set(['real', 'mock', 'replay']);

function toRun(value: unknown): RunSummary | null {
  const run = object(value);
  if (!run || typeof run.id !== 'string' || !isRunStatus(run.status)) return null;
  const lang = text(run.lang);
  return {
    id: run.id,
    title: text(run.title) ?? 'Совещание',
    meetingDate: text(run.meeting_date),
    meetingDateVerified: run.meeting_date_verified !== false,
    language: lang && lang in languages ? languages[lang as keyof typeof languages] : 'mixed',
    status: run.status,
    synthetic: run.synthetic === true,
    sourceMode: sourceModes.has(String(run.source_mode)) ? run.source_mode as SourceMode : 'mock',
    assignmentsCount: typeof run.assignments_count === 'number' ? run.assignments_count : 0,
    createdAt: text(run.created_at) ?? new Date(0).toISOString(),
  };
}

/** Keeps every server field (they are sent back on save) and fills lists an older draft may lack. */
function toProposal(value: unknown): Proposal | null {
  const draft = object(value);
  if (!draft || typeof draft.run_id !== 'string' || !Array.isArray(draft.assignments)) return null;
  return {
    ...draft,
    summary: text(draft.summary) ?? '',
    decisions: list(draft.decisions).filter((item): item is string => typeof item === 'string'),
    speakers: object(draft.speakers) as Record<string, string> ?? {},
    segments: list(draft.segments) as Proposal['segments'],
    assignments: (draft.assignments as Json[]).map((item) => ({
      ...item, evidence: list(item.evidence), review_reasons: list(item.review_reasons), source_segments: list(item.source_segments),
      review_status: item.review_status ?? 'unreviewed',
    })) as unknown as Proposal['assignments'],
    revision: typeof draft.revision === 'number' ? draft.revision : 1,
    source_mode: sourceModes.has(String(draft.source_mode)) ? draft.source_mode as SourceMode : 'mock',
    speaker_records: list(draft.speaker_records) as Proposal['speaker_records'],
  } as Proposal;
}

function toParticipants(value: unknown): RunParticipant[] {
  return list(value).flatMap((item) => {
    const person = object(item);
    const name = text(person?.name)?.trim();
    return name ? [{ name, role: text(person?.role) }] : [];
  });
}

function toAssignment(value: unknown): ServerAssignment | null {
  const item = object(value);
  if (!item || typeof item.id !== 'string' || typeof item.run_id !== 'string' || typeof item.task !== 'string') return null;
  const status = item.status === 'done' || item.status === 'overdue' ? item.status : 'in_progress';
  return {
    id: item.id, runId: item.run_id, runTitle: text(item.run_title) ?? '', assignee: text(item.assignee) ?? '',
    task: item.task, deadline: text(item.deadline), deadlineText: text(item.deadline_text), status,
  };
}

function toJira(value: unknown): JiraState {
  const body = object(value);
  const issues = list(body?.issues).flatMap((item): JiraIssue[] => {
    const issue = object(item);
    return issue && typeof issue.key === 'string' && typeof issue.url === 'string'
      ? [{ position: Number(issue.position) || 0, key: issue.key, url: issue.url, assigned: issue.assigned === true }] : [];
  });
  return { configured: body?.configured !== false, project: text(body?.project), issues };
}

export class ApiRunGateway implements RunGateway {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  private path(runId: string, suffix = ''): string {
    return `/api/runs/${encodeURIComponent(runId)}${suffix}`;
  }

  private async call<T>(action: string, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      if (typeof cause === 'object' && cause !== null && (cause as { name?: string }).name === 'CanceledError') throw cause;
      throw runError(cause, action);
    }
  }

  async list(signal?: AbortSignal): Promise<RunSummary[]> {
    const body = await this.call('Не удалось получить список встреч с сервера.', () => this.http.request<unknown>({ method: 'GET', path: '/api/runs', signal }));
    return list(body).map(toRun).filter((run): run is RunSummary => run !== null);
  }

  async get(runId: string, signal?: AbortSignal): Promise<RunDetail> {
    const body = object(await this.call('Не удалось открыть встречу на сервере.', () => this.http.request<unknown>({ method: 'GET', path: this.path(runId), signal })));
    const run = toRun(body?.run);
    if (!body || !run) throw new RunError('Сервер вернул неизвестный формат встречи.');
    const approved = toProposal(body.approved);
    const files = object(body.files);
    return {
      run,
      // Exports and the register come from the approved snapshot; seed history may only have a proposal.
      proposal: run.status === 'done' || run.status === 'executing' ? approved ?? toProposal(body.proposal) : toProposal(body.proposal),
      approved: approved !== null,
      approvedAt: text(body.approved_at),
      participants: toParticipants(body.participants),
      hasAudio: typeof body.audio === 'string',
      filesReady: Boolean(files && typeof files.docx === 'string'),
    };
  }

  async saveProposal(runId: string, proposal: Proposal, expectedRevision: number): Promise<Proposal> {
    const body = object(await this.call('Не удалось сохранить черновик.', () => this.http.request<unknown>({
      method: 'PUT', path: this.path(runId, '/proposal'), body: { expected_revision: expectedRevision, proposal },
    })));
    const saved = toProposal(body?.proposal);
    if (!saved) throw new RunError('Сервер не вернул сохранённую редакцию.');
    return saved;
  }

  async approve(runId: string, { approved, expectedRevision, proposal, comment }: ApprovalInput): Promise<void> {
    await this.call(approved ? 'Не удалось утвердить протокол.' : 'Не удалось отклонить протокол.', () => this.http.request<unknown>({
      method: 'POST', path: this.path(runId, '/approve'),
      body: { approved, expected_revision: expectedRevision, ...(proposal ? { proposal } : {}), ...(comment?.trim() ? { comment: comment.trim() } : {}) },
    }));
  }

  async protocolFile(runId: string, kind: 'docx' | 'pdf'): Promise<Blob> {
    return this.call(`Не удалось получить ${kind.toUpperCase()} протокола.`, () => this.http.request<Blob>({
      method: 'GET', path: this.path(runId, `/protocol.${kind}`), responseType: 'blob', timeout: fileTimeoutMs,
    }));
  }

  async audio(runId: string): Promise<Blob> {
    return this.call('Не удалось загрузить запись с сервера.', () => this.http.request<Blob>({
      method: 'GET', path: this.path(runId, '/audio'), responseType: 'blob', timeout: fileTimeoutMs,
    }));
  }

  async assignments(signal?: AbortSignal): Promise<ServerAssignment[]> {
    const body = await this.call('Не удалось получить поручения с сервера.', () => this.http.request<unknown>({ method: 'GET', path: '/api/assignments', signal }));
    return list(body).map(toAssignment).filter((item): item is ServerAssignment => item !== null);
  }

  async setAssignmentDone(assignmentId: string, done: boolean): Promise<void> {
    await this.call('Не удалось изменить статус поручения на сервере.', () => this.http.request<unknown>({
      method: 'PATCH', path: `/api/assignments/${encodeURIComponent(assignmentId)}`, body: { done },
    }));
  }

  async jira(runId: string, signal?: AbortSignal): Promise<JiraState> {
    return toJira(await this.call('Не удалось получить задачи Jira.', () => this.http.request<unknown>({ method: 'GET', path: this.path(runId, '/jira'), signal })));
  }

  async pushToJira(runId: string) {
    const body = object(await this.call('Не удалось создать задачи в Jira.', () => this.http.request<unknown>({
      method: 'POST', path: this.path(runId, '/jira'), timeout: 2 * 60_000,
    })));
    const created = list(body?.created).filter((key): key is string => typeof key === 'string');
    return { created, sprint: text(body?.sprint), state: { ...toJira(body), configured: true, project: text(body?.project) } };
  }
}
