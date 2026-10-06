import { describe, it, expect } from 'vitest'
import { loadEnv } from 'vite'
import { createGroqCaller } from '../model'
import type { DecisionEvent } from '../pipeline'
import { runCoach } from './coach'

// LIVE Coach run (2.5): `npm run test:live`. Observation, not a gate.
// Inputs are taken from the 2026-10-02 live Research run (docs/evidence/).

const env = loadEnv('test', process.cwd(), 'GROQ_')
const keys = Object.keys(env).filter(k => /^GROQ_API_KEY_\d+$/.test(k)).sort().map(k => env[k]).filter(Boolean)

const event: DecisionEvent = {
  kind: 'news_reflex', simMinute: 60, symbol: 'RELIANCE',
  facts: { newsId: 'n5', headline: 'IndiGo management memo: route review "under consideration" (yesterday\'s news)', classification: 'noise', minutesAfterNews: 1, newsNamesThisStock: false, side: 'BUY' },
  summary: 'Placed a BUY order for RELIANCE 1 minute after the headline "IndiGo management memo: route review "under consideration" (yesterday\'s news)", without pausing.',
}
const findings = {
  summary: 'RELIANCE was at 1226.79, -9.54% vs the previous close and -2.96% over the last 60 minutes; NIFTY was -7.11% vs the previous close. The latest headline was about IndiGo, not RELIANCE.',
  evidence: [
    { fact: 'RELIANCE at 1226.79, -9.54% vs prev close (1356.1), -2.96% over the last 60 minutes', tool: 'get_price_window' },
    { fact: 'NIFTY at 10207.9, -7.11% vs prev close', tool: 'get_market' },
  ],
}

describe.skipIf(keys.length === 0)('LIVE Coach', () => {
  const model = createGroqCaller({ keys })
  for (const [label, f] of [['with research', findings], ['monitor only', null]] as const) {
    it(`openai/gpt-oss-20b, ${label}`, async () => {
      const run = await runCoach({ event, findings: f, scenarioLabel: 'Covid Day Zero: 9 March 2020, NSE (India)' }, { model })
      console.log(`\n══ coach gpt-oss-20b · ${label} → ${run.status} (${run.usage.latencyMs} ms, ${run.usage.promptTokens}+${run.usage.completionTokens} tokens, ${run.steps.length} call(s))${run.error ? `\n  ERROR: ${run.error}` : ''}\n  OUTPUT: ${JSON.stringify(run.output)}`)
      expect(['ok', 'invalid_output', 'timeout', 'error']).toContain(run.status)
    }, 60_000)
  }
})
