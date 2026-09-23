import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalWorkspaceAuthGateway } from '../src/modules/auth/infrastructure/LocalWorkspaceAuthGateway.ts';
import { LOCAL_WORKSPACE_ID } from '../src/modules/auth/domain/auth.types.ts';
import type { AuthGateway } from '../src/modules/auth/application/AuthGateway.ts';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('local workspace requires an explicit choice and remains separate from failed API restore', async () => {
  const saved = storage();
  let remoteSignOut = 0;
  const remote: AuthGateway = {
    restoreSession: async () => { throw new Error('API unavailable'); },
    signInWithPassword: async () => { throw new Error('API unavailable'); },
    signInWithProvider: async () => { throw new Error('API unavailable'); },
    signOut: async () => { remoteSignOut += 1; },
  };
  const gateway = new LocalWorkspaceAuthGateway(remote, saved);
  const signal = new AbortController().signal;
  await assert.rejects(gateway.restoreSession(signal), /API unavailable/);
  assert.equal(saved.getItem('siqyrai.local-workspace.enabled'), null);
  const chosen = await gateway.signInWithProvider('local', '/meetings/live', signal);
  assert.equal(chosen.principal.id, LOCAL_WORKSPACE_ID);
  assert.deepEqual(await gateway.restoreSession(signal), chosen);
  await gateway.signOut(signal);
  assert.equal(saved.getItem('siqyrai.local-workspace.enabled'), null);
  assert.equal(remoteSignOut, 1);
});
