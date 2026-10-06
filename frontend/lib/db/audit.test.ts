import { describe, it, expect, beforeAll } from 'vitest'
import { toAuditPayload, recordPipelineRun, type RpcClient, type AuditInput } from './audit'
import type { PipelineRun, DecisionEvent } from '@/lib/agents/pipeline'
import type { AgentRun } from '@/lib/agents/types'
import { createTestDb, USER_A as A, USER_B as B } from '@/test/pglite'

// ─── Fixtures ───────────────────────────────────────────────

const event: DecisionEvent = { kind: 'panic_sell', simMinute: 95, symbol: 'INDIGO', facts: { soldPct: 100 }, summary: 'Sold all INDIGO' }

function agentRun(agent: 'research' | 'coach', over: Partial<AgentRun<unknown>> = {}): AgentRun<unknown> {
  return {
    runId: crypto.randomUUID(), agent, model: 'openai/gpt-oss-20b', status: 'ok', output: { x: 1 },
    steps: [{ type: 'model', toolCalls: [], promptTokens: 100, completionTokens: 20, latencyMs: 300 }],
    usage: { promptTokens: 100, completionTokens: 20, latencyMs: 300 },
    ...over,
  }
}

function fullRun(over: Partial<PipelineRun<unknown, unknown>> = {}): PipelineRun<unknown, unknown> {
  return {
    pipelineId: crypto.randomUUID(), event, path: 'full', feedback: { message: 'Slow down.' },
    research: agentRun('research'), coach: agentRun('coach'), notes: [],
    timings: { researchMs: 2000, coachMs: 600, totalMs: 2700 },
    ...over,
  }
}

const rejectedRun = (): PipelineRun<unknown, unknown> => ({
  pipelineId: crypto.randomUUID(), event: null, path: 'rejected', feedback: null,
  research: null, coach: null, notes: ['claimed event not reproduced'], timings: { researchMs: 0, coachMs: 0, totalMs: 3 },
})

// ─── Pure mapping ───────────────────────────────────────────

describe('toAuditPayload', () => {
  it('maps camelCase runs to the snake_case payload', () => {
    const run = fullRun()
    const p = toAuditPayload({ sessionId: 's1', actionSeq: 4, stateBefore: { cash: 1 }, run })
    expect(p).toMatchObject({
      id: run.pipelineId, session_id: 's1', path: 'full', action_seq: 4, state_before: { cash: 1 },
      event: { kind: 'panic_sell', sim_minute: 95, symbol: 'INDIGO', facts: { soldPct: 100 }, summary: 'Sold all INDIGO' },
      feedback: { message: 'Slow down.' },
    })
    expect(p.agent_runs.map(r => r.agent)).toEqual(['research', 'coach'])
    expect(p.agent_runs[0]).toMatchObject({ model: 'openai/gpt-oss-20b', prompt_tokens: 100, completion_tokens: 20, latency_ms: 300, error: null })
  })

  it('skips missing agent runs (e.g. research cut off)', () => {
    const p = toAuditPayload({ sessionId: 's1', actionSeq: 0, stateBefore: {}, run: fullRun({ path: 'monitor_only', research: null }) })
    expect(p.agent_runs.map(r => r.agent)).toEqual(['coach'])
  })

  it('refuses a non-rejected run without an event or triggering action', () => {
    expect(() => toAuditPayload({ sessionId: 's1', actionSeq: null, stateBefore: {}, run: fullRun() })).toThrow(/no event or triggering action/)
  })
})

// ─── End to end against the real migrations (PGlite) ────────

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { t = await createTestDb() }, 30_000)

/** An RpcClient that runs the call as a given role in PGlite, like supabase-js does over HTTP. */
const rpcAs = (who: 'service' | typeof A): RpcClient => ({
  rpc: (fn, args) => t.as(who, async () => {
    try {
      const [row] = await t.rows(`select public.${fn}($1::jsonb) as id`, [JSON.stringify(args.p)])
      return { data: (row as { id: string }).id, error: null }
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } }
    }
  }),
})

async function sessionWithAction(): Promise<string> {
  const [row] = await t.as(A, () => t.rows(`insert into sessions (scenario_id, engine_version) values ('COV-20', 'v1') returning id`))
  const id = (row as { id: string }).id
  await t.as(A, () => t.rows(`insert into session_actions (session_id, seq, sim_minute, action) values ($1, 0, 95, '{"type":"PLACE_ORDER"}')`, [id]))
  return id
}

const input = (sessionId: string, run = fullRun()): AuditInput<unknown, unknown> =>
  ({ sessionId, actionSeq: 0, stateBefore: { cash: 100000 }, run })

describe('recordPipelineRun → record_pipeline_run()', () => {
  it('writes the whole chain; the owner can read it, another user cannot', async () => {
    const s = await sessionWithAction()
    const run = fullRun()
    expect(await recordPipelineRun(rpcAs('service'), input(s, run))).toEqual({ ok: true, id: run.pipelineId })
    const own = await t.as(A, () => t.rows(
      `select e.kind, p.path, p.feedback, count(a.*)::int as agent_runs
         from decision_events e join pipeline_runs p on p.decision_event_id = e.id
         left join agent_runs a on a.pipeline_run_id = p.id
        where e.session_id = $1 group by e.kind, p.path, p.feedback`, [s]))
    expect(own).toEqual([{ kind: 'panic_sell', path: 'full', feedback: { message: 'Slow down.' }, agent_runs: 2 }])
    expect(await t.as(B, () => t.rows(`select * from pipeline_runs where session_id = $1`, [s]))).toEqual([])
  })

  it("'rejected': no decision event, feedback stored as SQL NULL (JSON null would break the CHECK)", async () => {
    const s = await sessionWithAction()
    const run = rejectedRun()
    expect((await recordPipelineRun(rpcAs('service'), { sessionId: s, actionSeq: null, stateBefore: null, run })).ok).toBe(true)
    const [p] = await t.as('service', () => t.rows(`select decision_event_id, feedback is null as no_feedback, notes from pipeline_runs where id = $1`, [run.pipelineId]))
    expect(p).toEqual({ decision_event_id: null, no_feedback: true, notes: ['claimed event not reproduced'] })
  })

  it('is atomic: one bad agent run and NOTHING is kept', async () => {
    const s = await sessionWithAction()
    const bad = fullRun({ coach: agentRun('coach', { status: 'not_a_status' as AgentRun<unknown>['status'] }) })
    const res = await recordPipelineRun(rpcAs('service'), input(s, bad))
    expect(res.ok).toBe(false)
    expect(await t.as('service', () => t.rows(`select * from decision_events where session_id = $1`, [s]))).toEqual([])
    expect(await t.as('service', () => t.rows(`select * from pipeline_runs where session_id = $1`, [s]))).toEqual([])
  })

  it('signed-in users cannot call it (EXECUTE revoked), so they cannot forge audit records', async () => {
    const s = await sessionWithAction()
    const res = await recordPipelineRun(rpcAs(A), input(s))
    expect(res).toMatchObject({ ok: false })
    expect((res as { error: string }).error).toMatch(/permission denied for function record_pipeline_run/)
  })

  it('never throws: a client that throws becomes { ok: false }', async () => {
    const exploding: RpcClient = { rpc: () => { throw new Error('network down') } }
    expect(await recordPipelineRun(exploding, input('s'))).toEqual({ ok: false, error: 'network down' })
  })
})
