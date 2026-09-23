import type { Identity } from '../../../shared/domain/Identity.ts';
import { MeetingRecord } from '../domain/MeetingRecord.ts';
import type { CreateMeetingInput, MeetingChanges, SegmentInput } from '../domain/meeting.types.ts';
import type { MeetingRepository } from './MeetingRepository.ts';

export class MeetingService {
  private readonly repository: MeetingRepository;
  private readonly identity: Identity;

  constructor(repository: MeetingRepository, identity: Identity) {
    this.repository = repository;
    this.identity = identity;
  }

  create = async (input: CreateMeetingInput): Promise<string> => {
    const meeting = MeetingRecord.create(input, this.identity).toSnapshot();
    await this.repository.addMeeting(meeting);
    return meeting.id;
  };

  update = async (id: string, changes: MeetingChanges): Promise<void> => {
    const current = await this.repository.getMeeting(id);
    const normalized = new MeetingRecord(current).change(changes).toSnapshot();
    const patch: MeetingChanges = {};
    if (changes.title !== undefined) patch.title = normalized.title;
    if (changes.organization !== undefined) patch.organization = normalized.organization;
    if (changes.date !== undefined) patch.date = normalized.date;
    if (changes.language !== undefined) patch.language = normalized.language;
    if (changes.summary !== undefined) patch.summary = normalized.summary;
    await this.repository.updateMeeting(id, patch);
  };

  saveParticipants = async (id: string, text: string): Promise<void> => {
    const current = await this.repository.getMeeting(id);
    const { participants } = new MeetingRecord(current).withParticipants(text, this.identity).toSnapshot();
    await this.repository.replaceParticipants(id, participants);
  };

  saveSegment = async (id: string, input: SegmentInput): Promise<void> => {
    const current = await this.repository.getMeeting(id);
    const segmentId = input.id || this.identity.nextId();
    const normalized = new MeetingRecord(current).withSegment(input, { nextId: () => segmentId, now: () => this.identity.now() }).toSnapshot();
    const segment = normalized.transcript.find((item) => item.id === segmentId);
    if (!segment) throw new Error('Normalized transcript segment is missing.');
    await this.repository.saveSegment(id, segment, Boolean(input.id));
  };

  remove = (id: string): Promise<void> => this.repository.deleteMeetingWithTasks(id);
}
