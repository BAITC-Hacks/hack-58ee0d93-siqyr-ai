import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import { Alert, Anchor, Button, Loader, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, SquareKanban } from 'lucide-react';
import { runKeys } from './runs.queries';
import styles from './RunMeetingPage.module.css';

/** Approved assignments as Jira issues; the server keeps one issue per assignment, so a repeat adds only new ones. */
export function JiraPanel({ runId, assignments }: { runId: string; assignments: number }) {
  const { runs } = useServices();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: runKeys.jira(runId), queryFn: ({ signal }) => runs!.jira(runId, signal), enabled: runs !== null, retry: false });
  const push = useMutation({
    mutationFn: () => runs!.pushToJira(runId),
    onSuccess: (result) => queryClient.setQueryData(runKeys.jira(runId), result.state),
  });
  const state = query.data;
  const remaining = Math.max(0, assignments - (state?.issues.length ?? 0));

  return <section className={styles.jira} aria-label="Jira">
    <div className={styles.blockTitle}><strong><SquareKanban size={15} /> Jira</strong><span>Задачи создаются из утверждённого протокола с цитатами и PDF во вложении.</span></div>
    {query.isPending ? <Loader size="xs" /> : query.error ? <Text size="sm" c="red">{query.error.message}</Text> : !state?.configured
      ? <Text size="sm" c="dimmed">Jira не подключена на сервере: задайте JIRA_URL, JIRA_PROJECT и JIRA_TOKEN.</Text>
      : <>
        {state.issues.length > 0 && <ul className={styles.jiraIssues}>{state.issues.map((issue) => <li key={issue.key}>
          <Anchor href={issue.url} target="_blank" rel="noreferrer">{issue.key} <ExternalLink size={12} /></Anchor>
          <span>Поручение {issue.position + 1}{issue.assigned ? '' : ' · исполнитель не найден в Jira'}</span>
        </li>)}</ul>}
        {push.error && <Alert color="red" mt="xs">{push.error.message}</Alert>}
        {push.data && <Alert color="teal" mt="xs">{push.data.created.length ? `Создано задач: ${push.data.created.length}${push.data.sprint ? ` · спринт «${push.data.sprint}»` : ''}.` : 'Новых задач нет: все поручения уже в Jira.'}</Alert>}
        {remaining > 0 && <Button mt="sm" size="sm" leftSection={<SquareKanban size={15} />} loading={push.isPending} onClick={() => push.mutate()}>
          {state.issues.length ? `Отправить оставшиеся (${remaining})` : `Создать задачи в Jira${state.project ? ` · ${state.project}` : ''}`}
        </Button>}
      </>}
  </section>;
}
