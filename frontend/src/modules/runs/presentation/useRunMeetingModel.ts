import type { Meeting } from '@/modules/meetings/domain/meeting.types';
import { useServices } from '@/modules/workspace/presentation/WorkspaceProvider';
import { useObjectUrl } from '@/shared/presentation/useObjectUrl';
import { fileStem, saveBlob } from '@/shared/presentation/saveBlob';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RunError } from '../application/RunError';
import { blockingAssignments, confirmSpeaker, correctAssignment, reviewProgress, setReviewStatus, unconfirmedSpeakers, type AssignmentEdit } from '../domain/review';
import type { AssignmentDraft, Proposal, ReviewStatus } from '../domain/run.types';
import { runKeys, runQuery } from './runs.queries';

export type RunTab = 'summary' | 'transcript' | 'protocol' | 'tasks';
export const runTabs: { id: RunTab; label: string; detail: string }[] = [
  { id: 'summary', label: 'Сводка', detail: 'Суть и решения' },
  { id: 'transcript', label: 'Расшифровка', detail: 'Реплики и голоса' },
  { id: 'protocol', label: 'Протокол', detail: 'Итоговый документ' },
  { id: 'tasks', label: 'Поручения', detail: 'Проверка и исполнение' },
];

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function useRunMeetingModel(meeting: Meeting) {
  const runId = meeting.backendRunId ?? '';
  const { runs } = useServices();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useQuery({ ...runQuery(runs!, runId), enabled: runs !== null && Boolean(runId) });
  const detail = query.data;
  const status = detail?.run.status;
  const reviewing = status === 'awaiting_approval';
  const serverDraft = detail?.proposal ?? null;

  const [draft, setDraft] = useState<Proposal | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'approve' | 'reject' | 'docx' | 'pdf' | 'audio' | null>(null);
  const [actionError, setActionError] = useState('');
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [focusedSegment, setFocusedSegment] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeek = useRef<number | null>(null);

  // A fresh server revision replaces the view unless the secretary has unsaved edits.
  useEffect(() => {
    if (!dirty) setDraft(serverDraft);
  }, [serverDraft?.revision, status, dirty]);

  // A status change moves the card in the list, and the register is written only at the end of execute:
  // pull both right away instead of waiting for the next interval (which also pauses in a hidden tab).
  const previousStatus = useRef(status);
  useEffect(() => {
    if (status && status !== previousStatus.current && (status === 'done' || previousStatus.current !== undefined)) {
      void queryClient.invalidateQueries({ queryKey: runKeys.sync });
    }
    previousStatus.current = status;
  }, [status, queryClient]);

  const proposal = draft ?? serverDraft;
  const localAudio = meeting.source?.blob && (meeting.source.type.startsWith('audio/') || meeting.source.type.startsWith('video/')) ? meeting.source.blob : null;
  const audioUrl = useObjectUrl(localAudio ?? audioBlob);
  const requestedTab = searchParams.get('tab');
  const tab: RunTab = runTabs.find((item) => item.id === requestedTab)?.id ?? (reviewing ? 'tasks' : 'summary');
  const progress = useMemo(() => proposal ? reviewProgress(proposal) : { total: 0, decided: 0, blocking: 0 }, [proposal]);
  const blocking = useMemo(() => proposal && reviewing ? blockingAssignments(proposal) : [], [proposal, reviewing]);
  const pendingSpeakers = useMemo(() => proposal && reviewing ? unconfirmedSpeakers(proposal) : [], [proposal, reviewing]);

  function selectTab(next: RunTab) {
    setSearchParams((current) => { const params = new URLSearchParams(current); params.set('tab', next); return params; });
  }

  function edit(change: (current: Proposal) => Proposal) {
    if (!proposal || !reviewing) return;
    setDraft(change(proposal));
    setDirty(true);
    setNotice('');
  }

  function editAssignment(index: number, change: (item: AssignmentDraft) => AssignmentDraft) {
    edit((current) => ({ ...current, assignments: current.assignments.map((item, position) => position === index ? change(item) : item) }));
  }

  const review = {
    setStatus: (index: number, next: ReviewStatus) => editAssignment(index, (item) => setReviewStatus(item, next)),
    correct: (index: number, change: AssignmentEdit) => editAssignment(index, (item) => correctAssignment(item, change)),
    speaker: (label: string, name: string) => edit((current) => confirmSpeaker(current, label, name)),
    summary: (summary: string) => edit((current) => ({ ...current, summary })),
    decisions: (decisions: string[]) => edit((current) => ({ ...current, decisions })),
  };

  function fail(cause: unknown, fallback: string) {
    setActionError(message(cause, fallback));
    setStale(cause instanceof RunError && cause.stale);
  }

  async function refreshServer() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: runKeys.run(runId) }),
      queryClient.invalidateQueries({ queryKey: runKeys.sync }),
    ]);
  }

  async function save() {
    if (!runs || !proposal || !serverDraft) return;
    setBusy('save');
    setActionError('');
    try {
      const saved = await runs.saveProposal(runId, proposal, serverDraft.revision);
      queryClient.setQueryData(runKeys.run(runId), (current: typeof detail) => current ? { ...current, proposal: saved } : current);
      setDraft(saved);
      setDirty(false);
      setNotice(`Сохранена редакция ${saved.revision}.`);
    } catch (cause) { fail(cause, 'Не удалось сохранить черновик.'); }
    finally { setBusy(null); }
  }

  async function decide(approved: boolean, comment = ''): Promise<boolean> {
    if (!runs || !proposal || !serverDraft) return false;
    setBusy(approved ? 'approve' : 'reject');
    setActionError('');
    try {
      await runs.approve(runId, { approved, expectedRevision: serverDraft.revision, ...(dirty ? { proposal } : {}), comment });
      setDirty(false);
      setNotice(approved ? 'Протокол утверждён. Сервер формирует DOCX, PDF и реестр поручений.' : 'Протокол отклонён.');
      await refreshServer();
      if (approved) selectTab('tasks');
      return true;
    } catch (cause) {
      fail(cause, approved ? 'Не удалось утвердить протокол.' : 'Не удалось отклонить протокол.');
      return false;
    } finally { setBusy(null); }
  }

  async function reload() {
    setDirty(false);
    setActionError('');
    setStale(false);
    setNotice('');
    await query.refetch();
  }

  function discard() {
    setDirty(false);
    setDraft(serverDraft);
    setActionError('');
    setNotice('');
  }

  async function download(kind: 'docx' | 'pdf') {
    if (!runs) return;
    setBusy(kind);
    setActionError('');
    try { saveBlob(await runs.protocolFile(runId, kind), `Протокол — ${fileStem(meeting.title)}.${kind}`); }
    catch (cause) { fail(cause, `Не удалось скачать ${kind.toUpperCase()}.`); }
    finally { setBusy(null); }
  }

  async function loadAudio() {
    if (!runs || localAudio || audioBlob) return;
    setBusy('audio');
    setActionError('');
    try { setAudioBlob(await runs.audio(runId)); }
    catch (cause) { fail(cause, 'Не удалось загрузить запись.'); }
    finally { setBusy(null); }
  }

  /** Opens the transcript at a source line and plays it when the recording is loaded. */
  function showSource(segmentIndex: number) {
    const segment = proposal?.segments[segmentIndex];
    setFocusedSegment(segmentIndex);
    selectTab('transcript');
    if (segment) pendingSeek.current = segment.start;
  }

  useEffect(() => {
    if (tab !== 'transcript' || focusedSegment === null) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`run-segment-${focusedSegment}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const audio = audioRef.current;
      if (audio && pendingSeek.current !== null) {
        audio.currentTime = pendingSeek.current;
        void audio.play().catch(() => {});
      }
      pendingSeek.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, focusedSegment, audioUrl]);

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    void audio.play().catch(() => {});
  }

  return {
    runId, detail, status, reviewing, proposal, dirty, busy, actionError, setActionError, stale, notice, setNotice,
    loading: query.isPending, loadError: query.error ? message(query.error, 'Не удалось открыть встречу на сервере.') : null,
    tab, selectTab, progress, blocking, pendingSpeakers, review, save, decide, reload, discard, download,
    audioUrl, audioRef, canLoadAudio: Boolean(detail?.hasAudio) && !localAudio && !audioBlob, loadAudio, showSource, focusedSegment, seek,
    retry: () => query.refetch(),
  };
}
