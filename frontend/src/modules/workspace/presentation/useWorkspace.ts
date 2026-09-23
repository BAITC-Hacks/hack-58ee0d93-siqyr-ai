import { HttpError } from '../../../shared/application/HttpClient.ts';
import { useQuery } from '@tanstack/react-query';
import { defaultSettings } from '../../settings/domain/settings.types.ts';
import { useServices } from './WorkspaceProvider.tsx';
import { workspaceQuery } from './workspace.queries.ts';

export function useWorkspace() {
  const { workspace } = useServices();
  const query = useQuery(workspaceQuery(workspace));
  return {
    meetings: query.data?.meetings ?? [],
    tasks: query.data?.tasks ?? [],
    settings: query.data?.settings ?? defaultSettings,
    loading: query.isPending,
    error: query.error instanceof HttpError ? query.error.message : query.error ? 'Локальное хранилище недоступно. Проверьте настройки браузера и обновите страницу.' : null,
    retry: query.refetch,
  };
}
