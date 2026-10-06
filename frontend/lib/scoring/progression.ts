import type { Scorecard } from './scorecard'

// ============================================================================
// 5.4 Cross-session progression: the thesis claim is that coached users make
// fewer behavioural mistakes over sessions. This turns a user's stored
// scorecards (sessions.result, oldest first) into a series and a trend.
//
// The trend is an ordinary least-squares slope of flagged-orders-per-10 against
// session number: negative = fewer flagged decisions per session as you go.
// With few sessions it is descriptive only: no significance claim. The study
// design (docs/STUDY.md) says how to test it properly.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export interface SessionPoint {
  sessionId: string
  endedAt: string
  scenarioId: string
  flaggedPer10: number | null
  disciplineScore: number | null
  returnPct: number
  vsBuyAndHoldPts: number
  maxDrawdownPct: number
}

export interface Progression {
  points: SessionPoint[]
  /** sessions with at least one accepted order: the only ones behaviour can be judged on */
  judged: number
  /** OLS slope of flaggedPer10 per session (negative = improving); null with < 3 judged sessions */
  flaggedSlope: number | null
  /** mean flaggedPer10 in the first and second half of the judged sessions; null with < 2 */
  firstHalf: number | null
  secondHalf: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Least-squares slope of y on x = cov(x, y) / var(x). */
export function olsSlope(ys: readonly number[]): number | null {
  if (ys.length < 3) return null
  const xs = ys.map((_, i) => i + 1)
  const mx = mean(xs)
  const my = mean([...ys])
  const cov = xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0)
  const vx = xs.reduce((n, x) => n + (x - mx) ** 2, 0)
  return vx === 0 ? null : r2(cov / vx)
}

export function progression(rows: readonly { id: string; ended_at: string | null; result: unknown }[]): Progression {
  const points: SessionPoint[] = rows
    .filter(r => r.ended_at && isScorecard(r.result))
    .sort((a, b) => a.ended_at!.localeCompare(b.ended_at!))
    .map(r => {
      const sc = r.result as Scorecard
      return {
        sessionId: r.id, endedAt: r.ended_at!, scenarioId: sc.scenarioId,
        flaggedPer10: sc.behaviour.flaggedPer10, disciplineScore: sc.behaviour.disciplineScore,
        returnPct: sc.financial.returnPct, vsBuyAndHoldPts: sc.vsBuyAndHoldPts, maxDrawdownPct: sc.financial.maxDrawdownPct,
      }
    })
  const judged = points.map(p => p.flaggedPer10).filter((v): v is number => v !== null)
  const half = Math.floor(judged.length / 2)
  return {
    points,
    judged: judged.length,
    flaggedSlope: olsSlope(judged),
    firstHalf: judged.length >= 2 ? r2(mean(judged.slice(0, half))) : null,
    secondHalf: judged.length >= 2 ? r2(mean(judged.slice(judged.length - half))) : null,
  }
}

export function isScorecard(x: unknown): x is Scorecard {
  const s = x as Partial<Scorecard> | null
  return !!s && typeof s === 'object' && typeof s.version === 'number' && !!s.financial && !!s.behaviour
}
