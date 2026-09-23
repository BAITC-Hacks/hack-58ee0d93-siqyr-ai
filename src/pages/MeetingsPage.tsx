import { useMemo, useState } from 'react';
import { ActionIcon, Button, Group, Menu, Modal, Select, Text, TextInput } from '@mantine/core';
import { ArrowRight, ChevronRight, MoreHorizontal, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import type { Meeting, Task } from '../domain/types';
import styles from './MeetingsPage.module.css';

type KindFilter = 'all' | 'example' | 'local';

const statusText: Record<Meeting['status'], string> = {
  ready: 'Готово к работе',
  draft: 'Черновик',
  pending: 'Ожидает обработки',
};

function meetingNumber(meeting: Meeting, index: number) {
  return String(meeting.number ?? index + 1).padStart(2, '0');
}

function meetingTasks(tasks: Task[], meetingId: string) {
  return tasks.filter((task) => task.meetingId === meetingId);
}

export default function MeetingsPage() {
  const { meetings, tasks, loading, error, deleteMeeting } = useWorkspace();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Meeting | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletingNow, setDeletingNow] = useState(false);

  const visibleMeetings = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ru');
    return meetings.filter((meeting) => {
      if (kind !== 'all' && meeting.kind !== kind) return false;
      if (status !== 'all' && meeting.status !== status) return false;
      if (!needle) return true;
      const content = [meeting.title, meeting.organization, meeting.summary, ...meeting.participants.map((person) => person.name)].join(' ').toLocaleLowerCase('ru');
      return content.includes(needle);
    }).sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'local' ? -1 : 1;
      if (left.kind === 'example') return (left.number ?? 0) - (right.number ?? 0);
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [meetings, kind, status, search]);
  const selected = visibleMeetings.find((meeting) => meeting.id === selectedId) ?? visibleMeetings[0] ?? null;
  const selectedTasks = selected ? meetingTasks(tasks, selected.id) : [];
  const sections = selected ? [...new Set(selected.transcript.map((item) => item.section).filter((section) => section && section !== 'Текст совещания'))] : [];
  const hasFilters = Boolean(search.trim()) || kind !== 'all' || status !== 'all';

  function clearFilters() {
    setSearch('');
    setKind('all');
    setStatus('all');
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingNow(true);
    setDeleteError('');
    try {
      await deleteMeeting(deleting.id);
      setDeleting(null);
      if (selectedId === deleting.id) setSelectedId(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Не удалось удалить встречу. Попробуйте ещё раз.');
    } finally {
      setDeletingNow(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.headingRow}>
        <div>
          <div className={styles.eyebrow}>РАБОЧЕЕ ПРОСТРАНСТВО / ВСТРЕЧИ</div>
          <h1 className={styles.heading}>Встречи<span className={styles.headingCount}>{meetings.length}</span></h1>
          <p className={styles.subtitle}>Материалы встреч и поручения, собранные в одном месте.</p>
        </div>
        <Button component={Link} to="/meetings/new" leftSection={<Plus size={16} />} className={styles.newButton}>Новая встреча</Button>
      </div>

      {error && <div className={styles.errorBanner} role="alert">Не удалось загрузить данные: {error}</div>}

      <div className={styles.workspace}>
        <section className={styles.index} aria-label="Список встреч">
          <div className={styles.indexHeader}>
            <div className={styles.sectionLabel}>ИНДЕКС ВСТРЕЧ <span>{visibleMeetings.length}</span></div>
            <div className={styles.indexControls}>
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Поиск по встречам"
                aria-label="Поиск по встречам"
                leftSection={<Search size={16} />}
                rightSection={search ? <ActionIcon size="sm" variant="subtle" onClick={() => setSearch('')} aria-label="Очистить поиск"><X size={14} /></ActionIcon> : null}
                className={styles.search}
              />
              <div className={styles.filters}>
                <Select
                  aria-label="Тип встречи"
                  value={kind}
                  onChange={(value) => setKind((value ?? 'all') as KindFilter)}
                  data={[{ value: 'all', label: 'Все встречи' }, { value: 'example', label: 'Примеры' }, { value: 'local', label: 'Мои встречи' }]}
                  allowDeselect={false}
                  className={styles.filter}
                />
                <Select
                  aria-label="Статус встречи"
                  value={status}
                  onChange={(value) => setStatus(value ?? 'all')}
                  data={[{ value: 'all', label: 'Любой статус' }, { value: 'ready', label: 'Готово к работе' }, { value: 'draft', label: 'Черновик' }, { value: 'pending', label: 'Ожидает обработки' }]}
                  allowDeselect={false}
                  className={styles.filter}
                />
              </div>
            </div>
          </div>

          {loading ? <div className={styles.empty}>Загружаем встречи…</div> : visibleMeetings.length === 0 ? (
            <div className={styles.empty}>
              <strong>{hasFilters ? 'Ничего не найдено' : 'Пока нет встреч'}</strong>
              <span>{hasFilters ? 'Попробуйте изменить запрос или фильтры.' : 'Создайте встречу, чтобы собрать материалы и поручения.'}</span>
              {hasFilters ? <Button variant="subtle" size="xs" onClick={clearFilters}>Сбросить фильтры</Button> : <Button component={Link} to="/meetings/new" variant="light" size="xs">Создать встречу</Button>}
            </div>
          ) : (
            <div className={styles.rows}>
              {visibleMeetings.map((meeting, index) => {
                const taskCount = meetingTasks(tasks, meeting.id).length;
                const isSelected = selected?.id === meeting.id;
                return (
                  <div key={meeting.id} className={`${styles.row} ${isSelected ? styles.selected : ''}`}>
                    <button type="button" className={styles.rowButton} onClick={() => setSelectedId(meeting.id)} aria-pressed={isSelected}>
                      <span className={styles.rowNumber}>{meetingNumber(meeting, index)}</span>
                      <span className={styles.rowContent}>
                        <span className={styles.rowTitle}>{meeting.title}</span>
                        <span className={styles.rowMeta}>{meeting.kind === 'example' && <span className={styles.exampleTag}>Пример</span>}{meeting.organization || 'Без организации'}</span>
                        <span className={styles.rowStats}><Users size={13} /> {meeting.participants.length} участников <span className={styles.dot}>·</span> {taskCount} поручений</span>
                      </span>
                      <ChevronRight className={styles.rowChevron} size={18} strokeWidth={1.6} />
                    </button>
                    <Menu position="bottom-end" withinPortal shadow="sm">
                      <Menu.Target><ActionIcon className={styles.rowMenu} variant="subtle" aria-label={`Действия: ${meeting.title}`}><MoreHorizontal size={18} /></ActionIcon></Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item component={Link} to={`/meetings/${meeting.id}`}>Открыть встречу</Menu.Item>
                        <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => { setDeleting(meeting); setDeleteError(''); }}>Удалить</Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className={styles.dossier} aria-label="Обзор выбранной встречи">
          {selected ? (
            <>
              <div className={styles.dossierTop}>
                <div className={styles.dossierKicker}>{selected.kind === 'example' ? 'ПРИМЕР ВСТРЕЧИ' : 'МОЯ ВСТРЕЧА'} <span>№ {meetingNumber(selected, meetings.indexOf(selected))}</span></div>
                <span className={`${styles.status} ${selected.status === 'pending' ? styles.statusPending : ''}`}>{statusText[selected.status]}</span>
              </div>
              <h2 className={styles.dossierTitle}>{selected.title}</h2>
              <div className={styles.dossierMeta}>{selected.organization || 'Без организации'} <span>·</span> {selected.participants.length} участников <span>·</span> {selectedTasks.length} поручений</div>

              <div className={styles.contentBlock}>
                <div className={styles.contentHeading}>{sections.length > 0 ? 'ПОВЕСТКА' : 'КРАТКО О ВСТРЕЧЕ'}</div>
                {sections.length > 0 ? <ol className={styles.agenda}>{sections.map((section) => <li key={section}>{section?.replace(/^Часть \d+\.\s*/, '')}</li>)}</ol> : <p className={styles.summary}>{selected.summary.split('\n\n')[0] || 'Описание пока не добавлено.'}</p>}
              </div>

              <div className={styles.contentBlock}>
                <div className={styles.contentHeading}>ПОРУЧЕНИЯ <span>{selectedTasks.length}</span></div>
                {selectedTasks.length > 0 ? <div className={styles.taskPreview}>{selectedTasks.slice(0, 4).map((task, index) => (
                  <div className={styles.taskRow} key={task.id}>
                    <span className={styles.taskNumber}>{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{task.title}</strong><span>{task.assignee || 'Ответственный не указан'}{task.deadlineText && <> <span className={styles.dot}>·</span> {task.deadlineText}</>}</span></div>
                  </div>
                ))}</div> : <p className={styles.noContent}>Поручений пока нет.</p>}
                {selectedTasks.length > 4 && <div className={styles.moreTasks}>И ещё {selectedTasks.length - 4} поручений в материалах встречи</div>}
              </div>

              <Link to={`/meetings/${selected.id}`} className={styles.openLink}>Открыть встречу <ArrowRight size={17} /></Link>
            </>
          ) : <div className={styles.emptyDossier}>Выберите встречу в списке, чтобы посмотреть материалы.</div>}
        </section>
      </div>

      <Modal opened={Boolean(deleting)} onClose={() => setDeleting(null)} title="Удалить встречу?" centered size="sm">
        <Text size="sm">«{deleting?.title}» и связанные поручения будут удалены с этого устройства.</Text>
        {deleteError && <div className={styles.modalError} role="alert">{deleteError}</div>}
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)} disabled={deletingNow}>Отмена</Button>
          <Button color="red" onClick={confirmDelete} loading={deletingNow}>Удалить</Button>
        </Group>
      </Modal>
    </div>
  );
}
