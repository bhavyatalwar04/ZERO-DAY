// Behavioral analysis — shared types

export type EventKind =
  // ─── Live session ────────────────────────────────────
  | 'session_start'
  | 'session_end'
  | 'minute_tick'
  | 'pause'
  | 'resume'
  | 'speed_change'
  | 'symbol_focus'
  | 'order_placed'
  | 'order_filled'
  | 'order_rejected'
  | 'order_cancelled'
  | 'sl_set'
  | 'sl_cleared'
  | 'sl_triggered'
  | 'news_dropped'
  | 'news_viewed'
  | 'circuit_started'
  | 'circuit_ended'
  | 'tab_switched'
  // ─── Pre-game tutorial ───────────────────────────────
  | 'tutorial_opened'
  | 'tutorial_slide_viewed'
  | 'tutorial_quiz_answered'
  | 'tutorial_skipped'
  | 'tutorial_completed'
  | 'cinematic_started'
  | 'cinematic_skipped'
  | 'cinematic_completed'
  | 'trial_trade_step'
  | 'trial_trade_completed'
  // ─── In-session coach prompts ────────────────────────
  | 'coach_prompt_shown'
  | 'coach_prompt_answered'
  | 'coach_skipped_all'
  // ─── Academy / Mini-games ────────────────────────────
  | 'game_started'
  | 'game_round_answered'
  | 'game_streak_milestone'
  | 'game_life_lost'
  | 'game_over'
  | 'game_completed'
  | 'game_replayed'
  | 'candle_memory_card'
  | 'plan_dragdrop_submitted'
  | 'trend_stance_change'
  // ─── Navigation / engagement ─────────────────────────
  | 'page_view'
  | 'academy_playlist_opened'
  | 'youtube_playlist_loaded'
  | 'ledger_case_opened'

export interface TraceEvent {
  t: number          // wall-clock ms
  simMinute: number  // simulated minute at time of event
  kind: EventKind
  data?: Record<string, unknown>
}

// ─── Profile ────────────────────────────────────────────────

export interface TradeRecord {
  id: string
  side: 'BUY' | 'SELL'
  symbol: string
  qty: number
  price: number
  notional: number
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
  hasThesis: boolean
  thesisLength: number
  sizingPct: number      // notional / cash-at-time
  filledAtMin: number
  walletAtTrade: number  // cash-at-time
  realizedPnL: number    // 0 for BUY, computed for SELL
}

export interface BehaviorProfile {
  // Counts
  tradeCount: number
  buyCount: number
  sellCount: number

  // Discipline
  slUsageRate: number          // % of BUY trades followed by sl_set within 60s
  thesisRate: number           // % of orders with non-empty thesis
  avgThesisLength: number
  pauseToThinkRate: number     // % of trades with ≥30s pause within prior 2 min

  // Risk
  avgPositionSizePct: number
  maxPositionSizePct: number
  oversizedTradeCount: number  // > 30% wallet

  // Emotion
  panicSellCount: number       // sells within 60s of >2% adverse tick
  fomoBuyCount: number         // buys within 30s of >3% upward move
  newsReflexCount: number      // trades within 10s of news without pause
  revengeTradeCount: number    // size grew >2x after a realized loss within 5 min
  avgWinnerHoldMs: number
  avgLoserHoldMs: number
  dispositionRatio: number     // loserHold / winnerHold

  // Engagement
  newsViewedRate: number       // unique news viewed / total fired
  pauseMinutes: number         // total time paused
  symbolsTouched: number
  timeBeforeFirstTradeMs: number

  // Outcome
  realizedPnL: number
  finalEquity: number
  startingCash: number
  dayPnL: number
  dayPnLPct: number
  winCount: number
  lossCount: number
  winRate: number

  // Raw
  trades: TradeRecord[]
}

// ─── Mistakes ───────────────────────────────────────────────

export type MistakeId =
  | 'NO_STOP_LOSS'
  | 'OVERSIZED_POSITION'
  | 'REVENGE_TRADE'
  | 'PANIC_SELL'
  | 'FOMO_BUY'
  | 'NEWS_REFLEX'
  | 'NO_THESIS'
  | 'CIRCUIT_BREAKER_ATTEMPT'
  | 'DISPOSITION_EFFECT'
  | 'OVERTRADING'
  | 'IGNORED_NEWS'
  | 'HELD_THROUGH_CLOSE'

export type Severity = 'high' | 'med' | 'low'

export interface Mistake {
  id: MistakeId
  severity: Severity
  evidence: string                  // human-readable, cites times/prices
  data: Record<string, unknown>     // structured fields the LLM can quote
}

// ─── Archetype ──────────────────────────────────────────────

export type Archetype =
  | 'Methodical'      // SLs always set, small sizes, reads news first
  | 'Cowboy'          // Big sizes, no SLs, fast trades
  | 'Frozen'          // Few trades, lots of pauses, low engagement
  | 'Reactive'        // Trades within seconds of news drops
  | 'RevengeTrader'   // Sizes grow after losses
  | 'Paperhanded'     // Exits winners early, holds losers

export interface ArchetypeCard {
  archetype: Archetype
  confidence: number             // 0-1
  oneLiner: string
  traits: string[]               // 3 short bullets
}

// ─── Debrief contract (LLM I/O) ─────────────────────────────

export interface DebriefRequest {
  /** which scenario was played (route segment); unknown or missing → COV-20 */
  scenarioId?: string
  archetype: ArchetypeCard
  profile: BehaviorProfile
  mistakes: Mistake[]
  keyEvents: TraceEvent[]
}

export interface DebriefResponse {
  // 4-5 paragraph chronological narrative
  narrative: string

  // Per-trade analysis with counterfactual
  tradeBreakdown: {
    tradeRef: string         // e.g. "Trade 1" — keyed to numerical position
    summary: string          // what happened — context + your action + outcome
    counterfactual: string   // what the optimal path would have looked like
    estimatedAvoidableLoss?: number  // rupees that could have been saved
  }[]

  // Decision points where the user took the wrong action
  criticalMoments: {
    timestamp: string        // "09:47 IST"
    description: string      // what was happening in the market
    youDid: string           // your action
    shouldHaveDone: string   // optimal action
  }[]

  // Market timing analysis — when you traded vs broader regime
  marketTiming: string

  // What worked
  wins: { headline: string; detail: string }[]

  // Mistakes — one entry per type, evidences as array, with counterfactual
  mistakes: {
    mistakeId: MistakeId
    headline: string
    explanation: string
    counterfactual: string   // specific corrective action for next session
    evidences: string[]      // all evidence strings for this mistake
  }[]

  // One actionable rule for next session
  tomorrow: string
}
