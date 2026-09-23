import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError, CanceledError } from 'axios';
import { onlineManager, QueryObserver } from '@tanstack/react-query';
import { createQueryClient } from '../src/app/providers/createQueryClient.ts';
import { workspaceQuery, workspaceKeys } from '../src/modules/workspace/presentation/workspace.queries.ts';
import { workspaceMutation } from '../src/modules/workspace/presentation/workspace.mutations.ts';
import type { WorkspaceRepository } from '../src/modules/workspace/application/WorkspaceRepository.ts';
import { defaultSettings } from '../src/modules/settings/domain/settings.types.ts';
import { AxiosHttpClient } from '../src/infrastructure/http/AxiosHttpClient.ts';
import { HttpError } from '../src/shared/application/HttpClient.ts';

function fixture() {
  let reads = 0;
  let name = '';
  const repository: WorkspaceRepository = {
    networkMode: 'always',
    initialize: async () => {},
    restoreDemo: async () => {},
    readSnapshot: async () => { reads++; return { meetings: [], tasks: [], settings: { ...defaultSettings, displayName: name } }; },
  };
  return { repository, reads: () => reads, change: async (value: string) => { name = value; } };
}

test('shared query key deduplicates reads and remains usable offline', async () => {
  const { repository, reads } = fixture();
  const client = createQueryClient();
  onlineManager.setOnline(false);
  try {
    const options = workspaceQuery(repository);
    const [first, second] = await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
    assert.equal(reads(), 1);
    assert.equal(first, second);
    await client.fetchQuery(options);
    assert.equal(reads(), 1);
  } finally { onlineManager.setOnline(true); client.clear(); }
});

test('successful offline mutation invalidates and refreshes active views; failed writes do not retry', async () => {
  const { repository, change } = fixture();
  const client = createQueryClient();
  const observer = new QueryObserver(client, workspaceQuery(repository));
  const unsubscribe = observer.subscribe(() => {});
  await client.fetchQuery(workspaceQuery(repository));
  onlineManager.setOnline(false);
  try {
    const mutation = client.getMutationCache().build(client, workspaceMutation(client, repository, change));
    await mutation.execute('Updated');
    assert.equal(client.getQueryData<Awaited<ReturnType<typeof repository.readSnapshot>>>(workspaceKeys.snapshot())?.settings.displayName, 'Updated');
    let attempts = 0;
    const failing = client.getMutationCache().build(client, workspaceMutation(client, repository, async () => { attempts++; throw new Error('write failed'); }));
    await assert.rejects(() => failing.execute(undefined), /write failed/);
    assert.equal(attempts, 1);
    assert.equal(observer.getCurrentResult().isSuccess, true);
  } finally { onlineManager.setOnline(true); unsubscribe(); client.clear(); }
});

test('cancelled reads receive an AbortSignal and cannot publish stale data', async () => {
  const { repository } = fixture();
  const client = createQueryClient();
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  repository.readSnapshot = async (nextSignal) => {
    signal = nextSignal;
    started();
    return new Promise((_, reject) => nextSignal?.addEventListener('abort', () => reject(nextSignal.reason), { once: true }));
  };
  const pending = client.fetchQuery(workspaceQuery(repository));
  await ready;
  await client.cancelQueries({ queryKey: workspaceKeys.all });
  await assert.rejects(pending);
  assert.equal(signal?.aborted, true);
  assert.equal(client.getQueryData(workspaceKeys.snapshot()), undefined);
  client.clear();
});

test('HTTP adapter passes payload, params and signal and unwraps the response', async () => {
  const abort = new AbortController();
  const instance = axios.create({ adapter: async (config) => {
    assert.equal(config.url, '/meetings');
    assert.equal(config.method, 'post');
    assert.equal(config.signal, abort.signal);
    assert.deepEqual(config.params, { page: 2 });
    assert.equal(config.data, JSON.stringify({ title: 'Test' }));
    return { data: { id: 'created' }, status: 201, statusText: 'Created', headers: {}, config };
  } });
  const client = new AxiosHttpClient('https://api.example.test', instance);
  assert.deepEqual(await client.request({ method: 'POST', path: '/meetings', body: { title: 'Test' }, params: { page: 2 }, signal: abort.signal }), { id: 'created' });
});

test('HTTP adapter preserves cancellation and normalizes failures without leaking raw server bodies', async () => {
  const instance = axios.create({ adapter: async (config) => {
    throw new AxiosError('internal database secret', 'ERR_BAD_RESPONSE', config, undefined, { data: { secret: 'sensitive' }, status: 503, statusText: 'Unavailable', headers: {}, config });
  } });
  const client = new AxiosHttpClient('https://api.example.test', instance);
  await assert.rejects(() => client.request({ method: 'GET', path: '/test' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'ERR_BAD_RESPONSE');
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  const cancelled = new AxiosHttpClient('https://api.example.test', axios.create({ adapter: async () => { throw new CanceledError(); } }));
  await assert.rejects(() => cancelled.request({ method: 'GET', path: '/test' }), axios.isCancel);
  assert.throws(() => new AxiosHttpClient('  '));
});
