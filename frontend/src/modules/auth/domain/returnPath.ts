export function safeReturnPath(value: unknown, fallback = '/meetings'): string {
  if (typeof value !== 'string' || value.length > 2048) return fallback;
  let decoded = value;
  try {
    for (let i = 0; i < 3; i++) {
      if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u0020]/.test(decoded)) return fallback;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u0020]/.test(decoded)) return fallback;
    const target = new URL(decoded, 'https://local.invalid');
    if (target.origin !== 'https://local.invalid' || /^\/login(?:\/|$)/i.test(target.pathname)) return fallback;
    return value;
  } catch {
    return fallback;
  }
}
