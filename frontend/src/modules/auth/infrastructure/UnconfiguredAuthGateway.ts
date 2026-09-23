import type { AuthGateway } from '../application/AuthGateway.ts';
import { AuthError, type AuthSession } from '../domain/auth.types.ts';

/** Deliberately cannot create a session. No fake credentials, tokens or API assumptions. */
export class UnconfiguredAuthGateway implements AuthGateway {
  async restoreSession(): Promise<null> { return null; }
  async signInWithPassword(): Promise<AuthSession> { throw new AuthError('not-configured'); }
  async signInWithProvider(): Promise<AuthSession> { throw new AuthError('not-configured'); }
  async signOut(): Promise<void> {}
}
