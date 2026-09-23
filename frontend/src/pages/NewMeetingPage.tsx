import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Select, SegmentedControl, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ArrowLeft, CircleAlert, FileAudio2, Mic2, Pause, Play, Square, Trash2, UploadCloud } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import { useRecorder } from '../hooks/useRecorder';
import { createRecording, finishRecording, sendRecordingChunk } from '../lib/recordingApi';
import type { Meeting } from '../domain/types';
import styles from './NewMeetingPage.module.css';

type IntakeMode = 'upload' | 'record' | 'draft';
type Language = Meeting['language'];
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const supportedExtension = /\.(mp3|m4a|mp4|wav|webm|ogg|opus|aac|mov)$/i;

function isSupportedMedia(file: File) {
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || supportedExtension.test(file.name);
}

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function NewMeetingPage() {
  const navigate = useNavigate();
  const { settings, loading, createMeeting } = useWorkspace();
  const recorder = useRecorder();
  const [mode, setMode] = useState<IntakeMode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef(false);
  const recordingIdRef = useRef<string | null>(null);
  const form = useForm({
    initialValues: {
      title: '',
      organization: settings.organization || '',
      date: '',
      language: settings.defaultLanguage as Language,
    },
    validate: {
      title: (value) => value.trim() ? null : 'Укажите тему встречи.',
      organization: (value) => value.trim() ? null : 'Укажите организацию.',
    },
  });

  useEffect(() => {
    if (!loading && !initializedRef.current) {
      initializedRef.current = true;
      form.setFieldValue('organization', settings.organization || '');
      form.setFieldValue('language', settings.defaultLanguage);
    }
  }, [loading, settings.organization, settings.defaultLanguage]);

  useEffect(() => {
    const source = mode === 'upload' ? file : null;
    if (!source) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(source);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mode, file]);

  useEffect(() => {
    if (recorder.status !== 'recording' && recorder.status !== 'paused' && recorder.status !== 'requesting' && recorder.status !== 'finishing') return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [recorder.status]);

  function onFileChange(selected: File | null) {
    setFileError('');
    setSubmitError('');
    setFile(null);
    if (!selected) return;
    if (!isSupportedMedia(selected)) {
      setFileError('Выберите аудио- или видеофайл: MP3, M4A, MP4, WAV, WebM, OGG, AAC или MOV.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (selected.size === 0) {
      setFileError('Файл пуст. Выберите другую запись.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setFileError('Файл превышает 100 МБ. Выберите запись меньшего размера.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setFile(selected);
  }

  function changeMode(value: string) {
    if (recorder.status === 'recording' || recorder.status === 'paused' || recorder.status === 'requesting' || recorder.status === 'finishing') return;
    recorder.discard();
    setFile(null);
    setFileError('');
    setSubmitError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setMode(value as IntakeMode);
  }

  async function beginRecording() {
    if (!consent) { setSubmitError('Сначала подтвердите, что участники уведомлены о записи.'); return; }
    if (form.validate().hasErrors) return;
    setSubmitError('');
    setSaving(true);
    try {
      const runId = await createRecording({
        title: form.values.title.trim(), date: form.values.date || null, language: form.values.language,
      });
      recordingIdRef.current = runId;
      const started = await recorder.start((chunk, offset) => sendRecordingChunk(runId, chunk, offset));
      if (!started) setSubmitError('Сессия создана, но микрофон не запустился. Попробуйте новую запись.');
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Не удалось создать сессию записи.');
    } finally {
      setSaving(false);
    }
  }

  async function endRecording() {
    const runId = recordingIdRef.current;
    if (!runId) return;
    setSaving(true);
    setSubmitError('');
    try {
      await recorder.stop();
      await finishRecording(runId);
      const id = await createMeeting({
        title: form.values.title.trim(), organization: form.values.organization.trim(),
        date: form.values.date || null, language: form.values.language,
        kind: 'local', status: 'pending', summary: '', participants: [], transcript: [],
        backendRunId: runId,
        source: { name: 'Запись в системе.webm', size: 0, type: 'audio/webm' },
      });
      recordingIdRef.current = null;
      navigate(`/meetings/${id}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Не удалось завершить запись.');
    } finally {
      setSaving(false);
    }
  }

  async function onSave(values: typeof form.values) {
    setSubmitError('');
    const source = mode === 'upload' ? file : null;
    if (mode === 'upload' && !file) {
      setFileError('Выберите файл или переключитесь на черновик без записи.');
      return;
    }
    if (mode === 'record') {
      setSubmitError('В режиме записи нажмите «Начать запись», затем «Завершить».');
      return;
    }
    if (source && !consent) {
      setSubmitError('Подтвердите, что участники уведомлены о записи.');
      return;
    }
    setSaving(true);
    try {
      const sourceName = file?.name || '';
      const id = await createMeeting({
        title: values.title.trim(),
        organization: values.organization.trim(),
        date: values.date || null,
        language: values.language,
        kind: 'local',
        status: source ? 'pending' : 'draft',
        summary: '',
        participants: [],
        transcript: [],
        ...(source ? { source: { name: sourceName, size: source.size, type: source.type, blob: source } } : {}),
      });
      navigate(`/meetings/${id}`);
    } catch {
      setSubmitError('Не удалось сохранить встречу на этом устройстве. Проверьте доступное место и попробуйте снова.');
      setSaving(false);
    }
  }

  const activeRecording = recorder.status === 'recording' || recorder.status === 'paused';
  const sourceForPreview = mode === 'upload' ? file : null;
  const showConsent = mode !== 'draft';

  return (
    <div className={styles.page}>
      <Link className={styles.back} to="/meetings"><ArrowLeft size={16} /> Встречи</Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>НОВАЯ ВСТРЕЧА</p>
          <h1>Добавить встречу</h1>
          <p>Укажите контекст и добавьте источник. Запись в системе передаётся на локальный сервер.</p>
        </div>
      </div>

      <form onSubmit={form.onSubmit(onSave)} className={styles.form}>
        <section className={styles.section} aria-labelledby="meeting-context">
          <div className={styles.sectionHeader}><span className={styles.index}>01</span><div><h2 id="meeting-context">Контекст встречи</h2><p>Так встреча будет называться в реестре и протоколе.</p></div></div>
          <div className={styles.fields}>
            <TextInput label="Тема встречи" placeholder="Например, итоги производственного совещания" required maxLength={180} {...form.getInputProps('title')} />
            <div className={styles.fieldRow}>
              <TextInput label="Организация" placeholder="Название организации" required maxLength={160} {...form.getInputProps('organization')} />
              <TextInput label="Дата встречи" type="date" description="Если известна" {...form.getInputProps('date')} />
            </div>
            <Select label="Язык встречи" data={[{ value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }, { value: 'mixed', label: 'Русский и қазақша' }]} allowDeselect={false} {...form.getInputProps('language')} />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="meeting-source">
          <div className={styles.sectionHeader}><span className={styles.index}>02</span><div><h2 id="meeting-source">Источник встречи</h2><p>Выберите один способ. Запись отправляется на локальный сервер.</p></div></div>
          <div className={styles.sourceBody}>
            <SegmentedControl className={styles.modeSwitch} fullWidth value={mode} onChange={changeMode} disabled={activeRecording || recorder.status === 'requesting' || recorder.status === 'finishing'} data={[{ label: 'Загрузить файл', value: 'upload' }, { label: 'Записать звук', value: 'record' }, { label: 'Без записи', value: 'draft' }]} />
            {mode === 'upload' && <div className={styles.sourcePanel}>
              <label className={styles.filePicker}><UploadCloud size={22} strokeWidth={1.7} /><span><strong>Выбрать аудио или видео</strong><small>MP3, M4A, MP4, WAV, WebM, OGG, AAC, MOV · до 100 МБ</small></span><input ref={fileInputRef} className={styles.visuallyHidden} type="file" accept="audio/*,video/*,.m4a,.webm,.ogg,.opus,.aac,.mov" onChange={(event) => onFileChange(event.target.files?.[0] || null)} /></label>
              {file && <div className={styles.sourceFile}><FileAudio2 size={18} /><div><strong>{file.name}</strong><span>{formatSize(file.size)}</span></div><button type="button" onClick={() => { onFileChange(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label="Удалить выбранный файл"><Trash2 size={16} /></button></div>}
              {fileError && <p className={styles.error} role="alert">{fileError}</p>}
            </div>}
            {mode === 'record' && <div className={styles.sourcePanel}>
              <div className={styles.recorderLine}>
                <div className={styles.recordStatus}><span className={activeRecording ? styles.liveDot : styles.quietDot} /> <strong>{recorder.status === 'requesting' ? 'Ожидание микрофона…' : recorder.status === 'finishing' ? 'Завершение записи…' : recorder.status === 'recording' ? 'Идёт запись' : recorder.status === 'paused' ? 'На паузе' : recorder.status === 'complete' ? 'Запись готова' : 'Микрофон готов к записи'}</strong><span className={styles.timer}>{formatDuration(recorder.elapsedMs)}</span></div>
                <div className={styles.recordActions}>
                  {(recorder.status === 'idle' || recorder.status === 'complete') && <Button type="button" leftSection={<Mic2 size={16} />} variant="light" loading={saving} onClick={() => void beginRecording()}>Начать запись</Button>}
                  {recorder.status === 'recording' && <Button type="button" variant="default" leftSection={<Pause size={15} />} onClick={recorder.pause}>Пауза</Button>}
                  {recorder.status === 'paused' && <Button type="button" variant="default" leftSection={<Play size={15} />} onClick={recorder.resume}>Продолжить</Button>}
                  {activeRecording && <Button type="button" variant="default" leftSection={<Square size={14} />} loading={saving} onClick={() => void endRecording()}>Завершить</Button>}
                </div>
              </div>
              {recorder.error && <p className={styles.error} role="alert">{recorder.error}</p>}
              <p className={styles.helper}>Записывается только звук с микрофона. Подключение к Zoom, Teams или Meet пока недоступно.</p>
            </div>}
            {mode === 'draft' && <div className={styles.sourcePanel}><p className={styles.draftNote}>Создайте карточку встречи без записи. Позже можно будет вручную заполнить протокол и поручения.</p></div>}
            {sourceForPreview && previewUrl && mode !== 'draft' && <div className={styles.preview}><span>Предпрослушивание источника</span>{sourceForPreview.type.startsWith('video/') ? <video controls preload="metadata" src={previewUrl} /> : <audio controls preload="metadata" src={previewUrl} />}</div>}
          </div>
        </section>

        {showConsent && <section className={styles.consentSection}>
          <Checkbox checked={consent} disabled={activeRecording || recorder.status === 'requesting' || recorder.status === 'finishing'} onChange={(event) => { setConsent(event.currentTarget.checked); setSubmitError(''); }} label="Участники уведомлены о записи и согласны на её сохранение" />
          <p>{activeRecording ? 'Чтобы изменить подтверждение, сначала завершите запись.' : 'Подтвердите это до включения микрофона или сохранения файла встречи.'}</p>
        </section>}

        <div className={styles.footer}>
          <div className={styles.saveText}><CircleAlert size={16} /><span>{mode === 'draft' ? 'Черновик будет доступен для ручного заполнения.' : mode === 'record' ? 'После завершения запись будет обработана на локальном сервере. Этапы появятся на странице встречи.' : 'Распознавание и ИИ-обработка пока не подключены. Источник сохранится со статусом ожидания.'}</span></div>
          {submitError && <Alert color="red" title="Проверьте данные" className={styles.submitError}>{submitError}</Alert>}
          <div className={styles.footerActions}><Button component={Link} to="/meetings" variant="default">Отмена</Button>{mode !== 'record' && <Button type="submit" loading={saving} disabled={activeRecording || recorder.status === 'requesting' || recorder.status === 'finishing'}>{mode === 'draft' ? 'Создать черновик' : 'Сохранить встречу'}</Button>}</div>
        </div>
      </form>
    </div>
  );
}
