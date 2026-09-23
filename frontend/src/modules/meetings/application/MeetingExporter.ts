import type { Task } from '../../tasks/domain/task.types.ts';
import type { Meeting } from '../domain/meeting.types.ts';

export interface MeetingExporter {
  download(meeting: Meeting, tasks: Task[], includeTranscript?: boolean): Promise<void>;
  print(meeting: Meeting, tasks: Task[], includeTranscript?: boolean): void;
}
