import { useRecorder } from '@/modules/recording/presentation/useRecorder';
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
  const [mode, setMode] = useState<IntakeMode>('upload');
  const [file, setFile] = useState<File | null>(null);
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
      navigate(`/meetings/${id}`);
    } catch {
      setSubmitError('Не удалось сохранить встречу на этом устройстве. Проверьте доступное место и попробуйте снова.');
      setSaving(false);
    }
  }

  const activeRecording = recorder.status === 'recording' || recorder.status === 'paused';
  const sourceForPreview = mode === 'upload' ? file : recorder.blob;
  const showConsent = mode !== 'draft';

  return { recorder, mode, file, fileError, consent, setConsent, submitError, setSubmitError, saving, previewUrl, fileInputRef, form, onFileChange, changeMode, onSave, activeRecording, sourceForPreview, showConsent };
}
