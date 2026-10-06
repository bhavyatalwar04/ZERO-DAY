import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { runReactAgent, type ReactDeps } from './react-loop'
import { scriptedModel, ModelCallError, type ModelCaller, type ChatMessage } from './model'
import type { AgentLimits, AgentSpec, AnyToolDef, ToolStep, ToolContext } from './types'

// ─── Fixtures ───────────────────────────────────────────────

const Output = z.object({ summary: z.string(), confidence: z.number().min(0).max(1) })
type Out = z.infer<typeof Output>
const good: Out = { summary: 'INDIGO fell 9% on aviation-demand news', confidence: 0.8 }

let rsiCalls = 0
const rsi: AnyToolDef = {
  name: 'get_rsi',
  description: 'RSI(14) for a symbol',
  input: z.object({ symbol: z.string() }),
  output: z.object({ rsi: z.number() }),
  run: async () => { rsiCalls++; return { rsi: 28.4 } },
}

function makeSpec(
  over: Partial<AgentSpec<{ q: string }, Out>> = {},
  limits: Partial<AgentLimits> = {},
): AgentSpec<{ q: string }, Out> {
  return {
    name: 'research',
    kind: 'react',
    model: 'test-model',
    systemPrompt: 'SYS',
    buildUserMessage: i => `Q: ${i.q}`,
    tools: [rsi],
    output: Output,
    ...over,
    limits: { maxSteps: 5, maxTokens: 300, timeoutMs: 2000, toolTimeoutMs: 500, ...limits },
  }
}

const ctx: ReactDeps['ctx'] = {
  session: { source: 'client_snapshot', scenarioId: 'TEST', simMinute: 90, state: {} as ToolContext['session']['state'] },
  scenario: { scenarioId: 'TEST', timeline: {}, news: [], circuits: [] },
}
const deps = (model: ModelCaller): ReactDeps => ({ model, ctx, newRunId: () => 'run_test' })

const callRsi = { name: 'get_rsi', args: { symbol: 'INDIGO' } }
const submit = (args: unknown) => ({ name: 'submit_findings', args })
const lastMessage = (msgs: ChatMessage[]) => msgs[msgs.length - 1]
const toolSteps = (steps: { type: string }[]) => steps.filter((s): s is ToolStep => s.type === 'tool')

beforeEach(() => { rsiCalls = 0 })

// ─── Happy path and wiring ──────────────────────────────────

describe('runReactAgent: happy path', () => {
  it('runs a tool, then submits: status ok with the parsed output', async () => {
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ runId: 'run_test', agent: 'research', status: 'ok', output: good })
    expect(run.steps.map(s => s.type)).toEqual(['model', 'tool', 'model', 'tool'])
    expect(run.steps[3]).toMatchObject({ type: 'tool', name: 'submit_findings', result: good })
    expect(run.usage).toMatchObject({ promptTokens: 200, completionTokens: 40 })
    expect(run.usage.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('sends system + user messages, all tools plus submit, tool_choice required', async () => {
    const model = scriptedModel([{ toolCalls: [submit(good)] }])
    await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    const r = model.requests[0]
    expect(r.messages.slice(0, 2)).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'Q: why' }])
    expect(r.tools?.map(t => t.function.name).sort()).toEqual(['get_rsi', 'submit_findings'])
    expect(r).toMatchObject({ model: 'test-model', toolChoice: 'required', maxTokens: 300 })
  })

  it('appends the assistant message, then a tool message matched by tool_call_id', async () => {
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [submit(good)] }])
    await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    const msgs = model.requests[1].messages
    const assistant = msgs[msgs.length - 2]
    const tool = msgs[msgs.length - 1]
    expect(assistant.role).toBe('assistant')
    if (assistant.role !== 'assistant' || tool.role !== 'tool') throw new Error('wrong roles')
    expect(tool.tool_call_id).toBe(assistant.tool_calls?.[0].id)
    expect(tool.name).toBe('get_rsi')
    expect(JSON.parse(tool.content)).toEqual({ rsi: 28.4 })
  })

  it('feeds tool errors back to the model as "ERROR (<kind>): ..."', async () => {
    const model = scriptedModel([{ toolCalls: [{ name: 'get_price', args: {} }] }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    const last = lastMessage(model.requests[1].messages)
    expect(last.role).toBe('tool')
    expect(last.content).toMatch(/^ERROR \(unknown_tool\)/)
    expect(run.status).toBe('ok')
  })
})

// ─── The six agreed decisions ───────────────────────────────

