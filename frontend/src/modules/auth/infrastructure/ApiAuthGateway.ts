import { HttpError, type HttpClient } from '../../../shared/application/HttpClient.ts';
import type { AuthGateway } from '../application/AuthGateway.ts';
import { AuthError, validateSession, type AuthSession, type PasswordCredentials } from '../domain/auth.types.ts';

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StoredToken {
  token: string;
  expiresAt: number;
}

const storageKey = 'siqyrai.auth.v1';

function userSession(value: unknown, expiresAt: number): AuthSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AuthError('invalid-session');
  const user = value as Record<string, unknown>;
  if (typeof user.id !== 'string' || !user.id.trim()
    || typeof user.display_name !== 'string' || !user.display_name.trim()
    || typeof user.is_system_admin !== 'boolean'
    || typeof user.departments !== 'object' || user.departments === null || Array.isArray(user.departments)
    || !Object.entries(user.departments).every(([id, role]) => id.length > 0 && typeof role === 'string' && role.length > 0)) {
    throw new AuthError('invalid-session');
  }
  return {
    principal: {
      id: user.id,
      displayName: user.display_name,
      roles: user.is_system_admin ? ['system_admin'] : [],
      permissions: [],
    },
    expiresAt,
  };
}

export class ApiAuthGateway implements AuthGateway {
  private readonly http: HttpClient;
  private readonly storage: TokenStorage;
  private readonly now: () => number;

  constructor(http: HttpClient, storage: TokenStorage, now: () => number = Date.now) {
    this.http = http;
    this.storage = storage;
    this.now = now;
  }

  private clear(): void {
    this.storage.removeItem(storageKey);
  }

  private storedToken(): StoredToken | null {
    const raw = this.storage.getItem(storageKey);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null && 'token' in value && 'expiresAt' in value
        && typeof value.token === 'string' && value.token.length > 0
        && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) && value.expiresAt > this.now()) {
        return { token: value.token, expiresAt: value.expiresAt };
      }
    } catch { /* Invalid browser state is treated as a signed-out session. */ }
    this.clear();
    return null;
  }

  async restoreSession(signal: AbortSignal): Promise<AuthSession | null> {
    const stored = this.storedToken();
    if (!stored) return null;
    try {
      const user = await this.http.request<unknown>({
        method: 'GET', path: '/api/auth/me', headers: { Authorization: `Bearer ${stored.token}` }, signal,
      });
      return userSession(user, stored.expiresAt);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        this.clear();
        return null;
      }
      throw error;
    }
  }

  async signInWithPassword(credentials: PasswordCredentials, signal: AbortSignal): Promise<AuthSession> {
    let response: unknown;
    try {
      response = await this.http.request<unknown>({ method: 'POST', path: '/api/auth/login', body: credentials, signal });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) throw new AuthError('invalid-credentials');
      if (error instanceof HttpError && error.status === 404) throw new AuthError('not-configured');
      throw error;
    }
    if (typeof response !== 'object' || response === null || Array.isArray(response)) throw new AuthError('invalid-session');
    const result = response as Record<string, unknown>;
    if (typeof result.access_token !== 'string' || !result.access_token
      || result.token_type !== 'bearer'
      || typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
      throw new AuthError('invalid-session');
    }
    const expiresAt = this.now() + result.expires_in * 1000;
    if (!Number.isFinite(expiresAt)) throw new AuthError('invalid-session');
    const session = validateSession(userSession(result.user, expiresAt), this.now());
    if (signal.aborted) throw new AuthError('unavailable');
    this.storage.setItem(storageKey, JSON.stringify({ token: result.access_token, expiresAt }));
    return session;
  }

  async signInWithProvider(): Promise<AuthSession> {
    throw new AuthError('not-configured');
  }

  async signOut(): Promise<void> {
    this.clear();
  }
}
