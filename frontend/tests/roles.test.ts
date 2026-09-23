import assert from 'node:assert/strict';
import test from 'node:test';
import { firstAccessiblePath, pagePolicies, resolveRouteAccess } from '../src/app/routing/access.ts';
import { departmentClaims, roleLabel } from '../src/modules/auth/domain/departmentAccess.ts';
import { ApiAuthGateway } from '../src/modules/auth/infrastructure/ApiAuthGateway.ts';
import type { AuthSession } from '../src/modules/auth/domain/auth.types.ts';
import type { HttpClient } from '../src/shared/application/HttpClient.ts';

async function signIn(isSystemAdmin: boolean, departments: Record<string, string>): Promise<AuthSession> {
  const user = { id: 'user-1', username: 'tester', display_name: 'Тест', is_system_admin: isSystemAdmin, departments };
  const http: HttpClient = { request: async <T>(): Promise<T> => ({ access_token: 'token', token_type: 'bearer', expires_in: 60, user }) as T };
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  // Real clock: route checks compare the session expiry with Date.now().
  return new ApiAuthGateway(http, storage).signInWithPassword({ username: 'tester', password: 'test-password' }, new AbortController().signal);
}

test('department roles from the API map to the same rights as Principal.can on the server', () => {
  assert.deepEqual(departmentClaims(false, { default: 'viewer' }), { roles: ['viewer'], permissions: ['meetings:read'] });
  assert.deepEqual(departmentClaims(false, { default: 'editor' }).permissions, ['meetings:read', 'meetings:write']);
  assert.deepEqual(departmentClaims(false, { default: 'secretary' }).permissions, ['meetings:read', 'meetings:write', 'protocol:approve']);
  assert.deepEqual(departmentClaims(false, { default: 'department_admin' }).permissions,
    ['meetings:read', 'meetings:write', 'protocol:approve', 'department:admin']);
  assert.deepEqual(departmentClaims(true, {}), {
    roles: ['system_admin'], permissions: ['meetings:read', 'meetings:write', 'protocol:approve', 'department:admin', 'system:admin'],
  });
  // The UI works in the default department only: a role elsewhere or an unknown role grants nothing here.
  assert.deepEqual(departmentClaims(false, { legal: 'secretary' }), { roles: [], permissions: [] });
  assert.deepEqual(departmentClaims(false, { default: 'auditor' }), { roles: ['auditor'], permissions: [] });
});

test('role label shows the strongest known role', () => {
  assert.equal(roleLabel(['system_admin', 'viewer']), 'Системный администратор');
  assert.equal(roleLabel(['secretary']), 'Секретарь');
  assert.equal(roleLabel([]), 'Без роли в департаменте');
});

test('a viewer can open meetings but not the pages that create a server run', async () => {
  const viewer = await signIn(false, { default: 'viewer' });
  assert.deepEqual(viewer.principal.permissions, ['meetings:read']);
  assert.equal(resolveRouteAccess(viewer, [{ access: pagePolicies.meetings }]), true);
  assert.equal(resolveRouteAccess(viewer, [{ access: pagePolicies.newMeeting }]), false);
  assert.equal(resolveRouteAccess(viewer, [{ access: pagePolicies.call }]), false);
  assert.equal(firstAccessiblePath(viewer), '/meetings/live');

  for (const [admin, departments] of [[false, { default: 'editor' }], [false, { default: 'secretary' }], [true, {}]] as const) {
    const writer = await signIn(admin, departments);
    assert.equal(resolveRouteAccess(writer, [{ access: pagePolicies.newMeeting }]), true, JSON.stringify(departments));
    assert.equal(resolveRouteAccess(writer, [{ access: pagePolicies.call }]), true, JSON.stringify(departments));
  }
  assert.equal(resolveRouteAccess(await signIn(false, { legal: 'secretary' }), [{ access: pagePolicies.newMeeting }]), false);
});
