// ============================================================================
// 5.4 study analysis (docs/STUDY.md § Analysis plan), fixed before any data:
//   1. per participant, the OLS slope of flaggedPer10 over session number
//      (sessions with no orders skipped; at least 3 judged sessions);
//   2. compare the two groups' slopes with a one-sided Mann–Whitney U test
//      (H1: coached slopes are lower), α = 0.05, and report the effect size
//      (rank-biserial correlation) and both groups' medians.
// Exact p-value when there are no ties and the groups are small; otherwise the
// normal approximation with tie and continuity corrections (as R's wilcox.test).
// Pure functions, no I/O: `npm run study` (study-report.live.test.ts) reads the
// export and writes the report.
// Written by Claude at Bhavya's request (2026-11-04).
// ============================================================================

import type { StudyCondition } from './condition'

export interface StudyRow {
  userId: string
  sessionId: string
  endedAt: string
  scenarioId: string | null
  condition: StudyCondition
  /** null = no accepted orders: behaviour can't be judged */
  flaggedPer10: number | null
}

// ─── CSV (as exported by the Supabase SQL editor) ───────────

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(f => f !== '')) rows.push(row)
  const [header, ...body] = rows
  if (!header) return []
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

/** Rows from the export in docs/STUDY.md. Rows without a study condition (non-participants) are dropped. */
export function toStudyRows(records: Record<string, string>[]): StudyRow[] {
  return records
    .filter(r => r.condition === 'coached' || r.condition === 'control')
    .map(r => ({
      userId: r.user_id, sessionId: r.session_id, endedAt: r.ended_at, scenarioId: r.scenario_id || null,
      condition: r.condition as StudyCondition,
      flaggedPer10: r.flagged_per_10 === '' || r.flagged_per_10 === undefined || r.flagged_per_10 === 'null' ? null : Number(r.flagged_per_10),
    }))
}

// ─── Step 1: one slope per participant ──────────────────────

/** OLS slope of ys on 1..n. Same as progression.ts olsSlope, but unrounded (rounding would create false ties). */
export function slope(ys: readonly number[]): number | null {
  if (ys.length < 3) return null
  const n = ys.length
  const mx = (n + 1) / 2
  const my = ys.reduce((a, b) => a + b, 0) / n
  let cov = 0, vx = 0
  ys.forEach((y, i) => { cov += (i + 1 - mx) * (y - my); vx += (i + 1 - mx) ** 2 })
  return cov / vx
}

export interface Participant {
  userId: string
  condition: StudyCondition
  sessions: number
  judged: number
  scenarios: string[]
  slope: number | null
}

export function participants(rows: readonly StudyRow[]): Participant[] {
  const byUser = new Map<string, StudyRow[]>()
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])
  return [...byUser.entries()].map(([userId, rs]) => {
    const sorted = [...rs].sort((a, b) => a.endedAt.localeCompare(b.endedAt))
    const ys = sorted.map(r => r.flaggedPer10).filter((y): y is number => y !== null && Number.isFinite(y))
    const conditions = new Set(sorted.map(r => r.condition))
    if (conditions.size > 1) throw new Error(`participant ${userId} appears in both conditions: the assignment is broken`)
    return {
      userId, condition: sorted[0].condition, sessions: sorted.length, judged: ys.length,
      scenarios: [...new Set(sorted.map(r => r.scenarioId ?? '?'))], slope: slope(ys),
    }
  }).sort((a, b) => a.userId.localeCompare(b.userId))
}

// ─── Step 2: Mann–Whitney U ─────────────────────────────────

export type Alternative = 'less' | 'greater' | 'two-sided'

export interface MannWhitney {
  /** U for sample a: pairs (a_i, b_j) with a_i > b_j, ties counting ½. Equals R's W for wilcox.test(a, b). */
  u: number
  n1: number
  n2: number
  p: number
  method: 'exact' | 'normal'
  /** rank-biserial correlation = 2U/(n1·n2) − 1, in [−1, 1]; negative = a tends to be lower */
  rankBiserial: number
  /** P(a random a < a random b), ties counting ½ (the common-language effect size) */
  probALower: number
}

/** Mid-ranks (1-based), ties share the average rank. */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x)
  const out = new Array<number>(xs.length)
  for (let k = 0; k < order.length;) {
    let e = k
    while (e + 1 < order.length && order[e + 1].x === order[k].x) e++
    const r = (k + e) / 2 + 1
    for (let t = k; t <= e; t++) out[order[t].i] = r
    k = e + 1
  }
  return out
}

/** Exact null distribution of U for sizes m, n (no ties): P(U = u), u = 0..m·n. */
export function exactUDistribution(m: number, n: number): number[] {
  // P_{i,j}(u) = i/(i+j)·P_{i-1,j}(u−j) + j/(i+j)·P_{i,j−1}(u): the largest value is
  // either an a (beating all j b's) or a b. Probabilities, so no overflow.
  let prev: number[][] = Array.from({ length: n + 1 }, () => [1])          // i = 0: U is always 0
  for (let i = 1; i <= m; i++) {
    const cur: number[][] = [[1]]                                            // j = 0: U is always 0
    for (let j = 1; j <= n; j++) {
      const d = new Array<number>(i * j + 1).fill(0)
      const fromA = prev[j], fromB = cur[j - 1]
      for (let u = 0; u < fromA.length; u++) d[u + j] += (i / (i + j)) * fromA[u]
      for (let u = 0; u < fromB.length; u++) d[u] += (j / (i + j)) * fromB[u]
      cur.push(d)
    }
    prev = cur
  }
  return prev[n]
}

const EXACT_LIMIT = 50 // R uses the exact test when both samples are < 50 and there are no ties

