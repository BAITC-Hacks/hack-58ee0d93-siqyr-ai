import axios, { type AxiosInstance } from 'axios';
import { HttpError, type HttpClient, type HttpRequest } from '../../shared/application/HttpClient.ts';

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
        throw new HttpError('Не удалось выполнить запрос. Попробуйте ещё раз.', cause.response?.status, cause.code);
      }
      throw cause;
    }
  }
}
