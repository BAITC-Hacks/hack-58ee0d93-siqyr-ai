import { formatDate } from '@/shared/lib/formatDate';
import { Autocomplete, Button, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { Check, CircleSlash, Pencil, Play, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { clock, needsReview, reviewReasonLabels, reviewStatusLabels, type AssignmentEdit } from '../domain/review';
import type { AssignmentDraft, Evidence, ReviewStatus, RunSegment } from '../domain/run.types';
import styles from './RunMeetingPage.module.css';

const fieldLabels = { task: 'задача', assignee: 'ответственный', deadline: 'срок', context: 'контекст' } as const;

interface AssignmentReviewProps {
  item: AssignmentDraft;
  index: number;
  segments: RunSegment[];
  speakerOf: (segmentIndex: number) => string;
  editable: boolean;
  people: string[];
  onStatus: (index: number, status: ReviewStatus) => void;
  onCorrect: (index: number, edit: AssignmentEdit) => void;
  onSource: (segmentIndex: number) => void;
}

export function AssignmentReview({ item, index, segments, speakerOf, editable, people, onStatus, onCorrect, onSource }: AssignmentReviewProps) {
  const [editing, setEditing] = useState(false);
  const excluded = item.review_status === 'excluded';
  const open = needsReview(item);
  const quotes: Evidence[] = item.evidence.length ? item.evidence : item.source_segments.map((segment) => ({ segment_index: segment, quote: segments[segment]?.text ?? '', field: 'context' }));
  const deadlineCandidates = [...new Set(item.deadline_candidates ?? [])];
  const ownerCandidates = [...new Set(item.assignee_candidates ?? [])];

  return <article className={`${styles.card} ${open ? styles.cardOpen : ''} ${excluded ? styles.cardExcluded : ''}`} aria-label={`Поручение ${index + 1}`}>
    <div className={styles.cardTop}>
      <span className={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</span>
      <span className={`${styles.reviewBadge} ${styles[`review_${item.review_status}`]}`}>{reviewStatusLabels[item.review_status]}</span>
      {open && <span className={styles.openBadge}>Нужно решение</span>}
    </div>
    <p className={styles.cardTask}>{item.task}</p>
    <dl className={styles.cardFacts}>
      <div><dt>Ответственный</dt><dd>{item.assignee || <span className={styles.missing}>Не указан</span>}</dd></div>
      <div><dt>Срок</dt><dd>{item.deadline ? formatDate(item.deadline) : <span className={styles.missing}>Без точной даты</span>}{item.deadline_text && <small>«{item.deadline_text}»</small>}</dd></div>
    </dl>
    {item.review_reasons.length > 0 && <div className={styles.reasons}>{item.review_reasons.map((reason) => <span key={reason}>{reviewReasonLabels[reason] ?? reason}</span>)}</div>}
    {(ownerCandidates.length > 1 || deadlineCandidates.length > 1) && <div className={styles.candidates}>
      {ownerCandidates.length > 1 && <span>Названы исполнители: {ownerCandidates.join(', ')}</span>}
      {deadlineCandidates.length > 1 && <span>Названы сроки: {deadlineCandidates.map((value) => `«${value}»`).join(', ')}</span>}
    </div>}
    {quotes.length > 0 && <ul className={styles.evidence} aria-label="Источники в записи">
      {quotes.map((evidence, position) => {
        const segment = segments[evidence.segment_index];
        return <li key={`${evidence.segment_index}-${position}`}>
          <button type="button" onClick={() => onSource(evidence.segment_index)} title="Открыть реплику в расшифровке">
            <Play size={11} /> {clock(segment?.start ?? evidence.start)}
          </button>
          <span><strong>{speakerOf(evidence.segment_index)}</strong>{evidence.field && evidence.field !== 'context' ? ` · ${fieldLabels[evidence.field]}` : ''}: «{evidence.quote}»</span>
        </li>;
      })}
    </ul>}
    {item.review_note && <p className={styles.note}>Комментарий секретаря: {item.review_note}</p>}
    {editable && <Group gap="xs" className={styles.cardActions}>
      {excluded ? <Button size="xs" variant="default" leftSection={<RotateCcw size={14} />} onClick={() => onStatus(index, 'unreviewed')}>Вернуть в протокол</Button> : <>
        <Button size="xs" variant={item.review_status === 'confirmed' ? 'filled' : 'light'} leftSection={<Check size={14} />} onClick={() => onStatus(index, 'confirmed')}
          disabled={item.review_reasons.includes('deadline_conflict') || item.review_reasons.includes('evidence_missing')}
          title={item.review_reasons.includes('deadline_conflict') ? 'Выберите один срок через «Исправить»' : undefined}>Подтвердить</Button>
        <Button size="xs" variant="default" leftSection={<Pencil size={14} />} onClick={() => setEditing(true)}>Исправить</Button>
        <Button size="xs" variant="subtle" color="red" leftSection={<CircleSlash size={14} />} onClick={() => onStatus(index, 'excluded')}>Исключить</Button>
      </>}
    </Group>}
    <AssignmentEditor opened={editing} item={item} people={[...new Set([...people, ...ownerCandidates])]} deadlineCandidates={deadlineCandidates}
      onClose={() => setEditing(false)} onSave={(edit) => { onCorrect(index, edit); setEditing(false); }} />
  </article>;
}

function AssignmentEditor({ opened, item, people, deadlineCandidates, onClose, onSave }: {
  opened: boolean; item: AssignmentDraft; people: string[]; deadlineCandidates: string[]; onClose: () => void; onSave: (edit: AssignmentEdit) => void;
}) {
  const [values, setValues] = useState<AssignmentEdit>({ task: '', assignee: '', deadlineText: '', deadline: null, note: '' });
  useEffect(() => {
    if (opened) setValues({ task: item.task, assignee: item.assignee ?? '', deadlineText: item.deadline_text ?? '', deadline: item.deadline, note: item.review_note ?? '' });
  }, [opened, item]);
  const conflict = deadlineCandidates.length > 1;

  return <Modal opened={opened} onClose={onClose} title="Исправить поручение" size="lg" centered>
    <Stack gap="md">
      <Textarea label="Поручение" autosize minRows={2} required value={values.task} onChange={(event) => setValues({ ...values, task: event.currentTarget.value })} />
      <Autocomplete label="Ответственный" description="Участник, отдел или внешний исполнитель; пусто — не указан" data={people} value={values.assignee} onChange={(assignee) => setValues({ ...values, assignee })} />
      <TextInput label="Срок, как его сказали" description={conflict ? 'Названо несколько сроков: выберите один, иначе протокол не утвердить' : 'Формулировка из записи сохраняется в протоколе'}
        value={values.deadlineText} onChange={(event) => setValues({ ...values, deadlineText: event.currentTarget.value })} error={conflict && !deadlineCandidates.includes(values.deadlineText.trim()) && !values.deadlineText.trim() ? 'Выберите срок' : undefined} />
      {conflict && <Group gap="xs">{deadlineCandidates.map((candidate) => <Button key={candidate} size="compact-sm" variant={values.deadlineText === candidate ? 'filled' : 'light'} onClick={() => setValues({ ...values, deadlineText: candidate })}>{candidate}</Button>)}</Group>}
      <DatePickerInput label="Точная дата" description="Для реестра, напоминаний и Jira" placeholder="Выберите дату" locale="ru" valueFormat="DD.MM.YYYY" clearable
        value={values.deadline} onChange={(deadline) => setValues({ ...values, deadline: deadline || null })} />
      <Textarea label="Комментарий секретаря" autosize minRows={2} value={values.note} onChange={(event) => setValues({ ...values, note: event.currentTarget.value })} />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>Отмена</Button>
        <Button disabled={!values.task.trim()} onClick={() => onSave(values)}>Сохранить в черновике</Button>
      </Group>
    </Stack>
  </Modal>;
}
