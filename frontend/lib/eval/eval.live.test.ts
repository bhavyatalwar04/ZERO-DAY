import { describe, it, expect } from 'vitest'
import { loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { createGroqCaller } from '@/lib/agents/model'
import { withRetry } from '@/lib/agents/retry'
import { runResearch, RESEARCH_MODEL } from '@/lib/agents/research/research'
import { runCoach, describeCoachInput, COACH_MODEL, type CoachRunInput } from '@/lib/agents/coach/coach'
import { feedbackTemplate } from '@/lib/monitor/templates'
import { COV20_DATASET } from '@/lib/monitor/test-helpers'
import { SCENARIOS } from '@/lib/engine/scenarios'
import { buildCases } from './cases'
import { baselineSources, runBaseline } from './baseline'
import { scoreFeedback } from './rubric'
import { pacer } from './pacing'
import { toMarkdown, summarise, type CaseResult, type SystemResult } from './report'

// ============================================================================
// LIVE 2.7 eval: `npm run eval` (≈15–20 min on the free tier; costs real quota).
// Runs the 15 fixed cases through systems A, B, C and T (report.ts) and writes
// docs/evidence/eval-<date>.{json,md}. Observation, not a pass/fail gate.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

const env = loadEnv('test', process.cwd(), 'GROQ_')
const keys = Object.keys(env).filter(k => /^GROQ_API_KEY_\d+$/.test(k)).sort().map(k => env[k]).filter(Boolean)
const LABEL = SCENARIOS['COV-20'].label
// Groq enforces 7,000 INPUT tokens/minute on qwen (seen in the 2026-10-03 run's 429s) and
// one Research run re-sends its growing conversation (~6.9k input), so each Research run
// waits for an empty minute window: estimate = limit.
const TPM = 7_000
const RESEARCH_EST = 7_000
const COACH_EST = 1_500

const tokens = (u: { promptTokens: number; completionTokens: number }) => u.promptTokens + u.completionTokens

describe.skipIf(keys.length === 0)('LIVE 2.7 eval', () => {
  it('runs 15 cases × 4 systems and writes the report', async () => {
    const pace = pacer(withRetry(createGroqCaller({ keys })), { tokensPerMinute: TPM })
    const results: CaseResult[] = []
    for (const c of buildCases()) {
      const row: SystemResult[] = []
      const event = c.event

      if (event) {
        // T: the deterministic template (the pipeline's last resort).
        const t = feedbackTemplate(event)
        row.push({ system: 'T', detected: event.kind, feedback: t, status: 'ok', latencyMs: 0, tokens: 0,
          score: scoreFeedback(t, { expected: c.expected!, truth: c.truth, sources: event.summary }) })

        // A: Research → Coach.
        await pace.ready(RESEARCH_MODEL, RESEARCH_EST)
        const research = await runResearch({ event, scenarioLabel: LABEL }, {
          model: pace.caller,
          ctx: { session: { source: 'server_replay', scenarioId: 'COV-20', simMinute: event.simMinute, state: c.before }, scenario: COV20_DATASET },
        })
        const inA: CoachRunInput = { event, findings: research.output, scenarioLabel: LABEL }
        await pace.ready(COACH_MODEL, COACH_EST)
        const coachA = await runCoach(inA, { model: pace.caller })
        row.push({ system: 'A', detected: event.kind, feedback: coachA.output, status: coachA.status, error: coachA.error,
          latencyMs: coachA.usage.latencyMs, tokens: tokens(coachA.usage),
          score: scoreFeedback(coachA.output, { expected: c.expected!, truth: c.truth, sources: describeCoachInput(inA) }),
          research: { status: research.status, error: research.error, tokens: tokens(research.usage), latencyMs: research.usage.latencyMs, summary: research.output?.summary } })

        // B: Coach on Monitor's facts alone.
        const inB: CoachRunInput = { event, findings: null, scenarioLabel: LABEL }
        await pace.ready(COACH_MODEL, COACH_EST)
        const coachB = await runCoach(inB, { model: pace.caller })
        row.push({ system: 'B', detected: event.kind, feedback: coachB.output, status: coachB.status, error: coachB.error,
          latencyMs: coachB.usage.latencyMs, tokens: tokens(coachB.usage),
          score: scoreFeedback(coachB.output, { expected: c.expected!, truth: c.truth, sources: describeCoachInput(inB) }) })
      } else {
        // Harmless decision: Monitor stays quiet, so A, B and T make no call and show nothing.
        for (const system of ['T', 'A', 'B'] as const) row.push({ system, detected: null, feedback: null, score: null, status: 'quiet', latencyMs: 0, tokens: 0 })
      }

      // C: one prompt, detect + coach.
      await pace.ready(COACH_MODEL, COACH_EST)
      const base = await runBaseline(c, LABEL, pace.caller)
      const detected = base.output ? (base.output.pattern === 'none' ? null : base.output.pattern) : null
      row.push({ system: 'C', detected, feedback: base.output, status: base.status, error: base.error,
        latencyMs: base.usage.latencyMs, tokens: tokens(base.usage),
        score: c.expected ? scoreFeedback(base.output, { expected: c.expected, truth: c.truth, sources: baselineSources(c, LABEL) }) : null })

      results.push({ id: c.id, title: c.title, expected: c.expected, truth: c.truth, results: row })
      console.log(`${c.id}: ${row.map(r => `${r.system}=${r.score ? `${r.score.passed}/${r.score.total}` : r.detected ?? 'quiet'}${r.research ? ` (research ${r.research.status})` : ''}`).join('  ')}`)
    }

    const date = new Date().toISOString().slice(0, 10)
    const dir = path.resolve(process.cwd(), '../docs/evidence')
    fs.mkdirSync(dir, { recursive: true })
    const meta = { date, models: { research: RESEARCH_MODEL, coach: COACH_MODEL, 'single prompt': COACH_MODEL } }
    fs.writeFileSync(path.join(dir, `eval-${date}.json`), JSON.stringify({ meta, summary: summarise(results), results }, null, 2))
    fs.writeFileSync(path.join(dir, `eval-${date}.md`), toMarkdown(results, meta))
    console.log(toMarkdown(results, meta))
    expect(results).toHaveLength(15)
  }, 45 * 60_000)
})
