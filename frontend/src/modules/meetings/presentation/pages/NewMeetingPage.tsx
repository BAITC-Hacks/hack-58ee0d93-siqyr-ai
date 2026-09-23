import { ActionIcon, Alert, Button, Checkbox, FileInput, SegmentedControl, Select, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { ArrowLeft, CircleAlert, FileAudio2, Mic2, Pause, Play, Square, Trash2, UploadCloud } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNewMeetingModel } from '../models/useNewMeetingModel';
import styles from './NewMeetingPage.module.css';

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function NewMeetingPage() {
  const { recorder, streaming, formats, beginRecording, finishRecording, mode, file, fileError, consent, setConsent, submitError, setSubmitError, saving, previewUrl, form, onFileChange, changeMode, onSave, activeRecording, sourceForPreview, showConsent, participantsError, onParticipantsBlur } = useNewMeetingModel();
  const uploading = mode === 'upload' && streaming;

  return (
    <div className={styles.page}>
      <Link className={styles.back} to="/meetings"><ArrowLeft size={16} /> Встречи</Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>НОВАЯ ВСТРЕЧА</p>
          <h1>Добавить встречу</h1>
          <p>Укажите контекст и добавьте источник. {streaming && mode !== 'draft' ? 'Звук передаётся на локальный сервер для обработки, копия сохраняется в этом браузере.' : 'Карточка встречи сохраняется в этом браузере.'}</p>
        </div>
      </div>

      <form onSubmit={form.onSubmit(onSave)} className={styles.form}>
        <section className={styles.section} aria-labelledby="meeting-context">
          <div className={styles.sectionHeader}><span className={styles.index}>01</span><div><h2 id="meeting-context">Контекст встречи</h2><p>Так встреча будет называться в реестре и протоколе.</p></div></div>
          <div className={styles.fields}>
            <TextInput label="Тема встречи" placeholder="Например, итоги производственного совещания" required maxLength={180} {...form.getInputProps('title')} />
            <div className={styles.fieldRow}>
              <TextInput label="Организация" placeholder="Название организации" required maxLength={160} {...form.getInputProps('organization')} />
              <DatePickerInput label="Дата встречи" description="Если известна" placeholder="Выберите дату" locale="ru" valueFormat="DD.MM.YYYY" clearable value={form.values.date || null} onChange={(value) => form.setFieldValue('date', value || '')} />
            </div>
            <Select label="Язык встречи" data={[{ value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }, { value: 'mixed', label: 'Русский и қазақша' }]} allowDeselect={false} {...form.getInputProps('language')} />
            <Textarea label="Участники" autosize minRows={3} maxRows={10} placeholder={'Алия Сарсенова — главный инженер\nБекзат Омаров'}
              description={mode === 'record' && streaming ? 'По одному на строке: Имя — роль. Во время записи список можно дополнять: он уйдёт на сервер, когда вы выйдете из поля.' : 'По одному на строке: Имя — роль. Помогает связать голоса в записи с людьми.'}
              disabled={recorder.status === 'finishing'} {...form.getInputProps('participants')} onBlur={onParticipantsBlur} error={participantsError || undefined} />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="meeting-source">
          <div className={styles.sectionHeader}><span className={styles.index}>02</span><div><h2 id="meeting-source">Источник встречи</h2><p>Выберите один способ. {streaming ? 'При загрузке файла или записи звук передаётся на локальный сервер. Копия сохраняется в этом браузере.' : 'Файл или запись сохраняются в браузере на этом устройстве.'}</p></div></div>
          <div className={styles.sourceBody}>
            <SegmentedControl className={styles.modeSwitch} fullWidth value={mode} onChange={changeMode} disabled={activeRecording || recorder.status === 'requesting' || recorder.status === 'finishing'} data={[{ label: 'Загрузить файл', value: 'upload' }, { label: 'Записать звук', value: 'record' }, { label: 'Без записи', value: 'draft' }]} />
            {mode === 'upload' && <div className={styles.sourcePanel}>
              <FileInput label="Аудио или видео" placeholder="Выбрать файл" description={`MP3, M4A, MP4, WAV, WebM, OGG, AAC, MOV${formats ? ' и др.' : ''} · до ${formats ? Math.round(formats.maxBytes / 1024 / 1024) : 100} МБ`} leftSection={<UploadCloud size={18} />} accept={formats?.accept ?? 'audio/*,video/*,.m4a,.webm,.ogg,.opus,.aac,.mov'} value={file} onChange={onFileChange} clearable />
              {file && <div className={styles.sourceFile}><FileAudio2 size={18} /><div><strong>{file.name}</strong><span>{formatSize(file.size)}</span></div><ActionIcon type="button" variant="subtle" color="gray" onClick={() => onFileChange(null)} aria-label="Удалить выбранный файл"><Trash2 size={16} /></ActionIcon></div>}
              {fileError && <p className={styles.error} role="alert">{fileError}</p>}
            </div>}
            {mode === 'record' && <div className={styles.sourcePanel}>
              <div className={styles.recorderLine}>
                <div className={styles.recordStatus}><span className={activeRecording ? styles.liveDot : styles.quietDot} /> <strong>{recorder.status === 'requesting' ? 'Ожидание микрофона…' : recorder.status === 'finishing' ? 'Завершение записи…' : recorder.status === 'recording' ? 'Идёт запись' : recorder.status === 'paused' ? 'На паузе' : recorder.status === 'complete' ? 'Запись готова' : 'Микрофон готов к записи'}</strong><span className={styles.timer}>{formatDuration(recorder.elapsedMs)}</span></div>
                <div className={styles.recordActions}>
                  {(recorder.status === 'idle' || recorder.status === 'complete') && <Button type="button" leftSection={<Mic2 size={16} />} variant="light" loading={saving} onClick={() => void beginRecording()}>Начать запись</Button>}
                  {recorder.status === 'recording' && <Button type="button" variant="default" leftSection={<Pause size={15} />} onClick={recorder.pause}>Пауза</Button>}
                  {recorder.status === 'paused' && <Button type="button" variant="default" leftSection={<Play size={15} />} onClick={recorder.resume}>Продолжить</Button>}
                  {activeRecording && <Button type="button" variant="default" leftSection={<Square size={14} />} loading={saving} onClick={() => void finishRecording()}>Завершить</Button>}
                  {(activeRecording || recorder.status === 'complete') && <Button type="button" variant="subtle" color="gray" onClick={recorder.discard}>Удалить</Button>}
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
          <p>{activeRecording ? 'Чтобы изменить подтверждение, сначала завершите или удалите запись.' : 'Подтвердите это до включения микрофона или сохранения файла встречи.'}</p>
        </section>}

        <div className={styles.footer}>
          <div className={styles.saveText}><CircleAlert size={16} /><span>{mode === 'draft' ? 'Черновик будет доступен для ручного заполнения.' : mode === 'record' && streaming ? 'Звук уходит на локальный сервер во время записи. После «Завершить» начнётся распознавание, этапы появятся на странице встречи.' : uploading ? 'Файл уйдёт на локальный сервер: он проверит формат и начнёт распознавание, этапы появятся на странице встречи.' : 'Распознавание и ИИ-обработка пока не подключены. Источник сохранится со статусом ожидания.'}</span></div>
          {submitError && <Alert color="red" title="Проверьте данные" className={styles.submitError}>{submitError}</Alert>}
          <div className={styles.footerActions}><Button component={Link} to="/meetings" variant="default">Отмена</Button>{!(mode === 'record' && streaming) && <Button type="submit" loading={saving} disabled={activeRecording || recorder.status === 'requesting' || recorder.status === 'finishing'}>{mode === 'draft' ? 'Создать черновик' : uploading ? 'Отправить на распознавание' : 'Сохранить встречу'}</Button>}</div>
        </div>
      </form>
    </div>
  );
}
