import { isMeetingLanguage } from '@/modules/meetings/domain/meeting.types';
import { Alert, Button, Modal, NumberInput, Select, TextInput } from '@mantine/core';
import { Check, RotateCcw } from 'lucide-react';
import { useSettingsModel } from '../models/useSettingsModel';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const { saving, saved, setSaved, saveError, resetOpen, setResetOpen, resetting, resetMessage, setResetMessage, form, onSave, onReset } = useSettingsModel();

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
            <Select label="Язык новых встреч" data={[{ value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }, { value: 'mixed', label: 'Русский и қазақша' }]} allowDeselect={false} {...form.getInputProps('defaultLanguage')} onChange={(value) => { if (isMeetingLanguage(value)) form.setFieldValue('defaultLanguage', value); setSaved(false); }} />
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
