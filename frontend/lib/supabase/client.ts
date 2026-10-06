import { createBrowserClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Only treat as configured if we have a real Supabase project URL + valid-length key
export const IS_SUPABASE_CONFIGURED =
  SUPABASE_URL.startsWith('https://') &&
  SUPABASE_URL.includes('.supabase.co') &&
  SUPABASE_KEY.length > 30

// Demo mode: "Continue with Google" signs in a local demo user instead of
// redirecting to Google. On when NEXT_PUBLIC_DEMO_MODE=true or Supabase is unset.
export const IS_DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || !IS_SUPABASE_CONFIGURED

// Minimal no-op stub so the app loads without real Supabase credentials
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub: any = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
    onAuthStateChange: (_event: unknown, _cb: unknown) => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
  },
  from: () => ({
    select: () => Promise.resolve({ data: [], error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => Promise.resolve({ data: null, error: null }),
    delete: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
  }),
}

export function createClient() {
  if (!IS_SUPABASE_CONFIGURED) return stub
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY)
}
