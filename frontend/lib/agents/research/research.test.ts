import { describe, it, expect } from 'vitest'
import { NYSE } from '@/lib/engine/markets'
import { initialState } from '@/lib/engine/live-reducer'
import { COV20_DATASET } from '@/lib/engine/cov20-dataset'
import { scriptedModel } from '../model'
import type { AgentStep, ToolContext } from '../types'
import { groundingSources, ungroundedNumbers } from './grounding'
import { getPriceWindow } from './tools'
import { describeEvent, researchSpec, runResearch, type ResearchInput } from './research'

describe('ungroundedNumbers', () => {
  const sources = '{"changePct":-2.08,"price":1143.25,"at":"10:15","rsi14":28.4}'
  it('accepts numbers copied exactly or rounded, ignoring sign', () => {
    expect(ungroundedNumbers('fell 2.08% to 1143.25, RSI 28.4 at 10:15', sources)).toEqual([])
    expect(ungroundedNumbers('fell 2.1% to 1143, RSI 28', sources)).toEqual([])
  })
  it('flags invented numbers and wrong roundings', () => {
    expect(ungroundedNumbers('fell 3% to 1100, RSI 28.5', sources)).toEqual(['3', '1100', '28.5'])
  })
})

describe('groundingSources', () => {
  it('uses tool results and arguments, never the submission itself (that would be circular)', () => {
    const steps: AgentStep[] = [
      { type: 'tool', callId: 'a', name: 'get_price_window', args: { lookbackMinutes: 30 }, result: { price: 1143.25 }, latencyMs: 1 },
      { type: 'tool', callId: 'b', name: 'submit_findings', args: { summary: '777' }, result: { summary: '777' }, latencyMs: 1 },
    ]
    const src = groundingSources(steps, 'event at minute 95')
    expect(src).toContain('1143.25')
    expect(src).toContain('30')
    expect(src).toContain('95')
    expect(src).not.toContain('777')
  })
})

// ─── The agent, end to end with a scripted model and the real tools ──

const input: ResearchInput = {
  scenarioLabel: 'Covid Day Zero: 9 March 2020, NSE (India)',
  event: { kind: 'panic_sell', simMinute: 60, symbol: 'INDIGO', facts: { lossPct: 4.1 }, summary: 'Sold 10 INDIGO at a loss.' },
}
const ctx = {
  session: { source: 'server_replay' as const, scenarioId: 'COV-20', simMinute: 60, state: { ...initialState(), currentMinute: 60 } },
  scenario: COV20_DATASET,
}

async function priceWindow() {
  return getPriceWindow.run({ symbol: 'INDIGO', lookbackMinutes: 30 }, { ...ctx, signal: new AbortController().signal } as ToolContext)
}
const callWindow = { name: 'get_price_window', args: { symbol: 'INDIGO', lookbackMinutes: 30 } }
const submit = (summary: string, fact: string) => ({ name: 'submit_findings', args: { summary, evidence: [{ fact, tool: 'get_price_window' }] } })

describe('Research agent', () => {
  it('the user message carries the event, the clock time and the facts', () => {
    const msg = describeEvent(input)
    expect(msg).toMatch(/It is now 10:15 IST \(session minute 60\)/)
    // M4: other markets use their own local time
    expect(describeEvent({ ...input, market: NYSE })).toMatch(/It is now 10:30 ET \(session minute 60\)/)
    expect(msg).toMatch(/panic_sell on INDIGO/)
    expect(msg).toMatch(/lossPct: 4.1/)
  })

  it('a grounded submission is accepted', async () => {
    const w = await priceWindow()
    const model = scriptedModel([
      { toolCalls: [callWindow] },
      { toolCalls: [submit(`INDIGO moved ${w.changePct}% over 30 minutes to ${w.price}.`, `Price ${w.price}, ${w.vsPrevClosePct}% vs previous close`)] },
    ])
    const run = await runResearch(input, { model, ctx, newRunId: () => 'r1' })
    expect(run.status, run.error).toBe('ok')
    expect(run.output?.evidence[0].tool).toBe('get_price_window')
  })

  it('an invented number is rejected with the offending numbers named, then repaired', async () => {
    const w = await priceWindow()
    const model = scriptedModel([
      { toolCalls: [callWindow] },
      { toolCalls: [submit('INDIGO fell 12.34% in the last hour.', 'down 12.34%')] },
      { toolCalls: [submit(`INDIGO is at ${w.price}.`, `price ${w.price}`)] },
    ])
    const run = await runResearch(input, { model, ctx })
    expect(run.status).toBe('ok')
    const rejected = run.steps.find(s => s.type === 'tool' && s.errorKind === 'failed_check')
    expect(rejected).toMatchObject({ error: expect.stringMatching(/These numbers appear in no tool result: 12\.34/) })
  })

  it('two ungrounded submissions end as invalid_output', async () => {
    const model = scriptedModel([
      { toolCalls: [submit('INDIGO fell 12.34%.', 'down 12.34%')] },
      { toolCalls: [submit('INDIGO fell 56.7%.', 'down 56.7%')] },
    ])
    expect((await runResearch(input, { model, ctx })).status).toBe('invalid_output')
  })

  it('spec: five tools, provisional budgets, grounding check attached', () => {
    const spec = researchSpec()
    expect(spec.tools.map(t => t.name)).toEqual(['get_price_window', 'get_indicators', 'get_news', 'get_market', 'get_position'])
    expect(spec.check).toBeDefined()
    expect(spec.model).toBe('qwen/qwen3.8-27b')
  })
})
