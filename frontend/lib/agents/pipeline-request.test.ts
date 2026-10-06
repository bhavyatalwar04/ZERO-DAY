import { describe, it, expect } from 'vitest'
import { monitorSession } from '@/lib/monitor/monitor'
import { buy, drive, findMoment, px, qtyFor, sell, COV20_DATASET } from '@/lib/monitor/test-helpers'
import type { JournalEntry } from '@/lib/session/journal'
import type { Action } from '@/lib/engine/live-reducer'
import { handlePipelineRequest, type PipelineRequestDeps, type PipelineResponse } from './pipeline-request'
import type { AgentRun } from './types'
import type { ResearchFindings } from './research/research'
import type { CoachFeedback } from './coach/coach'

// A real session: a losing trade, then a bigger BUY two minutes later → revenge_trade.
const loss = findMoment('a 5-minute loss', (s, m) => m > 20 && m + 5 < 70 && px(s, m + 5) < px(s, m) * 0.998)
const q = qtyFor(loss.symbol, loss.minute, 15_000)
const session = drive([loss.minute, buy(loss.symbol, q), 5, sell(loss.symbol, q), 2, buy('TCS', qtyFor('TCS', loss.minute + 7, 30_000))])
const event = monitorSession(session.entries, COV20_DATASET).find(e => e.kind === 'revenge_trade')!
const SID = '22222222-2222-4222-8222-222222222222'
const USER = 'user-1'

const findings: ResearchFindings = { summary: 'TCS context.', evidence: [{ fact: 'TCS fact', tool: 'get_price_window' }] }
const feedback: CoachFeedback = { message: 'You traded bigger right after a loss. Wait a few minutes next time.', severity: 'warning', question: 'Why this size?' }
const okRun = <T,>(agent: 'research' | 'coach', output: T): AgentRun<T> =>
  ({ runId: `${agent}-1`, agent, model: 'm', status: 'ok', output, steps: [], usage: { promptTokens: 1, completionTokens: 1, latencyMs: 1 } })

function makeDeps(over: Partial<PipelineRequestDeps> = {}) {
  const calls = { research: 0, coach: 0, records: [] as Parameters<PipelineRequestDeps['record']>[0][], researchCtx: null as unknown }
  const deps: PipelineRequestDeps = {
    userId: async () => USER,
    loadSession: async id => (id === SID ? { scenarioId: 'COV-20' } : null),
    loadActions: async (_id, upto) => JSON.parse(JSON.stringify(session.entries.filter(e => e.seq <= upto))) as JournalEntry<Action>[],
    research: async (_input, ctx) => { calls.research++; calls.researchCtx = ctx; return okRun('research', findings) },
    coach: async () => { calls.coach++; return okRun('coach', feedback) },
    record: async input => { calls.records.push(input); return { ok: true, id: 'p1' } },
    budget: { deadlineMs: 5000, coachReserveMs: 1000 },
    newId: () => 'pipe-1',
    ...over,
  }
  return { deps, calls }
}

const post = (body: unknown) => new Request('http://x/api/pipeline', { method: 'POST', body: JSON.stringify(body) })
const claim = (over: Partial<{ kind: string; simMinute: number; symbol: string }> = {}) =>
  ({ sessionId: SID, actionSeq: event.actionSeq, claimed: { kind: event.kind, simMinute: event.simMinute, symbol: event.symbol, ...over } })

