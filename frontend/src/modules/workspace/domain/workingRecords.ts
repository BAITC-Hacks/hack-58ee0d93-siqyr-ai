import type { Meeting } from '../../meetings/domain/meeting.types.ts';
import type { Task } from '../../tasks/domain/task.types.ts';

export function workingRecords(meetings: readonly Meeting[], tasks: readonly Task[]) {
  const includedMeetings = meetings.filter((meeting) => meeting.kind === 'local');
  const includedIds = new Set(includedMeetings.map((meeting) => meeting.id));
  return {
    meetings: includedMeetings,
    tasks: tasks.filter((task) => includedIds.has(task.meetingId)),
  };
}
