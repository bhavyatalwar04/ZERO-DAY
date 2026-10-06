import { describe, it, expect } from 'vitest'
import { loadEnv } from 'vite'
import { createGroqCaller } from '../model'
import { SUBMIT_TOOL_NAME, type AgentRun } from '../types'
import { reducer, initialState, type Action } from '@/lib/engine/live-reducer'
import { replaySteps } from '@/lib/session/replay'
import { monitorSession } from '@/lib/monitor/monitor'
import { buy, drive, qtyFor, sell, findMoment, px, COV20_DATASET } from '@/lib/monitor/test-helpers'
import { runResearch, type ResearchFindings } from './research'

// ============================================================================
// LIVE run of the real Research agent (2.3/2.4): `npm run test:live`.
// Real Monitor events from a scripted session → Research with the production
// limits (RESEARCH_LIMITS, 9 s) on each candidate model. Observation, not a gate.
// ============================================================================

const env = loadEnv('test', process.cwd(), 'GROQ_')
const keys = Object.keys(env).filter(k => /^GROQ_API_KEY_\d+$/.test(k)).sort().map(k => env[k]).filter(Boolean)
const MODELS = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b']

// A session with a loss-making trade followed by a big re-entry (revenge), and a trade right after a headline.
const loss = findMoment('a 5-minute loss', (s, m) => m > 20 && m + 5 < 70 && px(s, m + 5) < px(s, m) * 0.998)
const q = qtyFor(loss.symbol, loss.minute, 15_000)
const news = COV20_DATASET.news.find(n => n.fireAt > loss.minute + 30 && n.fireAt < 70)!
const session = drive([
  loss.minute, buy(loss.symbol, q), 5, sell(loss.symbol, q),
  2, buy('TCS', qtyFor('TCS', loss.minute + 7, 30_000)),
  ...(news ? [news.fireAt - (loss.minute + 7) + 1, buy('RELIANCE', 3)] : []),
])
const events = monitorSession(session.entries, COV20_DATASET)
const engine = { reducer, initialState, tick: { type: 'TICK' } as Action }
const before = new Map([...replaySteps(engine, session.entries)].map(s => [s.entry.seq, s.before]))

function report(model: string, kind: string, run: AgentRun<ResearchFindings>): string {
  const lines = [`\n══ ${model} · ${kind} → ${run.status} (${run.usage.latencyMs} ms, ${run.usage.promptTokens}+${run.usage.completionTokens} tokens)`]
  if (run.error) lines.push(`  ERROR: ${run.error}`)
  for (const s of run.steps) {
    if (s.type === 'model') lines.push(`  model: ${s.toolCalls.map(c => `${c.name}(${c.arguments})`).join(', ') || `TEXT: ${s.text?.slice(0, 100)}`}`)
    else if (s.name === SUBMIT_TOOL_NAME) lines.push(`  submit: ${s.errorKind ? `REJECTED ${s.errorKind}: ${s.error?.slice(0, 200)}` : 'accepted'}`)
    else lines.push(`  tool ${s.name}: ${s.errorKind ? `ERROR ${s.errorKind}: ${s.error?.slice(0, 120)}` : JSON.stringify(s.result).slice(0, 140)}`)
  }
  if (run.output) lines.push(`  SUMMARY: ${run.output.summary}`, ...run.output.evidence.map(e => `   - [${e.tool}] ${e.fact}`))
  return lines.join('\n')
}

describe.skipIf(keys.length === 0)('LIVE Research agent', () => {
  const model = createGroqCaller({ keys })
  it('the scripted session produced Monitor events', () => {
    console.log(`events: ${events.map(e => `${e.kind}@${e.simMinute}`).join(', ')}`)
    expect(events.length).toBeGreaterThan(0)
  })
  for (const m of MODELS) {
    it(`${m}: runs on every event without throwing`, async () => {
      for (const [i, e] of events.entries()) {
        // Free tier: 8,000 tokens/minute per model. Let the window reset between runs.
        if (i > 0) await new Promise(r => setTimeout(r, 65_000))
        const run = await runResearch(
          { event: e, scenarioLabel: 'Covid Day Zero: 9 March 2020, NSE (India)' },
          { model, modelId: m, ctx: {
            session: { source: 'server_replay', scenarioId: 'COV-20', simMinute: e.simMinute, state: before.get(e.actionSeq)! },
            scenario: COV20_DATASET,
          } },
        )
        console.log(report(m, `${e.kind}@${e.simMinute}`, run))
        expect(['ok', 'step_limit', 'invalid_output', 'timeout', 'error', 'budget_exceeded']).toContain(run.status)
      }
    }, 240_000)
  }
})
