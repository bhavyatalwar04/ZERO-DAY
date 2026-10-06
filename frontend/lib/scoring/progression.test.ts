import { describe, it, expect } from 'vitest'
import { olsSlope, progression } from './progression'

const sc = (flaggedPer10: number | null, returnPct = 0) => ({
  version: 1, scenarioId: 'COV-20', reachedClose: true, lastMinute: 375,
  financial: { returnPct, maxDrawdownPct: 1 }, behaviour: { flaggedPer10, disciplineScore: flaggedPer10 === null ? null : 100 - flaggedPer10 * 10 },
  baselines: {}, vsBuyAndHoldPts: returnPct + 2.63,
})
const row = (i: number, result: unknown, ended: string | null = `2026-10-0${i}T10:00:00Z`) => ({ id: `s${i}`, ended_at: ended, result })

describe('5.4 progression', () => {
  it('OLS slope: exact on a straight line, null with fewer than 3 points', () => {
    expect(olsSlope([6, 4, 2])).toBe(-2)
    expect(olsSlope([1, 1, 1, 1])).toBe(0)
    expect(olsSlope([5, 3])).toBeNull()
  })

  it('orders sessions by end time, skips unscored and idle ones in the trend', () => {
    const p = progression([row(3, sc(2)), row(1, sc(6)), row(2, sc(4)), row(4, sc(null)), row(5, null), row(6, sc(1), null)])
    expect(p.points.map(x => x.sessionId)).toEqual(['s1', 's2', 's3', 's4'])
    expect(p.judged).toBe(3)
    expect(p.flaggedSlope).toBe(-2)
    expect(p.firstHalf).toBe(6)
    expect(p.secondHalf).toBe(2)
  })

  it('no sessions: an empty, honest result', () => {
    expect(progression([])).toEqual({ points: [], judged: 0, flaggedSlope: null, firstHalf: null, secondHalf: null })
  })
})
