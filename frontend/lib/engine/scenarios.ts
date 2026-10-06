import type { ScenarioDataset } from '@/lib/agents/types'
import type { OrusWhisper } from '@/types/live'
import { COV20_WHISPERS } from '@/lib/data/scenarios/cov-20/live-events'
import { COV20_DATASET } from './cov20-dataset'
import { NSE, type MarketSpec } from './markets'
import { buildScenario, type DailyFile, type ScenarioManifest } from '@/lib/data/scenarios/manifest'
import { TAX19_MANIFEST } from '@/lib/data/scenarios/tax-19/manifest'
import { ELEC24_MANIFEST } from '@/lib/data/scenarios/elec-24/manifest'
import { GME21_MANIFEST } from '@/lib/data/scenarios/gme-21/manifest'
import tax19Daily from '@/lib/data/scenarios/tax-19/daily.json'
import elec24Daily from '@/lib/data/scenarios/elec-24/daily.json'
import gme21Daily from '@/lib/data/scenarios/gme-21/daily.json'

// ============================================================================
// The scenario registry (4.5, ADR-009/011), by sessions.scenario_id. The engine,
// Monitor, agents, scoring and UI all look scenarios up here.
// COV-20 is Bhavya's hand-built scenario (synthetic prices, audit §1); the other
// three are built from a manifest + real daily bars (lib/data/scenarios/).
// Pure data and functions: no 'server-only', the browser uses it too.
// Written by Claude at Bhavya's request (2026-10-02; scenarios added 2026-10-03).
// ============================================================================

export interface ScenarioInfo {
  dataset: ScenarioDataset
  /** one line for agents and headers */
  label: string
  market: MarketSpec
  title: string
  subtitle: string
  dateLabel: string
  difficulty: number
  objective: string
  briefing: string
  /** where the prices come from, in plain words (shown in the UI) */
  dataNote: string
  /** stock display names */
  names: Record<string, string>
  /** COV-20 has a prep room (dossiers); the others go straight to a briefing */
  hasPrepRoom: boolean
  /** scripted ORUS whispers (COV-20 only so far) */
  whispers: OrusWhisper[]
}

function fromManifest(m: ScenarioManifest, daily: DailyFile): ScenarioInfo {
  const built = buildScenario(m, daily)
  return {
    dataset: built.dataset, label: m.label, market: m.market, title: m.title, subtitle: m.subtitle,
    dateLabel: m.dateLabel, difficulty: m.difficulty, objective: m.objective, briefing: m.briefing,
    dataNote: built.dataNote, names: Object.fromEntries(m.stocks.map(s => [s.symbol, s.name])), hasPrepRoom: false,
    whispers: m.whispers ?? [],
  }
}

export const SCENARIOS: Record<string, ScenarioInfo> = {
  'COV-20': {
    dataset: { ...COV20_DATASET, market: NSE },
    label: 'Covid Day Zero: 9 March 2020, NSE (India)',
    market: NSE,
    title: 'Covid Day Zero',
    subtitle: 'The day the pandemic hit Indian markets',
    dateLabel: '9 March 2020',
    difficulty: 3,
    objective: 'A crash with a circuit-breaker halt. Protect capital, find what holds up.',
    briefing: 'Covid-19 is spreading fast outside China; Italy is locking down its north, and oil prices collapsed over the weekend as Saudi Arabia and Russia fell out. Asian markets are sharply lower.',
    dataNote: 'Prices are a synthetic reconstruction of the day (one shared crash curve plus noise), not recorded market data. See docs/AUDIT.md §1.',
    names: { INDIGO: 'InterGlobe Aviation', SUNPHARMA: 'Sun Pharma', RELIANCE: 'Reliance Industries', HDFCBANK: 'HDFC Bank', TITAN: 'Titan Company', TCS: 'Tata Consultancy Services' },
    hasPrepRoom: true,
    whispers: COV20_WHISPERS,
  },
  'TAX-19': fromManifest(TAX19_MANIFEST, tax19Daily as DailyFile),
  'ELEC-24': fromManifest(ELEC24_MANIFEST, elec24Daily as DailyFile),
  'GME-21': fromManifest(GME21_MANIFEST, gme21Daily as DailyFile),
}

/** The proposal's other scenarios, and why each is out of scope (ADR-009). */
export const OUT_OF_SCOPE: { id: string; title: string; reason: string }[] = [
  { id: 'lehman-2008', title: 'Lehman Brothers Collapse', reason: 'LEH was delisted in 2008; no free daily data exists for it.' },
  { id: 'flash-crash-2010', title: 'The Flash Crash', reason: 'A 36-minute intraday event: daily bars cannot show it, so a reconstruction would be invented.' },
  { id: 'crypto-winter-2018', title: 'Crypto Winter', reason: 'A 24/7 market with no session, circuit breakers or closing bell: a different engine.' },
  { id: 'brexit-2016', title: 'Brexit Referendum', reason: 'Feasible (LSE daily data exists) but cut for time; needs an LSE market spec.' },
  { id: 'netflix-miss-2019', title: 'Netflix Subscriber Shock', reason: 'Feasible but cut for time; the move happened mostly overnight (an earnings gap).' },
  { id: 'apple-earnings-2020', title: "Apple's Surprise Quarter", reason: 'Feasible but cut for time; also an overnight earnings gap.' },
]

export const DEFAULT_SCENARIO = 'COV-20'

export function getScenario(id: string): ScenarioInfo {
  const s = SCENARIOS[id]
  if (!s) throw new Error(`Unknown scenario: ${id}`)
  return s
}