export function mannWhitneyU(a: readonly number[], b: readonly number[], alternative: Alternative = 'two-sided'): MannWhitney {
  const n1 = a.length, n2 = b.length
  if (!n1 || !n2) throw new Error('both groups need at least one value')
  const r = ranks([...a, ...b])
  const rankSumA = r.slice(0, n1).reduce((s, x) => s + x, 0)
  const u = rankSumA - (n1 * (n1 + 1)) / 2
  const hasTies = new Set([...a, ...b]).size < n1 + n2

  let p: number, method: MannWhitney['method']
  if (!hasTies && n1 < EXACT_LIMIT && n2 < EXACT_LIMIT) {
    method = 'exact'
    const dist = exactUDistribution(n1, n2)
    const cdf = (k: number) => dist.slice(0, Math.floor(k) + 1).reduce((s, x) => s + x, 0)
    const pLess = cdf(u)
    const pGreater = 1 - cdf(u - 1)
    p = alternative === 'less' ? pLess : alternative === 'greater' ? pGreater : Math.min(1, 2 * Math.min(pLess, pGreater))
  } else {
    method = 'normal'
    const N = n1 + n2
    const counts = new Map<number, number>()
    for (const x of [...a, ...b]) counts.set(x, (counts.get(x) ?? 0) + 1)
    const tieTerm = [...counts.values()].reduce((s, t) => s + (t ** 3 - t), 0)
    const sigma = Math.sqrt((n1 * n2 / 12) * ((N + 1) - tieTerm / (N * (N - 1))))
    const z = u - (n1 * n2) / 2
    const cc = alternative === 'two-sided' ? Math.sign(z) * 0.5 : alternative === 'greater' ? 0.5 : -0.5
    const zc = sigma === 0 ? 0 : (z - cc) / sigma
    p = alternative === 'less' ? normalCdf(zc) : alternative === 'greater' ? 1 - normalCdf(zc) : Math.min(1, 2 * Math.min(normalCdf(zc), 1 - normalCdf(zc)))
  }
  return { u, n1, n2, p, method, rankBiserial: (2 * u) / (n1 * n2) - 1, probALower: 1 - u / (n1 * n2) }
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((p, q) => p - q)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ─── The report ─────────────────────────────────────────────

export interface StudyResult {
  participants: Participant[]
  included: { coached: number[]; control: number[] }
  excluded: Participant[]
  test: MannWhitney | null
  medians: { coached: number | null; control: number | null }
  alpha: number
}

export function analyseStudy(rows: readonly StudyRow[], alpha = 0.05): StudyResult {
  const ps = participants(rows)
  const ok = ps.filter(p => p.slope !== null)
  const coached = ok.filter(p => p.condition === 'coached').map(p => p.slope!)
  const control = ok.filter(p => p.condition === 'control').map(p => p.slope!)
  return {
    participants: ps,
    included: { coached, control },
    excluded: ps.filter(p => p.slope === null),
    // H1: coached slopes are lower (more negative) than control slopes.
    test: coached.length && control.length ? mannWhitneyU(coached, control, 'less') : null,
    medians: { coached: median(coached), control: median(control) },
    alpha,
  }
}

const f = (x: number | null, d = 2) => (x === null ? '—' : x.toFixed(d))

export function studyReport(res: StudyResult, meta: { source: string; date: string }): string {
  const { test, included, medians } = res
  const lines = [
    `# 5.4 study result (${meta.date})`,
    '',
    `Source: \`${meta.source}\`. Analysis fixed in advance in \`docs/STUDY.md\`; computed by \`npm run study\` (\`lib/study/analysis.ts\`).`,
    '',
    '## Sample',
    '',
    `| | Coached | Control |`,
    `|---|---|---|`,
    `| Participants analysed (≥ 3 judged sessions) | ${included.coached.length} | ${included.control.length} |`,
    `| Median slope of flagged-per-10 per session | ${f(medians.coached)} | ${f(medians.control)} |`,
    '',
    `Excluded (fewer than 3 sessions with orders): ${res.excluded.length}` +
      (res.excluded.length ? ` (coached ${res.excluded.filter(p => p.condition === 'coached').length}, control ${res.excluded.filter(p => p.condition === 'control').length})` : '') + '.',
    '',
    '## Test (H1: coached slopes are lower)',
    '',
  ]
  if (!test) {
    lines.push('Not run: at least one group has no analysable participant.')
  } else {
    const sig = test.p < res.alpha
    lines.push(
      `- Mann–Whitney U = ${f(test.u, 1)} (n₁ = ${test.n1} coached, n₂ = ${test.n2} control), one-sided p = ${test.p.toFixed(4)} (${test.method}).`,
      `- Rank-biserial r = ${f(test.rankBiserial)} (negative = coached slopes lower).`,
      `- P(a coached participant's slope is lower than a control participant's) = ${f(test.probALower)}.`,
      '',
      sig
        ? `At α = ${res.alpha}, H0 (no difference in slopes) is rejected in favour of H1.`
        : `At α = ${res.alpha}, H0 (no difference in slopes) is not rejected.`,
      '',
      `With ${test.n1 + test.n2} participants this is a pilot (docs/STUDY.md § Rough power): report the effect size and its direction, not a confirmed effect.`,
    )
  }
  lines.push('', '## Per participant', '', '| Participant | Group | Sessions | Judged | Scenarios | Slope |', '|---|---|---|---|---|---|')
  res.participants.forEach((p, i) => lines.push(`| P${i + 1} | ${p.condition} | ${p.sessions} | ${p.judged} | ${p.scenarios.join(', ')} | ${f(p.slope)} |`))
  lines.push('', 'Participants are numbered, not named: no user ids appear in this report.')
  return lines.join('\n') + '\n'
}
