import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { ArrowRight, Plus, Radio } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { LiveConnecting } from '../components/LiveConnecting';
import styles from './LiveMeetingPage.module.css';

export default function LiveMeetingPage() {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [createError, setCreateError] = useState('');
  const { meetings, settings, loading, error, retry } = useWorkspace();
  const { recordings } = useServices();
  const conversations = meetings.filter((meeting) => meeting.kind === 'local' && (meeting.captureKind === 'conversation' || meeting.backendRunId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  async function startConversation() {
    if (opening) return;
    setCreateError('');
    setOpening(true);
    const started = Date.now();
    try {
      let runId: string | null = null;
      let title = '';
      let date = '';
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Этот браузер не может открыть микрофон.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (recordings) {
        const now = new Date();
        title = 'Разговор · ' + new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(now);
        date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        runId = await recordings.create({ title, date, language: settings.defaultLanguage });
      }
      const wait = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.max(0, 1600 - (Date.now() - started));
      await new Promise<void>((resolve) => window.setTimeout(resolve, wait));
      await navigate(runId ? '/meetings/live/call/' + encodeURIComponent(runId) : '/meetings/live/call', { state: { title, date, language: settings.defaultLanguage, autoStart: true } });
    } catch (cause) {
      setOpening(false);
      setCreateError(cause instanceof Error && cause.name === 'NotAllowedError'
        ? 'Доступ к микрофону отклонён. Разрешите его в браузере и попробуйте снова.'
        : cause instanceof Error ? cause.message : 'Не удалось создать разговор. Проверьте подключение и попробуйте снова.');
    }
  }

  if (opening) return <LiveConnecting />;

  return <div className={styles.page}>
    <header className={styles.header}><div><Text size="xs" fw={750} c="var(--accent)" tt="uppercase" lts="0.12em">Рабочее пространство</Text><Title order={1} mt={4}>Разговоры</Title></div><Button onClick={() => void startConversation()} leftSection={<Plus size={18} />}>Новый разговор</Button></header>
    {createError && <Alert color="red" title="Не удалось создать разговор" mb="md">{createError}</Alert>}
    {error && <Alert color="red" title="Не удалось открыть разговоры" mb="md"><Stack gap="sm"><Text size="sm">{error}</Text><Button variant="light" size="xs" w="fit-content" onClick={() => void retry()}>Повторить</Button></Stack></Alert>}
    <section aria-label="Сохранённые разговоры"><Stack gap="sm">
      {loading && <Card withBorder radius="md" p="lg"><Text c="dimmed">Загружаем разговоры…</Text></Card>}
      {!loading && conversations.length === 0 && <Card withBorder radius="md" p="xl"><div className={styles.empty}><Radio size={26} aria-hidden="true" /><Text c="dimmed">Здесь появятся ваши разговоры</Text></div></Card>}
      {!loading && conversations.map((meeting) => <Card key={meeting.id} withBorder radius="md" p="md"><Group justify="space-between" wrap="nowrap" gap="md">
        <Group wrap="nowrap" gap="md" className={styles.row}><span className={styles.icon}><Radio size={20} aria-hidden="true" /></span><div className={styles.copy}><Text fw={600}>{meeting.title}</Text><Badge color={meeting.backendRunId ? 'indigo' : 'gray'} variant="light" tt="none" mt={6}>{meeting.backendRunId ? 'Передано на обработку' : 'Запись сохранена на устройстве'}</Badge></div></Group>
        <Button component={Link} to={'/meetings/' + meeting.id} variant="subtle" rightSection={<ArrowRight size={16} />} aria-label={'Открыть разговор: ' + meeting.title}>Открыть</Button>
      </Group></Card>)}
    </Stack></section>
    <Text size="xs" c="dimmed" mt="lg">{recordings ? 'Новый разговор запросит доступ к микрофону. Во время записи звук передаётся на локальный сервер.' : 'Новый разговор запросит доступ к микрофону. Запись останется в этом браузере.'}</Text>
  </div>;
}
