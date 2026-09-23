import type { Meeting } from '@/modules/meetings/domain/meeting.types';
import type { Task } from '@/modules/tasks/domain/task.types';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useMemo, useState } from 'react';
import { filterMeetings, type MeetingFilters } from '../../domain/MeetingCatalog';
import { useMeetingCommands } from '../useMeetingCommands';
type KindFilter = 'all' | 'example' | 'local';

function meetingTasks(tasks: Task[], meetingId: string) { return tasks.filter((task) => task.meetingId === meetingId); }

export function useMeetingsModel() {
  const { meetings, tasks, loading, error } = useWorkspace();
  const { deleteMeeting } = useMeetingCommands();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<MeetingFilters['status']>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Meeting | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletingNow, setDeletingNow] = useState(false);

  const visibleMeetings = useMemo(() => filterMeetings(meetings, { search, kind, status }), [meetings, search, kind, status]);
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

  return { meetings, tasks, loading, error, search, setSearch, kind, setKind, status, setStatus, setSelectedId, deleting, setDeleting, deleteError, setDeleteError, deletingNow, visibleMeetings, selected, selectedTasks, sections, hasFilters, clearFilters, confirmDelete };
}
