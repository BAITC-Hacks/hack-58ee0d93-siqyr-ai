import { QueryClient } from '@tanstack/react-query';
import { HttpError } from '../../shared/application/HttpClient.ts';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) => failures < 2 && error instanceof HttpError && (error.status === undefined || error.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}
