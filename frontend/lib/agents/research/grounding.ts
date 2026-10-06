import { SUBMIT_TOOL_NAME, type AgentStep } from '../types'

// ============================================================================
// Number grounding (M6.1): every number Research states must come from a tool
// result, a tool argument, or the event it was given. This is what turns "no
// agent reads numbers off chart images" into an enforced property: the only
// numbers it may use are ones our code computed.
//
// Matching: a claimed number with d decimals matches a source number that
// rounds to it at d decimals, ignoring sign ("fell 2.1%" ← changePct -2.08).
// Rounding is allowed; inventing isn't.
// Known gap (live run 2026-09-23): a correct number attached to the WRONG claim
// passes. Grounding checks provenance, not meaning.
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

const NUMBER = /\d+(?:\.\d+)?/g

/** Text the agent was allowed to take numbers from: tool results and arguments (never its own submission), plus the input. */
export function groundingSources(steps: readonly AgentStep[], inputText: string): string {
  const parts = [inputText]
  for (const s of steps) {
    if (s.type !== 'tool' || s.name === SUBMIT_TOOL_NAME) continue
    parts.push(JSON.stringify(s.args))
    if (s.result !== undefined) parts.push(JSON.stringify(s.result))
  }
  return parts.join(' ')
}

/** Numbers in `claims` that no source number rounds to. Returns them as written, deduplicated. */
export function ungroundedNumbers(claims: string, sources: string): string[] {
  const known = (sources.match(NUMBER) ?? []).map(Number)
  const out = new Set<string>()
  for (const raw of claims.match(NUMBER) ?? []) {
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
    const target = Number(raw).toFixed(decimals)
    if (!known.some(k => Math.abs(k).toFixed(decimals) === target)) out.add(raw)
  }
  return [...out]
}
