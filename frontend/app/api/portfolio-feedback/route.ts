import { NextResponse } from 'next/server'
import type { PortfolioRunResult } from '@/types/portfolio'
import { V1_MODEL_PARAMS, REASONING_HEADROOM } from '@/lib/ai/v1-model'
import { requireUser } from '@/lib/auth/require-user'

export const maxDuration = 30

let keyIndex = 0

const SYSTEM_PROMPT = `You are a trading coach reviewing a student's portfolio simulation run.
Be concrete: cite specific decisions with rupee amounts. Keep total response under 120 words.
Output strictly valid JSON with these fields:
- headline: one punchy sentence summarising the run (max 12 words)
- winMoment: their single best decision (1 sentence, cite rupees if possible)
- costMoment: their single costliest decision (1 sentence, cite rupees if possible)
- bias: one cognitive bias name + 1-sentence explanation (or empty string if none clear)
- proTip: one thing a pro would do differently next time (1 sentence)
Return only raw JSON, no markdown fences.`

export async function POST(req: Request) {
  const auth = await requireUser('v1-ai')   // P8 + 8.4: signed-in users only, within the hourly limit
  if (auth instanceof Response) return auth
  try {
    const GROQ_KEYS = [
      process.env.GROQ_API_KEY_1,
      process.env.GROQ_API_KEY_2,
      process.env.GROQ_API_KEY_3,
      process.env.GROQ_API_KEY_4,
    ].filter(Boolean) as string[]

    if (GROQ_KEYS.length === 0) {
      return NextResponse.json({ error: 'No API keys configured' }, { status: 500 })
    }

    const { runResult, scenarioSlug } = await req.json() as {
      runResult: PortfolioRunResult
      scenarioSlug: string
    }

    const summary = buildSummary(runResult, scenarioSlug)

    let attempts = 0
    while (attempts < GROQ_KEYS.length) {
      try {
        const apiKey = GROQ_KEYS[keyIndex % GROQ_KEYS.length]
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...V1_MODEL_PARAMS,   // P7: was llama-3.1-8b-instant (not on the key)
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: summary },
            ],
            temperature: 0.25,
            max_tokens: 300 + REASONING_HEADROOM,
            stream: false,
          }),
        })

        if (response.status === 429) {
          keyIndex++
          attempts++
          continue
        }

        if (!response.ok) {
          throw new Error(`Groq error: ${response.status}`)
        }

        const data = await response.json()
        const text = data.choices?.[0]?.message?.content ?? ''

        try {
          const parsed = JSON.parse(text)
          return NextResponse.json(parsed)
        } catch {
          // If JSON parse fails, return a graceful fallback
          return NextResponse.json({
            headline: runResult.pnlRupees >= 0 ? 'Solid run — you beat the index.' : 'Tough session, but you learned the mechanics.',
            winMoment: '',
            costMoment: '',
            bias: '',
            proTip: 'Watch sector correlations during macro events — they amplify moves in the same direction.',
          })
        }
      } catch {
        keyIndex++
        attempts++
      }
    }

    return NextResponse.json({ error: 'All keys failed' }, { status: 500 })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function buildSummary(result: PortfolioRunResult, slug: string): string {
  const snapshotSummary = result.snapshots.map(s =>
    `At t=${s.atSecond}s (${s.reason}): portfolio=₹${Math.round(s.portfolioValue).toLocaleString('en-IN')}, cash=₹${Math.round(s.cash).toLocaleString('en-IN')}`
  ).join('\n')

  const mistakeSummary = result.mistakes.length > 0
    ? result.mistakes.map(m => `- ${m.label}: ${m.detail} (cost ₹${Math.abs(m.costRupees).toLocaleString('en-IN')})`).join('\n')
    : 'No major mistakes detected.'

  return `Scenario: ${slug}
Starting capital: ₹${result.startingCapital.toLocaleString('en-IN')}
Final value: ₹${result.finalValue.toLocaleString('en-IN')}
P&L: ₹${result.pnlRupees.toLocaleString('en-IN')} (${result.pnlPct.toFixed(2)}%)
Panic sold during flash crash: ${result.didPanicSell ? 'YES' : 'NO'}
Diversification score: ${result.diversificationScore.toFixed(1)}/5
Rules unlocked: ${result.unlockedRuleIds.join(', ') || 'none'}

Allocation snapshots:
${snapshotSummary}

Mistakes detected:
${mistakeSummary}`
}
