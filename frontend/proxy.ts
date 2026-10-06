import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { decideAccess } from '@/lib/auth/access'
import { DEMO_MODE } from '@/lib/auth/demo'

// ============================================================================
// Route guard (roadmap 3.4 / P5). Next 16 "proxy" (formerly middleware).
// Proxy ALWAYS runs on the Node.js runtime; exporting a `runtime` config here
// is a build error. The old Edge middleware is what crashed on Vercel.
//
// 1. Refreshes the Supabase session cookie (the server components can't).
// 2. Sends signed-out users from protected pages to /login?next=...
// Rules live in lib/auth/access.ts (unit-tested). /api is excluded: API routes
// must check auth themselves and answer 401, not a login redirect.
// ============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
// Same test as lib/supabase/client.ts: without a real project the app runs on a stub.
const SUPABASE_CONFIGURED = SUPABASE_URL.startsWith('https://') && SUPABASE_URL.includes('.supabase.co') && SUPABASE_KEY.length > 30

export async function proxy(request: NextRequest) {
  const enforce = SUPABASE_CONFIGURED && !DEMO_MODE
  if (!enforce) return NextResponse.next({ request })

  // The @supabase/ssr pattern: the client may refresh the session and set new
  // cookies; they must be written to BOTH the request (for this render) and the
  // response (for the browser).
  let response = NextResponse.next({ request })
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: cookiesToSet => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  let signedIn = false
  try {
    // getUser() asks Supabase to verify the token. getSession() would trust the cookie as-is.
    const { data } = await supabase.auth.getUser()
    signedIn = data.user !== null
  } catch {
    signedIn = false   // auth server unreachable: treat as signed out, never crash the request
  }

  const decision = decideAccess(request.nextUrl.pathname, request.nextUrl.search, { signedIn, enforce })
  if (decision.action === 'allow') return response

  const redirect = NextResponse.redirect(new URL(decision.to, request.url))
  // Keep any refreshed session cookies on the redirect too.
  response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
  return redirect
}

export const config = {
  // Everything except API routes, Next internals and static files.
  matcher: ['/((?!api/|_next/static|_next/image|favicon\\.ico|images/|videos/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)'],
}
