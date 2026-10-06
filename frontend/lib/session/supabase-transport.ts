import type { SupabaseClient } from '@supabase/supabase-js'
import type { DbError, SyncTransport } from './sync'

// Adapter: the sync queue's transport over the browser Supabase client (3.3).
// Inserts go straight to the database under RLS (users append only to their
// own active session); ending goes through /api/sessions/end. Every method
// returns errors instead of throwing, as sync.ts expects; a thrown error
// (fetch failed) becomes a code-less error, which sync treats as network.

const asNetwork = (e: unknown): DbError => ({ message: e instanceof Error ? e.message : String(e) })

export function supabaseTransport(
  db: SupabaseClient,
  session: { scenarioId: string; engineVersion: string },
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): SyncTransport {
  return {
    async startSession() {
      try {
        const { data, error } = await db.from('sessions')
          .insert({ scenario_id: session.scenarioId, engine_version: session.engineVersion })
          .select('id').single()
        if (error) return { error }
        return { id: (data as { id: string }).id }
      } catch (e) { return { error: asNetwork(e) } }
    },

    async insert(rows) {
      try {
        const { error } = await db.from('session_actions').insert(rows)
        return error
      } catch (e) { return asNetwork(e) }
    },

    async lastSeq(sessionId) {
      try {
        const { data, error } = await db.from('session_actions')
          .select('seq').eq('session_id', sessionId)
          .order('seq', { ascending: false }).limit(1)
        if (error) return { error }
        return (data as { seq: number }[])[0]?.seq ?? -1
      } catch (e) { return { error: asNetwork(e) } }
    },

    async endSession(sessionId) {
      try {
        const res = await fetchImpl('/api/sessions/end', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        if (res.ok) return null
        // 5xx: the server may recover, so no code → sync retries. 4xx: a real answer.
        if (res.status >= 500) return { message: `HTTP ${res.status}` }
        return { code: String(res.status), message: await res.text() }
      } catch (e) { return asNetwork(e) }
    },
  }
}
