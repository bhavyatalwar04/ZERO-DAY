import { describe, it, expect } from 'vitest'
import { summarise, toMarkdown, type CaseResult, type SystemResult } from './report'
import { scoreFeedback } from './rubric'

const truth = { symbol: 'TCS', price: 100, prevClose: 110, dayChangePct: -9.09, move15Pct: -1, direction: 'down' as const, niftyDayChangePct: -6 }
const good = { message: 'You are averaging down into a losing position. Write down a reason first.', question: 'What changed?' }
const sys = (system: SystemResult['system'], detected: string | null, fb = good, tokens = 1000): SystemResult => ({
  system, detected, feedback: fb, status: 'ok', latencyMs: 800, tokens,
  score: scoreFeedback(fb, { expected: 'averaging_down', truth, sources: '' }),
})

const results: CaseResult[] = [
  { id: 'avg', title: '', expected: 'averaging_down', truth, results: [sys('A', 'averaging_down'), sys('C', 'panic_sell')] },
  { id: 'ok', title: '', expected: null, truth, results: [{ ...sys('A', null), score: null, tokens: 0 }, { ...sys('C', 'overtrading'), score: null }] },
]

describe('eval report', () => {
  it('counts detection, false alarms and rubric scores per system', () => {
    const [a, c] = summarise(results)
    expect(a).toMatchObject({ system: 'A', detectionCorrect: 2, cases: 2, falsePositives: 0, meanScore: 1, fullMarks: 1, positives: 1 })
    expect(c).toMatchObject({ system: 'C', detectionCorrect: 0, falsePositives: 1 })
  })

  it('renders a markdown report with the headline table and caveats', () => {
    const md = toMarkdown(results, { date: '2026-10-03', models: { coach: 'm' } })
    expect(md).toContain('| A: Pipeline: Monitor → Research → Coach | 2/2 | 0 | 100% | 1/1 |')
    expect(md).toContain('flagged overtrading ✗')
    expect(md).toContain('(said panic_sell)')
    expect(md).toContain('## Caveats')
  })
})
