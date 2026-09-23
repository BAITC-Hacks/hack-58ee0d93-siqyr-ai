import type { AuthGateway } from '../application/AuthGateway.ts';
import { AuthError, LOCAL_WORKSPACE_ID, type AuthSession, type PasswordCredentials } from '../domain/auth.types.ts';

const storageKey = 'siqyrai.local-workspace.enabled';
const localSession: AuthSession = {
  principal: { id: LOCAL_WORKSPACE_ID, displayName: 'Локальное пространство', roles: [], permissions: ['meetings:read', 'meetings:write'] },
  expiresAt: null,
};

/** Local access is an explicit choice; an API failure never switches to this workspace. */
export class LocalWorkspaceAuthGateway implements AuthGateway {
  private readonly remote: AuthGateway;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  constructor(remote: AuthGateway, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.remote = remote;
    this.storage = storage;
  }

  restoreSession(signal: AbortSignal): Promise<AuthSession | null> {
    return this.storage.getItem(storageKey) === '1' ? Promise.resolve(localSession) : this.remote.restoreSession(signal);
  }

  signInWithPassword(credentials: PasswordCredentials, signal: AbortSignal): Promise<AuthSession> {
    return this.remote.signInWithPassword(credentials, signal);
  }

  signInWithProvider(provider: 'eds' | 'keycloak' | 'local', returnPath: string, signal: AbortSignal): Promise<AuthSession> {
    if (provider === 'local') {
      if (signal.aborted) return Promise.reject(new AuthError('unavailable'));
      this.storage.setItem(storageKey, '1');
      return Promise.resolve(localSession);
    }
    return this.remote.signInWithProvider(provider, returnPath, signal);
  }

  async signOut(signal: AbortSignal): Promise<void> {
    if (this.storage.getItem(storageKey) === '1') {
      this.storage.removeItem(storageKey);
      await this.remote.signOut(signal);
      return;
    }
    await this.remote.signOut(signal);
  }
}
