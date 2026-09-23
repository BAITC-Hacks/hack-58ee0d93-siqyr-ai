import axios, { type AxiosInstance } from 'axios';
import { HttpError, type HttpClient, type HttpRequest } from '../../shared/application/HttpClient.ts';

/** Only the API's `detail` string and `code` survive: they are written for users, other body fields are not. */
async function apiExplanation(data: unknown): Promise<{ detail?: string; reason?: string }> {
  let value = data;
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    try { value = JSON.parse(await value.text()); } catch { return {}; }
  }
  if (typeof value !== 'object' || value === null) return {};
  const { detail, code } = value as Record<string, unknown>;
  return { ...(typeof detail === 'string' ? { detail } : {}), ...(typeof code === 'string' ? { reason: code } : {}) };
}

export class AxiosHttpClient implements HttpClient {
  private readonly client: AxiosInstance;
  private readonly accessToken: () => string | null;

  constructor(baseURL: string, client?: AxiosInstance, accessToken: () => string | null = () => null) {
    if (!baseURL.trim()) throw new Error('API base URL is required.');
    this.client = client ?? axios.create({ baseURL, timeout: 30_000 });
    this.accessToken = accessToken;
  }

  async request<T>({ path, body, headers, ...options }: HttpRequest): Promise<T> {
    // An explicit Authorization header (session restore) wins over the stored token.
    const token = headers?.Authorization ? null : this.accessToken();
    try {
      const response = await this.client.request<T>({
        ...options, url: path, data: body, headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
      });
      return response.data;
    } catch (cause) {
      // Cancellation must remain recognizable to query consumers.
      if (axios.isCancel(cause)) throw cause;
      if (axios.isAxiosError(cause)) {
        const { detail, reason } = await apiExplanation(cause.response?.data);
        throw new HttpError('Не удалось выполнить запрос. Попробуйте ещё раз.', cause.response?.status, cause.code, detail, reason);
      }
      throw cause;
    }
  }
}
