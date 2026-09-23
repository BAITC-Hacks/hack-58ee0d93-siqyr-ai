import type { Task } from '@/modules/tasks/domain/task.types';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { workingRecords } from '@/modules/workspace/domain/workingRecords';
import { useMemo, useState } from 'react';
import { TaskBoard, type TaskStatusFilter as StatusFilter } from '../../domain/TaskBoard';
import { isTaskStatus } from '../../domain/task.types';
import { useTaskCommands } from '../useTaskCommands';

export function useTasksModel() {
  const { meetings, tasks, settings, loading, error } = useWorkspace();
  const { updateTask, deleteTask } = useTaskCommands();
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
  const reminderDays = settings.reminderDays;
  const { meetings: workingMeetings, tasks: workingTasks } = useMemo(() => workingRecords(meetings, tasks), [meetings, tasks]);
  const board = new TaskBoard(workingTasks, reminderDays, new Date());
  const meetingMap = useMemo(() => new Map(workingMeetings.map((meeting) => [meeting.id, meeting])), [workingMeetings]);
  const { owners, counts, reminders, missingDates } = board;
  const filtered = board.filter({ query, status, owner, meetingId });
  const groups = board.groups(filtered);

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
    if (!isTaskStatus(value) || value === task.status) return;
    setActionError('');
    setBusyId(task.id);
    try {
      await updateTask(task.id, { status: value });
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

  return { meetings: workingMeetings, tasks: workingTasks, loading, error, query, setQuery, status, setStatus, owner, setOwner, meetingId, setMeetingId, editing, editorOpen, setEditorOpen, deleting, setDeleting, busyId, actionError, setActionError, remindersOpen, setRemindersOpen, reminderDays, board, meetingMap, owners, counts, reminders, missingDates, filtered, groups, openEditor, resetFilters, changeStatus, confirmDelete };
}
