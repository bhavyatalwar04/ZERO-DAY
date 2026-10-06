import { describe, it, expect, beforeAll } from 'vitest'
import { completeSession, type SessionsDb } from './sessions'
import { handleEndSession, type CompleteResult } from '@/lib/session/end-session'
import { createTestDb, USER_A as A, type Who } from '@/test/pglite'

const SID = '11111111-1111-4111-8111-111111111111'

// ─── completeSession: the service role bypasses RLS, so its filters are the access control ──

function fakeDb(result: { data: { id: string }[] | null; error: { message: string } | null }) {
  const calls: { update?: unknown; filters: [string, string][] } = { filters: [] }
  const chain = {
    eq(col: string, v: string) { calls.filters.push([col, v]); return chain },
    select: () => Promise.resolve(result),
  }
  const db = { from: () => ({ update: (values: unknown) => { calls.update = values; return chain } }) }
  return { db: db as unknown as SessionsDb, calls }
}

describe('completeSession', () => {
  it('filters by id, owner and active status, and sets ended_at', async () => {
    const { db, calls } = fakeDb({ data: [{ id: SID }], error: null })
    const now = new Date('2026-10-02T10:00:00Z')
    expect(await completeSession(db, A, SID, now)).toBe('completed')
    expect(calls.filters).toEqual([['id', SID], ['user_id', A], ['status', 'active']])
    expect(calls.update).toEqual({ status: 'completed', ended_at: '2026-10-02T10:00:00.000Z' })
  })

  it('stores the scorecard in result when one is given (5.4)', async () => {
    const { db, calls } = fakeDb({ data: [{ id: SID }], error: null })
    const now = new Date('2026-10-02T10:00:00Z')
    await completeSession(db, A, SID, now, { version: 1 })
    expect(calls.update).toEqual({ status: 'completed', ended_at: '2026-10-02T10:00:00.000Z', result: { version: 1 } })
  })

  it('no matching row (not yours, not active, or unknown) → not_found', async () => {
    expect(await completeSession(fakeDb({ data: [], error: null }).db, A, SID)).toBe('not_found')
  })

  it('a database error is returned, not thrown', async () => {
    expect(await completeSession(fakeDb({ data: null, error: { message: 'boom' } }).db, A, SID)).toEqual({ error: 'boom' })
  })
})

// ─── POST /api/sessions/end ──────────────────────────────────

function post(body: unknown) {
  return new Request('http://x/api/sessions/end', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
}
function deps(userId: string | null, result: CompleteResult = 'completed') {
  const seen: [string, string][] = []
  return {
    seen,
    deps: {
      userId: async () => userId,
      complete: async (u: string, s: string) => { seen.push([u, s]); return result },
    },
  }
}

describe('handleEndSession', () => {
  it('401 when signed out, without touching the database', async () => {
    const d = deps(null)
    expect((await handleEndSession(post({ sessionId: SID }), d.deps)).status).toBe(401)
    expect(d.seen).toEqual([])
  })

  it.each([['not json', 'nope'], ['missing id', {}], ['not a uuid', { sessionId: '1; drop table sessions' }]])(
    '400 on a bad body (%s)', async (_, body) => {
      const d = deps(A)
      expect((await handleEndSession(post(body), d.deps)).status).toBe(400)
      expect(d.seen).toEqual([])
    })

  it('ends the session as the verified user, never a user id from the body', async () => {
    const d = deps(A)
    const res = await handleEndSession(post({ sessionId: SID, userId: 'someone-else' }), d.deps)
    expect(res.status).toBe(200)
    expect(d.seen).toEqual([[A, SID]])
  })

  it('404 when not found; 500 (without the internal message) on a database error', async () => {
    expect((await handleEndSession(post({ sessionId: SID }), deps(A, 'not_found').deps)).status).toBe(404)
    const res = await handleEndSession(post({ sessionId: SID }), deps(A, { error: 'secret detail' }).deps)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('secret detail')
  })
})

// ─── What sync.ts relies on, checked against the real migration ──

describe('database behaviour the sync queue relies on', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>
  beforeAll(async () => { t = await createTestDb() }, 30_000)
  const as = <T,>(who: Who, fn: () => Promise<T>) => t.as(who, fn)

  it('a re-sent batch fails in the order trigger (P0001), not the primary key (23505)', async () => {
    const [s] = await as(A, () => t.rows(`insert into sessions (scenario_id, engine_version) values ('COV-20', 'cov20.2') returning id`)) as { id: string }[]
    const send = () => as(A, () => t.rows(
      `insert into session_actions (session_id, seq, sim_minute, action) values ($1, 0, 0, '{"type":"START"}'), ($1, 1, 3, '{"type":"PAUSE"}')`, [s.id]))
    await send()
    const err = await send().then(() => null, (e: { code?: string; message: string }) => e)
    expect(err?.code).toBe('P0001')
    expect(err?.message).toMatch(/expected seq 2, got 0/)
  })

  it('the owner can read the last seq (what resync asks for)', async () => {
    const [s] = await as(A, () => t.rows(`insert into sessions (scenario_id, engine_version) values ('COV-20', 'cov20.2') returning id`)) as { id: string }[]
    await as(A, () => t.rows(`insert into session_actions (session_id, seq, sim_minute, action) values ($1, 0, 0, '{"type":"START"}')`, [s.id]))
    const last = await as(A, () => t.rows(`select seq from session_actions where session_id = $1 order by seq desc limit 1`, [s.id]))
    expect(last).toEqual([{ seq: 0 }])
  })
})
