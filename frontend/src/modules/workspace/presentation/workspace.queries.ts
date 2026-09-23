import { queryOptions } from '@tanstack/react-query';
import type { WorkspaceRepository } from '../application/WorkspaceRepository.ts';

export const workspaceKeys = {
  all: ['workspace'] as const,
  snapshot: () => [...workspaceKeys.all, 'snapshot'] as const,
};

export function workspaceQuery(repository: WorkspaceRepository) {
  return queryOptions({
    queryKey: workspaceKeys.snapshot(),
    queryFn: async ({ signal }) => {
      await repository.initialize();
      signal.throwIfAborted();
      return repository.readSnapshot(signal);
    },
    networkMode: repository.networkMode,
    staleTime: repository.networkMode === 'always' ? Infinity : 30_000,
  });
}