describe('runReactAgent: decisions', () => {
  it('1: a prose-only reply gets a nudge and counts as a step', async () => {
    const model = scriptedModel([{ text: 'I think it fell.' }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(lastMessage(model.requests[1].messages).role).toBe('user')
    expect(run.status).toBe('ok')
    expect(run.steps.filter(s => s.type === 'model')).toHaveLength(2)
  })

  it('2: submit in the same turn as another call finishes without running the other', async () => {
    const model = scriptedModel([{ toolCalls: [callRsi, submit(good)] }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(rsiCalls).toBe(0)
    expect(model.requests).toHaveLength(1)
  })

  it('2 + 3: after an invalid submit, EVERY tool call in that turn gets a tool message (the API rejects unanswered calls)', async () => {
    const model = scriptedModel([{ toolCalls: [callRsi, submit({ summary: 'x' })] }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(rsiCalls).toBe(0)
    const msgs = model.requests[1].messages
    const assistant = msgs.find(m => m.role === 'assistant')
    if (assistant?.role !== 'assistant') throw new Error('no assistant message')
    const answered = msgs.flatMap(m => (m.role === 'tool' ? [m.tool_call_id] : []))
    expect(answered.sort()).toEqual(assistant.tool_calls!.map(tc => tc.id).sort())
  })

  it('3: an invalid submit gets one repair attempt', async () => {
    const model = scriptedModel([{ toolCalls: [submit({ summary: 'x' })] }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(lastMessage(model.requests[1].messages).content).toMatch(/^ERROR \(invalid_args\)/)
    expect(toolSteps(run.steps)[0]).toMatchObject({ name: 'submit_findings', errorKind: 'invalid_args' })
  })

  it('3: a second invalid submit (bad JSON counts) ends as invalid_output', async () => {
    const model = scriptedModel([{ toolCalls: [submit({ summary: 'x' })] }, { toolCalls: [submit('{bad')] }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'invalid_output', output: null })
    expect(toolSteps(run.steps)[1]).toMatchObject({ name: 'submit_findings', errorKind: 'bad_json' })
  })

  it('4: the last allowed step forces submit_findings', async () => {
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [callRsi] }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec({}, { maxSteps: 3 }), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(model.requests.map(r => r.toolChoice)).toEqual([
      'required', 'required', { type: 'function', function: { name: 'submit_findings' } },
    ])
  })

  it('4: never submitting ends as step_limit after exactly maxSteps model calls', async () => {
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [callRsi] }, { toolCalls: [callRsi] }])
    const run = await runReactAgent(makeSpec({}, { maxSteps: 3 }), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'step_limit', output: null })
    expect(model.requests).toHaveLength(3)
  })

  it('1.7: going over maxRunTokens forces a submit on the next call', async () => {
    // the fake reports 100 prompt + 20 completion tokens per call
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [callRsi] }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec({}, { maxRunTokens: 200 }), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(model.requests.map(r => r.toolChoice)).toEqual([
      'required', 'required', { type: 'function', function: { name: 'submit_findings' } },
    ])
  })

  it('1.7: still over budget after the forced submit fails → budget_exceeded', async () => {
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [callRsi] }, { text: 'no' }])
    const run = await runReactAgent(makeSpec({}, { maxRunTokens: 200 }), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'budget_exceeded', output: null })
    expect(run.error).toMatch(/Used 360 tokens; budget is 200/)
    expect(model.requests).toHaveLength(3)
  })

  it('5 + 6: a model call still running when the run timer fires ends as timeout, keeping earlier steps', async () => {
    const first = scriptedModel([{ toolCalls: [callRsi] }])
    let n = 0
    const model: ModelCaller = req => n++ === 0
      ? first(req)
      : new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new ModelCallError('aborted', 'aborted'))))
    const started = Date.now()
    const run = await runReactAgent(makeSpec({}, { timeoutMs: 50 }), { q: 'why' }, deps(model))
    expect(Date.now() - started).toBeLessThan(1000)
    expect(run).toMatchObject({ status: 'timeout', output: null })
    expect(run.steps.map(s => s.type)).toEqual(['model', 'tool'])
  })

  it('5: a tool that ignores its signal cannot hold the run past timeoutMs, and it saw the run signal abort', async () => {
    let seen: AbortSignal | undefined
    const stubborn: AnyToolDef = { ...rsi, name: 'stubborn', run: (_i, c) => { seen = c.signal; return new Promise(() => {}) } }
    const model = scriptedModel([{ toolCalls: [{ name: 'stubborn', args: { symbol: 'X' } }] }])
    const started = Date.now()
    const run = await runReactAgent(
      makeSpec({ tools: [stubborn] }, { timeoutMs: 50, toolTimeoutMs: 5000 }),
      { q: 'why' }, deps(model),
    )
    expect(Date.now() - started).toBeLessThan(1000)
    expect(run.status).toBe('timeout')
    expect(seen?.aborted).toBe(true)
  })

  it('6: tool_use_failed is retried once with a nudge', async () => {
    const model = scriptedModel([
      { error: new ModelCallError('tool_use_failed', 'bad call', 400) },
      { toolCalls: [submit(good)] },
    ])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(lastMessage(model.requests[1].messages).role).toBe('user')
  })

  it('6: a malformed FORCED submit on the last step is retried, still forced (live run 2026-10-02)', async () => {
    const model = scriptedModel([
      { toolCalls: [callRsi] },
      { error: new ModelCallError('tool_use_failed', 'Tool choice is required, but model did not call a tool', 400) },
      { toolCalls: [submit(good)] },
    ])
    const run = await runReactAgent(makeSpec({}, { maxSteps: 2 }), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(model.requests).toHaveLength(3)
    expect(model.requests[2].toolChoice).toEqual({ type: 'function', function: { name: 'submit_findings' } })
  })

  it('6: a second tool_use_failed in the same run ends as error', async () => {
    const model = scriptedModel([
      { error: new ModelCallError('tool_use_failed', 'bad call', 400) },
      { error: new ModelCallError('tool_use_failed', 'bad call', 400) },
    ])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'error', output: null })
  })

  it('6: other model errors end the run as error without retrying', async () => {
    const model = scriptedModel([{ error: new ModelCallError('http', 'Groq 500', 500) }])
    const run = await runReactAgent(makeSpec(), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'error', output: null, error: 'http: Groq 500' })
    expect(model.requests).toHaveLength(1)
  })
})

