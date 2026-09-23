import { Autocomplete, Button } from '@mantine/core';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { voiceLabel } from '../domain/review';
import type { Proposal, SpeakerRecord } from '../domain/run.types';
import styles from './RunMeetingPage.module.css';

const mappingLabels: Record<SpeakerRecord['mapping_status'], string> = { confirmed: 'Подтверждено', suggested: 'Предложено ИИ', unmapped: 'Не сопоставлен' };

function SpeakerRow({ record, name, people, editable, pending, onConfirm }: {
  record: SpeakerRecord; name: string; people: string[]; editable: boolean; pending: boolean; onConfirm: (label: string, name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const changed = value.trim() !== name;
  return <div className={`${styles.speaker} ${pending ? styles.speakerPending : ''}`}>
    <div className={styles.speakerVoice}><strong>{voiceLabel(record.label)}</strong><small>{record.source_segments.length} реплик</small></div>
    {editable ? <Autocomplete aria-label={`Участник для ${voiceLabel(record.label)}`} placeholder="Кто говорит" data={people} value={value} onChange={setValue} className={styles.speakerInput} />
      : <span className={styles.speakerName}>{name || 'Не сопоставлен'}</span>}
    <span className={`${styles.mapping} ${styles[`mapping_${record.mapping_status}`]}`}>{mappingLabels[record.mapping_status]}</span>
    {editable && (changed || record.mapping_status !== 'confirmed') && <Button size="compact-sm" variant={pending ? 'filled' : 'light'} leftSection={<Check size={13} />}
      disabled={!value.trim() && record.mapping_status === 'unmapped'} onClick={() => onConfirm(record.label, value)}>Подтвердить</Button>}
  </div>;
}

/** Voice-to-person links: the server refuses approval while an assignment relies on an unconfirmed one. */
export function SpeakerReview({ proposal, people, editable, pending, onConfirm }: {
  proposal: Proposal; people: string[]; editable: boolean; pending: string[]; onConfirm: (label: string, name: string) => void;
}) {
  if (!proposal.speaker_records.length) return null;
  return <section className={styles.speakers} aria-label="Голоса и участники">
    <div className={styles.blockTitle}><strong>Голоса и участники</strong><span>Диаризация делит запись на голоса; связь с человеком подтверждает секретарь.</span></div>
    {proposal.speaker_records.map((record) => <SpeakerRow key={record.label} record={record} name={proposal.speakers[record.label] ?? record.participant_name ?? ''}
      people={[...new Set([...people, ...(record.candidate_names ?? [])])]} editable={editable} pending={pending.includes(record.label)} onConfirm={onConfirm} />)}
  </section>;
}
