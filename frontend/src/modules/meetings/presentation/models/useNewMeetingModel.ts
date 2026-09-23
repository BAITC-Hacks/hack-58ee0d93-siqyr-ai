import { useRecorder } from '@/modules/recording/presentation/useRecorder';
import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useObjectUrl } from '@/shared/presentation/useObjectUrl';
import { useForm } from '@mantine/form';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mediaSourceError } from '../../domain/mediaSource';
import { parseParticipantLines } from '../../domain/participantLines';
import { useMeetingCommands } from '../useMeetingCommands';
type IntakeMode = 'upload' | 'record' | 'draft';

export function useNewMeetingModel(initialMode: IntakeMode = 'upload') {
  const navigate = useNavigate();
  const { settings, loading } = useWorkspace();
  const { createMeeting, saveParticipants } = useMeetingCommands();
  const recorder = useRecorder();
  const services = useServices();
  const streaming = services.recordings !== null;
  const runIdRef = useRef<string | null>(null);
  const sentParticipantsRef = useRef('');
  const [participantsError, setParticipantsError] = useState('');
  const [mode, setMode] = useState<IntakeMode>(initialMode);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const previewUrl = useObjectUrl(mode === 'upload' ? file : mode === 'record' ? recorder.blob : null);
  const initializedRef = useRef(false);
  const form = useForm({
    initialValues: {
      title: '',
      organization: settings.organization || '',
      date: '',
      language: settings.defaultLanguage,
      participants: '',
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
    const issue = mediaSourceError(selected);
    if (issue) {
      setFileError(issue);
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
    if (value === 'upload' || value === 'record' || value === 'draft') setMode(value);
  }

  // Sends the list only while the server run still records: after /finish the server has already read it.
  async function syncParticipants() {
    const gateway = services.recordings;
    const runId = runIdRef.current;
    const participants = parseParticipantLines(form.values.participants);
    const key = JSON.stringify(participants);
    if (!gateway || !runId || key === sentParticipantsRef.current) return;
    await gateway.updateParticipants(runId, participants);
    sentParticipantsRef.current = key;
  }

  function onParticipantsBlur() {
    syncParticipants().then(() => setParticipantsError(''), () => {
      setParticipantsError('Не удалось обновить список на сервере. Он будет отправлен ещё раз при завершении записи.');
    });
  }

  // The card already exists: a failed list save must not look like a failed meeting save, the list stays editable on the meeting page.
  async function saveLocalParticipants(id: string, text: string) {
    if (text.trim()) await saveParticipants(id, text).catch(() => {});
  }

  async function beginRecording() {
    if (!consent) { setSubmitError('Сначала подтвердите, что участники уведомлены о записи.'); return; }
    setSubmitError('');
    const gateway = services.recordings;
    if (!gateway) { void recorder.start(); return; }
    // The server run needs the meeting title before the first chunk arrives.
    if (form.validate().hasErrors) return;
    setSaving(true);
    try {
      const participants = parseParticipantLines(form.values.participants);
      const runId = await gateway.create({ title: form.values.title.trim(), date: form.values.date || null, language: form.values.language, participants });
      runIdRef.current = runId;
      sentParticipantsRef.current = JSON.stringify(participants);
      let offset = 0;
      await recorder.start(async (chunk) => { offset = await gateway.sendChunk(runId, chunk, offset); });
    } catch {
      setSubmitError('Не удалось начать запись на сервере. Проверьте, что бэкенд запущен.');
    } finally {
      setSaving(false);
    }
  }

  async function finishRecording() {
    recorder.stop();
    const gateway = services.recordings;
    const runId = runIdRef.current;
    if (!gateway || !runId) return;
    setSaving(true);
    setSubmitError('');
    try {
      await services.recorder.drain();
      // The recording matters more than the name hints: voices can still be mapped to people on review.
      await syncParticipants().catch(() => {});
      await gateway.finish(runId);
      runIdRef.current = null;
      const blob = services.recorder.getSnapshot().blob;
      const values = form.values;
      const id = await createMeeting({
        title: values.title.trim(), organization: values.organization.trim(), date: values.date || null, language: values.language,
        backendRunId: runId,
        ...(blob ? { source: { name: `Запись ${new Date().toLocaleString('ru-RU')}.webm`, size: blob.size, type: blob.type, blob } } : {}),
      });
      await saveLocalParticipants(id, values.participants);
      navigate(`/meetings/${id}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Не удалось завершить запись.');
      setSaving(false);
    }
  }

  async function onSave(values: typeof form.values) {
    setSubmitError('');
    const source = mode === 'upload' ? file : mode === 'record' ? recorder.blob : null;
    if (mode === 'upload' && !file) {
      setFileError('Выберите файл или переключитесь на черновик без записи.');
      return;
    }
    if (mode === 'record' && !recorder.blob) {
      setSubmitError('Сначала запишите и остановите звук или создайте черновик без записи.');
      return;
    }
    if (source && !consent) {
      setSubmitError('Подтвердите, что участники уведомлены о записи.');
      return;
    }
    setSaving(true);
    try {
      const sourceName = mode === 'record'
        ? `Запись ${new Date().toLocaleString('ru-RU')}.${recorder.blob?.type.includes('mp4') ? 'm4a' : 'webm'}`
        : file?.name || '';
      const id = await createMeeting({
        title: values.title.trim(),
        organization: values.organization.trim(),
        date: values.date || null,
        language: values.language,
        ...(source ? { source: { name: sourceName, size: source.size, type: source.type, blob: source } } : {}),
      });
      await saveLocalParticipants(id, values.participants);
      navigate(`/meetings/${id}`);
    } catch {
      setSubmitError('Не удалось сохранить встречу на этом устройстве. Проверьте доступное место и попробуйте снова.');
      setSaving(false);
    }
  }

  const activeRecording = recorder.status === 'recording' || recorder.status === 'paused';
  const sourceForPreview = mode === 'upload' ? file : recorder.blob;
  const showConsent = mode !== 'draft';

  return { recorder, streaming, beginRecording, finishRecording, mode, file, fileError, consent, setConsent, submitError, setSubmitError, saving, previewUrl, form, onFileChange, changeMode, onSave, activeRecording, sourceForPreview, showConsent, participantsError, onParticipantsBlur };
}
