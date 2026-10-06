import { describe, it, expect } from 'vitest'
import { getPriceAtMinute, initialState } from '@/lib/engine/live-reducer'
import { COV20_DATASET } from '@/lib/engine/cov20-dataset'
import { createRegistry, executeTool } from '../registry'
import type { AnyToolDef, ScenarioDataset, ToolContext, ToolStep } from '../types'
import { marketAt } from './market-view'
import { RESEARCH_TOOLS, getIndicators, getNews, getPosition, getPriceWindow, researchTools } from './tools'
import { toGroqTool } from '../groq-tools'
import type { LiveSessionState } from '@/types/live'

const SYMBOLS = Object.keys(COV20_DATASET.timeline)

const state: LiveSessionState = {
  ...initialState(),
  cash: 50_000,
  realisedPnL: -120,
  positions: { INDIGO: { symbol: 'INDIGO', qty: 10, avgPrice: 1200, realisedPnL: 0, stopPrice: 1150 } },
  orders: [
    { id: 'o1', symbol: 'INDIGO', side: 'BUY', type: 'MARKET', validity: 'DAY', quantity: 10, status: 'FILLED', placedAtMin: 3, filledAtMin: 3, filledPrice: 1200 },
    { id: 'o2', symbol: 'INDIGO', side: 'SELL', type: 'LIMIT', validity: 'DAY', quantity: 5, price: 1250, status: 'PENDING', placedAtMin: 20 },
  ],
}

function ctxAt(minute: number, scenario: ScenarioDataset = COV20_DATASET): ToolContext {
  return {
    session: { source: 'server_replay', scenarioId: 'COV-20', simMinute: minute, state: { ...state, currentMinute: minute } },
    scenario, signal: new AbortController().signal,
  }
}

const run = async (tool: AnyToolDef, args: unknown, minute: number, scenario?: ScenarioDataset) => {
  const step = await executeTool(createRegistry([tool]), { id: 'c1', name: tool.name, arguments: JSON.stringify(args) }, ctxAt(minute, scenario), 1000)
  return step
}
const ok = (step: ToolStep) => { expect(step.errorKind, step.error).toBeUndefined(); return step.result as Record<string, unknown> }

/**
 * The scenario as it existed at minute m, with the unknowable parts POISONED rather than
 * just removed: later bars/news/halts/index points are dropped, and the current bar's
 * open/high/low/volume (minutes still to come) are set to absurd values. A tool that
 * reads anything it shouldn't produces a different output on this dataset.
 */
function cutAt(scenario: ScenarioDataset, m: number): ScenarioDataset {
  const current = Math.floor(m / 5)
  const POISON = 9_999_999
  const timeline = Object.fromEntries(Object.entries(scenario.timeline).map(([s, tl]) => [s, {
    ...tl,
    bars: tl.bars.slice(0, current + 1).map((b, i) => (i < current ? b : { ...b, open: POISON, high: POISON, low: -POISON, volume: POISON })),
  }]))
  return {
    ...scenario,
    timeline,
    news: scenario.news.filter(n => n.fireAt <= m),
    circuits: scenario.circuits.filter(c => c.fireAt <= m),
    indices: Object.fromEntries(Object.entries(scenario.indices ?? {}).map(([k, v]) => [k, v.slice(0, current + 1)])),
  }
}

const argsFor = (tool: AnyToolDef, symbol: string, lookback: number) =>
  tool.name === 'get_news' || tool.name === 'get_market' ? { lookbackMinutes: lookback } : tool.name === 'get_price_window' ? { symbol, lookbackMinutes: lookback } : { symbol }

async function leaks(tool: AnyToolDef): Promise<string[]> {
  const found: string[] = []
  for (let m = 0; m < 375; m += 7) for (const s of SYMBOLS) for (const lb of [5, 30, 180]) {
    const full = await run(tool, argsFor(tool, s, lb), m)
    const cut = await run(tool, argsFor(tool, s, lb), m, cutAt(COV20_DATASET, m))
    // Compare what the model would see (result or error), not timings.
    const seen = (st: ToolStep) => JSON.stringify({ result: st.result, error: st.error, kind: st.errorKind })
    if (seen(full) !== seen(cut)) found.push(`${tool.name} ${s}@${m} lb=${lb}: ${seen(full).slice(0, 200)} ≠ ${seen(cut).slice(0, 200)}`)
  }
  return found
}

describe('no lookahead (M6, the 2026-09-23 smoke-run lesson)', () => {
  it.each(RESEARCH_TOOLS.map(t => [t.name, t]))('%s gives the same output on the scenario cut and poisoned at the decision minute', async (_, tool) => {
    expect(await leaks(tool as AnyToolDef)).toEqual([])
  })

  it('testing the test: a tool that peeks at the current bar\'s high is caught', async () => {
    const peeky: AnyToolDef = {
      ...getPriceWindow, name: 'peeky', input: getIndicators.input,
      run: async ({ symbol }: { symbol: string }, ctx: ToolContext) => ({ ...(await getPriceWindow.run({ symbol, lookbackMinutes: 5 }, ctx)),
        high: ctx.scenario.timeline[symbol].bars[Math.floor(ctx.session.simMinute / 5)].high }),
    }
    expect((await leaks(peeky)).length).toBeGreaterThan(0)
  })

  it('testing the test: a tool that reads one bar ahead is caught', async () => {
    const ahead: AnyToolDef = {
      ...getPriceWindow, name: 'ahead', input: getIndicators.input,
      run: async ({ symbol }: { symbol: string }, ctx: ToolContext) => {
        const r = await getPriceWindow.run({ symbol, lookbackMinutes: 5 }, ctx)
        const bars = ctx.scenario.timeline[symbol].bars
        return { ...r, price: bars[Math.min(bars.length - 1, Math.floor(ctx.session.simMinute / 5) + 1)]?.close ?? 0 }
      },
    }
    expect((await leaks(ahead)).length).toBeGreaterThan(0)
  })
})

