import 'server-only'
import type { AgentLimits } from './types'
import type { PipelineBudget } from './pipeline'
import type { RetryPolicy } from './retry'

// ============================================================================
// Budgets (roadmap 1.7): the single place for time and token limits.
//
// PROVISIONAL. Derived from 2 live runs per model on 2026-09-23
// (docs/evidence/). Two samples say nothing about variance or tail latency:
// re-derive from the eval set (2.7) before quoting any of these in the report.
//
// Observed:
//   Research (react, 3 model calls):  qwen3.8-27b 2.2–2.8 s, 4.7k tokens;
//                                     gpt-oss-20b 2.2–5.4 s, 2.7–2.8k tokens
//   Coach (single-shot, 1 call):      0.57–0.71 s
// ============================================================================

export const RESEARCH_LIMITS: AgentLimits = {
  maxSteps: 4,           // 3 tool turns + submit, as the prompt asks. Live 2026-10-02: gpt-oss made 4 tool turns when allowed 5 steps
  maxTokens: 600,        // per call: the submit call is the largest
  timeoutMs: 9_000,      // ≈1.7× the slowest observed run (5.4 s)
  toolTimeoutMs: 1_000,  // tools are in-memory lookups (ms); 1 s means something is wrong
  // Groq free tier: 8,000 tokens/MINUTE per model (headers, 2026-10-02). Research must leave
  // room for Coach in the same minute, so it can't use the whole 8k.
  maxRunTokens: 5_000,
}

export const COACH_LIMITS: AgentLimits = {
  maxSteps: 2,           // one answer + one repair
  maxTokens: 800,        // gpt-oss is a reasoning model; its hidden reasoning counts toward this
  timeoutMs: 3_000,      // 2 attempts at the observed ~0.7 s, plus retry backoff
  toolTimeoutMs: 0,      // no tools
}

/** Research is cut off at deadline − reserve = 9 s, matching RESEARCH_LIMITS.timeoutMs. */
export const PIPELINE_BUDGET: PipelineBudget = {
  deadlineMs: 12_000,
  coachReserveMs: 3_000,
}

export { DEFAULT_RETRY as RETRY_POLICY } from './retry'
export type { RetryPolicy }
