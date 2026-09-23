import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiRecordingGateway } from '../src/modules/recording/infrastructure/ApiRecordingGateway.ts';
import type { HttpClient } from '../src/shared/application/HttpClient.ts';
import type { RunProgress } from '../src/modules/recording/application/RecordingGateway.ts';

test('authenticated SSE consumes split frames and deduplicates snapshot steps', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const encoder = new TextEncoder();
  const streamFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(input), authorization: headers.get('Authorization') });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('id: 1\nevent: step\ndata: {"seq":1,"content":"Начало"}\n'));
        controller.enqueue(encoder.encode('\nid: 2\nevent: step\ndata: {"seq":2,"content":"Речь готова"}\n\nevent: status\ndata: {"status":"done"}\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const http: HttpClient = { request: async <T>(): Promise<T> => ({
    run: { status: 'running' }, steps: [{ seq: 1, content: 'Начало' }],
  }) as T };
  const gateway = new ApiRecordingGateway(http, 'http://localhost:8000', () => 'test-token', streamFetch);
  const updates: RunProgress[] = [];
  const errors: string[] = [];
  const stop = gateway.watch('run-1', (progress) => updates.push(progress), (error) => errors.push(error));
  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [{ url: 'http://localhost:8000/api/runs/run-1/events', authorization: 'Bearer test-token' }]);
  assert.equal(updates.at(-1)?.status, 'done');
  assert.deepEqual(updates.at(-1)?.steps, [{ seq: 1, content: 'Начало' }, { seq: 2, content: 'Речь готова' }]);
});
