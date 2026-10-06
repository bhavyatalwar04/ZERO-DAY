import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createRegistry, executeTool } from './registry'
import type { AnyToolDef, ToolContext, RawToolCall } from './types'

// ─── Fixtures ───────────────────────────────────────────────

function makeCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return {
    session: { source: 'client_snapshot', scenarioId: 'TEST', simMinute: 0, state: {} as ToolContext['session']['state'] },
    scenario: { scenarioId: 'TEST', timeline: {}, news: [], circuits: [] },
    signal,
  }
}

const call = (name: string, args: string): RawToolCall => ({ id: 'call_1', name, arguments: args })

const double: AnyToolDef = {
  name: 'double',
  description: 'Doubles n',
  input: z.object({ n: z.number().default(3) }),
  output: z.object({ value: z.number() }),
  run: async ({ n }) => ({ value: n * 2 }),
}

const hangs: AnyToolDef = {
  name: 'hangs',
  description: 'Never resolves',
  input: z.object({}),
  output: z.object({}),
  run: () => new Promise(() => {}),
}

const throws: AnyToolDef = {
  name: 'throws',
  description: 'Always throws',
  input: z.object({}),
  output: z.object({}),
  run: async () => { throw new Error('database unavailable') },
}

const lies: AnyToolDef = {
  name: 'lies',
  description: 'Returns the wrong shape',
  input: z.object({}),
  output: z.object({ value: z.number() }),
  run: async () => ({ value: 'not a number' }),
}

const registry = createRegistry([double, hangs, throws, lies])

// ─── createRegistry ─────────────────────────────────────────

describe('createRegistry', () => {
  it('rejects duplicate, reserved and non-snake_case names', () => {
    expect(() => createRegistry([double, double])).toThrow(/Duplicate/)
    expect(() => createRegistry([{ ...double, name: 'submit_findings' }])).toThrow(/reserved/)
    expect(() => createRegistry([{ ...double, name: 'getPrice' }])).toThrow(/snake_case/)
  })
})

// ─── executeTool spec ───────────────────────────────────────

describe('executeTool', () => {
  it('rule 8: runs a valid call and returns a successful step', async () => {
    const step = await executeTool(registry, call('double', '{"n":5}'), makeCtx(), 1000)
    expect(step).toMatchObject({ type: 'tool', callId: 'call_1', name: 'double', args: { n: 5 }, result: { value: 10 } })
    expect(step.error).toBeUndefined()
    expect(step.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('rule 4: runs the tool with PARSED data (defaults applied)', async () => {
    const step = await executeTool(registry, call('double', '{}'), makeCtx(), 1000)
    expect(step.result).toEqual({ value: 6 })
  })

  it('rule 2: unknown tool, and the error lists available tools', async () => {
    const step = await executeTool(registry, call('get_price', '{}'), makeCtx(), 1000)
    expect(step.errorKind).toBe('unknown_tool')
    expect(step.error).toMatch(/double/)
  })

  it('rules 3 + 9: bad JSON, and args keeps the raw string', async () => {
    const step = await executeTool(registry, call('double', '{n: 5'), makeCtx(), 1000)
    expect(step.errorKind).toBe('bad_json')
    expect(step.args).toBe('{n: 5')
  })

  it('rule 4: schema-invalid args give invalid_args with a readable message', async () => {
    const step = await executeTool(registry, call('double', '{"n":"five"}'), makeCtx(), 1000)
    expect(step.errorKind).toBe('invalid_args')
    expect(step.error).toMatch(/n/)
    expect(step.args).toEqual({ n: 'five' })
  })

  it('rule 5: a hanging tool times out, and the tool sees an aborted signal', async () => {
    let seen: AbortSignal | undefined
    const spy: AnyToolDef = { ...hangs, name: 'spy', run: (_i, ctx) => { seen = ctx.signal; return new Promise(() => {}) } }
    const started = Date.now()
    const step = await executeTool(createRegistry([spy]), call('spy', '{}'), makeCtx(), 50)
    expect(step.errorKind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(seen?.aborted).toBe(true)
  })

  it('rule 5: the tool signal also follows the parent ctx.signal', async () => {
    const parent = new AbortController()
    parent.abort()
    let sawAborted = false
    const spy: AnyToolDef = { ...double, name: 'spy', output: z.object({}), run: async (_i, ctx) => { sawAborted = ctx.signal.aborted; return {} } }
    await executeTool(createRegistry([spy]), call('spy', '{}'), makeCtx(parent.signal), 1000)
    expect(sawAborted).toBe(true)
  })

  it('rule 6: a throwing tool gives tool_threw with the message', async () => {
    const step = await executeTool(registry, call('throws', '{}'), makeCtx(), 1000)
    expect(step.errorKind).toBe('tool_threw')
    expect(step.error).toMatch(/database unavailable/)
  })

  it('rule 7: a wrong-shaped result gives invalid_output', async () => {
    const step = await executeTool(registry, call('lies', '{}'), makeCtx(), 1000)
    expect(step.errorKind).toBe('invalid_output')
    expect(step.result).toBeUndefined()
  })

  it('rule 1: never throws, whatever the input', async () => {
    for (const c of [call('nope', 'null'), call('double', ''), call('double', '[]'), call('throws', '{}')]) {
      await expect(executeTool(registry, c, makeCtx(), 1000)).resolves.toMatchObject({ type: 'tool' })
    }
  })
})
