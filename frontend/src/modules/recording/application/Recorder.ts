export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finishing' | 'complete';

export interface RecorderSnapshot {
  status: RecorderStatus;
  blob: Blob | null;
  elapsedMs: number;
  error: string;
}

export interface Recorder {
  getSnapshot(): RecorderSnapshot;
  getIsActive(): boolean;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  discard(): void;
}
