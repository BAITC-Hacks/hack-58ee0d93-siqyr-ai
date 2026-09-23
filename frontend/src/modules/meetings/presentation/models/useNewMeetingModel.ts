import type { UploadFormats } from '@/modules/recording/application/RecordingGateway';
import { useRecorder } from '@/modules/recording/presentation/useRecorder';
import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useObjectUrl } from '@/shared/presentation/useObjectUrl';
import { useForm } from '@mantine/form';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mediaSourceError } from '../../domain/mediaSource';
import { useMeetingCommands } from '../useMeetingCommands';
type IntakeMode = 'upload' | 'record' | 'draft';

export function useNewMeetingModel() {
  const navigate = useNavigate();
  const { settings, loading } = useWorkspace();
  const { createMeeting } = useMeetingCommands();
  const recorder = useRecorder();
  const services = useServices();
  const streaming = services.recordings !== null;
  const runIdRef = useRef<string | null>(null);
  const [mode, setMode] = useState<IntakeMode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [formats, setFormats] = useState<UploadFormats | null>(null);
  const [fileError, setFileError] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const previewUrl = useObjectUrl(mode === 'upload' ? file : mode === 'record' ? recorder.blob : null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef(false);
  const form = useForm({
    initialValues: {
      title: '',
      organization: settings.organization || '',
      date: '',
      language: settings.defaultLanguage,
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
    const gateway = services.recordings;
    if (!gateway) return;
    let active = true;
    // Without the list the browser defaults stay; the server still checks the file on upload.
    gateway.formats().then((value) => { if (active) setFormats(value); }).catch(() => {});
    return () => { active = false; };
  }, [services.recordings]);

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
    const issue = mediaSourceError(selected, formats ?? undefined);
    if (issue) {
      setFileError(issue);
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
    if (value === 'upload' || value === 'record' || value === 'draft') setMode(value);
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
      const runId = await gateway.create({ title: form.values.title.trim(), date: form.values.date || null, language: form.values.language });
      runIdRef.current = runId;
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
      await gateway.finish(runId);
      runIdRef.current = null;
      const blob = services.recorder.getSnapshot().blob;
      const values = form.values;
      const id = await createMeeting({
        title: values.title.trim(), organization: values.organization.trim(), date: values.date || null, language: values.language,
        backendRunId: runId,
        ...(blob ? { source: { name: `Запись ${new Date().toLocaleString('ru-RU')}.webm`, size: blob.size, type: blob.type, blob } } : {}),
      });
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
    let backendRunId: string | undefined;
    const gateway = services.recordings;
    if (mode === 'upload' && file && gateway) {
      // The server checks the format and queues recognition; the meeting is saved only after it accepted the file.
      try {
        backendRunId = await gateway.upload({ title: values.title.trim(), date: values.date || null, language: values.language }, file);
      } catch (cause) {
        setSubmitError(cause instanceof Error ? cause.message : 'Не удалось отправить файл на сервер.');
        setSaving(false);
        return;
      }
    }
    try {
      const sourceName = mode === 'record'
        ? `Запись ${new Date().toLocaleString('ru-RU')}.${recorder.blob?.type.includes('mp4') ? 'm4a' : 'webm'}`
        : file?.name || '';
      const id = await createMeeting({
        title: values.title.trim(),
        organization: values.organization.trim(),
        date: values.date || null,
        language: values.language,
        ...(backendRunId ? { backendRunId } : {}),
        ...(source ? { source: { name: sourceName, size: source.size, type: source.type, blob: source } } : {}),
      });
      navigate(`/meetings/${id}`);
    } catch {
      setSubmitError('Не удалось сохранить встречу на этом устройстве. Проверьте доступное место и попробуйте снова.');
      setSaving(false);
    }
  }

  const activeRecording = recorder.status === 'recording' || recorder.status === 'paused';
  const sourceForPreview = mode === 'upload' ? file : recorder.blob;
  const showConsent = mode !== 'draft';

  return { recorder, streaming, formats, beginRecording, finishRecording, mode, file, fileError, consent, setConsent, submitError, setSubmitError, saving, previewUrl, fileInputRef, form, onFileChange, changeMode, onSave, activeRecording, sourceForPreview, showConsent };
}
