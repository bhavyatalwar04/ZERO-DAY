import 'server-only'
import { z } from 'zod'
import { SUBMIT_TOOL_NAME, type AnyToolDef } from './types'

// ============================================================================
// Zod → Groq tool definitions (OpenAI-compatible "function" tools)
// ============================================================================

export interface GroqTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

// z.number().int() emits ±Number.MAX_SAFE_INTEGER bounds. They carry no
// information for the model and cost tokens on every request, so drop them.
const SAFE_INT = Number.MAX_SAFE_INTEGER

function stripNoise(node: unknown, dropKeys: string[] = []): unknown {
  if (Array.isArray(node)) return node.map(n => stripNoise(n, dropKeys))
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema' || dropKeys.includes(k)) continue
    if (k === 'maximum' && v === SAFE_INT) continue
    if (k === 'minimum' && v === -SAFE_INT) continue
    out[k] = stripNoise(v, dropKeys)
  }
  return out
}

/**
 * JSON Schema for what the MODEL must send, so we use `io: 'input'`: a field
 * with a .default() is optional for the model even though it's always present
 * after parsing.
 */
export function zodToParameters(schema: z.ZodType): Record<string, unknown> {
  return stripNoise(z.toJSONSchema(schema, { io: 'input' })) as Record<string, unknown>
}

/**
 * JSON Schema for Groq's strict structured outputs (constrained decoding).
 * Strict mode requires every property to be `required` and every object to
 * have `additionalProperties: false`. Zod's OUTPUT view already gives the
 * second; this throws if the first is violated, at definition time instead of
 * as a 400 on every live call. Use `.nullable()` instead of `.optional()`.
 */
export function zodToStrictSchema(schema: z.ZodType): Record<string, unknown> {
  // `default` is dropped too: in the output view a defaulted field is always
  // present anyway, and OpenAI-style strict mode rejects the keyword.
  const json = stripNoise(z.toJSONSchema(schema, { io: 'output' }), ['default']) as Record<string, unknown>
  assertAllRequired(json, '')
  return json
}

/** Walks the schema; every object property must be listed in `required`. */
function assertAllRequired(node: unknown, path: string): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) assertAllRequired(n, path); return }
  const obj = node as Record<string, unknown>
  const props = obj.properties as Record<string, unknown> | undefined
  if (props) {
    const required = new Set((obj.required as string[] | undefined) ?? [])
    for (const [key, child] of Object.entries(props)) {
      const childPath = path ? `${path}.${key}` : key
      if (!required.has(key)) {
        throw new Error(`Strict output schema: "${childPath}" is optional. Strict mode needs every field required; use .nullable() instead of .optional().`)
      }
      assertAllRequired(child, childPath)
    }
  }
  if (obj.items) assertAllRequired(obj.items, `${path}[]`)
  for (const key of ['anyOf', 'oneOf', 'allOf']) if (obj[key]) assertAllRequired(obj[key], path)
}

export function toGroqTool(tool: AnyToolDef): GroqTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: zodToParameters(tool.input) },
  }
}

/**
 * The tool that ends a ReAct loop. Its parameters are the agent's output
 * schema, so "submitting" = handing over the final answer as structured args.
 * (On Groq, schema-enforced output can't be combined with tool calling, see ADR-001.)
 */
export function submitTool(output: z.ZodType, description: string): GroqTool {
  return {
    type: 'function',
    function: { name: SUBMIT_TOOL_NAME, description, parameters: zodToParameters(output) },
  }
}
