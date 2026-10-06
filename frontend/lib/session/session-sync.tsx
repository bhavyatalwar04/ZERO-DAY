'use client'

import { useEffect, useRef, useState } from 'react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import { createClient } from '@/lib/supabase/client'
import { DEMO_MODE } from '@/lib/auth/demo'
import { createActionSync, type ActionSync } from './sync'
import { supabaseTransport } from './supabase-transport'

/**
 * Bump when the reducer's behaviour changes: replaying an old log through a
 * newer engine can give different states (ADR-003). Stored on sessions.engine_version.
 * 'cov20.2' = deterministic order ids (ADR-005).
 * 'v2.3' = multi-scenario engine: prices, session length and circuits per scenario (M4, ADR-011).
 *   COV-20 replays are unchanged; the version records that new scenarios exist.
 */
export const ENGINE_VERSION = 'v2.3'

/**
 * Sends the session journal to Supabase (3.3, ADR-005). Use inside LiveSessionProvider.
 * Pure observer: never dispatches, never blocks the sim. Off unless a real user is
 * signed in (which also covers demo mode and an unconfigured Supabase, whose stub
 * client has no user). Returns the sync object (null while off), which the decision
 * coach uses to know when an action has reached the server.
 */
export function useSessionSync(): ActionSync | null {
  const { state, journal } = useLiveSession()
  const [enabled, setEnabled] = useState<boolean | null>(DEMO_MODE ? false : null)
  const [sync, setSync] = useState<ActionSync | null>(null)
  const syncRef = useRef<ActionSync | null>(null)

  useEffect(() => {
    if (DEMO_MODE) return
    let cancelled = false
    createClient().auth.getUser()
      .then(({ data }: { data: { user: unknown } }) => { if (!cancelled) setEnabled(!!data.user) })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!enabled) return
    // A ref, not state: StrictMode re-runs effects but keeps refs, so one session per mount.
    if (!syncRef.current) {
      syncRef.current = createActionSync({
        transport: supabaseTransport(createClient(), { scenarioId: state.scenarioId, engineVersion: ENGINE_VERSION }),
        onStatus: (s, detail) => { if (s === 'failed') console.warn('[session-sync] stopped:', detail) },
      })
      setSync(syncRef.current)
    }
    syncRef.current.update(journal)
  }, [enabled, journal, state.scenarioId])

  useEffect(() => {
    if (enabled && state.status === 'CLOSED') void syncRef.current?.end()
  }, [enabled, state.status])

  return sync
}
