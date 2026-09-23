import { usePermission } from '@/modules/auth/presentation/usePermission';
import type { Meeting } from '@/modules/meetings/domain/meeting.types';
import { runStatusLabels } from '@/modules/runs/domain/mirror';
import { useServerSync } from '@/modules/runs/presentation/useServerSync';
import { formatDate } from '@/shared/lib/formatDate';
import { ActionIcon, Button, Group, Menu, Modal, Select, Text, TextInput, UnstyledButton } from '@mantine/core';
import { Mic2, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMeetingsModel, type MeetingView } from '../models/useMeetingsModel';
import styles from './MeetingsPage.module.css';

const statusText: Record<Meeting['status'], string> = {
  ready: 'Готово к работе',
  draft: 'Черновик',
  pending: 'Ожидает обработки',
};

const languageText: Record<Meeting['language'], string> = {
  ru: 'Русский',
  kk: 'Қазақша',
  mixed: 'Смешанный',
};

const views: ReadonlyArray<{ value: MeetingView; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'review', label: 'Нужна проверка' },
  { value: 'processing', label: 'Обрабатываются' },
  { value: 'ready', label: 'Готовые' },
];

function assignmentCount(count: number): string {
  if (count === 0) return '—';
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? 'поручений' : last === 1 ? 'поручение' : last >= 2 && last <= 4 ? 'поручения' : 'поручений';
  return `${count} ${noun}`;
}

export default function MeetingsPage() {
  const { meetings, loading, error, search, setSearch, kind, setKind, view, setView, deleting, setDeleting, deleteError, setDeleteError, deletingNow, visibleMeetings, taskCounts, hasFilters, clearFilters, confirmDelete } = useMeetingsModel();
  const canCreate = usePermission('meetings:write');
  const hasExamples = meetings.some((meeting) => meeting.kind === 'example');
  const server = useServerSync();

  return (
    <div className={styles.page}>
      <div className={styles.headingRow}>
        <div>
          <h1 className={styles.heading}>Встречи</h1>
          <p className={styles.subtitle}>Записи, черновики и материалы совещаний</p>
        </div>
        <Group gap="sm"><Button component={Link} to="/meetings/live" variant="default" leftSection={<Mic2 size={18} />}>Живой разговор</Button>{canCreate && <Button component={Link} to="/meetings/new" leftSection={<Plus size={18} />} className={styles.newButton}>Новая встреча</Button>}</Group>
      </div>

      {error && <div className={styles.errorBanner} role="alert">Не удалось загрузить встречи: {error}</div>}
      {server.error && <div className={styles.errorBanner} role="alert">Встречи с сервера не обновились: {server.error} <Button variant="subtle" size="compact-xs" onClick={() => void server.refresh()} loading={server.syncing}>Повторить</Button></div>}

      <div className={styles.toolbar}>
        <TextInput
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Поиск по встречам"
          aria-label="Поиск по встречам"
          leftSection={<Search size={18} />}
          rightSection={search ? <ActionIcon size="sm" variant="subtle" onClick={() => setSearch('')} aria-label="Очистить поиск"><X size={15} /></ActionIcon> : null}
          className={styles.search}
        />
        <Select
          aria-label="Источник встреч"
          value={kind}
          onChange={(value) => setKind(value === 'example' || value === 'local' ? value : 'all')}
          data={[{ value: 'all', label: 'Все источники' }, { value: 'local', label: 'Мои встречи' }, { value: 'example', label: 'Примеры' }]}
          allowDeselect={false}
          className={styles.sourceFilter}
        />
      </div>

      <div className={styles.viewBar}>
        <div className={styles.views} role="group" aria-label="Фильтр по состоянию встречи">
          {views.map(({ value, label }) => <UnstyledButton key={value} type="button" className={`${styles.view} ${view === value ? styles.viewActive : ''}`} onClick={() => setView(value)} aria-pressed={view === value}>{label}</UnstyledButton>)}
        </div>
        {hasExamples && <span className={styles.exampleNote}>Примеры отмечены в списке</span>}
      </div>

      <section className={styles.register} aria-label="Список встреч">
        <div className={styles.tableHead} aria-hidden="true">
          <span>Встреча</span><span>Дата</span><span>Статус</span><span>Поручения</span><span></span>
        </div>
        {loading ? <div className={styles.empty}>Загружаем встречи…</div> : visibleMeetings.length === 0 ? (
          <div className={styles.empty}>
            <strong>{hasFilters ? 'Ничего не найдено' : 'Пока нет встреч'}</strong>
            <span>{hasFilters ? 'Измените запрос или фильтр.' : canCreate ? 'Создайте встречу, чтобы начать работу.' : 'Встречи добавляют редактор или секретарь департамента.'}</span>
            {hasFilters ? <Button variant="subtle" size="sm" onClick={clearFilters}>Сбросить фильтры</Button> : canCreate && <Button component={Link} to="/meetings/new" variant="light" size="sm">Создать встречу</Button>}
          </div>
        ) : visibleMeetings.map((meeting) => {
          const taskCount = taskCounts.get(meeting.id) ?? 0;
          return <div key={meeting.id} className={`${styles.row} ${meeting.status === 'draft' ? styles.reviewRow : ''}`}>
            <div className={styles.meetingCell}>
              <Link to={`/meetings/${meeting.id}`} className={styles.meetingTitle}>{meeting.title}</Link>
              <div className={styles.meetingMeta}>
                {meeting.kind === 'example' && <span className={styles.exampleTag}>Пример</span>}
                <span>{languageText[meeting.language]}</span>
                {meeting.organization && <><span aria-hidden="true">·</span><span className={styles.organization}>{meeting.organization}</span></>}
              </div>
            </div>
            <span className={styles.dateCell}>{formatDate(meeting.date)}</span>
            <span className={styles.statusCell}><span className={`${styles.status} ${meeting.status === 'draft' ? styles.statusDraft : ''}`}>{meeting.kind === 'example' ? 'Для ознакомления' : meeting.runStatus ? runStatusLabels[meeting.runStatus] : statusText[meeting.status]}</span></span>
            <span className={styles.taskCell}>{assignmentCount(taskCount)}</span>
            <div className={styles.actions}>
              <Link to={`/meetings/${meeting.id}`} className={styles.rowAction}>{meeting.status === 'draft' ? 'Проверить' : 'Открыть'}</Link>
              <Menu position="bottom-end" withinPortal shadow="sm">
                <Menu.Target><ActionIcon variant="subtle" className={styles.menuButton} aria-label={`Действия: ${meeting.title}`}><MoreHorizontal size={18} /></ActionIcon></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item component={Link} to={`/meetings/${meeting.id}`}>Открыть встречу</Menu.Item>
                  <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => { setDeleting(meeting); setDeleteError(''); }}>Удалить</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
          </div>;
        })}
      </section>

      <Modal opened={Boolean(deleting)} onClose={() => setDeleting(null)} title="Удалить встречу?" centered size="sm">
        <Text size="sm">«{deleting?.title}» и связанные поручения будут удалены с этого устройства.{deleting?.backendRunId ? ' На сервере встреча и утверждённый протокол сохранятся.' : ''}</Text>
        {deleteError && <div className={styles.modalError} role="alert">{deleteError}</div>}
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)} disabled={deletingNow}>Отмена</Button>
          <Button color="red" onClick={confirmDelete} loading={deletingNow}>Удалить</Button>
        </Group>
      </Modal>
    </div>
  );
}
