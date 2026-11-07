import 'server-only'

// ============================================================================
// Agent switches read from the server environment (ADR-015).
// Written by Claude at Bhavya's request (2026-11-07).
// ============================================================================

/**
 * The Research agent (ReAct, qwen3.8-27b) runs only when AGENT_RESEARCH=on.
 * On Groq's free tier one Research run costs ~6,400 tokens (~90% of a pipeline
 * run) against 200,000 tokens/day per model, i.e. ~30 runs a day for ALL users,
 * and the eval measured only +1 rubric point with it (99% vs 98%, ADR-010).
 * Off: the Coach answers from Monitor's facts ('monitor_only' path).
 */
export const RESEARCH_ENABLED = process.env.AGENT_RESEARCH === 'on'
