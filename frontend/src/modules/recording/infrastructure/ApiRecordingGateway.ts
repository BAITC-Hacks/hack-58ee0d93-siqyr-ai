import type { HttpClient } from '../../../shared/application/HttpClient.ts';
import type { RecordingGateway, RecordingRunInput, RunProgress, RunStep } from '../application/RecordingGateway.ts';

const serverLanguage = { ru: 'ru', kk: 'kk', mixed: 'rukk' } as const;
const finalStatuses = new Set(['done', 'error', 'rejected']);

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

  async create(input: RecordingRunInput): Promise<string> {
    const body = new FormData();
    body.set('title', input.title);
    body.set('lang', serverLanguage[input.language]);
    if (input.date) body.set('meeting_date', input.date);
    const created = parse(await this.http.request<unknown>({ method: 'POST', path: '/api/runs/recordings', body }));
    if (typeof created?.run_id !== 'string') throw new Error('Сервер не вернул идентификатор записи.');
    return created.run_id;
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
