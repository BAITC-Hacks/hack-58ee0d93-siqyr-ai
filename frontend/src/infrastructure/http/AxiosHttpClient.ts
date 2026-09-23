import axios, { type AxiosInstance } from 'axios';
import { HttpError, type HttpClient, type HttpRequest } from '../../shared/application/HttpClient.ts';

export class AxiosHttpClient implements HttpClient {
  private readonly client: AxiosInstance;

  constructor(baseURL: string, client?: AxiosInstance) {
    if (!baseURL.trim()) throw new Error('API base URL is required.');
    this.client = client ?? axios.create({ baseURL, timeout: 30_000 });
  }

  async request<T>({ path, body, ...options }: HttpRequest): Promise<T> {
    try {
      const response = await this.client.request<T>({ ...options, url: path, data: body });
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
