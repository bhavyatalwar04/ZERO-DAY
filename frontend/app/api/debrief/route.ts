import { NextRequest, NextResponse } from 'next/server'
import type { DebriefRequest, DebriefResponse, MistakeId, Mistake } from '@/lib/behavior/types'
import { V1_DEBRIEF_PARAMS, REASONING_HEADROOM } from '@/lib/ai/v1-model'
import { requireUser } from '@/lib/auth/require-user'
import { resolveScenario, marketTime, buildDebriefSystemPrompt } from '@/lib/ai/scenario-prompt'
import { formatMoney, signedMoney } from '@/lib/engine/markets'
import type { ScenarioInfo } from '@/lib/engine/scenarios'

export const maxDuration = 30

let currentKeyIndex = 0

const VALID_MISTAKE_IDS: ReadonlySet<MistakeId> = new Set<MistakeId>([
  'NO_STOP_LOSS', 'OVERSIZED_POSITION', 'REVENGE_TRADE', 'PANIC_SELL',
  'FOMO_BUY', 'NEWS_REFLEX', 'NO_THESIS', 'CIRCUIT_BREAKER_ATTEMPT',
  'DISPOSITION_EFFECT', 'OVERTRADING', 'IGNORED_NEWS', 'HELD_THROUGH_CLOSE',
])

export async function POST(req: NextRequest) {
  const auth = await requireUser('v1-ai')   // P8 + 8.4: signed-in users only, within the hourly limit
  if (auth instanceof Response) return auth
  const GROQ_KEYS = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
  ].filter(Boolean) as string[]

  if (GROQ_KEYS.length === 0) {
    return NextResponse.json(emptyFallback('GROQ_API_KEY env vars are not configured.'), { status: 200 })
  }

  let body: DebriefRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body?.profile || !Array.isArray(body.mistakes) || !body.archetype) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  const scenario = resolveScenario(body.scenarioId)
  const minToMarketTime = (min: number) => marketTime(min, scenario.market)

  // Build a richer payload — full trade list + grouped mistakes + key event timeline
  const trimmedEvents = (body.keyEvents ?? []).slice(0, 30)
  const groupedMistakes = groupMistakes(body.mistakes)

  const compactPayload = {
    archetype: body.archetype,
    profile: {
      tradeCount: body.profile.tradeCount,
      buyCount: body.profile.buyCount,
      sellCount: body.profile.sellCount,
      slUsageRate: round(body.profile.slUsageRate, 2),
      thesisRate: round(body.profile.thesisRate, 2),
      avgPositionSizePct: round(body.profile.avgPositionSizePct, 3),
      maxPositionSizePct: round(body.profile.maxPositionSizePct, 3),
      newsViewedRate: round(body.profile.newsViewedRate, 2),
      pauseMinutes: round(body.profile.pauseMinutes, 1),
      timeBeforeFirstTradeSec: Math.round(body.profile.timeBeforeFirstTradeMs / 1000),
      realizedPnL: Math.round(body.profile.realizedPnL),
      dayPnL: Math.round(body.profile.dayPnL),
      dayPnLPct: round(body.profile.dayPnLPct, 2),
      winCount: body.profile.winCount,
      lossCount: body.profile.lossCount,
      winRate: round(body.profile.winRate, 2),
      dispositionRatio: round(body.profile.dispositionRatio, 2),
    },
    trades: body.profile.trades.map((t, i) => ({
      ref: `Trade ${i + 1}`,
      side: t.side,
      symbol: t.symbol,
      qty: t.qty,
      price: t.price,
      sizingPct: round(t.sizingPct, 3),
      hasThesis: t.hasThesis,
      thesisLength: t.thesisLength,
      filledAtMin: t.filledAtMin,
      timeStr: minToMarketTime(t.filledAtMin),
      orderType: t.orderType,
      realizedPnL: Math.round(t.realizedPnL),
    })),
    detected_mistakes_grouped: groupedMistakes,
    key_events: trimmedEvents.map(e => ({
      simMinute: e.simMinute,
      timeStr: minToMarketTime(e.simMinute),
      kind: e.kind,
      data: e.data,
    })),
  }

  const userPrompt = `Behavior report for this session:\n\n${JSON.stringify(compactPayload, null, 2)}\n\nReturn ONLY the JSON object matching the schema.`

  let attempts = 0
  let lastError = 'unknown'
  while (attempts < GROQ_KEYS.length) {
    const apiKey = GROQ_KEYS[currentKeyIndex]
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...V1_DEBRIEF_PARAMS,   // P7: was llama-3.3-70b-versatile (not on the key)
          messages: [
            { role: 'system', content: buildDebriefSystemPrompt(scenario) },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: 3000 + REASONING_HEADROOM,
        }),
      })

      if (res.status === 429) {
        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length
        attempts++
        continue
      }
      if (!res.ok) {
        lastError = `${res.status}: ${(await res.text()).slice(0, 200)}`
        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length
        attempts++
        continue
      }

      const data = await res.json()
      const raw = data?.choices?.[0]?.message?.content ?? ''
      const json = parseJsonRobust(raw)
      if (!json) {
        return NextResponse.json(richFallback(body, scenario), { status: 200 })
      }

      const validated = validateResponse(json, body.mistakes)
      return NextResponse.json(validated)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length
      attempts++
    }
  }

  console.error('[debrief] all keys failed:', lastError)
  return NextResponse.json(richFallback(body, scenario), { status: 200 })
}

