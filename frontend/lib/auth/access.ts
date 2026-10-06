import { DEFAULT_AFTER_LOGIN } from './redirect'

// Which pages need a signed-in user (roadmap 3.4 / P5). A pure function, so the
// rules are unit-tested without running Next; proxy.ts applies the result.

/** Reachable while signed out. Everything else (that the proxy matches) requires login. */
const PUBLIC_PATHS = ['/', '/login', '/signup']
const PUBLIC_PREFIXES = ['/auth/']

export type AccessDecision = { action: 'allow' } | { action: 'redirect'; to: string }

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

export function decideAccess(
  pathname: string,
  search: string,
  opts: { signedIn: boolean; enforce: boolean },
): AccessDecision {
  // Not enforcing (Supabase not configured, or demo mode): behave as before.
  if (!opts.enforce) return { action: 'allow' }

  // Signed-in users have no reason to see the login/signup forms.
  if (opts.signedIn && (pathname === '/login' || pathname === '/signup')) {
    return { action: 'redirect', to: DEFAULT_AFTER_LOGIN }
  }
  if (opts.signedIn || isPublicPath(pathname)) return { action: 'allow' }

  return { action: 'redirect', to: `/login?next=${encodeURIComponent(pathname + search)}` }
}
