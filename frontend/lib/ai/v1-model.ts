import 'server-only'

// ============================================================================
// Model settings for the V1 ORUS routes (proposal P7).
// The V1 routes hardcoded Llama models that this project's Groq key doesn't have
// (404 model_not_found), so V1's AI was down. They now use the gpt-oss models the
// V2 agents already use.
//
// gpt-oss is a reasoning model: its hidden reasoning counts against max_tokens.
// Probed 2026-10-03: with max_tokens 40 and default settings it spent all 40 on
// reasoning and returned "". With reasoning_effort 'low' + include_reasoning false
// it answered in 31 tokens. Hence the two settings AND the headroom below.
// Written by Claude at Bhavya's request (2026-10-03).
// ============================================================================

/** Extra tokens for hidden reasoning, on top of each route's visible-answer budget. */
export const REASONING_HEADROOM = 256

const REASONING = { reasoning_effort: 'low', include_reasoning: false } as const

/**
 * Short, fast replies (chat, tutor, copilot, feedback). On gpt-oss-120b since 2026-11-07
 * (ADR-015): Groq's free limits are per model, so moving these off gpt-oss-20b leaves
 * that model's whole daily quota to the live Coach. Same settings as the debrief, which
 * already ran on 120b.
 */
export const V1_MODEL_PARAMS = { model: 'openai/gpt-oss-120b', ...REASONING } as const

/** The post-session debrief: long structured JSON, previously the 70B model. */
export const V1_DEBRIEF_PARAMS = { model: 'openai/gpt-oss-120b', ...REASONING } as const
