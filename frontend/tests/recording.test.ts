import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserRecorder, type RecorderPlatform } from '../src/modules/recording/infrastructure/BrowserRecorder.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function stream() {
  let stops = 0;
  return { value: { getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream, stops: () => stops };
}

function fakeRecorder() {
  const recorder = {
    state: 'inactive', mimeType: 'audio/webm',
    ondataavailable: null as ((event: { data: Blob }) => void) | null,
    onstop: null as (() => void) | null,
    onerror: null as (() => void) | null,
    start() { this.state = 'recording'; },
    pause() { this.state = 'paused'; },
    resume() { this.state = 'recording'; },
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); });
    },
  };
  return recorder;
}

test('discarding a pending permission request releases the late stream and keeps idle state', async () => {
  const pending = deferred<MediaStream>();
  const media = stream();
  const recorder = new BrowserRecorder({ supported: () => true, requestStream: () => pending.promise, createRecorder: () => { throw new Error('must not start'); }, now: () => 0 });
  const starting = recorder.start();
  assert.equal(recorder.getIsActive(), true);
  recorder.discard();
  pending.resolve(media.value);
  await starting;
  assert.equal(media.stops(), 1);
  assert.equal(recorder.getSnapshot().status, 'idle');
});

test('a stale permission failure cannot stop a newer recording', async () => {
  const first = deferred<MediaStream>();
  const media = stream();
  const captured = fakeRecorder();
  let requests = 0;
  const recorder = new BrowserRecorder({ supported: () => true, requestStream: () => ++requests === 1 ? first.promise : Promise.resolve(media.value), createRecorder: () => captured as unknown as MediaRecorder, now: () => 0 });
  try {
    const old = recorder.start();
    await recorder.start();
    first.reject(new Error('old request failed'));
    await old;
    assert.equal(recorder.getSnapshot().status, 'recording');
    assert.equal(media.stops(), 0);
  } finally { recorder.discard(); }
});

test('pause time is excluded, stop produces a blob, and cleanup permits reuse', async () => {
  const media = stream();
  const captured = fakeRecorder();
  let now = 0;
  const platform: RecorderPlatform = { supported: () => true, requestStream: async () => media.value, createRecorder: () => captured as unknown as MediaRecorder, now: () => now };
  const recorder = new BrowserRecorder(platform);
  try {
    await recorder.start();
    now = 1000; recorder.pause();
    assert.equal(recorder.getSnapshot().elapsedMs, 1000);
    now = 5000; recorder.resume();
    now = 7000; recorder.stop();
    assert.equal(recorder.getSnapshot().elapsedMs, 3000);
    await Promise.resolve();
    assert.equal(recorder.getSnapshot().status, 'complete');
    assert.equal(await recorder.getSnapshot().blob?.text(), 'audio');
    assert.equal(media.stops(), 1);
    recorder.discard();
    assert.equal(recorder.getSnapshot().blob, null);
    await recorder.start();
    assert.equal(recorder.getSnapshot().status, 'recording');
  } finally { recorder.discard(); }
});

test('streaming sends chunks in order, drain waits for the last one, and a failed chunk stops recording', async () => {
  const media = stream();
  const captured = fakeRecorder();
  const platform: RecorderPlatform = { supported: () => true, requestStream: async () => media.value, createRecorder: () => captured as unknown as MediaRecorder, now: () => 0 };
  const recorder = new BrowserRecorder(platform);
  const sent: string[] = [];
  try {
    await recorder.start(async (chunk) => { await Promise.resolve(); sent.push(await chunk.text()); });
    captured.ondataavailable?.({ data: new Blob(['one']) });
    captured.ondataavailable?.({ data: new Blob(['two']) });
    recorder.stop();
    await recorder.drain();
    assert.deepEqual(sent, ['one', 'two', 'audio']);
    assert.equal(await recorder.getSnapshot().blob?.text(), 'onetwoaudio');

    const failing = fakeRecorder();
    const broken = new BrowserRecorder({ ...platform, createRecorder: () => failing as unknown as MediaRecorder });
    await broken.start(async () => { throw new Error('offline'); });
    failing.ondataavailable?.({ data: new Blob(['lost']) });
    await assert.rejects(broken.drain(), /offline/);
    assert.equal(failing.state, 'inactive');
    assert.match(broken.getSnapshot().error, /сервер/);
    broken.discard();
  } finally { recorder.discard(); }
});
