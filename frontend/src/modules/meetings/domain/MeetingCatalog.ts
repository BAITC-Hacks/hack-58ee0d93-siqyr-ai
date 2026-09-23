import type { Meeting, MeetingKind, MeetingStatus } from './meeting.types.ts';

export interface MeetingFilters { search: string; kind: 'all' | MeetingKind; status: 'all' | MeetingStatus }

export function filterMeetings(meetings: readonly Meeting[], { search, kind, status }: MeetingFilters): Meeting[] {
  const needle = search.trim().toLocaleLowerCase('ru');
  return meetings.filter((meeting) => {
    if (kind !== 'all' && meeting.kind !== kind) return false;
    if (status !== 'all' && meeting.status !== status) return false;
    const content = [meeting.title, meeting.organization, meeting.summary, ...meeting.participants.map((person) => person.name)].join(' ').toLocaleLowerCase('ru');
    return !needle || content.includes(needle);
  }).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'local' ? -1 : 1;
    if (left.kind === 'example') return (left.number ?? 0) - (right.number ?? 0);
    return right.createdAt.localeCompare(left.createdAt);
  });
}
