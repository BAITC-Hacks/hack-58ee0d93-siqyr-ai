import type { ParticipantLine } from '../../meetings/domain/participantLines.ts';
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
  503: 'Обработка записи сейчас недоступна. Попробуйте позже.',
};

function uploadError(cause: unknown): Error {
  const status = cause instanceof HttpError ? cause.status : undefined;
  if (status === undefined) return new Error('Не удалось связаться с сервером. Проверьте подключение и повторите загрузку.');
  return new Error(uploadErrors[status] ?? 'Сервер не смог принять файл. Повторите загрузку.');
}

// The server keeps role as null when it is unknown, not as an empty string.
function serverParticipants(participants: ParticipantLine[]) {
  return participants.map(({ name, role }) => role ? { name, role } : { name });
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
  private readonly accessToken: () => string | null;
  private readonly streamFetch: typeof fetch;

  constructor(http: HttpClient, baseUrl: string, accessToken: () => string | null = () => null, streamFetch: typeof fetch = (input, init) => fetch(input, init)) {
    this.http = http;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.accessToken = accessToken;
    this.streamFetch = streamFetch;
  }

  private runForm(input: RecordingRunInput): FormData {
    const body = new FormData();
    body.set('title', input.title);
    body.set('lang', serverLanguage[input.language]);
    if (input.date) body.set('meeting_date', input.date);
    if (input.participants?.length) body.set('participants', JSON.stringify(serverParticipants(input.participants)));
    return body;
  }

  async create(input: RecordingRunInput): Promise<string> {
    const created = parse(await this.http.request<unknown>({ method: 'POST', path: '/api/runs/recordings', body: this.runForm(input) }));
    if (typeof created?.run_id !== 'string') throw new Error('Не удалось начать запись. Попробуйте ещё раз.');
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
    if (typeof created?.run_id !== 'string') throw new Error('Не удалось принять запись. Попробуйте загрузить файл ещё раз.');
    return created.run_id;
  }

  async formats(): Promise<UploadFormats> {
    const body = parse(await this.http.request<unknown>({ method: 'GET', path: '/api/formats' }));
    const extensions: unknown = body?.extensions;
    if (typeof body?.accept !== 'string' || typeof body.max_upload_mb !== 'number' || !Array.isArray(extensions)
      || !extensions.every((item): item is string => typeof item === 'string')) {
      throw new Error('Не удалось получить список поддерживаемых форматов.');
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
    if (typeof next !== 'number') throw new Error('Не удалось передать звук. Проверьте подключение и попробуйте снова.');
    return next;
  }

  async updateParticipants(runId: string, participants: ParticipantLine[]): Promise<void> {
    await this.http.request<unknown>({
      method: 'PATCH', path: `/api/runs/${encodeURIComponent(runId)}/participants`,
      body: { participants: serverParticipants(participants) },
    });
  }

  async finish(runId: string): Promise<void> {
    await this.http.request<unknown>({ method: 'POST', path: `/api/runs/${encodeURIComponent(runId)}/finish` });
  }

  watch(runId: string, onProgress: (progress: RunProgress) => void, onError: (message: string) => void): () => void {
    let active = true;
    let finished = false;
    let lastSeq = 0;
    const abort = new AbortController();
    let progress: RunProgress = { status: 'queued', steps: [] };
    const update = (status: string | undefined, steps: RunStep[]) => {
      const known = new Set(progress.steps.map((step) => step.seq));
      progress = {
        status: status ?? progress.status,
        steps: [...progress.steps, ...steps.filter((step) => !known.has(step.seq))].sort((a, b) => a.seq - b.seq),
      };
      lastSeq = Math.max(lastSeq, ...progress.steps.map((step) => step.seq), 0);
      finished = finalStatuses.has(progress.status);
      if (active) onProgress(progress);
      if (finished) abort.abort();
    };
    const path = `/api/runs/${encodeURIComponent(runId)}`;
    void this.http.request<unknown>({ method: 'GET', path }).then((detail) => {
      const run = parse(parse(detail)?.run);
      const steps = parse(detail)?.steps;
      update(typeof run?.status === 'string' ? run.status : undefined,
        Array.isArray(steps) ? steps.map(toStep).filter((step): step is RunStep => step !== null) : []);
    }).catch(() => { if (active) onError('Не удалось получить ход обработки с сервера.'); });

    const consume = async () => {
      while (active && !finished) {
        const token = this.accessToken();
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (lastSeq) headers['Last-Event-ID'] = String(lastSeq);
        try {
          const response = await this.streamFetch(`${this.baseUrl}${path}/events`, { headers, signal: abort.signal });
          if (!response.ok || !response.body) {
            onError(response.status === 401 ? 'Сессия истекла. Войдите снова, чтобы видеть обработку.' : 'Не удалось подключиться к этапам обработки.');
            return;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (active && !finished) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const eventType = /^event: (.+)$/m.exec(frame)?.[1];
              const data = /^data: (.+)$/m.exec(frame)?.[1];
              if (eventType === 'step' && data) {
                const step = toStep(data);
                if (step) update(undefined, [step]);
              } else if (eventType === 'status' && data) {
                const status = parse(data)?.status;
                if (typeof status === 'string') update(status, []);
              }
              boundary = buffer.indexOf('\n\n');
            }
          }
          if (active && !finished) await new Promise((resolve) => setTimeout(resolve, 1_000));
        } catch {
          if (!active || finished || abort.signal.aborted) return;
          onError('Связь с обработкой прервалась. Пытаемся переподключиться.');
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    };
    void consume();
    return () => { active = false; abort.abort(); };
  }
}