describe('researchTools(symbols)', () => {
  const tools = researchTools(SYMBOLS)

  it('the schema the model sees lists the scenario’s symbols as an enum', () => {
    const groq = toGroqTool(tools.find(t => t.name === 'get_position')!)
    expect(JSON.stringify(groq.function.parameters)).toContain(JSON.stringify(SYMBOLS))
    const news = toGroqTool(tools.find(t => t.name === 'get_news')!)
    expect(JSON.stringify(news.function.parameters)).not.toContain('INDIGO')
  })

  it('a made-up symbol ("TRO", live run 2026-10-02) is rejected as invalid_args before the tool runs', async () => {
    const step = await executeTool(createRegistry(tools), { id: 'c', name: 'get_position', arguments: '{"symbol":"TRO"}' }, ctxAt(60), 1000)
    expect(step.errorKind).toBe('invalid_args')
  })
})

describe('market view', () => {
  it('prices exactly like the engine (what the user saw)', () => {
    for (const s of SYMBOLS) for (let m = 0; m <= 375; m++) expect(marketAt(COV20_DATASET, m).price(s)).toBe(getPriceAtMinute(s, m))
  })

  it('clamps later minutes to now', () => {
    const v = marketAt(COV20_DATASET, 40)
    expect(v.price('INDIGO', 300)).toBe(v.price('INDIGO'))
  })
})

describe('tools', () => {
  it('get_price_window: change and vs-previous-close match the engine\'s prices', async () => {
    const r = ok(await run(getPriceWindow, { symbol: 'indigo', lookbackMinutes: 30 }, 60))
    const p = getPriceAtMinute('INDIGO', 60), p0 = getPriceAtMinute('INDIGO', 30), pc = COV20_DATASET.timeline.INDIGO.prevClose
    expect(r).toMatchObject({ symbol: 'INDIGO', from: '09:45', to: '10:15' })
    expect(r.changePct).toBeCloseTo(((p - p0) / p0) * 100, 2)
    expect(r.vsPrevClosePct).toBeCloseTo(((p - pc) / pc) * 100, 2)
    expect(r.high as number).toBeGreaterThanOrEqual(r.low as number)
  })

  it('an unknown symbol is a tool error listing the valid symbols (the model can correct itself)', async () => {
    const step = await run(getPriceWindow, { symbol: 'TSLA', lookbackMinutes: 30 }, 60)
    expect(step.errorKind).toBe('tool_threw')
    expect(step.error).toMatch(/Use one of: .*INDIGO/)
  })

  it('a lookahead request is impossible: there is no argument for it, and extra args are rejected or ignored', async () => {
    const step = await run(getPriceWindow, { symbol: 'INDIGO', lookbackMinutes: -30 }, 60)
    expect(step.errorKind).toBe('invalid_args')
  })

  it('get_indicators: null + a note instead of a made-up value when there is too little data', async () => {
    const early = ok(await run(getIndicators, { symbol: 'TCS' }, 20))
    expect(early.rsi14).toBeNull()
    expect(early.sma60min).toBeNull()
    expect((early.notes as string[]).join(' ')).toMatch(/rsi14 needs 15 bars/)
    const later = ok(await run(getIndicators, { symbol: 'TCS' }, 120))
    expect(later.rsi14).toEqual(expect.any(Number))
    expect(later.rsi14 as number).toBeGreaterThanOrEqual(0)
    expect(later.rsi14 as number).toBeLessThanOrEqual(100)
    expect(later.notes).toEqual([])
  })

  it('get_news: newest first, and the scenario\'s answer key (signal/noise, impacts) is withheld', async () => {
    const r = ok(await run(getNews, { lookbackMinutes: 375 }, 100))
    const heads = r.headlines as { minutesAgo: number }[]
    expect(heads.length).toBeGreaterThan(0)
    expect(heads.map(h => h.minutesAgo)).toEqual([...heads.map(h => h.minutesAgo)].sort((a, b) => a - b))
    expect(JSON.stringify(r)).not.toMatch(/classification|signal|noise|pctImpact/)
  })

  it('get_position: the holding at the decision, without stop prices (stops never execute, P2)', async () => {
    const r = ok(await run(getPosition, { symbol: 'INDIGO' }, 60))
    expect(r).toMatchObject({ qty: 10, avgPrice: 1200, cash: 50_000, realisedPnLToday: -120 })
    expect(r.openOrders).toEqual([{ side: 'SELL', type: 'LIMIT', quantity: 5, limitPrice: 1250, triggerPrice: null, placedAt: '09:35' }])
    expect(JSON.stringify(r)).not.toMatch(/stop/i)
    const none = ok(await run(getPosition, { symbol: 'TCS' }, 60))
    expect(none).toMatchObject({ qty: 0, avgPrice: null, unrealisedPnL: null })
  })
})
