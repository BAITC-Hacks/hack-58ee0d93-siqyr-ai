import type { Settings } from '@/modules/settings/domain/settings.types';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useForm } from '@mantine/form';
import { useEffect, useRef, useState } from 'react';
import { useSettingsCommands } from '../useSettingsCommands';

export function useSettingsModel() {
  const { settings, loading } = useWorkspace();
  const { updateSettings, resetDemo } = useSettingsCommands();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const initializedRef = useRef(false);
  const form = useForm<Settings>({
    initialValues: settings,
    validate: {
      displayName: (value) => value.trim().length > 80 ? 'Не более 80 символов.' : null,
      organization: (value) => value.trim().length > 160 ? 'Не более 160 символов.' : null,
      reminderDays: (value) => Number.isInteger(value) && value >= 0 && value <= 30 ? null : 'Укажите целое число от 0 до 30.',
    },
  });

  useEffect(() => {
    if (!loading && !initializedRef.current) {
      initializedRef.current = true;
      form.setValues(settings);
      form.resetDirty(settings);
    }
  }, [loading, settings]);

  async function onSave(values: Settings) {
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      await updateSettings({
        displayName: values.displayName.trim(),
        organization: values.organization.trim(),
        defaultLanguage: values.defaultLanguage,
        reminderDays: values.reminderDays,
      });
      form.resetDirty(values);
      setSaved(true);
    } catch {
      setSaveError('Не удалось сохранить настройки на этом устройстве. Попробуйте снова.');
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    setResetting(true);
    setResetMessage('');
    try {
      await resetDemo();
      setResetOpen(false);
      setResetMessage('Два демонстрационных примера восстановлены.');
    } catch {
      setResetMessage('Не удалось восстановить примеры. Попробуйте снова.');
    } finally {
      setResetting(false);
    }
  }

  return { saving, saved, setSaved, saveError, resetOpen, setResetOpen, resetting, resetMessage, setResetMessage, form, onSave, onReset };
}
