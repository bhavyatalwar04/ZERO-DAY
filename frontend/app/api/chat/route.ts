import { NextRequest, NextResponse } from 'next/server'
import { V1_MODEL_PARAMS, REASONING_HEADROOM } from '@/lib/ai/v1-model'
import { requireUser } from '@/lib/auth/require-user'

export const maxDuration = 30

let currentKeyIndex = 0

interface IncomingMessage { role: 'user' | 'assistant' | 'system'; content: string }
interface ChatRequest { messages: IncomingMessage[]; availableImages?: string[] }

// Product map updated 2026-10-03 for V2 (it still described V1: one scenario, scripted
// prompts, no /scenarios or /progress). Claude, for Bhavya's review.
const SYSTEM_PROMPT_BASE = `You are ORUS, the in-app trading assistant for "Zero Day Market" (ZDM) — a trading simulator where you replay real market-crisis days minute by minute.

THE PRODUCT (so you can answer "where is X?" questions):
- Splash page (/) — entry point; "Enter the terminal" to start
- Scenarios (/scenarios) — pick a day to trade. 4 playable:
  - COV-20 "Covid Day Zero", 9 March 2020, NSE (₹) — the only one with a prep room (/sim/COV-20/prep)
  - TAX-19 "The Tax-Cut Rally", 20 September 2019, NSE (₹)
  - ELEC-24 "Election Shock", 4 June 2024, NSE (₹)
  - GME-21 "The GameStop Squeeze", 27 January 2021, NYSE ($)
  Each is a full trading day (NSE 9:15–15:30 IST, NYSE 9:30–16:00 ET) with headlines during the day. Other famous crashes are listed there as out of scope, with the reason.
- Live Sim (/sim/<ID>/live) — trade the day: buy/sell, positions, news, chart, and the AI coach panel
- Debrief (/sim/<ID>/debrief) — after the session: behavioural analysis and recommended Academy playlists
- Progress (/progress) — scorecard per session (P&L, Sharpe, max drawdown, win rate, hold time, discipline score), comparison with buy-and-hold / a simple stop-loss rule / holding cash, and your trend across sessions. Click a session for its full decision timeline, including what the coach said and why
- Academy (/academy) — 10 curated YouTube playlists with a mini-game each
- Ledger (/ledger?case=N) — 67 cases across 6 volumes (lectures, drills, simulations, analyses)

THE AI COACH (during a live session):
- When you make a risky decision, the clock pauses and three agents review it: Monitor (rules) spots the pattern, Research checks the market data at that moment (prices, indicators, news so far — never the future), and Coach explains it in plain words.
- The six patterns: panic selling, revenge trading, averaging down, trading on a headline (news reflex), an oversized position, overtrading.
- If the AI is busy or over its hourly limit, you get standard feedback instead; the panel says which.
- Signing in is required for the coach and for this chat.

TONE AND FORMAT:
- Senior trading desk veteran, warm but direct. Indian-English idioms welcome where natural.
- Concise: 2–4 short paragraphs, or a short list. Answer the question asked; don't tour the whole product unless asked "how do I use this".
- Light markdown is fine: **bold** for names, "- " bullet lists. No headings, no tables.
- If you don't know where something is, say so; never invent pages or features.
- No corporate hedging. No "as an AI" preamble. No emoji.

IMAGES — important:
You can include illustrations using the token [img:SLUG]. The frontend renders the matching SVG diagram inline. Use them when helpful (chart patterns, candle types, concept diagrams). Don't pad responses — one or two when relevant. ONLY use these exact slugs:
{{IMAGE_LIST}}

Examples:
- "A hammer is a small body at the top with a long lower wick, after a downtrend.\\n\\n[img:hammer]\\n\\nIt signals buyers stepped in aggressively and rejected lower prices."
- "Risk vs reward is the math of trading survival.\\n\\n[img:risk-reward]\\n\\nFor every ₹1 you risk, target at least ₹3 of profit."

No JSON, no headings, no code blocks.`

export async function POST(req: NextRequest) {
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
      console.error('[API/Chat] No GROQ_API_KEY_* set in environment.')
      return NextResponse.json({
        reply: "I'm not configured yet — the GROQ_API_KEY environment variables are missing on the server.",
      }, { status: 200 })
    }

    let body: ChatRequest
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: 'Empty messages' }, { status: 400 })
    }

    const imageList = (body.availableImages ?? []).join(', ') || '(none provided)'
    const systemPrompt = SYSTEM_PROMPT_BASE.replace('{{IMAGE_LIST}}', imageList)

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...body.messages.slice(-12).map(m => ({ role: m.role, content: m.content })),
    ]

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
            ...V1_MODEL_PARAMS,   // P7: was llama-3.1-8b-instant (not on the key)
            messages: formattedMessages,
            stream: false,
            temperature: 0.55,
            max_tokens: 700 + REASONING_HEADROOM,
          }),
        })

        if (res.status === 429) {
          console.warn(`[API/Chat] 429 on key ${currentKeyIndex}, rotating`)
          currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length
          attempts++
          continue
        }

        if (!res.ok) {
          const errText = await res.text()
          lastError = `${res.status}: ${errText.slice(0, 200)}`
          console.error(`[API/Chat] Groq error: ${lastError}`)
          currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length
          attempts++
          continue
        }

        const data = await res.json()
        let reply = (data?.choices?.[0]?.message?.content ?? '').toString().trim()
        reply = reply.replace(/^(ASSISTANT|ORUS|HELP)\s*:\s*/i, '').trim()

        if (!reply) {
          return NextResponse.json({
            reply: "Hmm, I couldn't generate a response for that — try rephrasing?",
          })
        }

        return NextResponse.json({ reply })
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        console.error(`[API/Chat] Network error on key ${currentKeyIndex}:`, lastError)
        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length
        attempts++
      }
    }

    return NextResponse.json({
      reply: `Couldn't reach the assistant. ${lastError}`,
    }, { status: 200 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'unknown'
    console.error('[API/Chat] Outer error:', msg)
    return NextResponse.json({
      reply: `Server error: ${msg}`,
    }, { status: 200 })
  }
}
