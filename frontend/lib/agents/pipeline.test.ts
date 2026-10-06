import { describe, it, expect } from 'vitest'
import { runPipeline, type DecisionEvent, type PipelineDeps, type CoachInput } from './pipeline'
import type { AgentRun, RunStatus, SessionSnapshot } from './types'

// ─── Fakes ──────────────────────────────────────────────────

type Findings = { summary: string }
type Feedback = { message: string }

const event: DecisionEvent = {
  kind: 'panic_sell', simMinute: 95, symbol: 'INDIGO',
  facts: { soldPct: 100, dayChangePct: -7.9 },
  summary: 'You sold all your INDIGO at 10:50 after a 7.9% fall.',
}
const snapshot: SessionSnapshot = {
  source: 'client_snapshot', scenarioId: 'COV-20', simMinute: 95, state: {} as SessionSnapshot['state'],
}

function agentRun<T>(agent: AgentRun<T>['agent'], status: RunStatus, output: T | null): AgentRun<T> {
  return { runId: `${agent}_1`, agent, status, output, steps: [], usage: { promptTokens: 0, completionTokens: 0, latencyMs: 0 } }
}

const never = <T>() => new Promise<T>(() => {})

function makeDeps(over: Partial<PipelineDeps<Findings, Feedback>> = {}) {
  const calls = { research: [] as { timeoutMs: number }[], coach: [] as { input: CoachInput<Findings>; timeoutMs: number }[] }
  const deps: PipelineDeps<Findings, Feedback> = {
    detect: () => [event],
    research: async (_e, opts) => { calls.research.push(opts); return agentRun('research', 'ok', { summary: 'market crashed' }) },
    coach: async (input, opts) => { calls.coach.push({ input, timeoutMs: opts.timeoutMs }); return agentRun('coach', 'ok', { message: 'AI feedback' }) },
    template: e => ({ message: `TEMPLATE: ${e.summary}` }),
    newId: () => 'pipe_1',
    ...over,
  }
  return { deps, calls }
}

const budget = { deadlineMs: 1000, coachReserveMs: 300 }

// ─── Fallback ladder [decision 2] ───────────────────────────

describe('runPipeline: fallback ladder', () => {
  it('full: research + coach succeed, and coach receives the findings', async () => {
    const { deps, calls } = makeDeps()
    const run = await runPipeline(event, snapshot, deps, budget)
    expect(run).toMatchObject({ pipelineId: 'pipe_1', path: 'full', feedback: { message: 'AI feedback' } })
    expect(calls.coach[0].input).toEqual({ event, findings: { summary: 'market crashed' } })
  })

  it('monitor_only: research fails, coach runs with findings = null', async () => {
    const { deps, calls } = makeDeps({ research: async () => agentRun<Findings>('research', 'timeout', null) })
    const run = await runPipeline(event, snapshot, deps, budget)
    expect(run.path).toBe('monitor_only')
    expect(run.feedback).toEqual({ message: 'AI feedback' })
    expect(calls.coach[0].input.findings).toBeNull()
    expect(run.research?.status).toBe('timeout')
  })

  it('template: coach fails after good research', async () => {
    const { deps } = makeDeps({ coach: async () => agentRun<Feedback>('coach', 'invalid_output', null) })
    const run = await runPipeline(event, snapshot, deps, budget)
    expect(run).toMatchObject({ path: 'template', feedback: { message: `TEMPLATE: ${event.summary}` } })
    expect(run.coach?.status).toBe('invalid_output')
  })

  it('template: both agents fail', async () => {
    const { deps } = makeDeps({
      research: async () => agentRun<Findings>('research', 'error', null),
      coach: async () => agentRun<Feedback>('coach', 'error', null),
    })
    expect((await runPipeline(event, snapshot, deps, budget)).path).toBe('template')
  })

  it('a thrown error is recorded in notes, and the ladder still applies', async () => {
    const { deps } = makeDeps({ research: async () => { throw new Error('db down') } })
    const run = await runPipeline(event, snapshot, deps, budget)
    expect(run.path).toBe('monitor_only')
    expect(run.research).toBeNull()
    expect(run.notes.join()).toMatch(/research threw: db down/)
  })
})

// ─── Server-side re-detection [decision 1] ──────────────────

describe('runPipeline: Monitor re-check', () => {
  it('rejects an event the server does not reproduce, without calling any agent', async () => {
    const { deps, calls } = makeDeps({ detect: () => [] })
    const run = await runPipeline(event, snapshot, deps, budget)
    expect(run).toMatchObject({ path: 'rejected', feedback: null, event: null })
    expect(calls.research).toHaveLength(0)
    expect(calls.coach).toHaveLength(0)
  })

  it("uses the SERVER's event, not the client's claimed facts", async () => {
    const tampered = { ...event, facts: { soldPct: 100, dayChangePct: -50 } }
    const { deps, calls } = makeDeps()
    const run = await runPipeline(tampered, snapshot, deps, budget)
    expect(run.event?.facts).toEqual(event.facts)
    expect(calls.coach[0].input.event.facts).toEqual(event.facts)
  })

  it('treats a throwing detect as "not reproduced"', async () => {
    const { deps } = makeDeps({ detect: () => { throw new Error('bad rule') } })
    const run = await runPipeline(event, snapshot, deps, budget)
    expect(run.path).toBe('rejected')
    expect(run.notes.join()).toMatch(/detect threw: bad rule/)
  })
})

// ─── Time budget [decision 3] ───────────────────────────────

describe('runPipeline: budget', () => {
  it('gives research (deadline - reserve) and coach the remainder', async () => {
    const { deps, calls } = makeDeps()
    await runPipeline(event, snapshot, deps, budget)
    expect(calls.research[0].timeoutMs).toBeLessThanOrEqual(700)
    expect(calls.research[0].timeoutMs).toBeGreaterThan(650)
    expect(calls.coach[0].timeoutMs).toBeGreaterThan(900)
  })

  it('cuts off a hanging research agent so coach still runs within the deadline', async () => {
    const { deps, calls } = makeDeps({ research: () => never() })
    const started = Date.now()
    const run = await runPipeline(event, snapshot, deps, { deadlineMs: 200, coachReserveMs: 100 })
    expect(Date.now() - started).toBeLessThan(400)
    expect(run.path).toBe('monitor_only')
    expect(run.notes.join()).toMatch(/research cut off/)
    expect(calls.coach[0].timeoutMs).toBeGreaterThanOrEqual(50)
  })

  it('cuts off a hanging coach and falls back to the template', async () => {
    const { deps } = makeDeps({ coach: () => never() })
    const started = Date.now()
    const run = await runPipeline(event, snapshot, deps, { deadlineMs: 200, coachReserveMs: 100 })
    expect(Date.now() - started).toBeLessThan(400)
    expect(run.path).toBe('template')
    expect(run.notes.join()).toMatch(/coach cut off/)
  })

  it('records timings', async () => {
    const { deps } = makeDeps()
    const run = await runPipeline(event, snapshot, deps, budget)
    expect(run.timings.totalMs).toBeGreaterThanOrEqual(run.timings.researchMs + run.timings.coachMs)
  })
})
