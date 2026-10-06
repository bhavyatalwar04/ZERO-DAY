import type { ScenarioInfo } from '@/lib/engine/scenarios'
import { clockAt, formatMoney } from '@/lib/engine/markets'
import { STARTING_CASH } from '@/lib/engine/live-reducer'

// ============================================================================
// Scenario-specific copy for the live room's walkthrough (LiveTutorial) and
// coaching pauses (LiveCoachPrompts). Both were written for COV-20 (9 March
// 2020, NSE, ₹, NIFTY/BRENT), so TAX-19, ELEC-24 and GME-21 opened with the
// Covid crash briefing. COV-20 keeps its hand-written slides; the other
// scenarios get the text below, built from the scenario registry.
// Pure functions, no React: unit-tested in scenario-copy.test.ts.
// ============================================================================

/** The scenario the walkthrough, Aarav's replay and the cascade slide were written for. */
const HAND_BUILT_SCENARIO = 'COV-20'

export interface SlideCopy {
  title?: string
  body: string
  bullets?: string[]
}

export interface CoachOption {
  label: string
  correct: boolean
  explanation: string
}

export function usesHandBuiltIntro(s: ScenarioInfo): boolean {
  return s.dataset.scenarioId === HAND_BUILT_SCENARIO
}

const cash = (s: ScenarioInfo) => formatMoney(STARTING_CASH, s.market)
const stockCount = (s: ScenarioInfo) => Object.keys(s.dataset.timeline).length
const hasCircuits = (s: ScenarioInfo) => s.dataset.circuits.length > 0
const indexNames = (s: ScenarioInfo) => Object.keys(s.dataset.indices ?? {})
const leadIndex = (s: ScenarioInfo) => indexNames(s)[0] ?? 'the market index'
const timeAt = (s: ScenarioInfo, minute: number) => `${clockAt(minute, s.market)} ${s.market.tz}`

export function introSlideCopy(s: ScenarioInfo): SlideCopy {
  return {
    title: `${s.dateLabel} — ${s.title}`,
    body: `${s.briefing} ${s.objective}`,
    bullets: [
      'This is a simulation of a real market day — the day\'s open, high, low and close are real; the minute-by-minute path between them is reconstructed',
      ...(hasCircuits(s) ? ['Circuit breakers will halt trading if the market falls far enough'] : []),
      `You have ${cash(s)} and ${stockCount(s)} stocks to trade across one session`,
      'Every trade must have a written thesis — that log becomes your debrief',
    ],
  }
}

export function sessionSlideCopy(s: ScenarioInfo): SlideCopy {
  const { sessionMinutes, exchange } = s.market
  return {
    body: `Market opens at ${timeAt(s, 0)} and closes at ${timeAt(s, sessionMinutes)} — ${sessionMinutes} minutes of live trading. You will watch news drop in real time and decide whether to buy, hold, or sell under pressure.`,
    bullets: [
      `Cash: ${cash(s)} — fully available at market open`,
      `Stocks: ${stockCount(s)} ${exchange}-listed securities across sectors`,
      'No shorting — you can only sell what you own',
      'At closing bell, all positions are marked-to-market for your debrief score',
    ],
  }
}

export function clockSlideCopy(s: ScenarioInfo): SlideCopy {
  return {
    body: `The pulsing dot is the market status indicator. Green = LIVE and ticking. Red = HALTED. Grey = PAUSED. The clock shows simulated ${s.market.tz} time — ${s.dateLabel}.`,
    bullets: [`The session label ${s.dataset.scenarioId} refers to this specific simulation scenario`],
  }
}

export function indicesSlideCopy(s: ScenarioInfo): SlideCopy {
  const names = indexNames(s)
  const vix = names.includes('VIX') ? ' VIX is the fear index — high VIX means high volatility.' : ''
  return {
    body: `${names.length} market-wide indicators ticking in real time: ${names.join(', ')}. ${leadIndex(s)} is the benchmark for this session.${vix}`,
    bullets: [
      '▲ green = trading above yesterday\'s close · ▼ red = below',
      `Compare every stock with ${leadIndex(s)}: moving with it says little, moving against it is the story`,
    ],
  }
}

export function walletSlideBody(s: ScenarioInfo): string {
  return `Your spendable cash. Starts at ${cash(s)}. Decreases when you buy shares, increases when you sell. The line below shows the current market value of all stocks you hold.`
}

export function practiceSlideBody(s: ScenarioInfo): string {
  return `A practice trade in a sandbox. Make a complete BUY → set SL → wait → SELL cycle. Click each button when prompted. Nothing here counts toward your real ${cash(s)} session.`
}

/** Coaching pause 1 (at the bell): read the market before any single stock. */
export function marketReadPrompt(s: ScenarioInfo): { body: string; question: string; options: CoachOption[] } {
  const lead = leadIndex(s)
  return {
    body: `Before you place a single trade, look at the indices ticker at the top: ${indexNames(s).join(', ')}. What is the broader market telling you?`,
    question: 'Before you judge any single stock today, what should you compare it with?',
    options: [
      { label: `${lead} — a stock moving with the market tells you little; one moving against it is the story`,
        correct: true,
        explanation: `Correct. Separate the market's move from the stock's own move. ${lead} sets the tide; the gap between a stock and ${lead} is what that company's own news is doing.` },
      { label: 'Its price yesterday — nothing else matters',
        correct: false,
        explanation: 'Yesterday\'s close is your reference point, but without the market\'s move you cannot tell whether the stock is moving or the whole market is.' },
      { label: 'Nothing — just follow whatever is moving most',
        correct: false,
        explanation: 'Chasing the biggest mover without context is how traders buy the top of a squeeze or the first leg of a crash.' },
    ],
  }
}

/** Coaching pause 2 (first news drop): the analyst-downgrade question, about a stock in this scenario. */
export function signalNoiseQuestion(s: ScenarioInfo): string {
  const symbol = Object.keys(s.dataset.timeline)[0] ?? 'a stock in your watchlist'
  return `You see a headline: "Brokerage XYZ downgrades ${symbol} to NEUTRAL." How should you treat this?`
}
