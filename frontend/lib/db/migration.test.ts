import { describe, it, expect, beforeAll } from 'vitest'
import { AGENT_NAMES, RUN_STATUSES } from '@/lib/agents/types'
import { PIPELINE_PATHS } from '@/lib/agents/pipeline'
import { createTestDb, USER_A as A, USER_B as B, type Who } from '@/test/pglite'

// ============================================================================
// The real migration(s), applied to a real Postgres (PGlite = PostgreSQL in
// WebAssembly) with a minimal Supabase shim. Every test acts as a specific
// role, because RLS behaviour is the thing we're proving.
// ============================================================================

let t: Awaited<ReturnType<typeof createTestDb>>
const as = <T,>(who: Who, fn: () => Promise<T>) => t.as(who, fn)
const rows = (sql: string, params: unknown[] = []) => t.rows(sql, params)
const affected = (sql: string, params: unknown[] = []) => t.affected(sql, params)

beforeAll(async () => { t = await createTestDb() }, 30_000)

async function startSession(user: Who): Promise<string> {
  const [row] = await as(user, () => rows(`insert into sessions (scenario_id, engine_version) values ('COV-20', 'v1') returning id`))
  return (row as { id: string }).id
}

async function append(user: Who, sessionId: string, actions: [seq: number, minute: number][]) {
  const values = actions.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}, '{"type":"PLACE_ORDER"}')`).join(', ')
  return as(user, () => rows(`insert into session_actions (session_id, seq, sim_minute, action) values ${values}`,
    [sessionId, ...actions.flat()]))
}

/** The server writing one full audit chain: event → pipeline run → agent run. */
async function writeAudit(sessionId: string) {
  return as('service', async () => {
    const [ev] = await rows(
      `insert into decision_events (session_id, action_seq, kind, sim_minute, summary, state_before)
       values ($1, 0, 'panic_sell', 95, 'Sold all INDIGO', '{"cash":100000}') returning id`, [sessionId])
    const pipelineId = crypto.randomUUID()
    await rows(
      `insert into pipeline_runs (id, session_id, decision_event_id, path, feedback, timings)
       values ($1, $2, $3, 'full', '{"message":"hi"}', '{"totalMs":2000}')`, [pipelineId, sessionId, (ev as { id: string }).id])
    await rows(
      `insert into agent_runs (id, pipeline_run_id, agent, model, status, steps)
       values ($1, $2, 'research', 'openai/gpt-oss-20b', 'ok', '[]')`, [crypto.randomUUID(), pipelineId])
    return pipelineId
  })
}

// ─── Users and their own data ───────────────────────────────

describe('sessions and the action log', () => {
  it('a user starts a session and appends actions (multi-row insert)', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 0], [1, 12], [2, 12]])
    const got = await as(A, () => rows('select seq from session_actions where session_id = $1 order by seq', [s]))
    expect(got).toEqual([{ seq: 0 }, { seq: 1 }, { seq: 2 }])
  })

  it("another user can't see it, or append to it", async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 0]])
    expect(await as(B, () => rows('select * from sessions where id = $1', [s]))).toEqual([])
    expect(await as(B, () => rows('select * from session_actions where session_id = $1', [s]))).toEqual([])
    // BEFORE INSERT triggers run before RLS's WITH CHECK, and the ordering
    // trigger runs AS B, so RLS hides A's rows from it: B's seq 1 fails the
    // ordering check first...
    await expect(append(B, s, [[1, 5]])).rejects.toThrow(/expected seq 0/)
    // ...and seq 0, which passes the trigger, is stopped by RLS itself.
    await expect(append(B, s, [[0, 5]])).rejects.toThrow(/row-level security/)
  })

  it('actions are append-only: users get no update/delete, and even the server cannot update', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 0]])
    expect(await as(A, () => affected(`update session_actions set sim_minute = 99 where session_id = $1`, [s]))).toBe(0)
    expect(await as(A, () => affected(`delete from session_actions where session_id = $1`, [s]))).toBe(0)
    await expect(as('service', () => rows(`update session_actions set sim_minute = 99 where session_id = $1`, [s])))
      .rejects.toThrow(/append-only/)
  })

  it('the log must be contiguous and time must not run backwards', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 10]])
    await expect(append(A, s, [[2, 11]])).rejects.toThrow(/expected seq 1, got 2/)
    await expect(append(A, s, [[1, 9]])).rejects.toThrow(/went backwards/)
  })

  it('no appends once the server has ended the session', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 0]])
    await as('service', () => rows(`update sessions set status = 'completed', ended_at = now() where id = $1`, [s]))
    await expect(append(A, s, [[1, 1]])).rejects.toThrow(/row-level security/)
  })

  it("a user can't end their own session or write its result", async () => {
    const s = await startSession(A)
    expect(await as(A, () => affected(`update sessions set status = 'completed', ended_at = now(), result = '{"pnl":1e9}' where id = $1`, [s]))).toBe(0)
    await expect(as(A, () => rows(`insert into sessions (scenario_id, engine_version, result) values ('COV-20', 'v1', '{"pnl":1e9}')`)))
      .rejects.toThrow(/row-level security/)
  })

  it("a user can't start a session in someone else's name", async () => {
    await expect(as(A, () => rows(`insert into sessions (user_id, scenario_id, engine_version) values ($1, 'COV-20', 'v1')`, [B])))
      .rejects.toThrow(/row-level security/)
  })

  it('signed-out visitors get nothing at all', async () => {
    await expect(as('anon', () => rows('select * from sessions'))).rejects.toThrow(/permission denied/)
  })
})

// ─── The audit trail ────────────────────────────────────────

describe('audit trail (server-written, user-readable)', () => {
  it('users cannot write decision events, pipeline runs or agent runs', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 0]])
    await expect(as(A, () => rows(
      `insert into decision_events (session_id, action_seq, kind, sim_minute, summary, state_before)
       values ($1, 0, 'x', 0, 'x', '{}')`, [s]))).rejects.toThrow(/row-level security/)
    await expect(as(A, () => rows(
      `insert into pipeline_runs (id, session_id, path, timings) values ($1, $2, 'rejected', '{}')`,
      [crypto.randomUUID(), s]))).rejects.toThrow(/row-level security/)
  })

  it('the server writes a full chain; the owner reads it, nobody else does', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 95]])
    const pipelineId = await writeAudit(s)
    expect(await as(A, () => rows('select agent, status from agent_runs where pipeline_run_id = $1', [pipelineId])))
      .toEqual([{ agent: 'research', status: 'ok' }])
    expect(await as(B, () => rows('select * from agent_runs where pipeline_run_id = $1', [pipelineId]))).toEqual([])
    expect(await as(B, () => rows('select * from decision_events where session_id = $1', [s]))).toEqual([])
  })

  it('audit rows are immutable, even for the server', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 95]])
    const pipelineId = await writeAudit(s)
    await expect(as('service', () => rows(`update agent_runs set status = 'ok' where pipeline_run_id = $1`, [pipelineId])))
      .rejects.toThrow(/append-only/)
  })

  it('a decision event must point at an action that was actually logged', async () => {
    const s = await startSession(A)
    await append(A, s, [[0, 0]])
    await expect(as('service', () => rows(
      `insert into decision_events (session_id, action_seq, kind, sim_minute, summary, state_before)
       values ($1, 7, 'x', 0, 'x', '{}')`, [s]))).rejects.toThrow(/foreign key/)
  })

  it("'rejected' pipelines have no event and no feedback; the others must have both", async () => {
    const s = await startSession(A)
    await as('service', () => rows(
      `insert into pipeline_runs (id, session_id, path, timings) values ($1, $2, 'rejected', '{}')`, [crypto.randomUUID(), s]))
    await expect(as('service', () => rows(
      `insert into pipeline_runs (id, session_id, path, feedback, timings) values ($1, $2, 'full', '{}', '{}')`,
      [crypto.randomUUID(), s]))).rejects.toThrow(/pipeline_runs_rejected_has_no_event/)
  })
})

// ─── Drift between TypeScript and the database ──────────────

describe('CHECK constraints match the TypeScript constants', () => {
  async function allowedValues(constraint: string): Promise<string[]> {
    const [row] = await rows(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1`, [constraint])
    return [...(row as { def: string }).def.matchAll(/'([^']+)'/g)].map(m => m[1]).sort()
  }

  it('agent_runs.status = RUN_STATUSES', async () => {
    expect(await allowedValues('agent_runs_status_check')).toEqual([...RUN_STATUSES].sort())
  })
  it('agent_runs.agent = AGENT_NAMES', async () => {
    expect(await allowedValues('agent_runs_agent_check')).toEqual([...AGENT_NAMES].sort())
  })
  it('pipeline_runs.path = PIPELINE_PATHS', async () => {
    expect(await allowedValues('pipeline_runs_path_check')).toEqual([...PIPELINE_PATHS].sort())
  })
})
