import { DomainError } from '../../../shared/domain/DomainError.ts';
import type { Identity } from '../../../shared/domain/Identity.ts';
import { parseLocalDate } from '../../../shared/domain/LocalDate.ts';
import { isMeetingLanguage, type CreateMeetingInput, type Meeting, type MeetingChanges, type Person, type SegmentInput } from './meeting.types.ts';

export class MeetingRecord {
  private readonly data: Meeting;

  constructor(data: Meeting) {
    this.data = structuredClone(data);
  }

  static create(input: CreateMeetingInput, identity: Identity): MeetingRecord {
    return new MeetingRecord({
      ...input, id: identity.nextId(), createdAt: identity.now().toISOString(),
      title: input.title.trim(), organization: input.organization.trim(),
      kind: 'local', status: input.source ? 'pending' : 'draft',
      summary: '', participants: [], transcript: [],
    }).change({});
  }

  change(changes: MeetingChanges): MeetingRecord {
    const next = { ...this.data };
    // Explicit fields keep persistence identity and workflow state outside edit commands.
    if (changes.title !== undefined) next.title = changes.title.trim();
    if (changes.organization !== undefined) next.organization = changes.organization.trim();
    if (changes.date !== undefined) next.date = changes.date;
    if (changes.language !== undefined) next.language = changes.language;
    if (changes.summary !== undefined) next.summary = changes.summary.trim();
    if (!next.title) throw new DomainError('Укажите тему встречи.');
    if (!isMeetingLanguage(next.language)) throw new DomainError('Выберите язык встречи.');
    if (next.date !== null && !parseLocalDate(next.date)) throw new DomainError('Укажите корректную дату встречи.');
    return new MeetingRecord(next);
  }

  withParticipants(text: string, identity: Identity): MeetingRecord {
    const participants: Person[] = text.split('\n').map((line, index) => {
      const [name, ...role] = line.split(/\s+[—–-]\s+/);
      return { id: this.data.participants[index]?.id ?? identity.nextId(), name: name?.trim() ?? '', role: role.join(' — ').trim() };
    }).filter((person) => person.name);
    return new MeetingRecord({ ...this.data, participants });
  }

  withSegment(input: SegmentInput, identity: Identity): MeetingRecord {
    if (!input.speaker.trim() || !input.text.trim()) throw new DomainError('Укажите говорящего и текст реплики.');
    if (input.id && !this.data.transcript.some((segment) => segment.id === input.id)) throw new DomainError('Реплика не найдена.');
    const next = { id: input.id || identity.nextId(), speaker: input.speaker.trim(), role: input.role.trim(), text: input.text.trim(), section: input.section?.trim() || undefined };
    const transcript = input.id ? this.data.transcript.map((segment) => segment.id === input.id ? next : segment) : [...this.data.transcript, next];
    return new MeetingRecord({ ...this.data, transcript });
  }

  toSnapshot(): Meeting {
    return structuredClone(this.data);
  }
}
