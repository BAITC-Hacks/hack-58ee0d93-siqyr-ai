import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';
import { useWorkspaceMutation } from '../../workspace/presentation/useWorkspaceMutation.ts';
import type { TaskChanges } from '../domain/task.types.ts';

export function useTaskCommands() {
  const { tasks } = useServices();
  const create = useWorkspaceMutation(tasks.create);
  const update = useWorkspaceMutation(({ id, patch }: { id: string; patch: TaskChanges }) => tasks.update(id, patch));
  const remove = useWorkspaceMutation(tasks.remove);
  return {
    createTask: create.mutateAsync,
    updateTask: (id: string, patch: TaskChanges) => update.mutateAsync({ id, patch }),
    deleteTask: remove.mutateAsync,
  };
}