// ── helpers ──────────────────────────────────────────────────

function round(n: number, d: number): number {
  const p = Math.pow(10, d)
  return Math.round(n * p) / p
}

function groupMistakes(mistakes: Mistake[]): Array<{ id: string; severity: string; evidences: string[] }> {
  const map = new Map<string, { id: string; severity: string; evidences: string[] }>()
  for (const m of mistakes) {
    const ex = map.get(m.id)
    if (ex) ex.evidences.push(m.evidence)
    else map.set(m.id, { id: m.id, severity: m.severity, evidences: [m.evidence] })
  }
  return Array.from(map.values())
}

function parseJsonRobust(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch {}
  }
  return null
}

function validateResponse(json: Record<string, unknown>, detectedMistakes: Mistake[]): DebriefResponse {
  const validIds = new Set(detectedMistakes.map(m => m.id))
  const evidencesById = new Map<string, string[]>()
  for (const m of detectedMistakes) {
    const ex = evidencesById.get(m.id) ?? []
    ex.push(m.evidence)
    evidencesById.set(m.id, ex)
  }

  return {
    narrative: typeof json.narrative === 'string' ? json.narrative : '',
    tradeBreakdown: Array.isArray(json.tradeBreakdown)
      ? json.tradeBreakdown.slice(0, 12).map((t: Record<string, unknown>) => ({
          tradeRef: String(t.tradeRef ?? ''),
          summary: String(t.summary ?? ''),
          counterfactual: String(t.counterfactual ?? ''),
          estimatedAvoidableLoss: typeof t.estimatedAvoidableLoss === 'number' ? t.estimatedAvoidableLoss : undefined,
        }))
      : [],
    criticalMoments: Array.isArray(json.criticalMoments)
      ? json.criticalMoments.slice(0, 6).map((m: Record<string, unknown>) => ({
          timestamp: String(m.timestamp ?? ''),
          description: String(m.description ?? ''),
          youDid: String(m.youDid ?? ''),
          shouldHaveDone: String(m.shouldHaveDone ?? ''),
        }))
      : [],
    marketTiming: typeof json.marketTiming === 'string' ? json.marketTiming : '',
    wins: Array.isArray(json.wins)
      ? json.wins.slice(0, 3).map((w: Record<string, unknown>) => ({
          headline: String(w.headline ?? ''),
          detail: String(w.detail ?? ''),
        }))
      : [],
    mistakes: Array.isArray(json.mistakes)
      ? json.mistakes
          .filter((m: Record<string, unknown>) => typeof m.mistakeId === 'string' && validIds.has(m.mistakeId as MistakeId))
          .slice(0, 6)
          .map((m: Record<string, unknown>) => ({
            mistakeId: m.mistakeId as MistakeId,
            headline: String(m.headline ?? ''),
            explanation: String(m.explanation ?? ''),
            counterfactual: String(m.counterfactual ?? ''),
            evidences: Array.isArray(m.evidences) && m.evidences.length > 0
              ? m.evidences.map(String)
              : (evidencesById.get(m.mistakeId as MistakeId) ?? []),
          }))
      : [],
    tomorrow: typeof json.tomorrow === 'string' ? json.tomorrow : '',
  }
}

function emptyFallback(reason: string): DebriefResponse {
  return {
    narrative: `Unable to generate the LLM-powered debrief. ${reason}`,
    tradeBreakdown: [], criticalMoments: [], marketTiming: '',
    wins: [], mistakes: [], tomorrow: '',
  }
}

function richFallback(body: DebriefRequest, scenario: ScenarioInfo): DebriefResponse {
  const p = body.profile
  const { market } = scenario
  const groupedMistakes = groupMistakes(body.mistakes)
  return {
    narrative: `You closed the session with ${signedMoney(p.dayPnL, market)} on ${scenario.title} (${scenario.dateLabel}). You placed ${p.tradeCount} trade${p.tradeCount === 1 ? '' : 's'} (${p.buyCount} buys, ${p.sellCount} sells), with a ${Math.round(p.winRate * 100)}% win rate. Average position size was ${(p.avgPositionSizePct * 100).toFixed(0)}% of wallet. Stop loss usage: ${Math.round(p.slUsageRate * 100)}%. (LLM unavailable — showing rules-based summary only.)`,
    tradeBreakdown: p.trades.map((t, i) => ({
      tradeRef: `Trade ${i + 1}`,
      summary: `${t.side} ${t.qty} ${t.symbol} @ ${formatMoney(t.price, market, 2)} at ${marketTime(t.filledAtMin, market)}. Sizing ${(t.sizingPct * 100).toFixed(0)}% of wallet.`,
      counterfactual: 'Set a stop loss before entry; size off the stop distance.',
    })),
    criticalMoments: [],
    marketTiming: '',
    wins: p.slUsageRate >= 0.7
      ? [{ headline: 'Stop losses used consistently', detail: `${Math.round(p.slUsageRate * 100)}% of buys had a stop within 60 seconds.` }]
      : [],
    mistakes: groupedMistakes.map(g => ({
      mistakeId: g.id as MistakeId,
      headline: g.id.replace(/_/g, ' ').toLowerCase(),
      explanation: g.evidences[0] ?? '',
      counterfactual: 'Apply the relevant rule from the Academy playlists.',
      evidences: g.evidences,
    })),
    tomorrow: 'Set a stop loss before clicking Place Order. Define your maximum loss first, then derive share count.',
  }
}
