import type { Meeting, MeetingChanges, Segment } from '@/modules/meetings/domain/meeting.types';
import type { Task } from '@/modules/tasks/domain/task.types';
import { useWorkspace } from '@/modules/workspace/presentation/useWorkspace';
import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import { useObjectUrl } from '@/shared/presentation/useObjectUrl';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMeetingCommands } from '../useMeetingCommands';

type Tab = 'summary' | 'transcript' | 'protocol' | 'tasks';
export const tabs: { id: Tab; label: string; detail: string }[] = [
  { id: 'summary', label: 'Сводка', detail: 'Суть встречи' },
  { id: 'transcript', label: 'Расшифровка', detail: 'Реплики и источник' },
  { id: 'protocol', label: 'Протокол', detail: 'Итоговый документ' },
  { id: 'tasks', label: 'Поручения', detail: 'Исполнение' },
];

export function useMeetingModel() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { meetings, tasks, loading, error } = useWorkspace();
  const { updateMeeting, saveParticipants: updateParticipants, saveSegment: updateSegment } = useMeetingCommands();
  const { exporter } = useServices();
  const meeting = meetings.find((item) => item.id === id);
  const meetingTasks = useMemo(() => tasks.filter((task) => task.meetingId === id), [tasks, id]);
  const requestedTab = searchParams.get('tab');
  const tab: Tab = tabs.find((item) => item.id === requestedTab)?.id ?? 'summary';

  const [metadataOpen, setMetadataOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [metadata, setMetadata] = useState<{ title: string; organization: string; date: string; language: Meeting['language'] }>({ title: '', organization: '', date: '', language: 'ru' });
  const [peopleDraft, setPeopleDraft] = useState('');
  const [segmentDraft, setSegmentDraft] = useState({ speaker: '', role: '', section: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const sourceUrl = useObjectUrl(meeting?.source?.blob);

  useEffect(() => {
    if (!meeting) return;
    setSummaryDraft(meeting.summary);
    setSummaryEditing(false);
    setMetadata({ title: meeting.title, organization: meeting.organization, date: meeting.date || '', language: meeting.language });
    setPeopleDraft(meeting.participants.map((person) => `${person.name}${person.role ? ` — ${person.role}` : ''}`).join('\n'));
  }, [meeting?.id]);

  function selectTab(nextTab: Tab) {
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('tab', nextTab); return next; });
  }

  async function saveMeeting(patch: MeetingChanges, done?: () => void) {
    if (!meeting) return;
    setBusy(true);
    setLocalError('');
    try { await updateMeeting(meeting.id, patch); done?.(); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  }

  function startSegment(segment?: Segment) {
    setEditingSegment(segment || { id: '', speaker: '', role: '', text: '' });
    setSegmentDraft({ speaker: segment?.speaker || '', role: segment?.role || '', section: segment?.section || '', text: segment?.text || '' });
  }

  async function runEdit(operation: () => Promise<void>, done: () => void) {
    setBusy(true);
    setLocalError('');
    try { await operation(); done(); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  }

  async function saveSegment() {
    if (!meeting || !editingSegment) return;
    await runEdit(() => updateSegment(meeting.id, { ...segmentDraft, id: editingSegment.id || undefined }), () => setEditingSegment(null));
  }

  async function saveParticipants() {
    if (!meeting) return;
    await runEdit(() => updateParticipants(meeting.id, peopleDraft), () => setParticipantsOpen(false));
  }

  async function downloadDocx() {
    if (!meeting) return;
    setBusy(true);
    setLocalError('');
    try { await exporter.download(meeting, meetingTasks, includeTranscript); setExportOpen(false); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Не удалось создать DOCX.'); }
    finally { setBusy(false); }
  }

  function printProtocol() {
    if (!meeting) return;
    setLocalError('');
    try { exporter.print(meeting, meetingTasks, includeTranscript); setExportOpen(false); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Не удалось открыть печать.'); }
  }

  return { meeting, meetingTasks, loading, error, tab, metadataOpen, setMetadataOpen, participantsOpen, setParticipantsOpen, exportOpen, setExportOpen, includeTranscript, setIncludeTranscript, taskOpen, setTaskOpen, editingTask, setEditingTask, editingSegment, setEditingSegment, transcriptQuery, setTranscriptQuery, summaryDraft, setSummaryDraft, summaryEditing, setSummaryEditing, metadata, setMetadata, peopleDraft, setPeopleDraft, segmentDraft, setSegmentDraft, busy, localError, setLocalError, sourceUrl, selectTab, saveMeeting, startSegment, saveSegment, saveParticipants, downloadDocx, printProtocol };
}
