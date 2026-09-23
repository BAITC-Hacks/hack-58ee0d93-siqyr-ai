import { HttpError, type HttpClient } from '../../../shared/application/HttpClient.ts';
import type { RecordingGateway, RecordingRunInput, RunProgress, RunStep, UploadFormats } from '../application/RecordingGateway.ts';

const serverLanguage = { ru: 'ru', kk: 'kk', mixed: 'rukk' } as const;
const finalStatuses = new Set(['done', 'error', 'rejected']);
// 100 МБ через медленную сеть не укладываются в общий таймаут клиента.
const uploadTimeoutMs = 10 * 60_000;
// The HTTP client does not pass server texts through, so upload failures are explained by the contract's status codes.
const uploadErrors: Record<number, string> = {
  400: 'Сервер отклонил данные встречи или пустой файл. Проверьте тему, дату и файл.',
  401: 'Сессия истекла. Войдите снова и повторите загрузку.',
  403: 'Нет прав создавать встречи в этом подразделении.',
  413: 'Файл больше, чем принимает сервер. Выберите запись меньшего размера.',
  415: 'Сервер не принял файл: это не аудио- или видеозапись поддерживаемого формата либо файл повреждён.',
  429: 'Сервер занят обработкой других встреч. Повторите через минуту.',
  503: 'Распознавание на сервере сейчас недоступно: модели не подготовлены.',
};

function uploadError(cause: unknown): Error {
  const status = cause instanceof HttpError ? cause.status : undefined;
  if (status === undefined) return new Error('Сервер недоступен. Проверьте, что бэкенд запущен, и повторите загрузку.');
  return new Error(uploadErrors[status] ?? 'Сервер не смог принять файл. Повторите загрузку.');
}

function parse(data: unknown): Record<string, unknown> | null {
  try {
    const value: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function toStep(value: unknown): RunStep | null {
  const step = parse(value);
  return step && typeof step.seq === 'number' && typeof step.content === 'string' ? { seq: step.seq, content: step.content } : null;
}

export class ApiRecordingGateway implements RecordingGateway {
  private readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(http: HttpClient, baseUrl: string) {
    this.http = http;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private runForm(input: RecordingRunInput): FormData {
    const body = new FormData();
    body.set('title', input.title);
    body.set('lang', serverLanguage[input.language]);
    if (input.date) body.set('meeting_date', input.date);
    return body;
  }

  async create(input: RecordingRunInput): Promise<string> {
    const created = parse(await this.http.request<unknown>({ method: 'POST', path: '/api/runs/recordings', body: this.runForm(input) }));
    if (typeof created?.run_id !== 'string') throw new Error('Сервер не вернул идентификатор записи.');
    return created.run_id;
  }

  async upload(input: RecordingRunInput, file: File): Promise<string> {
    const body = this.runForm(input);
    body.set('file', file, file.name);
    let created: Record<string, unknown> | null;
    try {
      created = parse(await this.http.request<unknown>({ method: 'POST', path: '/api/runs', body, timeout: uploadTimeoutMs }));
    } catch (cause) {
      throw uploadError(cause);
    }
    if (typeof created?.run_id !== 'string') throw new Error('Сервер не вернул идентификатор встречи.');
    return created.run_id;
  }

  async formats(): Promise<UploadFormats> {
    const body = parse(await this.http.request<unknown>({ method: 'GET', path: '/api/formats' }));
    const extensions: unknown = body?.extensions;
    if (typeof body?.accept !== 'string' || typeof body.max_upload_mb !== 'number' || !Array.isArray(extensions)
      || !extensions.every((item): item is string => typeof item === 'string')) {
      throw new Error('Сервер вернул неизвестный список форматов.');
    }
    return { accept: body.accept, extensions, maxBytes: body.max_upload_mb * 1024 * 1024 };
  }

  async sendChunk(runId: string, chunk: Blob, offset: number): Promise<number> {
    const send = () => this.http.request<unknown>({
      method: 'POST', path: `/api/runs/${encodeURIComponent(runId)}/chunks`, body: chunk,
      headers: { 'X-Chunk-Offset': String(offset), 'Content-Type': 'application/octet-stream' },
    });
    let response: unknown;
    // The server accepts a repeat of an already stored chunk at the same offset, so one retry is safe.
    try { response = await send(); } catch { response = await send(); }
    const next = parse(response)?.offset;
    if (typeof next !== 'number') throw new Error('Сервер не подтвердил получение звука.');
    return next;
  }

  async finish(runId: string): Promise<void> {
    await this.http.request<unknown>({ method: 'POST', path: `/api/runs/${encodeURIComponent(runId)}/finish` });
  }

  watch(runId: string, onProgress: (progress: RunProgress) => void, onError: (message: string) => void): () => void {
    let active = true;
    let progress: RunProgress = { status: 'queued', steps: [] };
    const update = (status: string | undefined, steps: RunStep[]) => {
      const known = new Set(progress.steps.map((step) => step.seq));
      progress = {
        status: status ?? progress.status,
        steps: [...progress.steps, ...steps.filter((step) => !known.has(step.seq))].sort((a, b) => a.seq - b.seq),
      };
      if (active) onProgress(progress);
    };
    const path = `/api/runs/${encodeURIComponent(runId)}`;
    const source = new EventSource(`${this.baseUrl}${path}/events`);
    source.addEventListener('step', (event) => {
      const step = toStep((event as MessageEvent).data);
      if (step) update(undefined, [step]);
    });
    source.addEventListener('status', (event) => {
      const status = parse((event as MessageEvent).data)?.status;
      if (typeof status !== 'string') return;
      update(status, []);
      if (finalStatuses.has(status)) source.close();
    });
    source.onerror = () => {
      if (active && source.readyState === EventSource.CLOSED) onError('Связь с сервером прервана. Обновите страницу, чтобы переподключиться.');
    };
    void this.http.request<unknown>({ method: 'GET', path }).then((detail) => {
      const run = parse(parse(detail)?.run);
      const steps = parse(detail)?.steps;
      update(typeof run?.status === 'string' ? run.status : undefined,
        Array.isArray(steps) ? steps.map(toStep).filter((step): step is RunStep => step !== null) : []);
    }).catch(() => { if (active) onError('Не удалось получить ход обработки с сервера.'); });
    return () => { active = false; source.close(); };
  }
}
