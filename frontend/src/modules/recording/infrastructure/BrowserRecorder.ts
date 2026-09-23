import type { Recorder, RecorderSnapshot } from '../application/Recorder.ts';

const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
const emptySnapshot = (): RecorderSnapshot => ({ status: 'idle', blob: null, elapsedMs: 0, error: '' });

export interface RecorderPlatform {
  supported(): boolean;
  requestStream(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): MediaRecorder;
  now(): number;
}

const browserPlatform: RecorderPlatform = {
  supported: () => typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined',
  requestStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createRecorder: (stream) => {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type));
    return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  },
  now: () => Date.now(),
};

export class BrowserRecorder implements Recorder {
  private readonly platform: RecorderPlatform;
  private snapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private recordedMs = 0;
  private requestId = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(platform: RecorderPlatform = browserPlatform) { this.platform = platform; }

  getSnapshot = (): RecorderSnapshot => this.snapshot;
  getIsActive = (): boolean => ['requesting', 'recording', 'paused', 'finishing'].includes(this.snapshot.status);
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start = async (): Promise<void> => {
    this.discard();
    if (!this.platform.supported()) {
      this.publish({ error: 'Запись с микрофона не поддерживается в этом браузере. Загрузите готовый файл.' });
      return;
    }
    const requestId = this.requestId;
    this.publish({ status: 'requesting' });
    try {
      const stream = await this.platform.requestStream();
      if (requestId !== this.requestId) { this.stopTracks(stream); return; }
      this.stream = stream;
      const recorder = this.platform.createRecorder(stream);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (requestId === this.requestId && event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (requestId !== this.requestId) return;
        this.discard();
        this.publish({ error: 'Не удалось записать звук. Проверьте микрофон и попробуйте снова.' });
      };
      recorder.onstop = () => {
        if (requestId !== this.requestId) return;
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.chunks = [];
        this.recorder = null;
        this.release();
        if (blob.size === 0) this.publish({ status: 'idle', error: 'Запись пуста. Запишите звук ещё раз.' });
        else if (blob.size > MAX_RECORDING_BYTES) this.publish({ status: 'idle', error: 'Запись превышает 100 МБ. Сделайте запись короче.' });
        else this.publish({ status: 'complete', blob });
      };
      recorder.start(1000);
      this.startedAt = this.platform.now();
      this.publish({ status: 'recording' });
      this.startTimer();
    } catch (cause) {
      if (requestId !== this.requestId) return;
      this.discard();
      const name = cause instanceof Error ? cause.name : '';
      this.publish({ error: name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Доступ к микрофону отклонён. Разрешите его в браузере или загрузите файл.'
        : name === 'NotFoundError'
          ? 'Микрофон не найден. Подключите устройство или загрузите файл.'
          : 'Не удалось начать запись. Проверьте микрофон и попробуйте снова.' });
    }
  };

  pause = (): void => {
    if (this.recorder?.state !== 'recording') return;
    this.recorder.pause();
    this.recordedMs += this.platform.now() - this.startedAt;
    this.clearTimer();
    this.publish({ status: 'paused', elapsedMs: this.recordedMs });
  };

  resume = (): void => {
    if (this.recorder?.state !== 'paused') return;
    this.recorder.resume();
    this.startedAt = this.platform.now();
    this.publish({ status: 'recording' });
    this.startTimer();
  };

  stop = (): void => {
    if (!this.recorder || this.recorder.state === 'inactive') return;
    if (this.recorder.state === 'recording') this.recordedMs += this.platform.now() - this.startedAt;
    this.publish({ status: 'finishing', elapsedMs: this.recordedMs });
    this.recorder.stop();
    this.release();
  };

  discard = (): void => {
    this.requestId += 1;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.onerror = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    this.release();
    this.chunks = [];
    this.recordedMs = 0;
    this.startedAt = 0;
    this.snapshot = emptySnapshot();
    this.listeners.forEach((listener) => listener());
  };

  private publish(patch: Partial<RecorderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private startTimer(): void {
    this.clearTimer();
    this.timer = setInterval(() => this.publish({ elapsedMs: this.recordedMs + this.platform.now() - this.startedAt }), 250);
  }

  private clearTimer(): void { clearInterval(this.timer); this.timer = undefined; }
  private stopTracks(stream: MediaStream): void { stream.getTracks().forEach((track) => track.stop()); }
  private release(): void {
    this.clearTimer();
    if (this.stream) this.stopTracks(this.stream);
    this.stream = null;
  }
}
