import { describe, it, expect } from 'vitest'
import { createActionSync, type ActionRow, type DbError, type SyncStatus, type SyncTransport } from './sync'
import type { JournalEntry } from './journal'

type A = { type: string }
const entry = (seq: number, simMinute = seq): JournalEntry<A> => ({ seq, simMinute, action: { type: `A${seq}` } })
const journal = (n: number) => Array.from({ length: n }, (_, i) => entry(i))
const NETWORK: DbError = { message: 'TypeError: Failed to fetch' }

/**
 * A fake Supabase with the real rules: seq must continue from the last stored
 * row (the order trigger, P0001), appends only while the session is active (RLS).
 * `plan` scripts what happens to each insert call.
 */
function fakeServer(plan: ('ok' | 'network' | 'lost_response' | 'fatal')[] = []) {
  const rows: ActionRow[] = []
  let active = true
  let sessions = 0
  const calls: number[][] = []
  const transport: SyncTransport = {
    async startSession() { sessions++; return { id: 'sess-1' } },
    async insert(batch) {
      calls.push(batch.map(r => r.seq))
      const step = plan.shift() ?? 'ok'
      if (step === 'network') return NETWORK
      if (step === 'fatal') return { code: '42501', message: 'new row violates row-level security policy' }
      if (!active) return { code: '42501', message: 'new row violates row-level security policy' }
      const expected = rows.length
      if (batch[0].seq !== expected) return { code: 'P0001', message: `session_actions: expected seq ${expected}, got ${batch[0].seq}` }
      rows.push(...batch)
      return step === 'lost_response' ? NETWORK : null
    },
    async lastSeq() { return rows.length - 1 },
    async endSession() { active = false; return null },
  }
  return { transport, rows, calls, sessions: () => sessions, active: () => active }
}

function setup(server: ReturnType<typeof fakeServer>, maxBatch = 50) {
  const statuses: SyncStatus[] = []
  const details: string[] = []
  const sync = createActionSync<A>({
    transport: server.transport, maxBatch,
    sleep: async () => {}, random: () => 0.5,
    onStatus: (s, d) => { statuses.push(s); if (d) details.push(d) },
  })
  return { sync, statuses, details }
}

const settle = () => new Promise(r => setTimeout(r, 0))

describe('createActionSync', () => {
  it('starts one session and sends every entry in order', async () => {
    const server = fakeServer()
    const { sync } = setup(server)
    sync.update(journal(3))
    await settle()
    expect(server.sessions()).toBe(1)
    expect(server.rows.map(r => r.seq)).toEqual([0, 1, 2])
    expect(server.rows[1]).toEqual({ session_id: 'sess-1', seq: 1, sim_minute: 1, action: { type: 'A1' } })
    expect(sync.status()).toBe('idle')
  })

  it('never has two requests in flight; entries arriving mid-flight go in the next batch', async () => {
    const server = fakeServer()
    const { sync } = setup(server)
    sync.update(journal(1))
    sync.update(journal(2))
    sync.update(journal(4))
    await settle()
    expect(server.rows.map(r => r.seq)).toEqual([0, 1, 2, 3])
    expect(server.calls).toEqual([[0, 1, 2, 3]])
  })

  it('splits large backlogs into batches', async () => {
    const server = fakeServer()
    const { sync } = setup(server, 2)
    sync.update(journal(5))
    await settle()
    expect(server.calls).toEqual([[0, 1], [2, 3], [4]])
  })

  it('retries network errors and loses nothing', async () => {
    const server = fakeServer(['network', 'network', 'ok'])
    const { sync, statuses } = setup(server)
    sync.update(journal(2))
    await settle()
    expect(server.rows.map(r => r.seq)).toEqual([0, 1])
    expect(statuses).toContain('retrying')
    expect(sync.status()).toBe('idle')
  })

  it('a lost response (rows saved, answer lost) is detected by resync, not sent twice', async () => {
    const server = fakeServer(['lost_response'])
    const { sync } = setup(server)
    sync.update(journal(2))
    await settle()
    sync.update(journal(3))
    await settle()
    expect(server.rows.map(r => r.seq)).toEqual([0, 1, 2])
    expect(sync.status()).toBe('idle')
  })

  it('stops as failed on a real database error, and the reason is kept', async () => {
    const server = fakeServer(['fatal'])
    const { sync, details } = setup(server)
    sync.update(journal(2))
    await settle()
    expect(sync.status()).toBe('failed')
    expect(details.at(-1)).toMatch(/insert: 42501/)
    sync.update(journal(3))
    await settle()
    expect(server.rows).toEqual([])
  })

  it('end() drains the queue first, then ends the session', async () => {
    const server = fakeServer(['network'])
    const { sync } = setup(server)
    sync.update(journal(3))
    await sync.end()
    expect(server.rows).toHaveLength(3)
    expect(server.active()).toBe(false)
    expect(sync.status()).toBe('ended')
  })

  it('end() while a batch is in flight still ends after it', async () => {
    const server = fakeServer()
    const { sync } = setup(server)
    sync.update(journal(2))
    const ending = sync.end()
    sync.update(journal(3))   // appended after end() was requested: still sent before ending
    await ending
    await settle()
    expect(server.rows.map(r => r.seq)).toEqual([0, 1, 2])
    expect(sync.status()).toBe('ended')
  })

  it('does not end a session whose log failed (an incomplete log must not look completed)', async () => {
    const server = fakeServer(['fatal'])
    const { sync } = setup(server)
    sync.update(journal(1))
    await sync.end()
    expect(server.active()).toBe(true)
    expect(sync.status()).toBe('failed')
  })

  it('a rejected end-of-session is reported as failed, not ended', async () => {
    const server = fakeServer()
    server.transport.endSession = async () => ({ code: '404', message: 'session not found' })
    const { sync, details } = setup(server)
    sync.update(journal(1))
    await sync.end()
    expect(sync.status()).toBe('failed')
    expect(details.at(-1)).toMatch(/end session: 404/)
  })

  it('a session that cannot start fails without inserting', async () => {
    const server = fakeServer()
    server.transport.startSession = async () => ({ error: { code: '42501', message: 'denied' } })
    const { sync, details } = setup(server)
    sync.update(journal(1))
    await settle()
    expect(sync.status()).toBe('failed')
    expect(details.at(-1)).toMatch(/start session/)
    expect(server.calls).toEqual([])
  })
})
