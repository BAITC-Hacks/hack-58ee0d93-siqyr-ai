import type { Meeting, Person, Segment } from '../../../modules/meetings/domain/meeting.types.ts';
import type { Task } from '../../../modules/tasks/domain/task.types.ts';
import content from './demo-content.json';

interface SourceMeeting {
  number: number;
  title: string;
  organization: string;
  transcript: Omit<Segment, 'id'>[];
  summaryBlocks: Array<{ type: string; text?: string }>;
  assignments: Array<{ task: string; assignee: string; deadlineRaw: string }>;
}

export function demoRecords(): { meetings: Meeting[]; tasks: Task[] } {
  const meetings: Meeting[] = [];
  const tasks: Task[] = [];

  for (const source of content satisfies SourceMeeting[]) {
    const meetingId = `example-${source.number}`;
    const people = new Map<string, Person>();
    const transcript = source.transcript.map((turn, index): Segment => {
      if (!people.has(turn.speaker)) {
        people.set(turn.speaker, {
          id: `${meetingId}-person-${people.size + 1}`,
          name: turn.speaker,
          role: turn.role,
        });
      }
      return { ...turn, id: `${meetingId}-segment-${index + 1}` };
    });

    meetings.push({
      id: meetingId,
      title: source.title,
      organization: source.organization,
      date: null,
      language: 'ru',
      kind: 'example',
      status: 'ready',
      summary: source.summaryBlocks
        .filter((block) => block.type === 'paragraph' && block.text)
        .map((block) => block.text)
        .join('\n\n'),
      participants: [...people.values()],
      transcript,
      createdAt: new Date().toISOString(),
      number: source.number,
    });

    source.assignments.forEach((assignment, index) => {
      tasks.push({
        id: `${meetingId}-task-${index + 1}`,
        meetingId,
        title: assignment.task,
        assignee: assignment.assignee,
        deadlineText: assignment.deadlineRaw,
        dueDate: null,
        status: 'todo',
        note: '',
      });
    });
  }

  return { meetings, tasks };
}
