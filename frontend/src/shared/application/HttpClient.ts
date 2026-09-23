export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Overrides the client default in milliseconds, e.g. for large uploads. */
  timeout?: number;
  /** 'blob' for files such as the protocol DOCX/PDF or the meeting audio. */
  responseType?: 'json' | 'blob';
}

export interface HttpClient {
  request<T>(request: HttpRequest): Promise<T>;
}

export class HttpError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  /** The API's own user-facing `detail` text; the rest of the response body is never kept. */
  readonly detail: string | undefined;
  /** The API's machine-readable `code` field, e.g. review_required. */
  readonly reason: string | undefined;

  constructor(message: string, status?: number, code?: string, detail?: string, reason?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.reason = reason;
  }
}
