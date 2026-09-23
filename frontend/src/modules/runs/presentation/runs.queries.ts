import { queryOptions } from '@tanstack/react-query';
import type { RunGateway } from '../application/RunGateway.ts';
import type { RunSync } from '../application/RunSync.ts';
import { processingStatuses } from '../domain/run.types.ts';

export const runKeys = {
  sync: ['server-sync'] as const,
  run: (runId: string) => ['run', runId] as const,
  jira: (runId: string) => ['run', runId, 'jira'] as const,
};

export function serverSyncQuery(sync: RunSync | null) {
  return queryOptions({
    queryKey: runKeys.sync,
    queryFn: ({ signal }) => {
      if (!sync) throw new Error('Server sync is not configured.');
      return sync.sync(signal);
    },
    enabled: sync !== null,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function runQuery(gateway: RunGateway, runId: string) {
  return queryOptions({
    queryKey: runKeys.run(runId),
    queryFn: ({ signal }) => gateway.get(runId, signal),
    // While the server works, poll; the live trace above comes from the event stream.
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return !status || processingStatuses.has(status) ? 3_000 : false;
    },
    retry: 1,
  });
}
