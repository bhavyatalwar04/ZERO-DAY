import type { ModelCaller } from '@/lib/agents/model'

// Keeps a long eval run under Groq's free-tier limit (8,000 tokens/minute PER
// MODEL, ADR-008) instead of discovering it through 429s.
// The wait happens BEFORE an agent run (`ready`), never inside a model call:
// agents have wall-clock budgets (Research: 9 s), and waiting inside a call would
// turn pacing into false timeouts. The wrapped caller only records usage.
// Written by Claude at Bhavya's request (2026-10-03).

export interface PacingOptions {
  tokensPerMinute: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface Pacer {
  /** the caller to give agents: records each call's tokens against its model */
  caller: ModelCaller
  /** resolves once `model` has room for `tokens` more in the current minute */
  ready(model: string, tokens: number): Promise<void>
}

export function pacer(inner: ModelCaller, { tokensPerMinute, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now }: PacingOptions): Pacer {
  const used = new Map<string, { at: number; tokens: number }[]>()
  const log = (model: string) => { const l = used.get(model) ?? []; used.set(model, l); return l }
  return {
    caller: async req => {
      const res = await inner(req)
      log(req.model).push({ at: now(), tokens: (res.step.promptTokens ?? 0) + (res.step.completionTokens ?? 0) })
      return res
    },
    async ready(model, tokens) {
      const l = log(model)
      for (;;) {
        const t = now()
        while (l.length && t - l[0].at >= 60_000) l.shift()
        if (l.length === 0 || l.reduce((n, e) => n + e.tokens, 0) + tokens <= tokensPerMinute) return
        await sleep(60_000 - (t - l[0].at) + 50)
      }
    },
  }
}
