import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client with the SERVICE ROLE key: it bypasses every RLS policy.
 * Server-only (the import above makes the build fail if a client component
 * imports this). Used only for writes users must not make themselves, such as
 * the audit trail (ADR-003). Never pass it to code that handles user input as SQL.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('createAdminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server env only)')
  }
  return createClient(url, key, {
    // No user session on the server: never persist or refresh tokens.
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
