import { ActionIcon, Alert, Badge, Box, Button, Center, Checkbox, Divider, Grid, Group, Paper, Select, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { ArrowLeft, Camera, CameraOff, Mic2, Pause, Play, Square, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNewMeetingModel } from '../models/useNewMeetingModel';

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function CallPage() {
  const { recorder, streaming, beginRecording, finishRecording, consent, setConsent, submitError, setSubmitError, saving, form } = useNewMeetingModel('record');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const active = recorder.status === 'recording' || recorder.status === 'paused';
  const locked = active || recorder.status === 'requesting' || recorder.status === 'finishing' || saving;
  const webmSupported = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' &&
    (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') || MediaRecorder.isTypeSupported('audio/webm'));

  useEffect(() => { if (video.current) video.current.srcObject = cameraStream; }, [cameraStream]);
  useEffect(() => () => cameraStream?.getTracks().forEach((track) => track.stop()), [cameraStream]);

  async function toggleCamera() {
    if (cameraStream) { cameraStream.getTracks().forEach((track) => track.stop()); setCameraStream(null); return; }
    setCameraError('');
    try { setCameraStream(await navigator.mediaDevices.getUserMedia({ video: true, audio: false })); }
    catch { setCameraError('Не удалось включить камеру. Разрешите доступ в браузере и попробуйте снова.'); }
  }

  return <Stack gap="md">
    <Group justify="space-between"><Button component={Link} to="/meetings/live" variant="subtle" color="gray" leftSection={<ArrowLeft size={16} />} pl={0}>Разговоры</Button><Badge variant="light" color="gray">Локальный разговор</Badge></Group>
    <Group justify="space-between" align="start"><div><Title order={1}>{form.values.title.trim() || 'Новый разговор'}</Title><Text c="dimmed" size="sm" mt={4}>Запись с этого устройства · {duration(recorder.elapsedMs)}</Text></div><Badge size="lg" variant="light" color={active ? 'red' : 'gray'} circle>{recorder.status === 'recording' ? 'Идёт запись' : recorder.status === 'paused' ? 'Пауза' : 'Не начато'}</Badge></Group>

    <Grid gap="md" align="stretch">
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Paper radius="lg" bg="#202b3f" style={{ overflow: 'hidden' }} h="100%">
          <Center bg="#34425c" h={{ base: 350, md: 490 }} pos="relative" style={{ overflow: 'hidden' }}>
            {cameraStream ? <video ref={video} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} /> : <Stack align="center" gap="md"><ThemeIcon size={102} radius="xl" bg="#647594" color="white"><Users size={48} strokeWidth={1.3} /></ThemeIcon><Text c="white" size="sm">Камера выключена</Text></Stack>}
            <Badge pos="absolute" bottom={16} left={16} color="dark" variant="filled">Вы · это устройство</Badge>
          </Center>
          <Group justify="space-between" gap="sm" p="md" wrap="wrap">
            <Group gap="sm"><ActionIcon size="lg" radius="xl" variant="light" color="gray" onClick={() => void toggleCamera()} aria-label={cameraStream ? 'Выключить камеру' : 'Включить камеру'}>{cameraStream ? <Camera size={19} /> : <CameraOff size={19} />}</ActionIcon><Text c="white" size="sm"><Mic2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />{active ? recorder.status === 'paused' ? 'Микрофон на паузе' : 'Микрофон записывает' : 'Микрофон не записывает'}</Text></Group>
            <Group gap="xs">
              {!active && recorder.status !== 'requesting' && recorder.status !== 'finishing' && <Button leftSection={<Mic2 size={16} />} disabled={!streaming || !webmSupported} loading={saving} onClick={() => void beginRecording()}>Начать разговор</Button>}
              {recorder.status === 'recording' && <Button variant="default" leftSection={<Pause size={16} />} onClick={recorder.pause}>Пауза</Button>}
              {recorder.status === 'paused' && <Button variant="default" leftSection={<Play size={16} />} onClick={recorder.resume}>Продолжить</Button>}
              {active && <Button color="red" leftSection={<Square size={15} />} loading={saving} onClick={() => void finishRecording()}>Завершить</Button>}
            </Group>
          </Group>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Paper withBorder radius="lg" p="lg" h="100%"><Stack gap="md"><Group justify="space-between"><Title order={3}>Разговор</Title><Text c="dimmed" size="sm" ff="monospace">{duration(recorder.elapsedMs)}</Text></Group><Divider />
          <TextInput label="Тема" placeholder="Тема встречи" required maxLength={180} disabled={locked} {...form.getInputProps('title')} />
          <TextInput label="Организация" placeholder="Название организации" required maxLength={160} disabled={locked} {...form.getInputProps('organization')} />
          <DatePickerInput label="Дата" placeholder="Выберите дату" locale="ru" valueFormat="DD.MM.YYYY" clearable disabled={locked} value={form.values.date || null} onChange={(value) => form.setFieldValue('date', value || '')} />
          <Select label="Язык" data={[{ value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }, { value: 'mixed', label: 'Русский и қазақша' }]} allowDeselect={false} disabled={locked} {...form.getInputProps('language')} />
          <Checkbox checked={consent} disabled={locked} onChange={(event) => { setConsent(event.currentTarget.checked); setSubmitError(''); }} label="Участники уведомлены о записи и транскрибации ИИ" />
          <Box bg="var(--app-bg)" p="md" style={{ borderRadius: 8 }}><Text fw={650} size="sm">Расшифровка</Text><Text c="dimmed" size="sm" mt={6}>Текст появится в карточке встречи после завершения записи и обработки звука.</Text></Box>
          {!streaming && <Alert color="orange" title="Локальный сервер недоступен">Настройте подключение к серверу и обновите страницу.</Alert>}
          {!webmSupported && <Alert color="orange" title="Запись недоступна в этом браузере">Откройте страницу в браузере с поддержкой записи WebM.</Alert>}
          {(submitError || recorder.error || cameraError) && <Alert color="red" title="Не удалось продолжить">{submitError || recorder.error || cameraError}</Alert>}
        </Stack></Paper>
      </Grid.Col>
    </Grid>
    <Text c="dimmed" size="xs">Камера показывает только локальный предпросмотр. Подключение других участников пока недоступно. Во время записи звук передаётся на локальный сервер.</Text>
  </Stack>;
}
