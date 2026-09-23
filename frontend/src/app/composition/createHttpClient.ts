import { AxiosHttpClient } from '@/infrastructure/http/AxiosHttpClient';
import { storedAccessToken } from '@/modules/auth/infrastructure/ApiAuthGateway';
import type { HttpClient } from '@/shared/application/HttpClient';

export function createHttpClient(): HttpClient {
  const baseURL = import.meta.env.VITE_API_URL?.trim();
  if (!baseURL) throw new Error('Set VITE_API_URL before enabling API access.');
  // With AUTH_MODE=local every API route needs the Bearer token issued at sign-in.
  return new AxiosHttpClient(baseURL, undefined, () => storedAccessToken(window.sessionStorage));
}
