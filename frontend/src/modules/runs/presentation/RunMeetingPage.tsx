import type { Meeting } from '@/modules/meetings/domain/meeting.types';
import pageStyles from '@/modules/meetings/presentation/pages/MeetingPage.module.css';
import { RecordingProgress } from '@/modules/recording/presentation/RecordingProgress';
import TaskEditor from '@/modules/tasks/presentation/components/TaskEditor';
import type { Task } from '@/modules/tasks/domain/task.types';
import { useTaskCommands } from '@/modules/tasks/presentation/useTaskCommands';
import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { formatDate } from '@/shared/lib/formatDate';
import { Alert, Button, Collapse, Group, Loader, Modal, Select, Stack, Text, Textarea } from '@mantine/core';
import { ArrowLeft, Check, ChevronRight, Download, FileAudio, FileText, ListChecks, Play, Save, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { runStatusLabels } from '../domain/mirror';
import { clock, segmentText, speakerName, voiceLabel } from '../domain/review';
import { processingStatuses, type Proposal } from '../domain/run.types';
import { AssignmentReview } from './AssignmentReview';
import { JiraPanel } from './JiraPanel';
import { SpeakerReview } from './SpeakerReview';
import styles from './RunMeetingPage.module.css';
import { runTabs, useRunMeetingModel } from './useRunMeetingModel';

const sourceModeLabels = { real: 'Реальная обработка', mock: 'Демо-режим: тестовые данные', replay: 'Повтор сохранённого запуска' } as const;
const taskStatusLabels = { todo: 'К выполнению', 'in-progress': 'В работе', done: 'Выполнено' } as const;

function paragraphs(text: string) {
  return text.split(/\n\s*\n/).filter(Boolean).map((part, index) => <p key={index}>{part}</p>);
}

function ProtocolPreview({ proposal, title, date, people, approved }: { proposal: Proposal; title: string; date: string | null; people: string[]; approved: boolean }) {
  const included = proposal.assignments.filter((item) => item.review_status !== 'excluded');
  return <>
    <div className={pageStyles.protocolTitle}><p>{approved ? 'Утверждённая редакция' : `Черновик · редакция ${proposal.revision}`}</p><h2>ПРОТОКОЛ</h2><h3>{title}</h3><div><span>{formatDate(date)}</span></div></div>
    <section className={pageStyles.protocolSection}><h4>Участники</h4>{people.length ? <p>{people.join(', ')}</p> : <p className={pageStyles.placeholder}>Не указаны</p>}</section>
    <section className={pageStyles.protocolSection}><h4>Краткое содержание</h4>{proposal.summary.trim() ? <div className={pageStyles.prose}>{paragraphs(proposal.summary)}</div> : <p className={pageStyles.placeholder}>Не заполнено</p>}</section>
    {proposal.decisions.length > 0 && <section className={pageStyles.protocolSection}><h4>Решения</h4><ol className={pageStyles.topicList}>{proposal.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ol></section>}
    <section className={pageStyles.protocolSection}><h4>Поручения</h4>{included.length ? <div className={pageStyles.protocolTableWrap}><table className={pageStyles.protocolTable}>
      <thead><tr><th>№</th><th>Поручение</th><th>Ответственный</th><th>Срок</th></tr></thead>
      <tbody>{included.map((item, index) => <tr key={index}><td>{String(index + 1).padStart(2, '0')}</td><td>{item.task}</td><td>{item.assignee || 'Не указан'}</td><td>{item.deadline ? formatDate(item.deadline) : item.deadline_text || 'Не указан'}</td></tr>)}</tbody>
    </table></div> : <p className={pageStyles.placeholder}>Поручений нет.</p>}</section>
  </>;
}

function RegisterRow({ task, index, onOpen }: { task: Task; index: number; onOpen: (task: Task) => void }) {
  const { updateTask } = useTaskCommands();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(status: string | null) {
    if (status !== 'todo' && status !== 'in-progress' && status !== 'done') return;
    setBusy(true);
    setError('');
    try { await updateTask(task.id, { status }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить статус.'); }
    finally { setBusy(false); }
  }
  return <div className={styles.registerRow}>
    <span className={pageStyles.taskNumber}>{String(index + 1).padStart(2, '0')}</span>
    <button type="button" className={styles.registerMain} onClick={() => onOpen(task)}>
      <strong>{task.title}</strong><small>{task.assignee || 'Ответственный не указан'} · {task.dueDate ? formatDate(task.dueDate) : task.deadlineText || 'Срок не указан'}</small>
      {error && <small className={styles.rowError}>{error}</small>}
    </button>
    <Select aria-label={`Статус: ${task.title}`} size="xs" w={150} data={Object.entries(taskStatusLabels).map(([value, label]) => ({ value, label }))} value={task.status} onChange={(value) => void change(value)} disabled={busy} allowDeselect={false} />
  </div>;
}

export default function RunMeetingPage({ meeting }: { meeting: Meeting }) {
  const { runs } = useServices();
  const { tasks } = useWorkspace();
  const model = useRunMeetingModel(meeting);
  const { detail, status, reviewing, proposal, tab } = model;
  const [traceOpen, setTraceOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const register = tasks.filter((task) => task.meetingId === meeting.id && task.serverId);

  if (!runs) return <Alert color="gray" title="Сервер не подключён">Задайте VITE_API_URL, чтобы открыть серверную обработку этой встречи.</Alert>;
  if (model.loading) return <div className={pageStyles.loading}><Loader size="sm" /><span>Загружаем встречу с сервера…</span></div>;
  if (model.loadError || !detail) return <div className={pageStyles.missing}><FileText size={27} /><h1>Не удалось открыть встречу</h1><p>{model.loadError}</p>
    <Group><Button variant="light" onClick={() => void model.retry()}>Повторить</Button><Button component={Link} to="/meetings" variant="default">К списку встреч</Button></Group></div>;

  const run = detail.run;
  const processing = status ? processingStatuses.has(status) : false;
  const done = status === 'done';
  const people = [...new Set([...detail.participants.map((person) => person.name), ...meeting.participants.map((person) => person.name)])];
  const peopleText = detail.participants.length ? detail.participants.map((person) => person.role ? `${person.name} — ${person.role}` : person.name) : meeting.participants.map((person) => person.name);
  const speakerOf = (index: number) => proposal ? speakerName(proposal, proposal.segments[index]?.speaker ?? null) : '';
  const approveBlocked = model.blocking.length > 0 || model.pendingSpeakers.length > 0;

  return <div className={pageStyles.page}>
    <div className={pageStyles.backline}><Link to="/meetings"><ArrowLeft size={15} /> Все встречи</Link><span><ChevronRight size={13} /> Встреча</span></div>
    <header className={pageStyles.header}>
      <div className={pageStyles.heading}>
        <div className={pageStyles.eyebrow}>СЕРВЕРНАЯ ОБРАБОТКА · {sourceModeLabels[proposal?.source_mode ?? run.sourceMode].toUpperCase()}{run.synthetic ? ' · СИНТЕТИКА' : ''}</div>
        <h1>{meeting.title}</h1>
        <div className={pageStyles.metadata}>
          <span>{formatDate(run.meetingDate ?? meeting.date)}{!run.meetingDateVerified && ' (дата не подтверждена: относительные сроки не пересчитаны)'}</span>
          <span className={pageStyles.metaDot}>·</span>
          <span className={`${styles.status} ${styles[`status_${run.status}`] ?? ''}`}>{runStatusLabels[run.status]}</span>
        </div>
      </div>
      <div className={pageStyles.headerActions}>
        {done && <><Button variant="default" leftSection={<Download size={16} />} loading={model.busy === 'docx'} onClick={() => void model.download('docx')}>DOCX</Button>
          <Button variant="default" leftSection={<Download size={16} />} loading={model.busy === 'pdf'} onClick={() => void model.download('pdf')}>PDF</Button></>}
      </div>
    </header>

    {processing || status === 'error' || status === 'rejected'
      ? <RecordingProgress runId={model.runId} className={pageStyles.alert} />
      : <div className={styles.traceToggle}><button type="button" onClick={() => setTraceOpen((open) => !open)} aria-expanded={traceOpen}><ListChecks size={14} /> {traceOpen ? 'Скрыть ход обработки' : 'Показать ход обработки'}</button>
        <Collapse expanded={traceOpen} keepMounted={false}><RecordingProgress runId={model.runId} className={pageStyles.alert} /></Collapse></div>}

    {status === 'rejected' && <Alert color="orange" className={pageStyles.alert} title="Протокол отклонён">Черновик не попал в реестр поручений. Загрузите запись заново, если нужен новый протокол.</Alert>}
    {status === 'error' && <Alert color="red" className={pageStyles.alert} title="Обработка не завершена">Причина указана в ходе обработки выше. Проверьте запись и загрузите её заново.</Alert>}
    {model.actionError && <Alert color="red" className={pageStyles.alert} withCloseButton onClose={() => model.setActionError('')}>
      <Stack gap="xs"><Text size="sm">{model.actionError}</Text>{model.stale && <Button size="xs" variant="light" w="fit-content" onClick={() => void model.reload()}>Загрузить актуальную редакцию</Button>}</Stack>
    </Alert>}
    {model.notice && <Alert color="teal" className={pageStyles.alert} withCloseButton onClose={() => model.setNotice('')}>{model.notice}</Alert>}

    {reviewing && proposal && <div className={styles.reviewBar} role="region" aria-label="Утверждение протокола">
      <div className={styles.reviewInfo}>
        <strong>Черновик готов к проверке · редакция {proposal.revision}{model.dirty ? ' · есть несохранённые правки' : ''}</strong>
        <span>Проверено {model.progress.decided} из {model.progress.total} поручений.{' '}
          {model.blocking.length > 0 && <>Нужно решение по №{model.blocking.join(', №')}. </>}
          {model.pendingSpeakers.length > 0 && <>Подтвердите голоса: {model.pendingSpeakers.map(voiceLabel).join(', ')}. </>}
          {!approveBlocked && 'Непроверенные поручения будут подтверждены при утверждении.'}</span>
      </div>
      <Group gap="xs" className={styles.reviewActions}>
        {model.dirty && <Button variant="subtle" color="gray" leftSection={<Undo2 size={15} />} onClick={model.discard} disabled={model.busy !== null}>Отменить правки</Button>}
        {model.dirty && <Button variant="default" leftSection={<Save size={15} />} loading={model.busy === 'save'} disabled={model.busy !== null && model.busy !== 'save'} onClick={() => void model.save()}>Сохранить</Button>}
        <Button variant="default" color="red" leftSection={<X size={15} />} disabled={model.busy !== null} onClick={() => setRejecting(true)}>Отклонить</Button>
        <Button leftSection={<Check size={15} />} loading={model.busy === 'approve'} disabled={approveBlocked || (model.busy !== null && model.busy !== 'approve')} onClick={() => void model.decide(true)}
          title={approveBlocked ? 'Сначала примите решение по отмеченным поручениям и голосам' : undefined}>Утвердить протокол</Button>
      </Group>
    </div>}

    {!proposal ? <div className={styles.waiting}><Loader size="sm" /><div><strong>{processing ? 'Идёт обработка записи' : 'Черновика нет'}</strong>
      <span>{processing ? 'Расшифровка, сводка и поручения появятся здесь после распознавания и анализа.' : 'Сервер не подготовил протокол для этой встречи.'}</span></div></div>
      : <div className={pageStyles.workspace}>
        <aside className={pageStyles.outline} aria-label="Разделы встречи"><div className={pageStyles.railTitle}>ДОКУМЕНТ</div><nav>{runTabs.map((item, index) => <button type="button" key={item.id} className={`${pageStyles.outlineItem} ${tab === item.id ? pageStyles.active : ''}`} onClick={() => model.selectTab(item.id)}>
          <span className={pageStyles.outlineNumber}>{String(index + 1).padStart(2, '0')}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</nav>
          <div className={pageStyles.outlineFoot}>{proposal.segments.length} реплик · {proposal.assignments.length} поручений</div></aside>
        <div className={pageStyles.mobileTabs} role="tablist" aria-label="Разделы встречи">{runTabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} className={tab === item.id ? pageStyles.mobileActive : ''} onClick={() => model.selectTab(item.id)}>{item.label}</button>)}</div>

        <article className={pageStyles.paper}>
          {tab === 'summary' && <>
            <div className={pageStyles.documentTop}><span>01 / СВОДКА ВСТРЕЧИ</span><span>{reviewing ? 'Черновик ИИ, редактируется' : done ? 'Утверждено' : runStatusLabels[run.status]}</span></div>
            <section className={pageStyles.section}><div className={pageStyles.sectionHeading}><div><span>01</span><h3>Краткое содержание</h3></div></div>
              {reviewing ? <Textarea autosize minRows={6} value={proposal.summary} onChange={(event) => model.review.summary(event.currentTarget.value)} aria-label="Краткое содержание" />
                : proposal.summary.trim() ? <div className={pageStyles.prose}>{paragraphs(proposal.summary)}</div> : <div className={pageStyles.emptyInline}>Сводка не подготовлена.</div>}
            </section>
            <section className={pageStyles.section}><div className={pageStyles.sectionHeading}><div><span>02</span><h3>Решения</h3></div></div>
              {reviewing ? <Textarea autosize minRows={3} description="По одному решению на строке" value={proposal.decisions.join('\n')} aria-label="Решения"
                onChange={(event) => model.review.decisions(event.currentTarget.value.split('\n'))}
                onBlur={() => { const cleaned = proposal.decisions.map((item) => item.trim()).filter(Boolean); if (cleaned.join('\n') !== proposal.decisions.join('\n')) model.review.decisions(cleaned); }} />
                : proposal.decisions.length ? <ol className={pageStyles.topicList}>{proposal.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ol> : <div className={pageStyles.emptyInline}>Решения не выделены.</div>}
            </section>
            <section className={pageStyles.section}><div className={pageStyles.sectionHeading}><div><span>03</span><h3>Участники</h3></div></div>
              {peopleText.length ? <ul className={styles.plainList}>{peopleText.map((person) => <li key={person}>{person}</li>)}</ul> : <div className={pageStyles.emptyInline}>Участники не указаны при загрузке.</div>}
            </section>
          </>}

          {tab === 'transcript' && <>
            <div className={pageStyles.documentTop}><span>02 / РАСШИФРОВКА</span><span>{proposal.segments.length} реплик · таймкоды по репликам</span></div>
            <SpeakerReview proposal={proposal} people={people} editable={reviewing} pending={model.pendingSpeakers} onConfirm={model.review.speaker} />
            <div className={styles.audio}>
              {model.audioUrl ? <audio ref={model.audioRef} controls src={model.audioUrl} className={pageStyles.player}>Ваш браузер не поддерживает воспроизведение аудио.</audio>
                : model.canLoadAudio ? <Button variant="light" size="sm" leftSection={<FileAudio size={15} />} loading={model.busy === 'audio'} onClick={() => void model.loadAudio()}>Загрузить запись для прослушивания</Button>
                  : <Text size="sm" c="dimmed">{detail.hasAudio ? '' : 'Исходной записи на сервере нет: это демо-образец или история.'}</Text>}
            </div>
            {proposal.segments.length ? <div className={pageStyles.segments}>{proposal.segments.map((segment, index) => <div key={index} id={`run-segment-${index}`} className={`${styles.segment} ${model.focusedSegment === index ? styles.segmentFocused : ''}`}>
              <button type="button" className={styles.time} onClick={() => model.seek(segment.start)} disabled={!model.audioUrl} title={model.audioUrl ? 'Прослушать с этого места' : 'Сначала загрузите запись'}><Play size={10} /> {clock(segment.start)}</button>
              <div><div className={styles.segmentSpeaker}>{speakerName(proposal, segment.speaker)}{segment.corrected_text && <em>исправлено</em>}</div><p>{segmentText(segment)}</p></div>
            </div>)}</div> : <div className={pageStyles.emptyInline}>Расшифровка пуста.</div>}
          </>}

          {tab === 'protocol' && <>
            <div className={pageStyles.documentTop}><span>03 / ПРОТОКОЛ</span><span>{done ? 'Файлы формирует сервер из утверждённой редакции' : 'Предпросмотр черновика'}</span></div>
            <ProtocolPreview proposal={proposal} title={meeting.title} date={run.meetingDate ?? meeting.date} people={peopleText} approved={done} />
            {done && <Group justify="center" mt="lg"><Button variant="default" leftSection={<Download size={16} />} loading={model.busy === 'docx'} onClick={() => void model.download('docx')}>Скачать DOCX</Button>
              <Button variant="default" leftSection={<Download size={16} />} loading={model.busy === 'pdf'} onClick={() => void model.download('pdf')}>Скачать PDF</Button></Group>}
          </>}

          {tab === 'tasks' && <>
            <div className={pageStyles.documentTop}><span>04 / ПОРУЧЕНИЯ</span><span>{done ? `${register.length} в реестре` : `${proposal.assignments.length} в черновике`}</span></div>
            {done ? <>
              <div className={pageStyles.tabHeading}><div><p className={pageStyles.kicker}>РЕЕСТР ИСПОЛНЕНИЯ</p><h2>Поручения</h2><p>Утверждённые поручения. Статус «Выполнено» сохраняется на сервере и останавливает напоминания.</p></div></div>
              {register.length ? <div className={pageStyles.taskList}>{register.map((task, index) => <RegisterRow key={task.id} task={task} index={index} onOpen={setEditingTask} />)}</div>
                : <div className={pageStyles.emptyInline}>{run.assignmentsCount ? 'Реестр обновляется с сервера…' : 'В утверждённом протоколе нет поручений.'}</div>}
              <JiraPanel runId={model.runId} assignments={proposal.assignments.filter((item) => item.review_status !== 'excluded').length} />
            </> : <>
              <div className={pageStyles.tabHeading}><div><p className={pageStyles.kicker}>{reviewing ? 'ПРОВЕРКА СЕКРЕТАРЁМ' : 'ЧЕРНОВИК'}</p><h2>Поручения</h2>
                <p>{reviewing ? 'Каждое поручение подтверждено цитатой из записи. Подтвердите, исправьте или исключите его; нажмите на время, чтобы открыть реплику.' : 'Поручения попадут в реестр после утверждения протокола.'}</p></div></div>
              {proposal.assignments.length ? <div className={styles.cards}>{proposal.assignments.map((item, index) => <AssignmentReview key={index} item={item} index={index} segments={proposal.segments}
                speakerOf={speakerOf} editable={reviewing} people={people} onStatus={model.review.setStatus} onCorrect={model.review.correct} onSource={model.showSource} />)}</div>
                : <div className={pageStyles.emptyInline}>ИИ не нашёл поручений в этой записи.</div>}
            </>}
          </>}
        </article>

        <aside className={pageStyles.context} aria-label="Контекст встречи">
          <div className={pageStyles.contextHead}><span>КОНТЕКСТ</span></div>
          <div className={pageStyles.contextSection}><div className={pageStyles.contextTitle}><strong>Источник данных</strong></div><small>{sourceModeLabels[proposal.source_mode]}{run.synthetic ? '; синтетическая встреча' : ''}</small></div>
          <div className={pageStyles.contextSection}><div className={pageStyles.contextTitle}><strong>Редакция</strong></div><small>{done && detail.approvedAt ? `Утверждена ${new Date(detail.approvedAt).toLocaleString('ru-RU')}` : `№ ${proposal.revision}${model.dirty ? ', есть правки' : ''}`}</small></div>
          <div className={pageStyles.contextSection}><div className={pageStyles.contextTitle}><strong>Участники</strong></div><div className={pageStyles.contextPeople}>{people.slice(0, 6).map((name) => <div key={name}><span>{name}</span></div>)}{people.length === 0 && <small>Не указаны</small>}</div></div>
        </aside>
      </div>}

    <Modal opened={rejecting} onClose={() => setRejecting(false)} title="Отклонить протокол?" centered>
      <Stack gap="md">
        <Text size="sm">Черновик не попадёт в реестр поручений, файлы не сформируются. Действие нельзя отменить.</Text>
        <Textarea label="Причина" placeholder="Например: запись неполная, нужна повторная загрузка" autosize minRows={3} value={rejectComment} onChange={(event) => setRejectComment(event.currentTarget.value)} />
        <Group justify="flex-end"><Button variant="default" onClick={() => setRejecting(false)}>Отмена</Button>
          <Button color="red" loading={model.busy === 'reject'} onClick={() => void model.decide(false, rejectComment).then((ok) => { if (ok) setRejecting(false); })}>Отклонить</Button></Group>
      </Stack>
    </Modal>
    <TaskEditor opened={editingTask !== undefined} onClose={() => setEditingTask(undefined)} task={editingTask} meetingId={meeting.id} />
  </div>;
}
