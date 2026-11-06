import { describe, it, expect } from 'vitest'
import { analyseStudy, exactUDistribution, mannWhitneyU, median, normalCdf, parseCsv, participants, ranks, slope, studyReport, toStudyRows, type StudyRow } from './analysis'
import { olsSlope } from '@/lib/scoring/progression'
import { mulberry32 } from '@/lib/session/test-sessions'

/** Independent check: the exact one-sided p by enumerating every way to split the pooled values. */
function bruteForceP(a: number[], b: number[], alt: 'less' | 'greater'): number {
  const pooled = [...a, ...b], N = pooled.length, m = a.length
  const u = (xs: number[], ys: number[]) => xs.reduce((s, x) => s + ys.reduce((t, y) => t + (x > y ? 1 : x === y ? 0.5 : 0), 0), 0)
  const observed = u(a, b)
  let hits = 0, total = 0
  for (let mask = 0; mask < 1 << N; mask++) {
    let bits = 0
    for (let t = mask; t; t &= t - 1) bits++
    if (bits !== m) continue
    const xs = pooled.filter((_, i) => mask & (1 << i)), ys = pooled.filter((_, i) => !(mask & (1 << i)))
    const v = u(xs, ys)
    total++
    if (alt === 'less' ? v <= observed + 1e-9 : v >= observed - 1e-9) hits++
  }
  return hits / total
}

describe('Mann–Whitney U (5.4 analysis step 2)', () => {
  it("reproduces R's documented example: wilcox.test(x, y, alternative = 'g') → W = 35, p = 0.1272", () => {
    const x = [0.80, 0.83, 1.89, 1.04, 1.45, 1.38, 1.91, 1.64, 0.73, 1.46]
    const y = [1.15, 0.88, 0.90, 0.74, 1.21]
    const r = mannWhitneyU(x, y, 'greater')
    expect(r.u).toBe(35)
    expect(r.method).toBe('exact')
    expect(r.p).toBeCloseTo(0.1272, 4)
  })

  it('exact p matches brute-force enumeration on random samples', () => {
    const rand = mulberry32(7)
    for (let k = 0; k < 6; k++) {
      const a = Array.from({ length: 5 + (k % 3) }, () => Math.round(rand() * 1e6) / 1e3)
      const b = Array.from({ length: 6 }, () => Math.round(rand() * 1e6) / 1e3)
      for (const alt of ['less', 'greater'] as const) expect(mannWhitneyU(a, b, alt).p).toBeCloseTo(bruteForceP(a, b, alt), 10)
    }
  })

  it('the exact distribution is a distribution, symmetric around m·n/2', () => {
    const d = exactUDistribution(7, 9)
    expect(d).toHaveLength(64)
    expect(d.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12)
    d.forEach((p, u) => expect(p).toBeCloseTo(d[63 - u], 12))
  })

  it('with ties, the normal approximation stays close to the exact permutation p', () => {
    const a = [-1, -0.5, -0.5, 0, 0, 0.5, -1, -1.5], b = [0, 0.5, 0.5, 1, 0, -0.5, 1, 1.5]
    const r = mannWhitneyU(a, b, 'less')
    expect(r.method).toBe('normal')
    expect(Math.abs(r.p - bruteForceP(a, b, 'less'))).toBeLessThan(0.01)
  })

  it('effect sizes: complete separation gives r = −1 and P(lower) = 1', () => {
    const r = mannWhitneyU([1, 2, 3], [4, 5, 6], 'less')
    expect(r).toMatchObject({ u: 0, rankBiserial: -1, probALower: 1 })
    expect(r.p).toBeCloseTo(1 / 20, 12)   // 1 of C(6,3) = 20 splits
  })

  it('helpers: mid-ranks, median, normal CDF', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4])
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(normalCdf(0)).toBeCloseTo(0.5, 7)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6)
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 6)
  })
})

describe('per-participant slopes (5.4 analysis step 1)', () => {
  it('equals progression.ts olsSlope before rounding', () => {
    const rand = mulberry32(3)
    for (let k = 0; k < 20; k++) {
      const ys = Array.from({ length: 3 + (k % 5) }, () => Math.round(rand() * 100) / 10)
      expect(Math.round(slope(ys)! * 100) / 100).toBe(olsSlope(ys))
    }
    expect(slope([1, 2])).toBeNull()
  })

  const row = (userId: string, day: number, condition: 'coached' | 'control', flaggedPer10: number | null): StudyRow =>
    ({ userId, sessionId: `${userId}-${day}`, endedAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`, scenarioId: 'COV-20', condition, flaggedPer10 })

  it('orders sessions by time, skips sessions with no orders, needs 3 judged sessions', () => {
    const ps = participants([
      row('u1', 3, 'coached', 2), row('u1', 1, 'coached', 6), row('u1', 2, 'coached', null), row('u1', 4, 'coached', 4),
      row('u2', 1, 'control', 5), row('u2', 2, 'control', 5),
    ])
    expect(ps[0]).toMatchObject({ userId: 'u1', sessions: 4, judged: 3, slope: -1 })   // 6, 2, 4 → slope −1
    expect(ps[1]).toMatchObject({ userId: 'u2', judged: 2, slope: null })
  })

  it('refuses data where one participant is in both groups', () => {
    expect(() => participants([row('u1', 1, 'coached', 1), row('u1', 2, 'control', 1)])).toThrow(/both conditions/)
  })

  it('end to end: CSV export → result → report (no user ids leak)', () => {
    const csv = [
      'user_id,session_id,ended_at,scenario_id,condition,flagged_per_10,discipline,return_pct,vs_bh_pts',
      ...['a', 'b', 'c'].flatMap((u, i) => [1, 2, 3].map(d => `secret-${u},s${u}${d},2026-11-0${d}T10:00:00Z,COV-20,coached,${6 - d * (i + 1)},50,1,0`)),
      ...['d', 'e', 'f'].flatMap((u, i) => [1, 2, 3].map(d => `secret-${u},s${u}${d},2026-11-0${d}T10:00:00Z,"TAX-19",control,${3 + d * i},50,1,0`)),
      'secret-x,sx1,2026-11-01T10:00:00Z,COV-20,,4,50,1,0',  // non-participant: dropped
    ].join('\r\n')
    const rows = toStudyRows(parseCsv(csv))
    expect(rows).toHaveLength(18)
    const res = analyseStudy(rows)
    expect([...res.included.coached].sort((p, q) => p - q)).toEqual([-3, -2, -1])
    expect([...res.included.control].sort((p, q) => p - q)).toEqual([0, 1, 2])
    expect(res.test).toMatchObject({ u: 0, method: 'exact', rankBiserial: -1 })
    expect(res.test!.p).toBeCloseTo(0.05, 12)
    const md = studyReport(res, { source: 'export.csv', date: '2026-11-04' })
    expect(md).toContain('H0 (no difference in slopes) is not rejected')   // p = 0.05 is not < 0.05
    expect(md).not.toContain('secret-')
  })

  it('parseCsv handles quotes, doubled quotes and a trailing newline', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([{ a: 'x, y', b: 'say "hi"' }])
  })
})
