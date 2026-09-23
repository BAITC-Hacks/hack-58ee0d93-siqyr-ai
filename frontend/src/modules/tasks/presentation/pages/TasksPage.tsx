import type { Task } from '@/modules/tasks/domain/task.types';
import TaskEditor from '@/modules/tasks/presentation/components/TaskEditor';
import { formatDate } from '@/shared/lib/formatDate';
import { Alert, Badge, Button, Group, Modal, Select, Tabs, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { AlertCircle, ArrowUpRight, CalendarClock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type TaskGroup as GroupId } from '../../domain/TaskBoard';
import { isTaskStatus } from '../../domain/task.types';
import { useTasksModel } from '../models/useTasksModel';
import styles from './TasksPage.module.css';


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

export default function TasksPage() {
  const { meetings, tasks, loading, error, query, setQuery, status, setStatus, owner, setOwner, meetingId, setMeetingId, editing, editorOpen, setEditorOpen, deleting, setDeleting, busyId, actionError, setActionError, remindersOpen, setRemindersOpen, reminderDays, board, meetingMap, owners, counts, reminders, missingDates, filtered, groups, openEditor, resetFilters, changeStatus, confirmDelete } = useTasksModel();

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>РАБОЧИЙ РЕЕСТР</div>
          <Title order={1} className={styles.title}>Поручения</Title>
          <Text className={styles.subtitle}>Поручения из ваших встреч, ответственные и сроки. Демонстрационные примеры не входят в реестр.</Text>
        </div>
        <Button leftSection={<Plus size={17} />} onClick={() => openEditor()} disabled={meetings.length === 0}>Добавить поручение</Button>
      </header>

      {error && <Alert color="red" title="Не удалось загрузить данные" mb="md">{error}</Alert>}
      {actionError && <Alert color="red" title="Не удалось выполнить действие" mb="md" withCloseButton onClose={() => setActionError('')}>{actionError}</Alert>}

      <section className={styles.register} aria-label="Реестр поручений">
        <Tabs value={status} onChange={(value) => setStatus(isTaskStatus(value) ? value : 'all')}>
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
                      <UnstyledButton type="button" className={styles.taskTitle} onClick={() => openEditor(task)}>{task.title}</UnstyledButton>
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
          {reminders.length === 0 ? <Text size="sm" c="dimmed">Поручений с наступившей или ближайшей точной датой нет.</Text> : reminders.map((task) => <UnstyledButton key={task.id} type="button" className={styles.reminderItem} onClick={() => openEditor(task)}><span className={styles.reminderText}>{task.title}</span><Badge variant="light" color={board.groupFor(task) === 'overdue' ? 'orange' : 'teal'}>{board.groupFor(task) === 'overdue' ? 'Дата прошла' : 'Скоро'}</Badge><span>{task.dueDate && formatDate(task.dueDate)}</span></UnstyledButton>)}
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
