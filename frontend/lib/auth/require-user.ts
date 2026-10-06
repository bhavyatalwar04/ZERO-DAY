import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEMO_MODE } from './demo'
import { consumeQuota, type QuotaBucket, type RpcClient } from '@/lib/db/quota'

/**
 * Sign-in check for the V1 ORUS routes (proposal P8). They were open to anonymous
 * callers, so anyone could spend the Groq quota. proxy.ts deliberately skips /api,
 * so each route checks for itself.
 * Returns the user id, or a 401 response to return as-is. `reply` is included
 * because the V1 clients display that field.
 * Demo mode (no Supabase) has no users, so it is let through.
 * Written by Claude at Bhavya's request (2026-10-03).
 */
export async function requireUser(bucket?: QuotaBucket): Promise<string | Response> {
  if (DEMO_MODE) return 'demo'
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (data.user) {
      // 8.4: per-user hourly limit on the Groq-backed routes (fails open if the limiter is missing).
      if (bucket && (await consumeQuota(supabase as unknown as RpcClient, bucket)) === 'exceeded') {
        return NextResponse.json({ error: 'rate_limited', reply: "You've used ORUS a lot in the last hour. Try again a little later." }, { status: 429 })
      }
      return data.user.id
    }
  } catch { /* treated as signed out */ }
  return NextResponse.json({ error: 'not signed in', reply: 'Sign in to use ORUS.' }, { status: 401 })
}
