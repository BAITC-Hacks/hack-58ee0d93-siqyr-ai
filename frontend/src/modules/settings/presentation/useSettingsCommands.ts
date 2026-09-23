import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';
import { useWorkspaceMutation } from '../../workspace/presentation/useWorkspaceMutation.ts';

export function useSettingsCommands() {
  const { settings, workspace } = useServices();
  const update = useWorkspaceMutation(settings.update);
  const reset = useWorkspaceMutation(() => workspace.restoreDemo());
  return { updateSettings: update.mutateAsync, resetDemo: () => reset.mutateAsync(undefined) };
}
