import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiAuthGateway } from '../src/modules/auth/infrastructure/ApiAuthGateway.ts';
import { AuthError } from '../src/modules/auth/domain/auth.types.ts';
import { HttpError, type HttpClient, type HttpRequest } from '../src/shared/application/HttpClient.ts';

const user = {
  id: 'user-1', username: 'tester', display_name: 'Тестовый пользователь',
  is_system_admin: false, departments: { default: 'secretary' },
};

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    size: () => values.size,
  };
}

test('API login sends backend credentials, restores through /me, and signs out locally', async () => {
  const requests: HttpRequest[] = [];
  const http: HttpClient = { request: async <T>(request: HttpRequest): Promise<T> => {
    requests.push(request);
    if (request.path === '/api/auth/login') return {
      access_token: 'issued-token', token_type: 'bearer', expires_in: 1800, user,
    } as T;
    if (request.path === '/api/auth/me') return user as T;
    throw new Error('Unexpected route');
  } };
  const saved = storage();
  const gateway = new ApiAuthGateway(http, saved, () => 1_000);
  const signal = new AbortController().signal;
  const signedIn = await gateway.signInWithPassword({ username: 'tester', password: 'test-password' }, signal);
  assert.deepEqual(requests[0]?.body, { username: 'tester', password: 'test-password' });
  assert.equal(signedIn.principal.displayName, 'Тестовый пользователь');
  assert.equal(signedIn.expiresAt, 1_801_000);
  assert.equal(saved.size(), 1);
  assert.equal(saved.getItem('siqyrai.auth.v1')?.includes('test-password'), false);
  const restored = await gateway.restoreSession(signal);
  assert.deepEqual(restored, signedIn);
  assert.equal(requests[1]?.headers?.Authorization, 'Bearer issued-token');
  await gateway.signOut();
  assert.equal(saved.size(), 0);
  assert.equal(await gateway.restoreSession(signal), null);
});

test('invalid credentials and rejected tokens do not leave a usable session', async () => {
  const saved = storage();
  const failedLogin = new ApiAuthGateway({ request: async () => { throw new HttpError('request failed', 401); } }, saved);
  await assert.rejects(failedLogin.signInWithPassword({ username: 'tester', password: 'bad-password' }, new AbortController().signal),
    (error: unknown) => error instanceof AuthError && error.code === 'invalid-credentials');
  assert.equal(saved.size(), 0);

  const login = new ApiAuthGateway({ request: async <T>(): Promise<T> => ({
    access_token: 'issued-token', token_type: 'bearer', expires_in: 30, user,
  }) as T }, saved, () => 1_000);
  await login.signInWithPassword({ username: 'tester', password: 'test-password' }, new AbortController().signal);
  const rejected = new ApiAuthGateway({ request: async () => { throw new HttpError('request failed', 401); } }, saved, () => 2_000);
  assert.equal(await rejected.restoreSession(new AbortController().signal), null);
  assert.equal(saved.size(), 0);
});

test('expired or malformed browser tokens are removed before a request', async () => {
  const saved = storage();
  saved.setItem('siqyrai.auth.v1', '{bad json');
  const http: HttpClient = { request: async () => { throw new Error('No request expected'); } };
  const gateway = new ApiAuthGateway(http, saved, () => 2_000);
  assert.equal(await gateway.restoreSession(new AbortController().signal), null);
  assert.equal(saved.size(), 0);
  saved.setItem('siqyrai.auth.v1', JSON.stringify({ token: 'old', expiresAt: 1_999 }));
  assert.equal(await gateway.restoreSession(new AbortController().signal), null);
  assert.equal(saved.size(), 0);
});
