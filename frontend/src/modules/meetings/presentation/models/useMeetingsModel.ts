import type { Meeting } from '@/modules/meetings/domain/meeting.types';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useMemo, useState } from 'react';
import { filterMeetings } from '../../domain/MeetingCatalog';
import { useMeetingCommands } from '../useMeetingCommands';

export type MeetingView = 'all' | 'review' | 'processing' | 'ready';
type KindFilter = 'all' | 'example' | 'local';

export function useMeetingsModel() {
  const { meetings, tasks, loading, error } = useWorkspace();
  const { deleteMeeting } = useMeetingCommands();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [view, setView] = useState<MeetingView>('all');
  const [deleting, setDeleting] = useState<Meeting | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletingNow, setDeletingNow] = useState(false);

  const visibleMeetings = useMemo(() => {
    const matches = filterMeetings(meetings, { search, kind, status: 'all' });
    if (view === 'all') return matches;
    const status = view === 'review' ? 'draft' : view === 'processing' ? 'pending' : 'ready';
    return matches.filter((meeting) => meeting.status === status);
  }, [meetings, search, kind, view]);
  const taskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) counts.set(task.meetingId, (counts.get(task.meetingId) ?? 0) + 1);
    return counts;
  }, [tasks]);
  const hasFilters = Boolean(search.trim()) || kind !== 'all' || view !== 'all';

  function clearFilters() {
    setSearch('');
    setKind('all');
    setView('all');
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingNow(true);
    setDeleteError('');
    try {
      await deleteMeeting(deleting.id);
      setDeleting(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Не удалось удалить встречу. Попробуйте ещё раз.');
    } finally {
      setDeletingNow(false);
    }
  }

  return { meetings, loading, error, search, setSearch, kind, setKind, view, setView, deleting, setDeleting, deleteError, setDeleteError, deletingNow, visibleMeetings, taskCounts, hasFilters, clearFilters, confirmDelete };
}