describe('POST /api/pipeline', () => {
  it('fixture: the session contains a revenge_trade', () => expect(event).toBeDefined())

  it('full path: re-detects the event from the stored log, runs Research → Coach, audits, returns feedback', async () => {
    const { deps, calls } = makeDeps()
    const res = await handlePipelineRequest(post(claim()), deps)
    expect(res.status).toBe(200)
    const body = await res.json() as PipelineResponse
    expect(body).toMatchObject({ pipelineId: 'pipe-1', path: 'full', feedback, audited: true, event: { kind: 'revenge_trade', simMinute: event.simMinute } })
    expect(body.event?.summary).toBe(event.summary)   // the SERVER's event, not the client's claim
    expect(calls).toMatchObject({ research: 1, coach: 1 })
    expect(calls.records[0]).toMatchObject({ sessionId: SID, actionSeq: event.actionSeq })
  })

  it('8.4: over the hourly limit → 429 before any agent runs; an unavailable limiter fails open', async () => {
    const limited = makeDeps({ quota: async () => 'exceeded' })
    const res = await handlePipelineRequest(post(claim()), limited.deps)
    expect(res.status).toBe(429)
    expect(limited.calls).toMatchObject({ research: 0, coach: 0 })
    const open = makeDeps({ quota: async () => 'unavailable' })
    expect((await handlePipelineRequest(post(claim()), open.deps)).status).toBe(200)
  })

  it('2.6: the Coach gets the history (earlier events this session, past sessions)', async () => {
    let seen: unknown
    const { deps } = makeDeps({
      coach: async input => { seen = input.history; return okRun('coach', feedback) },
      pastSessions: async () => [{ result: { version: 1, financial: {}, behaviour: { events: { revenge_trade: 2 } } } }],
    })
    await handlePipelineRequest(post(claim()), deps)
    expect(seen).toEqual({ earlierThisSession: 0, pastSessions: 1, inPastSessions: 2 })
  })

  it('Research sees the state BEFORE the decision, rebuilt by server replay', async () => {
    const { deps, calls, } = makeDeps()
    await handlePipelineRequest(post(claim()), deps)
    const ctx = calls.researchCtx as { session: { source: string; state: { orders: unknown[] } } }
    expect(ctx.session.source).toBe('server_replay')
    // Before the revenge BUY: two orders (the losing buy and sell), not three.
    expect(ctx.session.state.orders).toHaveLength(2)
    expect(calls.records[0].stateBefore).toBe(ctx.session.state)
  })

  it('a claim the server cannot reproduce is rejected before any tokens are spent, and still audited', async () => {
    const { deps, calls } = makeDeps()
    const body = await (await handlePipelineRequest(post(claim({ kind: 'panic_sell' })), deps)).json() as PipelineResponse
    expect(body).toMatchObject({ path: 'rejected', feedback: null, event: null })
    expect(calls).toMatchObject({ research: 0, coach: 0 })
    expect(calls.records[0]).toMatchObject({ actionSeq: null })
  })

  it('an event from an EARLIER action cannot be re-claimed for a later actionSeq', async () => {
    const { deps } = makeDeps()
    const body = await (await handlePipelineRequest(post({ ...claim(), actionSeq: event.actionSeq - 1 }), deps)).json() as PipelineResponse
    expect(body.path).toBe('rejected')
  })

  it('Research failing → monitor_only; Coach failing → template; both still answer 200', async () => {
    const fail = <T,>(agent: 'research' | 'coach'): AgentRun<T> => ({ ...okRun<T>(agent, null as T), status: 'error', output: null, error: 'boom' })
    const r1 = await (await handlePipelineRequest(post(claim()), makeDeps({ research: async () => fail('research') }).deps)).json() as PipelineResponse
    expect(r1).toMatchObject({ path: 'monitor_only', feedback })
    const r2 = await (await handlePipelineRequest(post(claim()), makeDeps({ coach: async () => fail('coach') }).deps)).json() as PipelineResponse
    expect(r2.path).toBe('template')
    expect(r2.feedback?.message).toContain(event.summary)
  })

  it('a failed audit write still returns the feedback, flagged audited:false', async () => {
    const { deps } = makeDeps({ record: async () => ({ ok: false, error: 'db down' }) })
    const body = await (await handlePipelineRequest(post(claim()), deps)).json() as PipelineResponse
    expect(body).toMatchObject({ path: 'full', audited: false })
  })

  it('401 signed out · 400 bad body · 404 not your session · 409 not synced yet · 400 unsupported scenario', async () => {
    expect((await handlePipelineRequest(post(claim()), makeDeps({ userId: async () => null }).deps)).status).toBe(401)
    expect((await handlePipelineRequest(post({ sessionId: 'nope' }), makeDeps().deps)).status).toBe(400)
    expect((await handlePipelineRequest(post({ ...claim(), sessionId: '33333333-3333-4333-8333-333333333333' }), makeDeps().deps)).status).toBe(404)
    const lagging = makeDeps({ loadActions: async () => session.entries.slice(0, event.actionSeq) as JournalEntry<Action>[] })
    const r = await handlePipelineRequest(post(claim()), lagging.deps)
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ error: 'not_synced' })
    expect((await handlePipelineRequest(post(claim()), makeDeps({ loadSession: async () => ({ scenarioId: 'LEHMAN-08' }) }).deps)).status).toBe(400)
  })

  it('422 when the stored log is inconsistent (replay refuses to guess)', async () => {
    const broken = session.entries.map(e => (e.seq === 1 ? { ...e, simMinute: e.simMinute + 50 } : e))
    const { deps } = makeDeps({ loadActions: async (_id, upto) => broken.filter(e => e.seq <= upto) as JournalEntry<Action>[] })
    expect((await handlePipelineRequest(post(claim()), deps)).status).toBe(422)
  })
})
