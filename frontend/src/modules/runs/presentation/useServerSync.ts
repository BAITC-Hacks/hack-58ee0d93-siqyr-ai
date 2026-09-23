import { useQuery } from '@tanstack/react-query';
import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';
import { serverSyncQuery } from './runs.queries.ts';

/** State of the background copy of server meetings and assignments into this browser. */
export function useServerSync() {
  const { sync } = useServices();
  const query = useQuery(serverSyncQuery(sync));
  return {
    enabled: sync !== null,
    syncing: query.isFetching,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Не удалось обновить данные с сервера.') : null,
    syncedAt: query.data ?? null,
    refresh: () => query.refetch(),
  };
}
