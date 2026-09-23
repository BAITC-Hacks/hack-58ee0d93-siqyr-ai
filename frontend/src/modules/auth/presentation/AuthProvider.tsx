import { createContext, useContext, useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';
import type { AuthController } from '../application/AuthController.ts';

const AuthContext = createContext<AuthController | null>(null);

export function AuthProvider({ controller, children }: PropsWithChildren<{ controller: AuthController }>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    void controller.restore();
    return controller.cancelPending;
  }, [controller]);

  useEffect(() => {
    if (state.status !== 'authenticated' || state.session.expiresAt === null) return;
    const check = () => controller.expireIfNeeded();
    let timer: number;
    const expiresAt = state.session.expiresAt;
    const schedule = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      timer = window.setTimeout(() => {
        check();
        if (expiresAt > Date.now()) schedule();
      }, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [controller, state]);

  return <AuthContext.Provider value={controller}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const controller = useContext(AuthContext);
  if (!controller) throw new Error('AuthProvider is required.');
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { state, controller };
}
