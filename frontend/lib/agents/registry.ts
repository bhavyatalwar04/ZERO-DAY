import 'server-only'
import { z } from 'zod'
import {
  SUBMIT_TOOL_NAME,
  type AnyToolDef, type RawToolCall, type ToolContext, type ToolErrorKind, type ToolRegistry, type ToolStep,
} from './types'

// ─── Registry construction ──────────────────────────────────

export function createRegistry(tools: AnyToolDef[]): ToolRegistry {
  const map = new Map<string, AnyToolDef>()
  for (const t of tools) {
    if (t.name === SUBMIT_TOOL_NAME) throw new Error(`"${SUBMIT_TOOL_NAME}" is reserved for ending the loop`)
    if (!/^[a-z][a-z0-9_]*$/.test(t.name)) throw new Error(`Tool name "${t.name}" must be snake_case`)
    if (map.has(t.name)) throw new Error(`Duplicate tool name "${t.name}"`)
    map.set(t.name, t)
  }
  return map
}

// ─── executeTool ────────────────────────────────────────────
//
// This is the boundary where untrusted model output meets our code.
// Spec designed together; implementation written by Claude at Bhavya's
// request (2026-09-23, recorded in docs/LEARNINGS.md).
// Spec (the tests in registry.test.ts check each rule):
//
//  1. NEVER throws. Every failure becomes a ToolStep with `error` + `errorKind`.
//     The loop sends `error` back to the model so it can correct itself,
//     so write errors the MODEL can act on.
//  2. Unknown tool name        → errorKind 'unknown_tool'; the error lists the available names.
//  3. `call.arguments` is a JSON string; if JSON.parse fails → 'bad_json'.
//  4. Validate with tool.input.safeParse(); on failure → 'invalid_args',
//     error text from z.prettifyError(result.error). Run the tool with the
//     PARSED data (result.data), not the raw object: defaults are applied there.
//  5. Enforce timeoutMs → 'timeout'. Careful: an AbortSignal doesn't stop a
//     promise that ignores it. You need to race the tool against a timer, and
//     clear the timer afterwards so it doesn't keep the process alive.
//     Pass the tool a signal that aborts on EITHER ctx.signal or your timeout
//     (look up AbortSignal.any).
//  6. If run() throws or rejects → 'tool_threw' (include the message).
//  7. Validate the result with tool.output.safeParse(); failure → 'invalid_output'.
//     This one is OUR bug, not the model's; say so in the message.
//  8. Success → { type: 'tool', callId, name, args, result, latencyMs }.
//  9. `args` = the parsed JSON if parsing succeeded, else the raw string.
//     `latencyMs` covers the whole call, validation included.
//

export async function executeTool(
  registry: ToolRegistry,
  call: RawToolCall,
  ctx: ToolContext,
  timeoutMs: number,
): Promise<ToolStep> {
  const started = Date.now()
  const parsed = parseJson(call.arguments)
  const args = parsed.ok ? parsed.value : call.arguments   // rule 9

  // Every failure has the same shape; only the message and kind differ.
  const fail = (errorKind: ToolErrorKind, error: string): ToolStep => ({
    type: 'tool', callId: call.id, name: call.name, args, error, errorKind,
    latencyMs: Date.now() - started,
  })

  // Rule 2: look the tool up first, so a wrong name is reported even if the
  // arguments are broken too (the bigger mistake first).
  const tool = registry.get(call.name)
  if (!tool) {
    return fail('unknown_tool', `Unknown tool "${call.name}". Available tools: ${[...registry.keys()].join(', ')}.`)
  }

  // Rule 3
  if (!parsed.ok) return fail('bad_json', `Arguments for "${call.name}" are not valid JSON. Send a JSON object matching the tool's parameters.`)

  // Rule 4: validate, then use the PARSED data from here on (defaults applied).
  const input = tool.input.safeParse(parsed.value)
  if (!input.success) return fail('invalid_args', `Invalid arguments for "${call.name}":\n${z.prettifyError(input.error)}`)

  // Rules 5 + 6: race the tool against a timer. Aborting a signal only asks the
  // tool to stop; the race is what guarantees we return on time.
  const timeout = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => { timeout.abort(); resolve(TIMED_OUT) }, timeoutMs)
  })
  let result: unknown
  try {
    const signal = AbortSignal.any([ctx.signal, timeout.signal])
    result = await Promise.race([tool.run(input.data, { ...ctx, signal }), timedOut])
  } catch (err) {
    return fail('tool_threw', `Tool "${call.name}" failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
  if (result === TIMED_OUT) return fail('timeout', `Tool "${call.name}" timed out after ${timeoutMs}ms.`)

  // Rule 7: a bad result is OUR bug, so tell the model it isn't at fault.
  const output = tool.output.safeParse(result)
  if (!output.success) return fail('invalid_output', `Internal error in tool "${call.name}" (not caused by your arguments). Try a different approach.`)

  // Rule 8
  return { type: 'tool', callId: call.id, name: call.name, args, result: output.data, latencyMs: Date.now() - started }
}

/** A unique value, so a tool that legitimately returns 'timeout' can't be mistaken for one. */
const TIMED_OUT = Symbol('timed out')

/**
 * Returns success and failure as separate cases. A raw-string fallback would be
 * ambiguous: '"TCS"' is valid JSON that parses to the string "TCS".
 */
function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(raw) } } catch { return { ok: false } }
}
