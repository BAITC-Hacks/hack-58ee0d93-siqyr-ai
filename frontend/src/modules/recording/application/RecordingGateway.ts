import type { MeetingLanguage } from '../../meetings/domain/meeting.types.ts';

export interface RecordingRunInput {
  title: string;
  date: string | null;
  language: MeetingLanguage;
}

export interface RunStep {
  seq: number;
  content: string;
}

export interface RunProgress {
  status: string;
  steps: RunStep[];
}

/** Server run that receives the microphone stream while the meeting is still being recorded. */
export interface RecordingGateway {
  create(input: RecordingRunInput): Promise<string>;
  /** Appends a chunk at the byte offset the server confirmed last and returns the new offset. */
  sendChunk(runId: string, chunk: Blob, offset: number): Promise<number>;
  finish(runId: string): Promise<void>;
  watch(runId: string, onProgress: (progress: RunProgress) => void, onError: (message: string) => void): () => void;
}
