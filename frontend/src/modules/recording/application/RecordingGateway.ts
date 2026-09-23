import type { MeetingLanguage } from '../../meetings/domain/meeting.types.ts';
import type { SourceLimits } from '../../meetings/domain/mediaSource.ts';
import type { ParticipantLine } from '../../meetings/domain/participantLines.ts';

export interface RecordingRunInput {
  title: string;
  date: string | null;
  language: MeetingLanguage;
  /** Names the server maps diarized voices to; they are hints, not a count of voices. */
  participants?: ParticipantLine[];
}

export interface RunStep {
  seq: number;
  content: string;
}

export interface RunProgress {
  status: string;
  steps: RunStep[];
}

export interface UploadFormats extends SourceLimits {
  /** Value for the file input's accept attribute. */
  accept: string;
}

/** Server run for a meeting recording: streamed from the microphone or uploaded as a finished file. */
export interface RecordingGateway {
  create(input: RecordingRunInput): Promise<string>;
  /** Appends a chunk at the byte offset the server confirmed last and returns the new offset. */
  sendChunk(runId: string, chunk: Blob, offset: number): Promise<number>;
  /** Replaces the whole participant list; the server accepts it only until the recording is finished. */
  updateParticipants(runId: string, participants: ParticipantLine[]): Promise<void>;
  finish(runId: string): Promise<void>;
  /** Sends a recording file; the server checks its format and queues it for recognition. */
  upload(input: RecordingRunInput, file: File): Promise<string>;
  formats(): Promise<UploadFormats>;
  watch(runId: string, onProgress: (progress: RunProgress) => void, onError: (message: string) => void): () => void;
}
