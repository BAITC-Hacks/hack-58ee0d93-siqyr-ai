import type { Meeting, MeetingChanges, Person, Segment } from '../domain/meeting.types.ts';

export interface MeetingRepository {
  addMeeting(meeting: Meeting): Promise<void>;
  getMeeting(id: string): Promise<Meeting>;
  updateMeeting(id: string, changes: MeetingChanges): Promise<void>;
  replaceParticipants(id: string, participants: Person[]): Promise<void>;
  saveSegment(id: string, segment: Segment, replace: boolean): Promise<void>;
  deleteMeetingWithTasks(id: string): Promise<void>;
}
