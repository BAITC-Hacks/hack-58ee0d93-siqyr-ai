import { Alert, Badge, Button, Group, Loader, Paper, Select, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { Check, Download, ExternalLink, FileText, Save, Send, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';
import type { AssignmentDraft, JiraIssue, Proposal, ReviewStatus, RunDetail } from '../application/ProtocolGateway.ts';

const statusLabel: Record<string, string> = {
  recording: 'Идёт запись', queued: 'В очереди', transcribing: 'Распознавание речи', running: 'Подготовка черновика',
  awaiting_approval: 'Ждёт утверждения секретарём', executing: 'Формирование файлов', done: 'Утверждён', error: 'Ошибка обработки', rejected: 'Отклонён',
};
const reasonLabel: Record<string, string> = {
  owner_uncertain: 'исполнитель не ясен', deadline_conflict: 'конфликт сроков', deadline_unknown: 'срок не определён',
  evidence_missing: 'нет источника', speaker_uncertain: 'голос не подтверждён', overlap: 'наложение голосов',
  audio_protocol_mismatch: 'расхождение с аудио', scope_incomplete: 'действие неполное',
};
const reviewOptions: { value: ReviewStatus; label: string }[] = [
  { value: 'unreviewed', label: 'Не проверено' }, { value: 'confirmed', label: 'Подтверждено' },
  { value: 'corrected', label: 'Исправлено' }, { value: 'excluded', label: 'Исключено' },
];
const settled = new Set(['awaiting_approval', 'done', 'error', 'rejected']);

function clock(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ServerProtocolPanel({ runId, className }: { runId: string; className?: string }) {
  const { protocols } = useServices();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [draft, setDraft] = useState<Proposal | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<JiraIssue[]>([]);

  const load = useCallback(async () => {
    if (!protocols) return null;
    const next = await protocols.run(runId);
    setDetail(next);
    return next;
  }, [protocols, runId]);

  useEffect(() => {
    if (!protocols) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await load();
        if (!active || !next) return;
        setDraft((current) => (current && current.revision === next.proposal?.revision && next.status === 'awaiting_approval') ? current : next.proposal && structuredClone(next.proposal));
        if (!settled.has(next.status)) timer = setTimeout(tick, 2_500);
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить протокол.'); timer = setTimeout(tick, 5_000); }
      }
    };
    void tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [protocols, load]);

  if (!protocols) return null;
  const status = detail?.status ?? 'queued';
  const editable = status === 'awaiting_approval';
  const speakerName = (label: string | null) => (label && draft?.speakers[label]) || label || 'голос не определён';

  function change(update: (proposal: Proposal) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      update(next);
      return next;
    });
    setDirty(true);
  }

  function editAssignment(index: number, patch: Partial<AssignmentDraft>, corrected = true) {
    change((proposal) => {
      const item = proposal.assignments[index];
      if (!item) return;
      Object.assign(item, patch);
      if (corrected && item.review_status !== 'excluded') item.review_status = 'corrected';
      if ('deadline' in patch) item.deadline_candidates = [];
    });
  }

  async function act(label: string, operation: () => Promise<void>) {
    setBusy(label);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция не выполнена.'); }
    finally { setBusy(''); }
  }

  const saveDraft = () => act('save', async () => {
    if (!draft || !protocols) return;
    const saved = await protocols.save(runId, draft);
    setDraft(structuredClone(saved));
    setDirty(false);
    setNotice(`Правки сохранены, редакция ${saved.revision}.`);
  });

  const decide = (approved: boolean) => act(approved ? 'approve' : 'reject', async () => {
    if (!draft || !protocols) return;
    const next = await protocols.approve(runId, draft, approved);
    setDirty(false);
    setNotice(approved ? 'Протокол утверждён. Формируем DOCX/PDF и реестр поручений…' : 'Протокол отклонён.');
    setDetail((current) => current && { ...current, status: next });
    const poll = async (attempt: number) => {
      const fresh = await load();
      if (fresh?.proposal) setDraft(structuredClone(fresh.proposal));
      if (fresh && !settled.has(fresh.status) && attempt < 40) setTimeout(() => void poll(attempt + 1), 1_500);
    };
    await poll(0);
  });

  const download = (kind: 'docx' | 'pdf') => act(kind, async () => {
    if (!protocols) return;
    save(await protocols.download(runId, kind), `Протокол ${detail?.title || runId}.${kind}`);
  });

  const toJira = () => act('jira', async () => {
    if (!protocols) return;
    const created = await protocols.jira(runId);
    setIssues(created);
    setNotice(created.length ? `Задачи в Jira: ${created.map((issue) => issue.key).join(', ')}` : 'Новых задач для Jira нет.');
  });

  const assignments = draft?.assignments ?? [];
  const pendingSpeakers = (draft?.speaker_records ?? []).filter((record) => record.participant_name && record.mapping_status !== 'confirmed');

  return <Paper withBorder radius="md" p="lg" className={className}>
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" c="dimmed" fw={600}>ПРОТОКОЛ С СЕРВЕРА · СВОДКА, ПОРУЧЕНИЯ, УТВЕРЖДЕНИЕ</Text>
          <Title order={3}>{detail?.title || 'Протокол встречи'}</Title>
        </div>
        <Group gap="xs">
          <Badge variant="light" color={status === 'done' ? 'teal' : status === 'error' || status === 'rejected' ? 'red' : 'blue'}>{statusLabel[status] ?? status}</Badge>
          {detail && <Badge variant="outline" color={detail.sourceMode === 'real' ? 'teal' : 'gray'}>{detail.sourceMode === 'real' ? 'локальные модели' : detail.sourceMode}</Badge>}
          {draft && <Badge variant="outline" color="gray">редакция {draft.revision}</Badge>}
        </Group>
      </Group>

      {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert color="teal" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
      {!detail && <Group gap="xs"><Loader size="xs" /><Text size="sm">Загружаем протокол…</Text></Group>}
      {detail && !draft && !settled.has(status) && <Group gap="xs"><Loader size="xs" /><Text size="sm">Черновик появится после распознавания и разбора поручений.</Text></Group>}

      {draft && <>
        <section>
          <Title order={5} mb={6}>Краткое содержание</Title>
          {editable
            ? <Textarea autosize minRows={3} value={draft.summary} onChange={(event) => { const value = event.currentTarget.value; change((proposal) => { proposal.summary = value; }); }} aria-label="Краткое содержание" />
            : <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{draft.summary || 'Не заполнено'}</Text>}
        </section>

        {draft.decisions.length > 0 && <section>
          <Title order={5} mb={6}>Решения</Title>
          <ol style={{ margin: 0, paddingLeft: 20 }}>{draft.decisions.map((decision, index) => <li key={index}><Text size="sm">{decision}</Text></li>)}</ol>
        </section>}

        {(draft.speaker_records.length > 0 || Object.keys(draft.speakers).length > 0) && <section>
          <Title order={5} mb={6}>Говорящие (диаризация)</Title>
          <Group gap="xs">
            {(draft.speaker_records.length ? draft.speaker_records : Object.entries(draft.speakers).map(([label, name]) => ({ label, participant_name: name, mapping_status: 'suggested' as const, source_segments: [] }))).map((record) =>
              <Badge key={record.label} size="lg" variant={record.mapping_status === 'confirmed' ? 'filled' : 'light'} color={record.participant_name ? 'blue' : 'gray'}
                rightSection={editable && record.participant_name && record.mapping_status !== 'confirmed'
                  ? <Check size={14} style={{ cursor: 'pointer' }} aria-label={`Подтвердить ${record.participant_name}`} onClick={() => change((proposal) => { const target = proposal.speaker_records.find((item) => item.label === record.label); if (target) target.mapping_status = 'confirmed'; })} />
                  : undefined}>
                {record.label} → {record.participant_name || 'не определён'}{record.mapping_status === 'confirmed' ? ' ✓' : ''}
              </Badge>)}
          </Group>
          {editable && pendingSpeakers.length > 0 && <Button mt={8} size="xs" variant="light" onClick={() => change((proposal) => { proposal.speaker_records.forEach((record) => { if (record.participant_name) record.mapping_status = 'confirmed'; }); })}>Подтвердить всех говорящих</Button>}
        </section>}

        <section>
          <Group justify="space-between" mb={6}>
            <Title order={5}>Поручения ({assignments.filter((item) => item.review_status !== 'excluded').length})</Title>
            {editable && assignments.length > 0 && <Button size="xs" variant="light" onClick={() => change((proposal) => { proposal.assignments.forEach((item) => { if (item.review_status === 'unreviewed') item.review_status = 'confirmed'; }); })}>Подтвердить все непроверенные</Button>}
          </Group>
          {assignments.length === 0 ? <Text size="sm" c="dimmed">Поручений не найдено.</Text> :
            <div style={{ overflowX: 'auto' }}><Table withTableBorder verticalSpacing="xs" style={{ minWidth: 820 }}>
              <Table.Thead><Table.Tr><Table.Th>№</Table.Th><Table.Th>Суть</Table.Th><Table.Th>Ответственный</Table.Th><Table.Th>Срок</Table.Th><Table.Th>Источник в записи</Table.Th><Table.Th>Проверка</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{assignments.map((item, index) => {
                const quote = item.evidence[0];
                const excluded = item.review_status === 'excluded';
                return <Table.Tr key={index} style={excluded ? { opacity: 0.5 } : undefined}>
                  <Table.Td>{index + 1}</Table.Td>
                  <Table.Td style={{ minWidth: 220 }}>{editable ? <Textarea autosize minRows={1} size="xs" value={item.task} onChange={(event) => editAssignment(index, { task: event.currentTarget.value })} aria-label={`Суть поручения ${index + 1}`} /> : <Text size="sm">{item.task}</Text>}</Table.Td>
                  <Table.Td style={{ minWidth: 150 }}>{editable ? <TextInput size="xs" value={item.assignee ?? ''} placeholder="Не указан" onChange={(event) => editAssignment(index, { assignee: event.currentTarget.value.trim() ? event.currentTarget.value : null })} aria-label={`Ответственный ${index + 1}`} /> : <Text size="sm">{item.assignee || 'Не указан'}</Text>}
                    {(item.assignee_candidates?.length ?? 0) > 0 && <Text size="xs" c="dimmed">варианты: {item.assignee_candidates?.join(', ')}</Text>}</Table.Td>
                  <Table.Td style={{ minWidth: 140 }}>{editable ? <TextInput size="xs" type="date" value={item.deadline ?? ''} onChange={(event) => editAssignment(index, { deadline: event.currentTarget.value || null })} aria-label={`Срок ${index + 1}`} /> : <Text size="sm">{item.deadline || 'Не указан'}</Text>}
                    {item.deadline_text && <Text size="xs" c="dimmed">«{item.deadline_text}»</Text>}
                    {item.deadline_candidates.length > 1 && <Text size="xs" c="orange">варианты: {item.deadline_candidates.join(' / ')}</Text>}</Table.Td>
                  <Table.Td style={{ maxWidth: 260 }}>{quote ? <Text size="xs"><b>{clock(quote.start)}</b> {speakerName(draft.segments[quote.segment_index]?.speaker ?? null)}: «{quote.quote}»</Text> : <Text size="xs" c="dimmed">—</Text>}</Table.Td>
                  <Table.Td style={{ minWidth: 170 }}>
                    <Group gap={4} mb={4}>{item.review_reasons.map((reason) => <Badge key={reason} size="xs" color="orange" variant="light">{reasonLabel[reason] ?? reason}</Badge>)}</Group>
                    {editable
                      ? <Group gap={4} wrap="nowrap">
                          <Select size="xs" w={130} data={reviewOptions} value={item.review_status} onChange={(value) => value && editAssignment(index, { review_status: value as ReviewStatus }, false)} aria-label={`Статус проверки ${index + 1}`} />
                          {!excluded && <Button size="compact-xs" variant="subtle" color="red" onClick={() => editAssignment(index, { review_status: 'excluded' }, false)} aria-label={`Исключить ${index + 1}`}><X size={14} /></Button>}
                        </Group>
                      : <Text size="xs">{reviewOptions.find((option) => option.value === item.review_status)?.label}</Text>}
                  </Table.Td>
                </Table.Tr>;
              })}</Table.Tbody>
            </Table></div>}
        </section>

        <details>
          <summary style={{ cursor: 'pointer' }}><b>Расшифровка с говорящими</b> · {(detail?.segments.length ? detail.segments : draft.segments).length} реплик</summary>
          <Stack gap={4} mt={8}>{(detail?.segments.length ? detail.segments : draft.segments).map((segment, index) =>
            <Text key={index} size="sm"><Text span c="dimmed" size="xs">{clock(segment.start)} </Text><b>{speakerName(segment.speaker)}</b>{segment.lang ? <Text span c="dimmed" size="xs"> [{segment.lang}]</Text> : null}: {segment.corrected_text || segment.text}</Text>)}</Stack>
        </details>
      </>}

      <Group gap="sm">
        {editable && draft && <>
          <Button leftSection={<Save size={16} />} variant="default" disabled={!dirty} loading={busy === 'save'} onClick={saveDraft}>Сохранить правки</Button>
          <Button leftSection={<Check size={16} />} color="teal" loading={busy === 'approve'} onClick={() => decide(true)}>Утвердить протокол</Button>
          <Button leftSection={<X size={16} />} variant="subtle" color="red" loading={busy === 'reject'} onClick={() => decide(false)}>Отклонить</Button>
        </>}
        {status === 'done' && <>
          <Button leftSection={<Download size={16} />} loading={busy === 'docx'} onClick={() => download('docx')}>Скачать DOCX</Button>
          <Button leftSection={<FileText size={16} />} variant="default" loading={busy === 'pdf'} onClick={() => download('pdf')}>Скачать PDF</Button>
          <Button leftSection={<Send size={16} />} variant="light" loading={busy === 'jira'} onClick={toJira}>Создать задачи в Jira</Button>
        </>}
      </Group>
      {issues.length > 0 && <Group gap="xs">{issues.map((issue) => <Button key={issue.key} component="a" href={issue.url} target="_blank" rel="noreferrer" size="compact-sm" variant="subtle" rightSection={<ExternalLink size={13} />}>{issue.key}</Button>)}</Group>}
    </Stack>
  </Paper>;
}
