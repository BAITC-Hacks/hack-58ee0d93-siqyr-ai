import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthController } from '../src/modules/auth/application/AuthController.ts';
import type { AuthGateway } from '../src/modules/auth/application/AuthGateway.ts';
import { AuthError, validateSession, type AuthSession } from '../src/modules/auth/domain/auth.types.ts';
import { canAccess } from '../src/modules/auth/domain/accessPolicy.ts';
import { safeReturnPath } from '../src/modules/auth/domain/returnPath.ts';
import { UnconfiguredAuthGateway } from '../src/modules/auth/infrastructure/UnconfiguredAuthGateway.ts';
import { resolveRouteAccess } from '../src/app/routing/access.ts';

const session: AuthSession = {
  principal: { id: 'user-1', displayName: 'Test User', roles: ['member'], permissions: ['meetings:read', 'tasks:read'] },
  expiresAt: 2_000,
};

function gateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    restoreSession: async () => session,
    signInWithPassword: async () => session,
    signInWithProvider: async () => session,
    signOut: async () => {},
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('access requires a current session and explicit matching role / permission claims', () => {
  assert.equal(canAccess(null, {}, 1_000), false);
  assert.equal(canAccess(session, {}, 1_000), true);
  assert.equal(canAccess(session, {}, 2_000), false);
  assert.equal(canAccess(session, { rolesAnyOf: ['admin', 'member'], permissionsAllOf: ['meetings:read', 'tasks:read'] }, 1_000), true);
  assert.equal(canAccess(session, { rolesAnyOf: ['admin'] }, 1_000), false);
  assert.equal(canAccess(session, { permissionsAllOf: ['meetings:read', 'meetings:write'] }, 1_000), false);
  assert.equal(canAccess(session, { rolesAnyOf: [] }, 1_000), false);
  assert.equal(canAccess(session, { permissionsAllOf: [] }, 1_000), false);
  assert.equal(canAccess(session, { roles: ['member'] } as never, 1_000), false);
  assert.equal(canAccess(session, [] as never, 1_000), false);
  assert.equal(canAccess({ ...session, principal: { ...session.principal, roles: ['admin'] } }, { permissionsAllOf: ['meetings:write'] }, 1_000), false);
});

test('route access fails closed without metadata and composes parent and child policies', () => {
  const current = { ...session, expiresAt: null };
  assert.equal(resolveRouteAccess(current, [undefined]), false);
  assert.equal(resolveRouteAccess(null, [{ access: {} }]), false);
  assert.equal(resolveRouteAccess(current, [{ access: {} }, { access: { rolesAnyOf: ['member'] } }]), true);
  assert.equal(resolveRouteAccess(current, [{ access: { rolesAnyOf: ['admin'] } }, { access: {} }]), false);
  assert.equal(resolveRouteAccess(current, [{ access: null }]), false);
  assert.equal(resolveRouteAccess(current, [{ access: { rolesAnyOf: 'member' } }]), false);
});

test('return paths preserve local deep links but reject external, encoded and login-loop destinations', () => {
  assert.equal(safeReturnPath('/meetings/abc?tab=tasks#item'), '/meetings/abc?tab=tasks#item');
  for (const value of [null, '', 'https://evil.test', '//evil.test', '/\\evil.test', '/%2fexample.test', '/%252fexample.test', '/%5cevil.test', '/%0aevil', '/login?returnTo=/tasks', '/%6cogin', '/foo/../login', '/bad%']) {
    assert.equal(safeReturnPath(value), '/meetings', String(value));
  }
  assert.equal(safeReturnPath('//evil.test', '/tasks'), '/tasks');
});

test('session claims are copied, frozen and validated at the adapter boundary', () => {
  const claims = ['member'];
  const checked = validateSession({ ...session, principal: { ...session.principal, roles: claims } }, 1_000);
  claims.push('admin');
  assert.deepEqual(checked.principal.roles, ['member']);
  assert.ok(Object.isFrozen(checked.principal));
  assert.throws(() => validateSession({ ...session, expiresAt: 999 }, 1_000), AuthError);
  assert.throws(() => validateSession({ ...session, principal: { ...session.principal, roles: 'admin' as never } }, 1_000), AuthError);
  assert.throws(() => validateSession({ ...session, expiresAt: undefined as never }, 1_000), AuthError);
});

