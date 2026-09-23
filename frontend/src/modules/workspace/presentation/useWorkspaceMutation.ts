import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServices } from './WorkspaceProvider.tsx';
import { workspaceMutation } from './workspace.mutations.ts';

export function useWorkspaceMutation<T, V>(mutationFn: (variables: V) => Promise<T>) {
  const queryClient = useQueryClient();
  const { workspace } = useServices();
  return useMutation(workspaceMutation(queryClient, workspace, mutationFn));
}
