import { Alert, Badge, Button, Group, Menu, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { ChevronDown, Mic2, PhoneCall } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { getGoogleSessionToken, subscribeGoogleSession } from '@/modules/integrations/application/googleSession';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { formatDate } from '@/shared/lib/formatDate';

export default function LiveMeetingPage() {
  const { meetings, loading, error, retry } = useWorkspace();
  const googleConnected = useSyncExternalStore(subscribeGoogleSession, getGoogleSessionToken) !== null;
  const conversations = meetings.filter((meeting) => meeting.kind === 'local' && meeting.backendRunId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return <Stack gap="lg">
    <Group justify="space-between" align="start" gap="lg">
      <div><Text size="xs" fw={750} c="var(--accent)" tt="uppercase" lts="0.12em">Разговоры</Text><Title order={1} mt={4}>Живые разговоры</Title><Text c="dimmed" mt={6}>Записи разговоров и их обработанные материалы</Text></div>
      <Menu position="bottom-end" shadow="md" withinPortal>
        <Menu.Target><Button leftSection={<PhoneCall size={18} />} rightSection={<ChevronDown size={16} />}>Начать разговор</Button></Menu.Target>
        <Menu.Dropdown><Menu.Item component={Link} to="/meetings/live/call" leftSection={<Mic2 size={17} />}>Локальный разговор</Menu.Item><Menu.Item component={Link} to="/integrations" disabled={!googleConnected}>Google Meet</Menu.Item></Menu.Dropdown>
      </Menu>
    </Group>

    {error && <Alert color="red" title="Не удалось загрузить разговоры"><Stack gap="xs"><Text size="sm">{error}</Text><Button variant="light" size="xs" w="fit-content" onClick={() => void retry()}>Повторить</Button></Stack></Alert>}

    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
      <Table.ScrollContainer minWidth={670}><Table verticalSpacing="md" horizontalSpacing="lg" highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Разговор</Table.Th><Table.Th>Дата</Table.Th><Table.Th>Источник</Table.Th><Table.Th>Статус</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {loading ? <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" py="xl">Загружаем разговоры…</Text></Table.Td></Table.Tr> : conversations.length === 0 ? <Table.Tr><Table.Td colSpan={5}><Stack align="flex-start" gap="sm" py="xl" mih={190} justify="center"><Title order={3}>Пока нет разговоров</Title><Text c="dimmed">Запишите первый разговор, чтобы он появился здесь.</Text><Button component={Link} to="/meetings/live/call" variant="light" leftSection={<PhoneCall size={16} />}>Начать разговор</Button></Stack></Table.Td></Table.Tr> : conversations.map((meeting) => <Table.Tr key={meeting.id}><Table.Td><Stack gap={2}><Text component={Link} to={`/meetings/${meeting.id}`} fw={650} c="var(--ink)" style={{ textDecoration: 'none' }}>{meeting.title}</Text><Text size="xs" c="dimmed">{meeting.organization}</Text></Stack></Table.Td><Table.Td>{formatDate(meeting.date)}</Table.Td><Table.Td>Локальная запись</Table.Td><Table.Td><Badge variant="light" color={meeting.status === 'ready' ? 'teal' : meeting.status === 'draft' ? 'orange' : 'blue'}>{meeting.status === 'ready' ? 'Готово' : meeting.status === 'draft' ? 'Нужна проверка' : 'Обрабатывается'}</Badge></Table.Td><Table.Td><Button component={Link} to={`/meetings/${meeting.id}`} variant="subtle" size="xs">Открыть</Button></Table.Td></Table.Tr>)}
        </Table.Tbody>
      </Table></Table.ScrollContainer>
    </Paper>
  </Stack>;
}
