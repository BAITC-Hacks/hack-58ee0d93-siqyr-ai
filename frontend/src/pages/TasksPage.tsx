import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Select, Tabs, Text, TextInput, Title } from '@mantine/core';
import { AlertCircle, ArrowUpRight, CalendarClock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Task } from '../domain/types';
import { useWorkspace } from '../hooks/useWorkspace';
import TaskEditor from '../components/TaskEditor';
import styles from './TasksPage.module.css';

type StatusFilter = 'all' | Task['status'];
type GroupId = 'overdue' | 'soon' | 'later' | 'undated' | 'done';

const statusLabels: Record<Task['status'], string> = {
  todo: 'К выполнению',
  'in-progress': 'В работе',
  done: 'Готово',
};

const groupLabels: Record<GroupId, string> = {
  overdue: 'Прошедшие даты',
  soon: 'Ближайшие сроки',
  later: 'Позже',
  undated: 'Без точной даты',
  done: 'Завершённые',
};

function localDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.getFullYear() === Number(y) && date.getMonth() === Number(m) - 1 && date.getDate() === Number(d) ? date : null;
}

function dayStamp(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatDate(value: string): string {
  const date = localDate(value);
  return date ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date) : value;
}

export default function TasksPage() {
  const { meetings, tasks, settings, loading, error, updateTask, deleteTask } = useWorkspace();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [owner, setOwner] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [remindersOpen, setRemindersOpen] = useState(false);
  const today = dayStamp(new Date());
  const reminderDays = Math.max(0, Number.isFinite(settings.reminderDays) ? settings.reminderDays : 0);
  const reminderEnd = today + reminderDays * 86_400_000;
  const meetingMap = useMemo(() => new Map(meetings.map((meeting) => [meeting.id, meeting])), [meetings]);
  const owners = useMemo(() => [...new Set(tasks.map((task) => task.assignee.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [tasks]);
  const counts = useMemo(() => ({
    all: tasks.length,
    todo: tasks.filter((task) => task.status === 'todo').length,
    'in-progress': tasks.filter((task) => task.status === 'in-progress').length,
    done: tasks.filter((task) => task.status === 'done').length,
  }), [tasks]);

  const filtered = useMemo(() => tasks.filter((task) => {
    const matchesQuery = !query.trim() || `${task.title} ${task.assignee}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));
    return matchesQuery && (status === 'all' || task.status === status) && (!owner || (owner === '__unassigned__' ? !task.assignee.trim() : task.assignee.trim() === owner)) && (!meetingId || task.meetingId === meetingId);
  }), [tasks, query, status, owner, meetingId]);

  function groupFor(task: Task): GroupId {
    if (task.status === 'done') return 'done';
    const date = task.dueDate ? localDate(task.dueDate) : null;
    if (!date) return 'undated';
    const stamp = dayStamp(date);
    if (stamp < today) return 'overdue';
    if (stamp <= reminderEnd) return 'soon';
    return 'later';
  }

  const groups = (['overdue', 'soon', 'later', 'undated', 'done'] as GroupId[])
    .map((id) => ({ id, items: filtered.filter((task) => groupFor(task) === id).sort((a, b) => {
      const aDate = a.dueDate ?? '';
      const bDate = b.dueDate ?? '';
      return aDate.localeCompare(bDate) || a.title.localeCompare(b.title, 'ru');
    }) }))
    .filter((group) => group.items.length > 0);

  const reminders = tasks.filter((task) => task.status !== 'done' && task.dueDate && localDate(task.dueDate) && dayStamp(localDate(task.dueDate)!) <= reminderEnd)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const missingDates = tasks.filter((task) => task.status !== 'done' && !task.dueDate && task.deadlineText.trim());

  function openEditor(task?: Task) {
    setEditing(task ?? null);
    setEditorOpen(true);
  }

  function resetFilters() {
    setQuery('');
    setStatus('all');
    setOwner(null);
    setMeetingId(null);
  }

  async function changeStatus(task: Task, value: string | null) {
    if (!value || value === task.status) return;
    setActionError('');
    setBusyId(task.id);
    try {
      await updateTask(task.id, { status: value as Task['status'] });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Не удалось изменить статус. Попробуйте ещё раз.');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setActionError('');
    setBusyId(deleting.id);
    try {
      await deleteTask(deleting.id);
      setDeleting(null);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Не удалось удалить поручение. Попробуйте ещё раз.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>РАБОЧИЙ РЕЕСТР</div>
          <Title order={1} className={styles.title}>Поручения</Title>
          <Text className={styles.subtitle}>Решения из встреч, ответственные и сроки в одном списке.</Text>
        </div>
        <Button leftSection={<Plus size={17} />} onClick={() => openEditor()} disabled={meetings.length === 0}>Добавить поручение</Button>
      </header>

      {error && <Alert color="red" title="Не удалось загрузить данные" mb="md">{error}</Alert>}
      {actionError && <Alert color="red" title="Не удалось выполнить действие" mb="md" withCloseButton onClose={() => setActionError('')}>{actionError}</Alert>}

      <section className={styles.register} aria-label="Реестр поручений">
        <Tabs value={status} onChange={(value) => setStatus((value ?? 'all') as StatusFilter)}>
          <Tabs.List className={styles.statusBar} aria-label="Фильтр по статусу">
            {([['all', 'Все'], ['todo', 'К выполнению'], ['in-progress', 'В работе'], ['done', 'Готово']] as const).map(([value, label]) => (
              <Tabs.Tab key={value} value={value} className={styles.statusTab}>{label}<span>{counts[value]}</span></Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
        <div className={styles.filters}>
          <TextInput className={styles.search} leftSection={<Search size={16} />} placeholder="Поиск по поручению или ответственному" aria-label="Поиск по поручению или ответственному" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <Select className={styles.filterSelect} placeholder="Все ответственные" aria-label="Фильтр по ответственному" data={[...owners.map((name) => ({ value: name, label: name })), { value: '__unassigned__', label: 'Не назначен' }]} value={owner} onChange={(value) => setOwner(value === null ? null : String(value))} clearable searchable />
          <Select className={styles.filterSelect} placeholder="Все встречи" aria-label="Фильтр по встрече" data={meetings.map((meeting) => ({ value: meeting.id, label: meeting.title }))} value={meetingId} onChange={(value) => setMeetingId(value === null ? null : String(value))} clearable searchable />
          {(query || status !== 'all' || owner || meetingId) && <Button variant="subtle" size="sm" onClick={resetFilters}>Сбросить</Button>}
        </div>

        {loading ? <div className={styles.empty}><Text>Загружаем поручения…</Text></div> : filtered.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><Search size={20} /></div>
            <Title order={3}>{tasks.length ? 'Поручения не найдены' : 'Пока нет поручений'}</Title>
            <Text>{tasks.length ? 'Измените запрос или фильтры, чтобы увидеть другие поручения.' : 'Создайте поручение и привяжите его к встрече.'}</Text>
            {tasks.length ? <Button variant="light" onClick={resetFilters}>Сбросить фильтры</Button> : <Button onClick={() => openEditor()} disabled={meetings.length === 0}>Добавить поручение</Button>}
          </div>
        ) : (
          <div className={styles.list}>
            <div className={styles.columns} aria-hidden="true"><span>ПОРУЧЕНИЕ / ВСТРЕЧА</span><span>ОТВЕТСТВЕННЫЙ</span><span>СРОК</span><span>СТАТУС</span><span /></div>
            {groups.map((group) => (
              <section key={group.id} className={styles.group} aria-label={groupLabels[group.id]}>
                <div className={styles.groupHeading}><span>{groupLabels[group.id]}</span><span className={styles.groupCount}>{group.items.length}</span></div>
                {group.items.map((task) => {
                  const meeting = meetingMap.get(task.meetingId);
                  return <div key={task.id} className={styles.row}>
                    <div className={styles.taskCell}>
                      <button type="button" className={styles.taskTitle} onClick={() => openEditor(task)}>{task.title}</button>
                      {meeting ? <Link className={styles.meetingLink} to={`/meetings/${meeting.id}`}>{meeting.title}<ArrowUpRight size={12} /></Link> : <span className={styles.meetingMissing}>Встреча удалена</span>}
                    </div>
                    <div className={`${styles.field} ${styles.ownerCell}`}><span className={styles.mobileLabel}>Ответственный</span><span>{task.assignee.trim() || <span className={styles.muted}>Не назначен</span>}</span></div>
                    <div className={`${styles.field} ${styles.deadlineCell}`}><span className={styles.mobileLabel}>Срок</span>{task.dueDate ? <div className={styles.deadline}><strong>{formatDate(task.dueDate)}</strong>{task.deadlineText && task.deadlineText !== formatDate(task.dueDate) && <span title="Срок в протоколе">{task.deadlineText}</span>}</div> : <div className={styles.deadline}><strong className={!task.deadlineText ? styles.muted : undefined}>{task.deadlineText || 'Срок не указан'}</strong></div>}</div>
                    <div className={`${styles.field} ${styles.statusCell}`}><span className={styles.mobileLabel}>Статус</span><Select aria-label={`Статус: ${task.title}`} className={styles.rowSelect} size="xs" data={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} value={task.status} onChange={(value) => void changeStatus(task, value)} disabled={busyId === task.id} allowDeselect={false} /></div>
                    <Group gap={3} className={styles.rowActions} wrap="nowrap"><Button variant="subtle" size="compact-sm" aria-label={`Редактировать: ${task.title}`} title="Редактировать" onClick={() => openEditor(task)}><Pencil size={15} /></Button><Button variant="subtle" color="red" size="compact-sm" aria-label={`Удалить: ${task.title}`} title="Удалить" onClick={() => setDeleting(task)}><Trash2 size={15} /></Button></Group>
                  </div>;
                })}
              </section>
            ))}
          </div>
        )}
      </section>

      <section className={styles.reminderSection} aria-label="Локальные напоминания">
        <div className={styles.reminderHeader}>
          <div className={styles.reminderTitle}><CalendarClock size={18} /><div><strong>Напоминания в приложении</strong><span>По точным датам, за {reminderDays} дн. до срока</span></div></div>
          <Button variant="subtle" size="xs" onClick={() => setRemindersOpen((value) => !value)} aria-expanded={remindersOpen}>{remindersOpen ? 'Свернуть' : 'Показать'}</Button>
        </div>
        {remindersOpen && <div className={styles.reminderBody}>
          {reminders.length === 0 ? <Text size="sm" c="dimmed">Поручений с наступившей или ближайшей точной датой нет.</Text> : reminders.map((task) => <button key={task.id} type="button" className={styles.reminderItem} onClick={() => openEditor(task)}><span className={styles.reminderText}>{task.title}</span><Badge variant="light" color={task.dueDate && localDate(task.dueDate) && dayStamp(localDate(task.dueDate)!) < today ? 'orange' : 'teal'}>{task.dueDate && localDate(task.dueDate) && dayStamp(localDate(task.dueDate)!) < today ? 'Дата прошла' : 'Скоро'}</Badge><span>{task.dueDate && formatDate(task.dueDate)}</span></button>)}
          {missingDates.length > 0 && <div className={styles.needsDates}><AlertCircle size={15} /> {missingDates.length} {missingDates.length === 1 ? 'поручению' : 'поручениям'} с текстовым сроком нужна точная дата для напоминания.</div>}
          <Text size="xs" c="dimmed">Напоминания видны только здесь. Уведомления и сообщения не отправляются.</Text>
        </div>}
      </section>

      <TaskEditor opened={editorOpen} onClose={() => setEditorOpen(false)} task={editing ?? undefined} />
      <Modal opened={Boolean(deleting)} onClose={() => setDeleting(null)} title="Удалить поручение?" centered size="sm">
        <Text size="sm">{deleting?.title}</Text>
        <Text size="sm" c="dimmed" mt="xs">Это удалит поручение из локального реестра.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="subtle" color="gray" onClick={() => setDeleting(null)} disabled={Boolean(busyId)}>Отмена</Button><Button color="red" leftSection={<Trash2 size={15} />} loading={Boolean(busyId)} onClick={() => void confirmDelete()}>Удалить</Button></Group>
      </Modal>
    </div>
  );
}
