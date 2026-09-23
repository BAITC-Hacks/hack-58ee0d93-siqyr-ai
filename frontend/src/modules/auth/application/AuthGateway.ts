import type { AuthSession, PasswordCredentials } from '../domain/auth.types.ts';

/** Application port, not an HTTP contract. Implement when the identity service is defined. */
export interface AuthGateway {
  restoreSession(signal: AbortSignal): Promise<AuthSession | null>;
  signInWithPassword(credentials: PasswordCredentials, signal: AbortSignal): Promise<AuthSession>;
  signInWithProvider(provider: 'eds' | 'keycloak', returnPath: string, signal: AbortSignal): Promise<AuthSession>;
  signOut(signal: AbortSignal): Promise<void>;
}
