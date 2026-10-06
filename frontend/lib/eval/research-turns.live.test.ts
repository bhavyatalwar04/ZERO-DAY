import { describe, it, expect } from 'vitest'
import { loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { createGroqCaller } from '@/lib/agents/model'
import { withRetry } from '@/lib/agents/retry'
import { runResearch, RESEARCH_MODEL } from '@/lib/agents/research/research'
import { COV20_DATASET } from '@/lib/monitor/test-helpers'
import { SCENARIOS } from '@/lib/engine/scenarios'
import { buildCases } from './cases'
import { pacer } from './pacing'

// LIVE: Research alone on the 12 eval cases with a pattern, recording status and
// model turns per run: the measure for the "one turn of tool calls" prompt change
// (ADR-010 finding: Groq's 7k input-tokens/min limit on qwen). `npm run eval:research`.
// Written by Claude at Bhavya's request (2026-10-03).

const env = loadEnv('test', process.cwd(), 'GROQ_')
const keys = Object.keys(env).filter(k => /^GROQ_API_KEY_\d+$/.test(k)).sort().map(k => env[k]).filter(Boolean)

describe.skipIf(keys.length === 0)('LIVE Research turns', () => {
  it('runs Research on the 12 pattern cases', async () => {
    const pace = pacer(withRetry(createGroqCaller({ keys })), { tokensPerMinute: 7000 })
    const rows: string[] = []
    let ok = 0
    for (const c of buildCases().filter(c => c.event)) {
      await pace.ready(RESEARCH_MODEL, 7000)
      const run = await runResearch({ event: c.event!, scenarioLabel: SCENARIOS['COV-20'].label }, {
        model: pace.caller,
        ctx: { session: { source: 'server_replay', scenarioId: 'COV-20', simMinute: c.event!.simMinute, state: c.before }, scenario: COV20_DATASET },
      })
      const turns = run.steps.filter(s => s.type === 'model').length
      if (run.status === 'ok') ok++
      rows.push(`| ${c.id} | ${run.status} | ${turns} | ${run.usage.promptTokens} | ${run.usage.latencyMs} | ${(run.error ?? '').slice(0, 90).replace(/\|/g, '/')} |`)
      console.log(rows.at(-1))
    }
    const date = new Date().toISOString().slice(0, 10)
    const md = [`# Research turns after the one-turn prompt (${date})`, '', `Model \`${RESEARCH_MODEL}\`, 12 eval cases, each run starting on an empty token window. **ok ${ok}/12.**`, '',
      '| Case | Status | Model turns | Input tokens | Latency ms | Error |', '|---|---|---|---|---|---|', ...rows, ''].join('\n')
    fs.writeFileSync(path.resolve(process.cwd(), `../docs/evidence/research-turns-${date}.md`), md)
    expect(rows).toHaveLength(12)
  }, 30 * 60_000)
})
