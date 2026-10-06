// Action sync (3.3, ADR-005): sends the journal to session_actions, in order.
//
// Rules:
// - One request in flight at a time; each sends the next unsent entries as one batch.
// - Network errors retry forever with capped, jittered backoff: a short outage
//   loses nothing while the page stays open.
// - Any database error triggers a *resync*: ask the server for its last seq. If a
//   previous batch actually landed (the response was lost), adopt the server's
//   position and carry on. Otherwise the error is real (e.g. the session isn't
//   active, or a bug broke the order) and sync stops as 'failed'.
//   Why not key on "duplicate key": the order trigger runs BEFORE the primary-key
//   check, so a re-sent batch fails with the trigger's "expected seq" error.
// - The sim never waits for sync and never sees its errors.
// Written by Claude at Bhavya's request (2026-10-02).

import type { JournalEntry } from './journal'
import { backoffDelay, type RetryPolicy } from '@/lib/agents/backoff'

export type SyncStatus = 'idle' | 'syncing' | 'retrying' | 'failed' | 'ended'

export interface ActionRow {
  session_id: string
  seq: number
  sim_minute: number
  action: unknown
}

/** The shape of a Supabase/PostgREST error. An empty or missing code means the request never got an answer. */
export interface DbError { code?: string; message: string }

/** Thin adapter over Supabase, so the logic here is testable with a fake. Methods return errors rather than throw. */
export interface SyncTransport {
  startSession(): Promise<{ id: string } | { error: DbError }>
  insert(rows: ActionRow[]): Promise<DbError | null>
  /** Highest stored seq for the session (-1 if none). */
  lastSeq(sessionId: string): Promise<number | { error: DbError }>
  endSession(sessionId: string): Promise<DbError | null>
}

export interface SyncOptions {
  transport: SyncTransport
  maxBatch?: number
  retry?: RetryPolicy
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  onStatus?: (status: SyncStatus, detail?: string) => void
}

export const SYNC_RETRY: RetryPolicy = { maxRetries: Infinity, baseDelayMs: 500, maxDelayMs: 15_000 }

export function isNetworkError(err: DbError): boolean {
  return !err.code
}

class SyncStop extends Error {}

export function createActionSync<A>(opts: SyncOptions) {
  const { transport, maxBatch = 50, retry = SYNC_RETRY } = opts
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const random = opts.random ?? Math.random

  let entries: readonly JournalEntry<A>[] = []
  let sessionId: string | null = null
  let sent = 0
  let status: SyncStatus = 'idle'
  let endRequested = false
  let running: Promise<void> | null = null

  const setStatus = (s: SyncStatus, detail?: string) => {
    status = s
    opts.onStatus?.(s, detail)
  }
  const fail = (what: string, err: DbError): never => {
    setStatus('failed', `${what}: ${err.code ? err.code + ' ' : ''}${err.message}`)
    throw new SyncStop()
  }

  /** Runs `call` until it succeeds or fails with a non-network error. */
  async function untilAnswered<T>(call: () => Promise<T>, errorOf: (r: T) => DbError | null): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const result = await call()
      const err = errorOf(result)
      if (!err || !isNetworkError(err)) {
        if (status === 'retrying') setStatus('syncing')
        return result
      }
      setStatus('retrying', err.message)
      await sleep(backoffDelay(Math.min(attempt, 30), retry, random))
    }
  }

  const errOf = <T,>(r: T | { error: DbError }) =>
    (typeof r === 'object' && r !== null && 'error' in r ? r.error : null)

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId
    const r = await untilAnswered(() => transport.startSession(), errOf)
    if ('error' in r) return fail('start session', r.error)
    sessionId = r.id
    return sessionId
  }

  async function resync(id: string, cause: DbError) {
    const r = await untilAnswered(() => transport.lastSeq(id), errOf)
    if (typeof r !== 'number') return fail('resync', r.error)
    const serverNext = r + 1
    // The server has rows we didn't know about (a lost response): skip past them.
    if (serverNext > sent && serverNext <= entries.length) { sent = serverNext; return }
    fail('insert', cause)
  }

  async function loop() {
    try {
      const id = await ensureSession()
      while (sent < entries.length) {
        setStatus('syncing')
        const batch = entries.slice(sent, sent + maxBatch)
        const rows = batch.map(e => ({ session_id: id, seq: e.seq, sim_minute: e.simMinute, action: e.action }))
        const err = await untilAnswered(() => transport.insert(rows), e => e)
        if (err) await resync(id, err)
        else sent += batch.length
      }
      if (endRequested && status !== 'ended') {
        const err = await untilAnswered(() => transport.endSession(id), e => e)
        if (err) fail('end session', err)
        setStatus('ended')
      } else {
        setStatus('idle')
      }
    } catch (e) {
      if (!(e instanceof SyncStop)) setStatus('failed', e instanceof Error ? e.message : String(e))
    }
  }

  function kick(): Promise<void> {
    if (status === 'failed' || status === 'ended') return Promise.resolve()
    if (!running) {
      running = loop().finally(() => {
        running = null
        // Belt and braces: anything appended as the loop was finishing gets its own run.
        if (status === 'idle' && sent < entries.length) void kick()
      })
    }
    return running
  }

  return {
    /** Hand over the full journal (it only grows). Unsent entries are sent in the background. */
    update(journal: readonly JournalEntry<A>[]) {
      entries = journal
      // Entries arriving while a batch is in flight are picked up by the running loop.
      void kick()
    },
    /** Send everything, then mark the session completed on the server. */
    async end() {
      endRequested = true
      // A loop that is already running checks endRequested after draining.
      await kick()
      if (status === 'idle') await kick()
    },
    status: () => status,
    sessionId: () => sessionId,
    /** Number of entries the server has confirmed. */
    sent: () => sent,
  }
}

export type ActionSync = ReturnType<typeof createActionSync>
