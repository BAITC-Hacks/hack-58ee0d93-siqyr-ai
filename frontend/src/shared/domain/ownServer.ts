const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Recordings and meeting texts go only to a server of this deployment: an API on the user's own machine,
 * or the on-premise server that served this page and proxies /api on the same origin (infra/nginx.conf).
 */
export function isOwnServer(apiUrl: string, pageOrigin: string): boolean {
  let api: URL;
  try {
    api = new URL(apiUrl, pageOrigin);
  } catch {
    return false;
  }
  return LOOPBACK.has(api.hostname) || api.origin === pageOrigin;
}
