import { ActionIcon, Alert, Avatar, Badge, Button, Group, Paper, Stack, Tabs, Text, Title } from '@mantine/core';
import { ArrowLeft, FileText, Mic, MicOff, Square, Target } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '@/modules/auth/presentation/AuthProvider';
import { LOCAL_WORKSPACE_ID } from '@/modules/auth/domain/auth.types';
import { useOnDeviceTranscript } from '@/modules/recording/presentation/useOnDeviceTranscript';
import { useObjectUrl } from '@/shared/presentation/useObjectUrl';
import type { Segment } from '../../domain/meeting.types';
import { useNewMeetingModel, type ConversationCapture } from '../models/useNewMeetingModel';
import styles from './CallPage.module.css';

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

export default function CallPage() {
  const { runId } = useParams();
  const location = useLocation();
  const { state } = useAuth();
  const principal = state.status === 'authenticated' ? state.session.principal : null;
  const speaker = principal?.id === LOCAL_WORKSPACE_ID ? 'Вы' : principal?.displayName || 'Вы';
  const { recorder, streaming, beginRecording, finishRecording, keepRecordingLocally, submitError, saving, form } = useNewMeetingModel('record', true, false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const segmentsRef = useRef<Segment[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>('conversation');
  const previewUrl = useObjectUrl(recorder.blob);
  const active = recorder.status === 'recording' || recorder.status === 'paused';
  const supported = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';
  const webmSupported = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' &&
    (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') || MediaRecorder.isTypeSupported('audio/webm'));
  const canRecord = supported && (!streaming || webmSupported);

  function addSegment(text: string) {
    const normalized = text.trim();
    if (!normalized) return;
    segmentsRef.current = [...segmentsRef.current, { id: crypto.randomUUID(), speaker, role: '', text: normalized, offsetMs: recorder.elapsedMs }];
    setSegments(segmentsRef.current);
  }

  const transcription = useOnDeviceTranscript(form.values.language, recorder.status, addSegment);
  const capture = (): ConversationCapture => ({
    participants: [{ id: principal?.id ?? 'local-speaker', name: speaker, role: '' }],
    transcript: segmentsRef.current,
  });

  async function endConversation() {
    await transcription.stopAndFlush();
    const id = await finishRecording(capture());
    if (id) setSavedId(id);
  }

  async function saveLocally() {
    await transcription.stopAndFlush();
    const id = await keepRecordingLocally(capture());
    if (id) setSavedId(id);
  }

  useEffect(() => {
    const details = location.state as { title?: string; date?: string; language?: 'ru' | 'kk' | 'mixed' } | null;
    if (!details) return;
    if (details.title) form.setFieldValue('title', details.title);
    if (details.date) form.setFieldValue('date', details.date);
    if (details.language) form.setFieldValue('language', details.language);
  }, [runId]);

  useEffect(() => {
    const details = location.state as { autoStart?: boolean } | null;
    if ((!runId || !streaming) && !details?.autoStart) return;
    const timer = window.setTimeout(() => { void beginRecording(runId, true); }, 0);
    return () => window.clearTimeout(timer);
  }, [runId, streaming]);

  const status = savedId ? 'Разговор завершён' : recorder.status === 'recording' ? 'Разговор идёт' :
    recorder.status === 'paused' ? 'Микрофон выключен' : recorder.status === 'requesting' ? 'Подключаем микрофон' :
      recorder.status === 'finishing' ? 'Сохраняем разговор' : 'Готов к началу';

  return <div className={styles.page}>
    <Button component={Link} to="/meetings/live" variant="subtle" color="gray" leftSection={<ArrowLeft size={16} />} pl={0} mb="md">К разговорам</Button>
    <header className={styles.heading}>
      <div><Title order={1}>{form.values.title}</Title><Text c="dimmed" size="sm" mt={6}><span className={active ? styles.liveDot : styles.idleDot} />{status} · {duration(recorder.elapsedMs)}</Text></div>
      <Group className={styles.actions} gap="sm">
        {!savedId && !active && recorder.status !== 'requesting' && recorder.status !== 'finishing' && <Button leftSection={<Mic size={18} />} disabled={!canRecord} loading={saving} onClick={() => void beginRecording(runId, true)}>Начать разговор</Button>}
        {active && <ActionIcon size={42} variant="light" radius="md" color={recorder.status === 'recording' ? 'indigo' : 'gray'} onClick={recorder.status === 'recording' ? recorder.pause : recorder.resume} aria-pressed={recorder.status === 'recording'} aria-label={recorder.status === 'recording' ? 'Выключить микрофон' : 'Включить микрофон'}>{recorder.status === 'recording' ? <Mic size={20} /> : <MicOff size={20} />}</ActionIcon>}
        {active && <Button variant="default" leftSection={<Square size={16} />} loading={saving} onClick={() => void endConversation()}>Завершить</Button>}
        {savedId && <Button component={Link} to={'/meetings/' + savedId} variant="default" leftSection={<FileText size={17} />}>Открыть сохранённую встречу</Button>}
      </Group>
      <Group className={styles.people} gap="sm"><Avatar size={38} radius="xl" color="indigo">{speaker.slice(0, 1).toLocaleUpperCase('ru')}</Avatar><Text fw={600}>{speaker} <Text span c="dimmed" fw={400}>(вы)</Text></Text>{recorder.status === 'recording' && <Badge color="indigo" variant="light">Говорит</Badge>}</Group>
    </header>

    {!supported && <Alert color="orange" mt="md" title="Микрофон недоступен">Откройте страницу через localhost в браузере с поддержкой записи и разрешите доступ к микрофону.</Alert>}
    {streaming && supported && !webmSupported && <Alert color="orange" mt="md" title="Формат не поддерживается">Для серверной записи нужен браузер с поддержкой WebM.</Alert>}
    {(submitError || recorder.error) && <Alert color="red" mt="md" title="Не удалось продолжить">{submitError || recorder.error}</Alert>}
    {!savedId && recorder.blob && !active && <Paper withBorder radius="md" p="md" mt="md"><Group justify="space-between" align="center"><Text size="sm">Звук записан. Его можно сохранить в браузере.</Text><Button variant="light" loading={saving} onClick={() => void saveLocally()}>Сохранить локально</Button></Group></Paper>}

    <Tabs value={tab} onChange={setTab} className={styles.tabs} keepMounted={false}>
      <Tabs.List justify="center"><Tabs.Tab value="conversation">Разговор</Tabs.Tab><Tabs.Tab value="insights">Итоги</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="conversation" className={styles.pane}>
        {transcription.status === 'install-needed' && active && <Alert color="blue" title="Для живой расшифровки нужен языковой пакет" mb="md">{transcription.message}<Button variant="light" size="xs" mt="sm" onClick={() => void transcription.installLanguage()}>Установить на устройство</Button></Alert>}
        {transcription.status === 'unavailable' && active && <Alert color="gray" mb="md">{transcription.message}</Alert>}
        {transcription.status === 'error' && active && <Alert color="orange" mb="md">{transcription.message}</Alert>}
        {segments.length === 0 && !transcription.interim ? <div className={styles.empty}><Mic size={30} /><Title order={2}>{active ? 'Слушаем разговор' : 'Пока нет реплик'}</Title><Text c="dimmed">{active ? 'Реплики появятся после коротких пауз в речи, если доступно локальное распознавание.' : savedId ? 'Запись сохранена без автоматической расшифровки.' : 'Включите микрофон, чтобы начать разговор.'}</Text></div> :
          <Stack gap="xs" aria-label="Стенограмма разговора">{segments.map((segment) => <article key={segment.id} className={styles.utterance}><Group gap="sm"><Text fw={600}>{segment.speaker}</Text><Text size="sm" c="dimmed">{duration(segment.offsetMs ?? 0)}</Text></Group><Text className={styles.utteranceText}>{segment.text}</Text></article>)}{transcription.interim && <article className={styles.utterance}><Text fw={600}>{speaker}</Text><Text className={styles.interimText} aria-live="polite">{transcription.interim}</Text></article>}</Stack>}
      </Tabs.Panel>
      <Tabs.Panel value="insights" className={styles.pane}><div className={styles.empty}><Target size={30} /><Title order={2}>{savedId ? 'Разговор сохранён' : 'Итогов пока нет'}</Title><Text c="dimmed">{savedId ? 'Откройте встречу, чтобы прослушать запись и заполнить сводку или поручения.' : 'После завершения запись появится в рабочем пространстве. Итоги можно будет заполнить в карточке встречи.'}</Text>{savedId && <Button component={Link} to={'/meetings/' + savedId} variant="light">Открыть встречу</Button>}{savedId && previewUrl && <audio controls preload="metadata" src={previewUrl} className={styles.audio}>Ваш браузер не поддерживает воспроизведение аудио.</audio>}</div></Tabs.Panel>
    </Tabs>
    <Text size="xs" c="dimmed" mt="md">Звук распознаётся на этом устройстве только при поддержке локальной обработки браузером. Облачное распознавание в этом режиме не включается.</Text>
  </div>;
}
