// Demo-mode login fallback (roadmap 3.4 / P5).
//
// Before: on ANY network error or TypeError, login/signup created a local
// account with whatever email was typed, with no password check, and in
// production. Now it only happens when NEXT_PUBLIC_DEMO_MODE=true (an explicit
// switch for demos without Supabase), only for genuine connection failures, and
// always as one fixed, obviously fake identity.

/** Inlined at build time (NEXT_PUBLIC_). Off unless explicitly "true". */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

export const DEMO_USER = {
  id: 'usr_demo',
  firstName: 'Demo',
  lastName: 'User',
  email: 'demo@zeroday.market',
} as const

/**
 * True only for "couldn't reach the auth server". A plain TypeError is NOT
 * enough: that is also what an ordinary bug throws, and a bug must never log
 * someone in.
 */
export function isConnectionFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { name, message } = err as { name?: unknown; message?: unknown }
  // supabase-js wraps fetch failures in this error class
  if (name === 'AuthRetryableFetchError') return true
  const text = typeof message === 'string' ? message.toLowerCase() : ''
  // Chrome: "Failed to fetch", Firefox: "NetworkError when attempting...", Safari: "Load failed"
  return text.includes('failed to fetch') || text.includes('networkerror') || text === 'load failed'
}

export function shouldUseDemoFallback(err: unknown, demoMode: boolean = DEMO_MODE): boolean {
  return demoMode && isConnectionFailure(err)
}