test('unconfigured frontend never grants a session for any login method', async () => {
  const controller = new AuthController(new UnconfiguredAuthGateway());
  assert.equal(controller.getSnapshot().status, 'checking');
  await controller.restore();
  assert.equal(controller.getSnapshot().status, 'anonymous');
  await assert.rejects(controller.signInWithPassword({ username: 'test@example.test', password: 'test-only' }), (error: unknown) => error instanceof AuthError && error.code === 'not-configured');
  for (const provider of ['eds', 'keycloak'] as const) await assert.rejects(controller.signInWithProvider(provider, '/meetings'), AuthError);
  assert.equal(controller.getSnapshot().status, 'anonymous');
});

test('failed restore is not treated as a confirmed guest or existing authenticated session', async () => {
  const controller = new AuthController(gateway({ restoreSession: async () => { throw new Error('private server response'); } }));
  await controller.restore();
  assert.deepEqual(controller.getSnapshot(), { status: 'error', operation: 'restore', code: 'unavailable' });
});

test('password login normalizes username without mutating the password or retaining credentials', async () => {
  const controller = new AuthController(gateway({ signInWithPassword: async (credentials) => {
    assert.deepEqual(credentials, { username: 'user@example.test', password: ' exact password ' });
    return session;
  } }), () => 1_000);
  assert.equal(await controller.signInWithPassword({ username: ' user@example.test ', password: ' exact password ' }), true);
  const state = controller.getSnapshot();
  assert.equal(state.status, 'authenticated');
  assert.equal(JSON.stringify(state).includes('password'), false);
});

test('late restoration cannot overwrite a newer signed-in identity', async () => {
  const restored = deferred<AuthSession | null>();
  let oldSignal: AbortSignal | undefined;
  const controller = new AuthController(gateway({ restoreSession: (signal) => { oldSignal = signal; return restored.promise; } }), () => 1_000);
  const pending = controller.restore();
  await controller.signInWithPassword({ username: 'test@example.test', password: 'test-only' });
  assert.ok(oldSignal?.aborted);
  restored.resolve(null);
  await pending;
  assert.equal(controller.getSnapshot().status, 'authenticated');
});

test('a pending sign-in cannot reauthenticate after sign-out', async () => {
  const login = deferred<AuthSession>();
  const controller = new AuthController(gateway({ signInWithPassword: () => login.promise }), () => 1_000);
  const pending = controller.signInWithPassword({ username: 'test@example.test', password: 'test-only' });
  await controller.signOut();
  login.resolve(session);
  assert.equal(await pending, false);
  assert.equal(controller.getSnapshot().status, 'anonymous');
});

test('failed logout removes the working session and exposes a logout retry state', async () => {
  const controller = new AuthController(gateway({ signOut: async () => { throw new Error('network failed'); } }), () => 1_000);
  await controller.restore();
  await controller.signOut();
  assert.deepEqual(controller.getSnapshot(), { status: 'error', operation: 'sign-out', code: 'unavailable' });
});

test('session expiration revokes access and cancels pending work', async () => {
  let now = 1_000;
  const controller = new AuthController(gateway(), () => now);
  await controller.restore();
  now = 2_000;
  controller.expireIfNeeded();
  assert.deepEqual(controller.getSnapshot(), { status: 'anonymous', reason: 'expired' });
});

test('provider receives only a safe local return path and can return authoritative claims', async () => {
  const controller = new AuthController(gateway({ signInWithProvider: async (provider, path) => {
    assert.equal(provider, 'keycloak');
    assert.equal(path, '/meetings');
    return session;
  } }), () => 1_000);
  await controller.signInWithProvider('keycloak', '//evil.test');
  assert.equal(controller.getSnapshot().status, 'authenticated');
});
