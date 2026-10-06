import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { toGroqTool, submitTool, zodToStrictSchema } from './groq-tools'

describe('toGroqTool', () => {
  const tool = {
    name: 'get_window',
    description: 'OHLCV window',
    input: z.object({
      symbol: z.string().describe('NSE ticker'),
      from: z.number().int().min(0),
      bars: z.number().int().default(12),
    }),
    output: z.object({}),
    run: async () => ({}),
  }
  const params = toGroqTool(tool).function.parameters as {
    $schema?: string; required: string[]; properties: Record<string, Record<string, unknown>>
  }

  it('produces an OpenAI-style function tool', () => {
    expect(toGroqTool(tool)).toMatchObject({ type: 'function', function: { name: 'get_window', description: 'OHLCV window' } })
  })

  it('strips $schema and the safe-integer noise bounds', () => {
    expect(params.$schema).toBeUndefined()
    expect(params.properties.from).toEqual({ type: 'integer', minimum: 0 })
  })

  it('keeps descriptions (the model reads them)', () => {
    expect(params.properties.symbol.description).toBe('NSE ticker')
  })

  it('uses the input view: fields with defaults are optional for the model', () => {
    expect(params.required).toEqual(['symbol', 'from'])
  })
})

describe('zodToStrictSchema', () => {
  it('produces an all-required, closed schema without $schema, default or int noise', () => {
    const s = zodToStrictSchema(z.object({
      message: z.string(),
      n: z.number().int().default(1),
      tag: z.string().nullable(),
      nested: z.object({ a: z.number() }),
    })) as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> }
    expect(s.required).toEqual(['message', 'n', 'tag', 'nested'])
    expect(s.additionalProperties).toBe(false)
    expect(s.properties.n).toEqual({ type: 'integer' })
    expect(s.properties.tag.type).toEqual(['string', 'null'])
    expect(JSON.stringify(s)).not.toMatch(/\$schema|"default"/)
  })

  it('rejects .optional() anywhere, naming the field and the fix', () => {
    expect(() => zodToStrictSchema(z.object({ bias: z.string().optional() }))).toThrow(/"bias" is optional.*\.nullable\(\)/)
    expect(() => zodToStrictSchema(z.object({ items: z.array(z.object({ why: z.string().optional() })) })))
      .toThrow(/"items\[\]\.why" is optional/)
  })
})

describe('submitTool', () => {
  it('uses the reserved name and the output schema as parameters', () => {
    const t = submitTool(z.object({ summary: z.string() }), 'Submit your findings')
    expect(t.function.name).toBe('submit_findings')
    expect((t.function.parameters as { required: string[] }).required).toEqual(['summary'])
  })
})