// ─── Robustness ─────────────────────────────────────────────

describe("runReactAgent: the agent's own check (spec.check, M6.1)", () => {
  const mentions9 = (o: Out) => (o.summary.includes('9%') ? 'The number 9 appears in no tool result.' : null)

  it("a schema-valid submit that fails the check gets one repair, with the check's message", async () => {
    const fixed = { summary: 'INDIGO RSI is 28.4', confidence: 0.8 }
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [submit(good)] }, { toolCalls: [submit(fixed)] }])
    const run = await runReactAgent(makeSpec({ check: mentions9 }), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'ok', output: fixed })
    const rejected = toolSteps(run.steps).find(s => s.errorKind === 'failed_check')
    expect(rejected).toMatchObject({ name: 'submit_findings', error: 'The number 9 appears in no tool result.' })
    expect(rejected?.result).toBeUndefined()
    expect(lastMessage(model.requests[2].messages)).toMatchObject({ role: 'tool', content: 'ERROR (failed_check): The number 9 appears in no tool result.' })
  })

  it('failing the check twice ends as invalid_output', async () => {
    const model = scriptedModel([{ toolCalls: [submit(good)] }, { toolCalls: [submit(good)] }])
    const run = await runReactAgent(makeSpec({ check: mentions9 }), { q: 'why' }, deps(model))
    expect(run.status).toBe('invalid_output')
  })

  it('sees the steps BEFORE the submission (not circular) and the run input', async () => {
    let seen: { types: string[]; q: string } | null = null
    const model = scriptedModel([{ toolCalls: [callRsi] }, { toolCalls: [submit(good)] }])
    await runReactAgent(makeSpec({ check: (_o, steps, input) => { seen = { types: steps.map(s => s.type === 'tool' ? s.name : 'model'), q: input.q }; return null } }), { q: 'why' }, deps(model))
    expect(seen).toEqual({ types: ['model', 'get_rsi', 'model'], q: 'why' })
  })

  it('is not run on a schema-invalid submission', async () => {
    let calls = 0
    const model = scriptedModel([{ toolCalls: [submit({ summary: 'x' })] }, { toolCalls: [submit(good)] }])
    await runReactAgent(makeSpec({ check: () => { calls++; return null } }), { q: 'why' }, deps(model))
    expect(calls).toBe(1)
  })
})

describe('runReactAgent: never throws', () => {
  it('turns an arbitrary thrown error into status error', async () => {
    const model: ModelCaller = async () => { throw new Error('kaboom') }
    await expect(runReactAgent(makeSpec(), { q: 'why' }, deps(model))).resolves.toMatchObject({ status: 'error', output: null })
  })
})
