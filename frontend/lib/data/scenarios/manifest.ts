import type { CircuitBreakerEvent, NewsEvent, OrusWhisper, StockTimeline } from '@/types/live'
import type { ScenarioDataset } from '@/lib/agents/types'
import type { MarketSpec } from '@/lib/engine/markets'
import { buildTimeline, logReturns, minutePath, type DailyBar, type ExtremeHints } from './reconstruct'

// ============================================================================
// 4.1/4.2 The scenario template: everything a scenario is, in one manifest.
// Extracted from how COV-20 is wired (dataset = timeline + news + circuits +
// indices); new scenarios are a manifest + a daily.json of REAL bars fetched by
// scripts/fetch-scenario-daily.mjs. buildScenario() turns them into the same
// ScenarioDataset the engine, Monitor and agents already use.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export interface DailyFile {
  scenarioId: string
  date: string
  fetchedAt: string
  source: string
  bars: Record<string, DailyBar & { ticker: string; prevDate: string; splitFactor: number; source: string }>
}

export interface ScenarioManifest {
  id: string
  title: string
  subtitle: string
  /** the trading day, YYYY-MM-DD */
  date: string
  /** human date for the UI, e.g. "20 September 2019" */
  dateLabel: string
  /** one line for agents and headers: "<title>: <date>, <exchange> (<country>)" */
  label: string
  market: MarketSpec
  difficulty: 1 | 2 | 3 | 4 | 5
  /** what the scenario teaches / asks of the player */
  objective: string
  /** 2–4 sentences shown before the session: context known BEFORE the open, no spoilers */
  briefing: string
  /** tradable stocks: display symbol → data ticker, name, sector */
  stocks: { symbol: string; ticker: string; name: string; sector: string }[]
  /** market context: tool/HUD name → data ticker */
  indices: { name: string; ticker: string }[]
  /** where the day's high/low fall, per display symbol or index name (e.g. after an announcement) */
  hints?: Record<string, ExtremeHints>
  news: NewsEvent[]
  circuits: CircuitBreakerEvent[]
  whispers?: OrusWhisper[]
}

export interface BuiltScenario {
  manifest: ScenarioManifest
  dataset: ScenarioDataset
  /** provenance for the UI and the report */
  dataNote: string
}

const bar = (daily: DailyFile, ticker: string): DailyBar => {
  const b = daily.bars[ticker]
  if (!b) throw new Error(`${daily.scenarioId}: no daily bar for ${ticker} (run scripts/fetch-scenario-daily.mjs)`)
  return b
}

export function buildScenario(m: ScenarioManifest, daily: DailyFile): BuiltScenario {
  if (daily.date !== m.date) throw new Error(`${m.id}: daily.json is for ${daily.date}, manifest says ${m.date}`)
  const n = m.market.sessionMinutes
  // The first index is "the market": stocks co-move with its reconstructed path.
  const lead = m.indices[0]
  const leadPath = minutePath(bar(daily, lead.ticker), { sessionMinutes: n, seed: `${m.id}:${lead.name}`, hints: m.hints?.[lead.name] })
  const market = logReturns(leadPath)

  const timeline: Record<string, StockTimeline> = {}
  for (const s of m.stocks) {
    timeline[s.symbol] = buildTimeline(s.symbol, bar(daily, s.ticker), { sessionMinutes: n, seed: `${m.id}:${s.symbol}`, hints: m.hints?.[s.symbol], market, rho: 0.6 })
  }
  const indices: NonNullable<ScenarioDataset['indices']> = {}
  for (const ix of m.indices) {
    const d = bar(daily, ix.ticker)
    const t = buildTimeline(ix.name, d, { sessionMinutes: n, seed: `${m.id}:${ix.name}`, hints: m.hints?.[ix.name], market: ix === lead ? undefined : market, rho: ix.name === 'VIX' ? -0.7 : 0.8 })   // VIX rises as stocks fall
    indices[ix.name] = t.bars.map(b => ({ minute: b.minute, value: b.close, pctChange: b.close / d.prevClose - 1 }))
  }
  return {
    manifest: m,
    dataset: { scenarioId: m.id, timeline, news: m.news, circuits: m.circuits, indices, market: m.market },
    dataNote: `Daily open/high/low/close and previous close are real (${daily.source}, fetched ${daily.fetchedAt.slice(0, 10)}). The minute-by-minute path between them is reconstructed (ADR-009).`,
  }
}
