import { ProtocolError, type JiraIssue, type Proposal, type ProtocolGateway, type RunDetail, type ServerAssignment } from '../application/ProtocolGateway.ts';

const statusErrors: Record<number, string> = {
  401: 'Сессия истекла. Войдите снова.',
  403: 'Нет прав на это действие в подразделении встречи.',
  404: 'Встреча не найдена на сервере.',
  502: 'Внешняя система ответила ошибкой.',
  503: 'Сервис на сервере не настроен.',
};

// fetch instead of the shared HTTP client: review errors carry the server's own explanation (detail) and files are binary.
export class ApiProtocolGateway implements ProtocolGateway {
  private readonly baseUrl: string;
  private readonly accessToken: () => string | null;

  constructor(baseUrl: string, accessToken: () => string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.accessToken = accessToken;
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = this.accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ProtocolError('Сервер недоступен. Проверьте, что бэкенд запущен.', 0);
    }
    if (response.ok) return response;
    let detail = '';
    let code: string | undefined;
    try {
      const data: unknown = await response.json();
      if (data && typeof data === 'object') {
        const value = (data as { detail?: unknown }).detail;
        if (typeof value === 'string') detail = value;
        else if (Array.isArray(value)) detail = 'Сервер отклонил данные черновика.';
        const serverCode = (data as { code?: unknown }).code;
        if (typeof serverCode === 'string') code = serverCode;
      }
    } catch { /* not JSON */ }
    throw new ProtocolError(detail || statusErrors[response.status] || `Ошибка сервера (${response.status}).`, response.status, code);
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return await (await this.send(method, path, body)).json() as T;
  }

  private runPath(runId: string): string {
    return `/api/runs/${encodeURIComponent(runId)}`;
  }

  async run(runId: string): Promise<RunDetail> {
    const data = await this.json<{
      run: { status: string; title: string; source_mode?: string };
      proposal: Proposal | null; approved: Proposal | null;
      transcript?: { source_mode?: string; segments?: RunDetail['segments'] };
    }>('GET', this.runPath(runId));
    return {
      status: data.run.status,
      title: data.run.title,
      sourceMode: data.transcript?.source_mode ?? data.run.source_mode ?? 'mock',
      proposal: data.approved ?? data.proposal,
      approved: Boolean(data.approved),
      segments: data.transcript?.segments ?? data.proposal?.segments ?? [],
    };
  }

  async save(runId: string, proposal: Proposal): Promise<Proposal> {
    const data = await this.json<{ proposal: Proposal }>('PUT', `${this.runPath(runId)}/proposal`, { expected_revision: proposal.revision, proposal });
    return data.proposal;
  }

  async approve(runId: string, proposal: Proposal, approved: boolean): Promise<string> {
    const data = await this.json<{ status: string }>('POST', `${this.runPath(runId)}/approve`, { approved, expected_revision: proposal.revision, proposal });
    return data.status;
  }

  async download(runId: string, kind: 'docx' | 'pdf'): Promise<Blob> {
    return await (await this.send('GET', `${this.runPath(runId)}/protocol.${kind}`)).blob();
  }

  async jira(runId: string): Promise<JiraIssue[]> {
    const data = await this.json<{ issues?: JiraIssue[] }>('POST', `${this.runPath(runId)}/jira`);
    return data.issues ?? [];
  }

  async assignments(status?: string): Promise<ServerAssignment[]> {
    return await this.json<ServerAssignment[]>('GET', `/api/assignments${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  }

  async setDone(assignmentId: string, done: boolean): Promise<void> {
    await this.send('PATCH', `/api/assignments/${encodeURIComponent(assignmentId)}`, { done });
  }
}
