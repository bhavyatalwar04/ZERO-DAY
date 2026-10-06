import type { MonitorEventKind } from '@/lib/monitor/thresholds'
import { EVENT_PRIORITY } from '@/lib/monitor/thresholds'
import type { DetectedEvent } from '@/lib/monitor/monitor'
import { isScorecard } from '@/lib/scoring/progression'

// ============================================================================
// 2.6 What the Coach knows beyond the current decision (ADR-001 keeps the Coach
// a single call, so these are INPUTS the server computes, not tools the model
// calls):
//   - history: how often this user showed the same pattern earlier in this
//     session and in their past sessions (from the scorecards in sessions.result);
//   - taxonomy: the behavioural-finance name for each pattern, with the classic
//     reference, so feedback can name the bias, not just the behaviour.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export interface CoachHistory {
  /** events of this kind earlier in the current session (before the decision) */
  earlierThisSession: number
  /** completed, scored sessions before this one */
  pastSessions: number
  /** events of this kind across those sessions */
  inPastSessions: number
}

export const BIAS_TAXONOMY: Record<MonitorEventKind, { bias: string; note: string }> = {
  panic_sell: { bias: 'loss aversion', note: 'losses feel about twice as painful as equal gains, so fear drives selling at the worst moment (Kahneman & Tversky, 1979)' },
  averaging_down: { bias: 'the disposition effect', note: 'people hold and add to losers to avoid admitting a mistake (Shefrin & Statman, 1985)' },
  revenge_trade: { bias: 'the break-even effect', note: 'after a loss, people take bigger risks to get back to even (Thaler & Johnson, 1990)' },
  news_reflex: { bias: 'overreaction to news', note: 'vivid headlines get more weight than they deserve (De Bondt & Thaler, 1985)' },
  oversized_position: { bias: 'overconfidence', note: 'people overrate how sure they are, and size bets accordingly (Barber & Odean, 2001)' },
  overtrading: { bias: 'overconfidence in trading', note: 'the more often individuals trade, the worse they do on average (Barber & Odean, 2000)' },
}

/** History for one decision. `past`: rows of the user's sessions (RLS-scoped), any order. */
export function coachHistory(kind: string, actionSeq: number, sessionEvents: readonly DetectedEvent[], past: readonly { result: unknown }[]): CoachHistory {
  // The current session is still active, so it has no scorecard and isn't counted twice.
  const scored = past.map(r => r.result).filter(isScorecard)
  const k = (EVENT_PRIORITY as readonly string[]).includes(kind) ? (kind as MonitorEventKind) : null
  return {
    earlierThisSession: sessionEvents.filter(e => e.kind === kind && e.actionSeq < actionSeq).length,
    pastSessions: scored.length,
    inPastSessions: k ? scored.reduce((n, s) => n + (s.behaviour.events[k] ?? 0), 0) : 0,
  }
}

/** The lines added to the Coach's input. Every number here is one the Coach may quote. */
export function describeHistory(kind: string, h: CoachHistory | undefined): string[] {
  const lines: string[] = []
  const t = BIAS_TAXONOMY[kind as MonitorEventKind]
  if (t) lines.push(`Background (name the bias if it helps): ${t.bias}: ${t.note}.`)
  if (!h) return lines
  lines.push(h.earlierThisSession === 0
    ? 'This session: the first time this pattern has been flagged.'
    : `This session: this pattern was already flagged ${h.earlierThisSession} time${h.earlierThisSession === 1 ? '' : 's'} before this decision.`)
  if (h.pastSessions > 0) {
    lines.push(`Past sessions: ${h.pastSessions} completed; this pattern was flagged ${h.inPastSessions} time${h.inPastSessions === 1 ? '' : 's'} in them.`)
  }
  return lines
}
