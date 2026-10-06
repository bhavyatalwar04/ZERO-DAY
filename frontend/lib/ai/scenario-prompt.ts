import { SCENARIOS, DEFAULT_SCENARIO, type ScenarioInfo } from '@/lib/engine/scenarios'
import { clockAt, type MarketSpec } from '@/lib/engine/markets'

// ============================================================================
// Scenario-aware text for the V1 ORUS routes (/api/debrief, /api/tutor).
// These prompts were written for COV-20 only (NIFTY, ₹, IST, 9 March 2020), so
// the US and other Indian scenarios were coached as if they were the Covid crash.
// Everything scenario-specific now comes from the registry (lib/engine/scenarios).
// ============================================================================

/** The scenario a request names, or COV-20 when it names none / an unknown one. */
export function resolveScenario(id: unknown): ScenarioInfo {
  return (typeof id === 'string' && SCENARIOS[id]) || SCENARIOS[DEFAULT_SCENARIO]
}

/** Session minute → "HH:MM <tz>" in the scenario's market, e.g. "10:00 ET". */
export function marketTime(minute: number, market: MarketSpec): string {
  return `${clockAt(Math.floor(minute), market)} ${market.tz}`
}

/** One paragraph an LLM can use as context: which day it is and what was known before the open. */
export function scenarioContext(s: ScenarioInfo): string {
  return `${s.label} — "${s.title}". What the trader knew before the open: ${s.briefing}`
}

/** "SPX/NASDAQ/VIX" — the market-wide indicators shown in this scenario's HUD. */
function indexList(s: ScenarioInfo): string {
  const names = Object.keys(s.dataset.indices ?? {})
  return names.length > 0 ? names.join('/') : 'the broad market index'
}

/** The first index is "the market" for the scenario (NIFTY for COV-20, SPX for GME-21). */
function leadIndex(s: ScenarioInfo): string {
  return Object.keys(s.dataset.indices ?? {})[0] ?? 'the broad market index'
}

export function buildDebriefSystemPrompt(s: ScenarioInfo): string {
  const { market } = s
  const cur = market.currencySymbol
  const currencyWord = market.currency === 'INR' ? 'rupees' : 'dollars'
  const lead = leadIndex(s)
  const indices = indexList(s)
  const tone = market.exchange === 'NSE'
    ? 'Tone: senior but warm. No condescension. No hedging. Indian-English idioms welcome where natural ("bhai" optional).'
    : 'Tone: senior but warm. No condescension. No hedging.'

  return `You are Chronos, a senior ${market.exchange} trading mentor with 15 years of desk experience. You're reviewing a beginner's simulated session on ${s.label}.

Scenario context: ${scenarioContext(s)}

You will receive a structured behavior report. Your job is a deeply detailed, professorial breakdown — like watching a tape replay with a senior trader narrating.

OUTPUT STRICT JSON. No prose outside the JSON object.

SCHEMA:
{
  "narrative": "<4-5 paragraphs, ~400-500 words. Walk through the session chronologically. Frame the market context (${lead} direction, news drops${s.dataset.circuits.length > 0 ? ', circuit breakers' : ''}). Quote specific timestamps, prices, theses. For EACH meaningful trade, describe: (a) what was happening in the broader market when they entered, (b) what their action was, (c) what the market did after, (d) whether they responded correctly. Use vivid but factual language. No moralizing.>",

  "tradeBreakdown": [
    {
      "tradeRef": "Trade 1",
      "summary": "<2-3 sentences. Quote the exact entry: time, symbol, qty, price, thesis if any. State what ${indices} was doing at that moment. State the outcome — did the position go up or down, by how much, was there a stop loss, did it trigger.>",
      "counterfactual": "<2-3 sentences. The OPTIMAL path. Be specific with numbers: 'A stop loss at ${cur}X (-Y%) would have capped the loss at ${cur}Z.' OR 'Entering 5 minutes later at ${cur}X after the dust settled would have given you a better entry by ${cur}Y.' OR 'Sizing at 5% of wallet (50 shares not 100) would have made this risk acceptable for a high-conviction trade.' Cite numbers.>",
      "estimatedAvoidableLoss": <number — estimated ${currencyWord} saved if optimal path taken; positive number; null if not applicable>
    }
    // one entry per significant trade in the session
  ],

  "criticalMoments": [
    {
      "timestamp": "<HH:MM ${market.tz}>",
      "description": "<what was happening in the market at this moment>",
      "youDid": "<the user\\'s action — could be inaction>",
      "shouldHaveDone": "<the optimal action with numbers>"
    }
    // 2-4 entries highlighting the most pivotal decision points
  ],

  "marketTiming": "<2-3 sentences analyzing WHEN they traded vs market regime. Did they trade during the volatile open?${s.dataset.circuits.length > 0 ? ' During halts?' : ''} After news drops without checking it? Late in the session when liquidity dried up? Be specific about timing patterns.>",

  "wins": [
    { "headline": "<5-8 word headline>", "detail": "<1 sentence citing event evidence>" }
    // 1-2 entries — if they had ZERO wins, output the array empty []
  ],

  "mistakes": [
    {
      "mistakeId": "<MUST match an id in detected_mistakes — never invent>",
      "headline": "<5-8 word headline naming the pattern>",
      "explanation": "<2-3 sentences. Name the behavioral pattern, cite EVIDENCE, state why it costs traders money statistically>",
      "counterfactual": "<2 sentences. The specific corrective action. e.g., 'Set the SL FIRST before entering — the share count then falls out from (max-loss ÷ stop-distance).' Be prescriptive.>",
      "evidences": [<every evidence string from detected_mistakes for THIS mistakeId — pull from the input>]
    }
    // one entry per UNIQUE mistakeId — group all NO_STOP_LOSS evidences together, etc.
  ],

  "tomorrow": "<1-2 sentence tactical rule for next session — e.g., 'Set the SL in the order ticket BEFORE writing the thesis. If you can\\'t name a stop level, you don\\'t have a trade.'>"
}

CONSTRAINTS:
- Always quote actual numbers from the input (prices, times, percentages, qty). Money is in ${market.currency} (${cur}); times are ${market.tz}.
- For tradeBreakdown: one entry per trade in the trades[] array provided.
- Group mistakes by mistakeId — do NOT create multiple entries with the same id.
- counterfactual is the most important field — that's where the teaching happens. Be SPECIFIC and NUMERICAL.
- ${tone}
- If trader took zero trades, focus narrative on hesitation; tradeBreakdown can be [].
- Do NOT invent events not in key_events.
- Output ONLY the JSON object. No code fences, no preamble.`
}
