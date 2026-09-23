let token: string | null = null;
const listeners = new Set<() => void>();

export function getGoogleSessionToken(): string | null { return token; }
export function subscribeGoogleSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setGoogleSessionToken(next: string | null): void {
  token = next;
  listeners.forEach((listener) => listener());
}
