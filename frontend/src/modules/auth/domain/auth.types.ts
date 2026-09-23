export type SignInMethod = 'password' | 'eds' | 'keycloak' | 'local';
export const LOCAL_WORKSPACE_ID = 'siqyrai-local-browser-workspace';

export interface AuthPrincipal {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface AuthSession {
  readonly principal: AuthPrincipal;
  /** Epoch milliseconds; null means expiry is managed by the future server adapter. */
  readonly expiresAt: number | null;
}

export interface PasswordCredentials {
  username: string;
  password: string;
}

export type AuthErrorCode = 'not-configured' | 'invalid-credentials' | 'unavailable' | 'invalid-session';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
  }
}

export type AuthState =
  | { readonly status: 'checking' }
  | { readonly status: 'anonymous'; readonly reason?: 'expired' }
  | { readonly status: 'authenticated'; readonly session: AuthSession }
  | { readonly status: 'error'; readonly operation: 'restore' | 'sign-out'; readonly code: AuthErrorCode };

export function isSessionActive(session: AuthSession, now = Date.now()): boolean {
  return session.expiresAt === null || session.expiresAt > now;
}

export function validateSession(value: AuthSession, now: number): AuthSession {
  const principal = value?.principal;
  const validClaims = (claims: unknown): claims is string[] => Array.isArray(claims)
    && claims.every((claim) => typeof claim === 'string' && claim.length > 0 && claim.trim() === claim);
  if (!principal || typeof principal.id !== 'string' || !principal.id.trim()
    || typeof principal.displayName !== 'string'
    || !validClaims(principal.roles) || !validClaims(principal.permissions)
    || (value.expiresAt !== null && (!Number.isFinite(value.expiresAt) || value.expiresAt <= now))) {
    throw new AuthError('invalid-session');
  }
  return Object.freeze({
    principal: Object.freeze({
      id: principal.id,
      displayName: principal.displayName,
      roles: Object.freeze([...new Set(principal.roles)]),
      permissions: Object.freeze([...new Set(principal.permissions)]),
    }),
    expiresAt: value.expiresAt,
  });
}
