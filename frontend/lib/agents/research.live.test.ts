import { describe, it, expect } from 'vitest'
import { loadEnv } from 'vite'
import { z } from 'zod'
import { runReactAgent } from './react-loop'
import { runSingleShot } from './single-shot'
import { createGroqCaller } from './model'
import { SUBMIT_TOOL_NAME, type AgentRun, type AgentSpec, type AnyToolDef, type ToolContext } from './types'
import { COV20_TIMELINE } from '@/lib/data/scenarios/cov-20/timeline'
import { COV20_NEWS_EVENTS } from '@/lib/data/scenarios/cov-20/live-events'

// ============================================================================
// LIVE smoke run against the real Groq API: `npm run test:live`.
// Excluded from `npm test` and CI. Costs real tokens on your key.
// Purpose: first evidence of how real models behave in our loop. It is an
// observation, not a quality gate; the only hard assertion is "never throws".
// The tools here are throwaway; the real Research tools are designed in 2.4.
// ============================================================================

const env = loadEnv('test', process.cwd(), 'GROQ_')
const keys = Object.keys(env).filter(k => /^GROQ_API_KEY_\d+$/.test(k)).sort().map(k => env[k]).filter(Boolean)

const MODELS = ['llama-3.1-8b-instant', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']
const SYMBOLS = ['INDIGO', 'SUNPHARMA', 'RELIANCE', 'HDFCBANK', 'TITAN', 'TCS'] as const

const ist = (minute: number) => {
  const t = 9 * 60 + 15 + minute
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const round2 = (n: number) => Math.round(n * 100) / 100

// ─── Throwaway tools (small summaries, not raw bars) ────────

const getPriceSummary: AnyToolDef = {
  name: 'get_price_summary',
  description: 'Price summary for one stock between two session minutes (0 = 09:15 IST, 375 = 15:30 IST). Returns open, close, high, low and % change over the window, plus % change vs previous day close.',
  input: z.object({
    symbol: z.enum(SYMBOLS),
    fromMinute: z.number().int().min(0).max(375),
    toMinute: z.number().int().min(0).max(375),
  }),
  output: z.object({
    symbol: z.string(), from: z.string(), to: z.string(),
    open: z.number(), close: z.number(), high: z.number(), low: z.number(),
    windowChangePct: z.number(), vsPrevClosePct: z.number(),
  }),
  run: async ({ symbol, fromMinute, toMinute }) => {
    const tl = COV20_TIMELINE[symbol]
    const bars = tl.bars.filter(b => b.minute >= Math.min(fromMinute, toMinute) && b.minute <= Math.max(fromMinute, toMinute))
    if (bars.length === 0) throw new Error(`No bars between minute ${fromMinute} and ${toMinute}; bars are every 5 minutes`)
    const open = bars[0].open
    const close = bars[bars.length - 1].close
    return {
      symbol, from: ist(bars[0].minute), to: ist(bars[bars.length - 1].minute),
      open: round2(open), close: round2(close),
      high: round2(Math.max(...bars.map(b => b.high))), low: round2(Math.min(...bars.map(b => b.low))),
      windowChangePct: round2(((close - open) / open) * 100),
      vsPrevClosePct: round2(((close - tl.prevClose) / tl.prevClose) * 100),
    }
  },
}

const getNews: AnyToolDef = {
  name: 'get_news',
  description: 'News headlines published between two session minutes (0 = 09:15 IST). At most 8, oldest first.',
  input: z.object({ fromMinute: z.number().int().min(0).max(375), toMinute: z.number().int().min(0).max(375) }),
  output: z.array(z.object({ time: z.string(), headline: z.string(), source: z.string(), severity: z.string() })),
  run: async ({ fromMinute, toMinute }) =>
    COV20_NEWS_EVENTS
      .filter(n => n.fireAt >= fromMinute && n.fireAt <= toMinute)
      .slice(0, 8)
      // classification (signal/noise) is withheld on purpose: judging it is the agent's job
      .map(n => ({ time: ist(n.fireAt), headline: n.headline, source: n.source ?? 'unknown', severity: n.severity })),
}

// ─── The agent under test ───────────────────────────────────

const Findings = z.object({
  summary: z.string().max(600).describe('2-4 sentences of factual market context for the user decision'),
  evidence: z.array(z.object({
    fact: z.string().describe('one fact, with numbers exactly as returned by a tool'),
    tool: z.enum(['get_price_summary', 'get_news']),
  })).min(1).max(5),
  confidence: z.number().min(0).max(1),
})
type Findings = z.infer<typeof Findings>

interface Event { description: string }

const spec = (model: string): AgentSpec<Event, Findings> => ({
  name: 'research',
  kind: 'react',
  model,
  systemPrompt: [
    'You are the Research agent in a trading simulator replaying 9 March 2020 on the NSE (India).',
    'Given a user decision, gather factual market context with the tools, then call submit_findings.',
    'Rules: every number you state must come from a tool result. Do not judge the user; another agent does that.',
    'Use at most 3 tool calls before submitting.',
  ].join('\n'),
  buildUserMessage: e => `Decision event: ${e.description}`,
  tools: [getPriceSummary, getNews],
  output: Findings,
  limits: { maxSteps: 5, maxTokens: 600, timeoutMs: 45_000, toolTimeoutMs: 2_000 },
})

const EVENT: Event = {
  description: 'At 10:50 IST (session minute 95) the user sold their entire INDIGO position at market.',
}

const ctx: Omit<ToolContext, 'signal'> = {
  session: { source: 'client_snapshot', scenarioId: 'COV-20', simMinute: 95, state: {} as ToolContext['session']['state'] },
  scenario: { scenarioId: 'COV-20', timeline: COV20_TIMELINE, news: COV20_NEWS_EVENTS, circuits: [] },
}

// ─── Grounding check (the FinVQA-Chart idea, measured) ──────

/** Numbers in the final summary/evidence that appear in no tool result and not in the question. */
function ungroundedNumbers(run: AgentRun<Findings>): string[] {
  if (!run.output) return []
  // Exclude the submit step: its "result" IS the answer being checked (an earlier version was circular).
  const sources = [EVENT.description, ...run.steps.flatMap(s =>
    s.type === 'tool' && s.name !== SUBMIT_TOOL_NAME && s.result !== undefined ? [JSON.stringify(s.result)] : [])].join(' ')
  const known = new Set((sources.match(/\d+(?:\.\d+)?/g) ?? []).map(n => String(Number(n))))
  const claimed = [run.output.summary, ...run.output.evidence.map(e => e.fact)].join(' ').match(/\d+(?:\.\d+)?/g) ?? []
  return [...new Set(claimed.map(n => String(Number(n))))].filter(n => !known.has(n))
}

function report(model: string, run: AgentRun<Findings>): string {
  const lines = [`\n══ ${model} → ${run.status}  (${run.usage.latencyMs} ms, ${run.usage.promptTokens}+${run.usage.completionTokens} tokens)`]
  if (run.error) lines.push(`  ERROR: ${run.error}`)
  for (const s of run.steps) {
    if (s.type === 'model') lines.push(`  model: ${s.toolCalls.map(c => `${c.name}(${c.arguments})`).join(', ') || `TEXT: ${s.text?.slice(0, 120)}`}`)
    else lines.push(`  tool ${s.name}: ${s.errorKind ? `ERROR ${s.errorKind}: ${s.error?.slice(0, 160)}` : JSON.stringify(s.result).slice(0, 160)}`)
  }
  if (run.output) {
    lines.push(`  SUMMARY: ${run.output.summary}`, `  confidence: ${run.output.confidence}`)
    lines.push(`  ungrounded numbers: ${JSON.stringify(ungroundedNumbers(run))}`)
  }
  return lines.join('\n')
}

// ─── Runs ───────────────────────────────────────────────────

describe.skipIf(keys.length === 0)('LIVE research smoke run', () => {
  const model = createGroqCaller({ keys })
  for (const m of MODELS) {
    it(`${m}: completes without throwing`, async () => {
      const run = await runReactAgent(spec(m), EVENT, { model, ctx })
      console.log(report(m, run))
      expect(['ok', 'step_limit', 'invalid_output', 'timeout', 'error']).toContain(run.status)
    }, 60_000)
  }
})

// ─── Single-shot, strict json_schema (1.5): does Groq accept our schemas? ──

const CoachFeedback = z.object({
  message: z.string().min(20).max(400).describe('1-2 sentences to the user, second person'),
  severity: z.enum(['info', 'caution', 'warning']),
  bias: z.enum(['loss_aversion', 'panic_selling', 'herding', 'none']).nullable(),
})

describe.skipIf(keys.length === 0)('LIVE single-shot strict smoke run', () => {
  const model = createGroqCaller({ keys })
  for (const m of ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b']) {
    it(`${m}: strict json_schema accepted and output valid`, async () => {
      const run = await runSingleShot({
        name: 'coach', kind: 'single_shot', model: m,
        systemPrompt: 'You are a trading coach. Give short, specific behavioural feedback on the user decision.',
        buildUserMessage: () => `${EVENT.description} INDIGO was down 7.9% on the day; NIFTY had just resumed after a halt.`,
        tools: [], output: CoachFeedback,
        limits: { maxSteps: 2, maxTokens: 800, timeoutMs: 30_000, toolTimeoutMs: 0 },
      }, null, { model })
      console.log(`\n══ single-shot ${m} → ${run.status} (${run.usage.latencyMs} ms, ${run.steps.length} call(s))${run.error ? `\n  ERROR: ${run.error}` : ''}\n  OUTPUT: ${JSON.stringify(run.output)}`)
      expect(['ok', 'invalid_output', 'timeout', 'error']).toContain(run.status)
    }, 60_000)
  }
})
