import { mutationOptions, type QueryClient } from '@tanstack/react-query';
import type { WorkspaceRepository } from '../application/WorkspaceRepository.ts';
import { workspaceKeys } from './workspace.queries.ts';

export function workspaceMutation<T, V>(client: QueryClient, repository: WorkspaceRepository, mutationFn: (variables: V) => Promise<T>) {
  return mutationOptions({
    mutationFn,
    networkMode: repository.networkMode,
    retry: false,
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: workspaceKeys.all });
      await client.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}
