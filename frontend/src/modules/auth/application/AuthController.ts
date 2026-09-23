import { AuthError, isSessionActive, validateSession, type AuthSession, type AuthState, type PasswordCredentials } from '../domain/auth.types.ts';
import { safeReturnPath } from '../domain/returnPath.ts';
import type { AuthGateway } from './AuthGateway.ts';

export class AuthController {
  private readonly gateway: AuthGateway;
  private readonly now: () => number;
  private state: AuthState = { status: 'checking' };
  private readonly listeners = new Set<() => void>();
  private pending: AbortController | null = null;

  constructor(gateway: AuthGateway, now: () => number = Date.now) {
    this.gateway = gateway;
    this.now = now;
  }

  getSnapshot = (): AuthState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  cancelPending = (): void => {
    this.pending?.abort();
    this.pending = null;
  };

  private begin(): AbortController {
    this.cancelPending();
    this.pending = new AbortController();
    return this.pending;
  }

  private current(operation: AbortController): boolean {
    return this.pending === operation && !operation.signal.aborted;
  }

  private publish(state: AuthState): void {
    this.state = Object.freeze(state);
    this.listeners.forEach((listener) => listener());
  }

  restore = async (): Promise<void> => {
    const operation = this.begin();
    this.publish({ status: 'checking' });
    try {
      const session = await this.gateway.restoreSession(operation.signal);
      if (!this.current(operation)) return;
      this.publish(session ? { status: 'authenticated', session: validateSession(session, this.now()) } : { status: 'anonymous' });
    } catch (error) {
      if (this.current(operation)) this.publish({ status: 'error', operation: 'restore', code: this.errorCode(error) });
    }
  };

  private async signIn(request: (signal: AbortSignal) => Promise<AuthSession>): Promise<boolean> {
    const operation = this.begin();
    this.publish({ status: 'anonymous' });
    try {
      const session = await request(operation.signal);
      if (!this.current(operation)) return false;
      this.publish({ status: 'authenticated', session: validateSession(session, this.now()) });
      return true;
    } catch (error) {
      if (!this.current(operation)) return false;
      this.publish({ status: 'anonymous' });
      throw new AuthError(this.errorCode(error));
    }
  }

  signInWithPassword = (credentials: PasswordCredentials): Promise<boolean> =>
    this.signIn((signal) => this.gateway.signInWithPassword({ username: credentials.username.trim(), password: credentials.password }, signal));

  signInWithProvider = (provider: 'eds' | 'keycloak' | 'local', returnPath: string): Promise<boolean> =>
    this.signIn((signal) => this.gateway.signInWithProvider(provider, safeReturnPath(returnPath), signal));

  signOut = async (): Promise<void> => {
    const operation = this.begin();
    this.publish({ status: 'checking' });
    try {
      await this.gateway.signOut(operation.signal);
      if (this.current(operation)) this.publish({ status: 'anonymous' });
    } catch (error) {
      if (this.current(operation)) this.publish({ status: 'error', operation: 'sign-out', code: this.errorCode(error) });
    }
  };

  expireIfNeeded = (): void => {
    if (this.state.status === 'authenticated' && !isSessionActive(this.state.session, this.now())) {
      this.cancelPending();
      this.publish({ status: 'anonymous', reason: 'expired' });
    }
  };

  private errorCode(error: unknown) {
    return error instanceof AuthError ? error.code : 'unavailable' as const;
  }
}
