import { Alert, Badge, Checkbox, Group, Paper, SegmentedControl, Table, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';
import type { ServerAssignment } from '../application/ProtocolGateway.ts';

const statusView: Record<string, { label: string; color: string }> = {
  in_progress: { label: 'В работе', color: 'blue' }, overdue: { label: 'Просрочено', color: 'red' }, done: { label: 'Выполнено', color: 'teal' },
};
const priorityLabel: Record<string, string> = { high: 'высокий', normal: 'обычный', low: 'низкий' };

/** Registry of approved assignments on the server: statuses in progress / overdue / done (CONTRACT /api/assignments). */
export function ServerAssignmentsPanel({ className }: { className?: string }) {
  const { protocols } = useServices();
  const [items, setItems] = useState<ServerAssignment[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!protocols) return;
    try { setItems(await protocols.assignments()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить реестр поручений.'); }
  }, [protocols]);

  useEffect(() => { void load(); }, [load]);
  if (!protocols) return null;

  async function toggle(item: ServerAssignment, done: boolean) {
    if (!protocols) return;
    setBusyId(item.id);
    try { await protocols.setDone(item.id, done); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить статус.'); }
    finally { setBusyId(''); }
  }

  const all = items ?? [];
  const count = (status: string) => all.filter((item) => item.status === status).length;
  const shown = filter === 'all' ? all : all.filter((item) => item.status === filter);

  return <Paper withBorder radius="md" p="lg" className={className}>
    <Group justify="space-between" mb="sm">
      <div>
        <Text size="xs" c="dimmed" fw={600}>РЕЕСТР С СЕРВЕРА · ТОЛЬКО УТВЕРЖДЁННЫЕ ПРОТОКОЛЫ</Text>
        <Title order={3}>Дашборд поручений</Title>
      </div>
      <Group gap="xs">
        <Badge variant="light" color="blue">В работе: {count('in_progress')}</Badge>
        <Badge variant="light" color="red">Просрочено: {count('overdue')}</Badge>
        <Badge variant="light" color="teal">Выполнено: {count('done')}</Badge>
      </Group>
    </Group>
    {error && <Alert color="red" mb="sm" withCloseButton onClose={() => setError('')}>{error}</Alert>}
    <SegmentedControl mb="sm" value={filter} onChange={setFilter} data={[
      { value: 'all', label: `Все (${all.length})` }, { value: 'in_progress', label: 'В работе' }, { value: 'overdue', label: 'Просрочено' }, { value: 'done', label: 'Выполнено' },
    ]} />
    {items === null ? <Text size="sm" c="dimmed">Загружаем…</Text> : shown.length === 0 ? <Text size="sm" c="dimmed">Поручений нет. Они появляются здесь после утверждения протокола.</Text> :
      <div style={{ overflowX: 'auto' }}><Table withTableBorder verticalSpacing="xs" style={{ minWidth: 760 }}>
        <Table.Thead><Table.Tr><Table.Th>Выполнено</Table.Th><Table.Th>Поручение</Table.Th><Table.Th>Ответственный</Table.Th><Table.Th>Срок</Table.Th><Table.Th>Статус</Table.Th><Table.Th>Встреча</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{shown.map((item) => {
          const view = statusView[item.status] ?? { label: item.status, color: 'gray' };
          return <Table.Tr key={item.id}>
            <Table.Td><Checkbox checked={item.status === 'done'} disabled={busyId === item.id} onChange={(event) => void toggle(item, event.currentTarget.checked)} aria-label={`Выполнено: ${item.task}`} /></Table.Td>
            <Table.Td><Text size="sm">{item.task}</Text>{item.priority !== 'normal' && <Text size="xs" c="dimmed">приоритет: {priorityLabel[item.priority] ?? item.priority}</Text>}</Table.Td>
            <Table.Td><Text size="sm">{item.assignee}</Text></Table.Td>
            <Table.Td><Text size="sm">{item.deadline || item.deadline_text || 'Не указан'}</Text>{item.days_left != null && item.status !== 'done' && <Text size="xs" c={item.days_left < 0 ? 'red' : 'dimmed'}>{item.days_left < 0 ? `просрочено на ${-item.days_left} дн.` : `осталось ${item.days_left} дн.`}</Text>}</Table.Td>
            <Table.Td><Badge variant="light" color={view.color}>{view.label}</Badge></Table.Td>
            <Table.Td><Text size="sm" component={Link} to="/meetings" c="blue">{item.run_title}</Text></Table.Td>
          </Table.Tr>;
        })}</Table.Tbody>
      </Table></div>}
  </Paper>;
}
