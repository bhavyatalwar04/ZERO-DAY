// Post-login redirect target (roadmap 3.4 / P5). Shared by the auth callback,
// the login page and proxy.ts.

export const DEFAULT_AFTER_LOGIN = '/ledger'

const BASE = 'http://same-origin.invalid'

/**
 * Only same-site paths are allowed. Rejects open-redirect tricks:
 *   "//evil.com" and "/\evil.com"  (browsers read both as another host)
 *   "@evil.com"                     (https://site@evil.com = user@host)
 *   "/\t/evil.com"                  (browsers strip tabs/newlines, leaving //evil.com)
 *   "https://evil.com"
 * The final check resolves the path against a dummy origin and requires the
 * origin to be unchanged, so anything a browser would send off-site fails.
 */
export function safeNext(next: string | null | undefined, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback
  try {
    if (new URL(next, BASE).origin !== BASE) return fallback
  } catch {
    return fallback
  }
  return next
}
