import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, NumberInput, Select, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { Check, RotateCcw } from 'lucide-react';
import { useWorkspace } from '../hooks/useWorkspace';
import type { Settings } from '../domain/types';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const { settings, loading, updateSettings, resetDemo } = useWorkspace();
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

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <p className={styles.eyebrow}>РАБОЧЕЕ ПРОСТРАНСТВО</p>
        <h1>Настройки</h1>
        <p>Предпочтения для новых встреч и локальной работы с поручениями.</p>
      </div>

      <form onSubmit={form.onSubmit(onSave)}>
        <section className={styles.section} aria-labelledby="settings-profile">
          <div className={styles.sectionIntro}><h2 id="settings-profile">Профиль</h2><p>Эти данные видны только в этом браузере.</p></div>
          <div className={styles.sectionFields}>
            <TextInput label="Ваше имя" placeholder="Как к вам обращаться" maxLength={80} {...form.getInputProps('displayName')} onChange={(event) => { form.getInputProps('displayName').onChange(event); setSaved(false); }} />
            <TextInput label="Организация по умолчанию" placeholder="Название организации" maxLength={160} description="Автоматически подставляется при создании встречи." {...form.getInputProps('organization')} onChange={(event) => { form.getInputProps('organization').onChange(event); setSaved(false); }} />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="settings-workflow">
          <div className={styles.sectionIntro}><h2 id="settings-workflow">Встречи и поручения</h2><p>Начальные значения можно изменить для каждой встречи.</p></div>
          <div className={styles.sectionFields}>
            <Select label="Язык новых встреч" data={[{ value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }, { value: 'mixed', label: 'Русский и қазақша' }]} allowDeselect={false} {...form.getInputProps('defaultLanguage')} onChange={(value) => { form.setFieldValue('defaultLanguage', value as Settings['defaultLanguage']); setSaved(false); }} />
            <NumberInput label="Напоминать за сколько дней" min={0} max={30} step={1} allowDecimal={false} clampBehavior="strict" description="Только внутри приложения, если у поручения указана точная дата. 0 — в день срока. Уведомления по почте не отправляются." {...form.getInputProps('reminderDays')} onChange={(value) => { form.setFieldValue('reminderDays', typeof value === 'number' ? value : -1); setSaved(false); }} />
          </div>
        </section>

        <div className={styles.formFooter}>
          <div className={styles.feedback} aria-live="polite">{saved && <span className={styles.success}><Check size={15} /> Настройки сохранены</span>}{saveError && <span className={styles.error}>{saveError}</span>}</div>
          <Button type="submit" loading={saving}>Сохранить изменения</Button>
        </div>
      </form>

      <section className={styles.exampleSection} aria-labelledby="settings-examples">
        <div className={styles.sectionIntro}><h2 id="settings-examples">Демонстрационные примеры</h2><p>Можно вернуть исходные тексты и поручения двух примеров.</p></div>
        <div className={styles.exampleAction}><p>Восстановление сбросит правки в демонстрационных встречах. Ваши собственные встречи и настройки сохранятся.</p><Button variant="default" leftSection={<RotateCcw size={15} />} onClick={() => { setResetMessage(''); setResetOpen(true); }}>Восстановить примеры</Button>{resetMessage && <span className={styles.resetMessage} role="status">{resetMessage}</span>}</div>
      </section>

      <div className={styles.localNote}>Все записи, протоколы, поручения и настройки хранятся локально в браузере. Облачная синхронизация не подключена.</div>

      <Modal opened={resetOpen} onClose={() => { if (!resetting) setResetOpen(false); }} title="Восстановить примеры?" centered size="sm" closeOnClickOutside={!resetting} closeOnEscape={!resetting}>
        <p className={styles.modalText}>Изменения в двух демонстрационных протоколах и их поручениях будут сброшены. Ваши локальные встречи и настройки сохранятся.</p>
        {resetMessage && <Alert color="red" mb="md">{resetMessage}</Alert>}
        <div className={styles.modalActions}><Button variant="default" onClick={() => setResetOpen(false)} disabled={resetting}>Отмена</Button><Button color="red" loading={resetting} onClick={onReset}>Восстановить</Button></div>
      </Modal>
    </div>
  );
}
