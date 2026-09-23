export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finishing' | 'complete';

export interface RecorderSnapshot {
  status: RecorderStatus;
  blob: Blob | null;
  elapsedMs: number;
  error: string;
}

/** Receives each chunk in order while recording; a rejected chunk stops the recording. */
export type RecordingSink = (chunk: Blob) => Promise<void>;

export interface Recorder {
  getSnapshot(): RecorderSnapshot;
  getIsActive(): boolean;
  subscribe(listener: () => void): () => void;
  start(sink?: RecordingSink): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Resolves after stop once every chunk reached the sink; rejects with the sink error. */
  drain(): Promise<void>;
  discard(): void;
}
