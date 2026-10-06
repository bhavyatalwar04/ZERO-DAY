import { CHECKS, type CheckName, type Feedback, type Score } from './rubric'
import type { ExpectedKind, MarketTruth } from './cases'

// ============================================================================
// 2.7: turns per-case results into the numbers for the thesis (Results section).
// Pure, so the aggregation itself is unit-tested (report.test.ts).
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

export const SYSTEMS = {
  A: 'Pipeline: Monitor → Research → Coach',
  B: 'Monitor → Coach (no Research)',
  C: 'Single prompt (detect + coach in one call)',
  T: 'Deterministic template (no LLM)',
} as const
export type SystemId = keyof typeof SYSTEMS

export interface SystemResult {
  system: SystemId
  /** the pattern the system acted on: Monitor's for A/B/T, the model's own for C; null = "none" */
  detected: string | null
  feedback: Feedback | null
  /** rubric score; only for cases where a pattern is present */
  score: Score | null
  status: string
  latencyMs: number
  tokens: number
  error?: string
  research?: { status: string; error?: string; tokens: number; latencyMs: number; summary?: string }
}

export interface CaseResult {
  id: string
  title: string
  expected: ExpectedKind
  truth: MarketTruth
  results: SystemResult[]
}

export interface SystemSummary {
  system: SystemId
  detectionCorrect: number
  cases: number
  falsePositives: number
  /** among cases with a pattern */
  meanScore: number
  fullMarks: number
  positives: number
  checkPass: Record<CheckName, number>
  medianLatencyMs: number
  meanTokens: number
  researchOk?: number
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const r2 = (n: number) => Math.round(n * 100) / 100

export function summarise(results: CaseResult[]): SystemSummary[] {
  return (Object.keys(SYSTEMS) as SystemId[]).flatMap(system => {
    const rows = results.map(c => ({ c, r: c.results.find(r => r.system === system) })).filter(x => x.r) as { c: CaseResult; r: SystemResult }[]
    if (!rows.length) return []
    const positives = rows.filter(x => x.c.expected !== null)
    const scored = positives.map(x => x.r.score).filter((s): s is Score => !!s)
    const checkPass = Object.fromEntries(CHECKS.map(k => [k, scored.filter(s => s.checks[k]).length])) as Record<CheckName, number>
    const withLlm = rows.filter(x => x.r.tokens > 0 || x.r.research)
    const research = positives.map(x => x.r.research).filter(Boolean)
    return [{
      system,
      detectionCorrect: rows.filter(x => (x.r.detected ?? null) === x.c.expected).length,
      cases: rows.length,
      falsePositives: rows.filter(x => x.c.expected === null && x.r.detected !== null).length,
      meanScore: scored.length ? r2(scored.reduce((n, s) => n + s.passed / s.total, 0) / positives.length) : 0,
      fullMarks: scored.filter(s => s.passed === s.total).length,
      positives: positives.length,
      checkPass,
      medianLatencyMs: Math.round(median(withLlm.map(x => x.r.latencyMs + (x.r.research?.latencyMs ?? 0)))),
      meanTokens: withLlm.length ? Math.round(withLlm.reduce((n, x) => n + x.r.tokens + (x.r.research?.tokens ?? 0), 0) / withLlm.length) : 0,
      ...(research.length ? { researchOk: research.filter(r => r!.status === 'ok').length } : {}),
    }]
  })
}

const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a')

export function toMarkdown(results: CaseResult[], meta: { date: string; models: Record<string, string>; notes?: string[] }): string {
  const sum = summarise(results)
  const lines: string[] = []
  lines.push(`# 2.7 Eval run: ${meta.date}`, '')
  lines.push(`Models: ${Object.entries(meta.models).map(([k, v]) => `${k} = \`${v}\``).join(', ')}.`, '')
  lines.push('Fixed set: 15 decisions from scripted COV-20 sessions (2 per Monitor pattern, 3 harmless). Rubric: `lib/eval/rubric.ts` (7 automatic checks). Design: ADR-010.', '')
  lines.push('## Headline', '')
  lines.push('| System | Detection (15) | False alarms (3 harmless) | Mean rubric score (12) | Full marks | Median latency | Mean tokens | Research ok |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const s of sum) {
    lines.push(`| ${s.system}: ${SYSTEMS[s.system]} | ${s.detectionCorrect}/${s.cases} | ${s.falsePositives} | ${pctOf(s.meanScore * 100, 100)} | ${s.fullMarks}/${s.positives} | ${s.medianLatencyMs ? `${s.medianLatencyMs} ms` : 'n/a'} | ${s.meanTokens || 'n/a'} | ${s.researchOk !== undefined ? `${s.researchOk}/${s.positives}` : 'n/a'} |`)
  }
  lines.push('', '## Rubric checks passed (out of the 12 cases with a pattern)', '')
  lines.push(`| System | ${CHECKS.join(' | ')} |`, `|---|${CHECKS.map(() => '---').join('|')}|`)
  for (const s of sum) lines.push(`| ${s.system} | ${CHECKS.map(k => s.checkPass[k]).join(' | ')} |`)
  lines.push('', '## Per case', '')
  lines.push(`| Case | Expected | Stock on the day | ${sum.map(s => s.system).join(' | ')} |`, `|---|---|---|${sum.map(() => '---').join('|')}|`)
  for (const c of results) {
    const cells = sum.map(s => {
      const r = c.results.find(x => x.system === s.system)
      if (!r) return '–'
      if (c.expected === null) return r.detected === null ? 'quiet ✓' : `flagged ${r.detected} ✗`
      const det = r.detected === c.expected ? '' : ` (said ${r.detected ?? 'none'})`
      return r.score ? `${r.score.passed}/${r.score.total}${det}` : `${r.status}${det}`
    })
    lines.push(`| ${c.id} | ${c.expected ?? 'none'} | ${c.truth.dayChangePct}% | ${cells.join(' | ')} |`)
  }
  lines.push('', '## Failed checks, by case', '')
  for (const c of results) for (const r of c.results) {
    if (!r.score) continue
    const failed = CHECKS.filter(k => !r.score!.checks[k])
    if (failed.length) lines.push(`- **${c.id} / ${r.system}**: ${failed.join(', ')}${r.score.ungrounded.length ? ` (ungrounded: ${r.score.ungrounded.join(', ')})` : ''}${r.feedback ? `. "${r.feedback.message}"` : ''}`)
  }
  const researchFails = results.flatMap(c => c.results.filter(r => r.research && r.research.status !== 'ok').map(r => `- ${c.id}: ${r.research!.status}${r.research!.error ? `: ${r.research!.error.slice(0, 320)}` : ''}`))
  if (researchFails.length) lines.push('', '## Research failures', '', ...researchFails)
  lines.push('', '## Caveats', '')
  lines.push('- **Labels** follow our operational definitions (ADR-006). Monitor (A, B, T) matches them by construction; system C is measured against them. This is agreement with the definitions, not ground truth about trader psychology.')
  lines.push('- **The rubric uses lexicons:** it catches a missing pattern name or a contradicted price direction, not subtle wrongness. Grounding checks where numbers came from, not what they mean.')
  lines.push('- **C can only quote numbers in its prompt.** It must compute percentages itself, and the grounding check rejects computed numbers it wasn\'t given. That is a real property of the one-prompt design (no verified computation step), not an artefact.')
  lines.push('- **T (templates) passing every check is partly circular.** The rubric was checked against the templates, and the templates were fixed using the rubric (actions added 2026-10-03). T shows the rubric is satisfiable, not that templates are better feedback.')
  lines.push('- **COV-20 prices are synthetic** (ADR-009). One run per system: LLM outputs vary between runs.')
  for (const n of meta.notes ?? []) lines.push(`- ${n}`)
  return lines.join('\n') + '\n'
}
