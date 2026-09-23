import { AxiosHttpClient } from '@/infrastructure/http/AxiosHttpClient';
import type { HttpClient } from '@/shared/application/HttpClient';

export function createHttpClient(): HttpClient {
  const baseURL = import.meta.env.VITE_API_URL?.trim();
  if (!baseURL) throw new Error('Set VITE_API_URL before enabling API access.');
  return new AxiosHttpClient(baseURL);
}
