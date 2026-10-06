import { describe, it, expect } from 'vitest'
import { scriptedModel } from '@/lib/agents/model'
import { baselineContext, runBaseline } from './baseline'
import { buildCases } from './cases'
import { pacer } from './pacing'

const LABEL = 'Covid Day Zero: 9 March 2020, NSE (India)'
const cases = buildCases()
const avg = cases.find(c => c.id === 'avgdown-1')!

describe('single-prompt baseline (eval system C)', () => {
  it('gives the model the raw facts the pipeline agents see: orders, positions, prices, headlines', () => {
    const ctx = baselineContext(avg, LABEL)
    const pos = avg.before.positions[avg.truth.symbol]
    expect(ctx).toContain(`${avg.truth.symbol}: ${pos.qty} shares, average cost ${pos.avgPrice}`)
    expect(ctx).toContain(`previous close ${avg.truth.prevClose}`)
    expect(ctx).toMatch(/The user's LAST action: BUY \d+ /)
    // …but not Monitor's verdict or its computed facts
    expect(ctx).not.toContain('averaging_down')
    expect(ctx).not.toContain(avg.event!.summary)
  })

  it('runs as one strict-JSON call with the Coach guardrails (an invented number triggers one repair)', async () => {
    const model = scriptedModel([
      { text: JSON.stringify({ pattern: 'averaging_down', message: 'You bought more of a stock that is 99.99% below your cost. Write down a reason first.', severity: 'caution', question: 'What changed?' }) },
      { text: JSON.stringify({ pattern: 'averaging_down', message: 'You are averaging down into a losing position. Write down a reason before adding more.', severity: 'caution', question: 'What changed since your first buy?' }) },
    ])
    const run = await runBaseline(avg, LABEL, model)
    expect(run.status).toBe('ok')
    expect(run.output?.pattern).toBe('averaging_down')
    expect(model.requests).toHaveLength(2)
  })
})

describe('pacer', () => {
  it('makes a run wait for the per-model token window, before the run starts', async () => {
    let t = 0
    const waits: number[] = []
    const base = scriptedModel([{ text: 'a' }, { text: 'b' }])
    // The first call reports 5,000 tokens: a run needing 3,000 more must wait for the window.
    const model: typeof base = Object.assign(async (r: Parameters<typeof base>[0]) => {
      const res = await base(r)
      return { ...res, step: { ...res.step, promptTokens: 5000, completionTokens: 0 } }
    }, { requests: base.requests })
    const p = pacer(model, { tokensPerMinute: 7000, now: () => t, sleep: async ms => { waits.push(ms); t += ms } })
    const req = { model: 'm', messages: [], maxTokens: 10, signal: new AbortController().signal }
    await p.ready('m', 3000)
    await p.caller(req)
    await p.ready('other-model', 3000)   // separate limit per model: no wait
    expect(waits).toEqual([])
    await p.ready('m', 3000)
    expect(waits).toEqual([60_050])
  })
})
