import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { runSingleShot } from './single-shot'
import { scriptedModel, ModelCallError, type ModelCaller, type ChatMessage } from './model'
import type { AgentLimits, AgentSpec } from './types'

// ─── Fixtures ───────────────────────────────────────────────

const Feedback = z.object({
  message: z.string().min(10),
  severity: z.enum(['info', 'caution', 'warning']),
  bias: z.string().nullable(),
})
type Feedback = z.infer<typeof Feedback>
const good: Feedback = { message: 'You sold into a halt-driven panic.', severity: 'caution', bias: 'loss_aversion' }

function makeSpec(output: z.ZodType<Feedback> = Feedback, limits: Partial<AgentLimits> = {}): AgentSpec<{ q: string }, Feedback> {
  return {
    name: 'coach', kind: 'single_shot', model: 'test-model', systemPrompt: 'SYS',
    buildUserMessage: i => `Q: ${i.q}`, tools: [], output,
    limits: { maxSteps: 2, maxTokens: 400, timeoutMs: 2000, toolTimeoutMs: 0, ...limits },
  }
}
const deps = (model: ModelCaller) => ({ model, newRunId: () => 'run_test' })
const last = (msgs: ChatMessage[]) => msgs[msgs.length - 1]

// ─── Tests ──────────────────────────────────────────────────

describe('runSingleShot', () => {
  it('ok on the first valid answer; sends a strict json_schema and no tools', async () => {
    const model = scriptedModel([{ text: JSON.stringify(good) }])
    const run = await runSingleShot(makeSpec(), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ runId: 'run_test', agent: 'coach', status: 'ok', output: good })
    const r = model.requests[0]
    expect(r.tools).toBeUndefined()
    expect(r.responseFormat).toMatchObject({ type: 'json_schema', json_schema: { name: 'coach_output', strict: true } })
    expect(r.responseFormat?.json_schema.schema).toMatchObject({ required: ['message', 'severity', 'bias'], additionalProperties: false })
    expect(r.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'Q: why' }])
  })

  it('json_validate_failed (strict mode gave up) uses an attempt and retries; passes reasoningEffort', async () => {
    const model = scriptedModel([
      { error: new ModelCallError('json_validate_failed', 'Groq 400: json_validate_failed', 400) },
      { text: JSON.stringify(good) },
    ])
    const run = await runSingleShot({ ...makeSpec(), reasoningEffort: 'low' }, { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0].reasoningEffort).toBe('low')
  })

  it('json_validate_failed on every attempt → invalid_output, with the reason', async () => {
    const e = () => ({ error: new ModelCallError('json_validate_failed', 'Groq 400: json_validate_failed', 400) })
    const run = await runSingleShot(makeSpec(), { q: 'why' }, deps(scriptedModel([e(), e()])))
    expect(run.status).toBe('invalid_output')
    expect(run.error).toMatch(/could not produce schema-valid JSON/)
  })

  it('repairs invalid JSON once, sending the problem back', async () => {
    const model = scriptedModel([{ text: '{not json' }, { text: JSON.stringify(good) }])
    const run = await runSingleShot(makeSpec(), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    const repair = last(model.requests[1].messages)
    expect(repair.role).toBe('user')
    expect(repair.content).toMatch(/not valid JSON/)
    expect(run.steps).toHaveLength(2)
  })

  it('catches what constrained decoding does not: a Zod refinement (min length)', async () => {
    const model = scriptedModel([{ text: JSON.stringify({ ...good, message: 'short' }) }, { text: JSON.stringify(good) }])
    const run = await runSingleShot(makeSpec(), { q: 'why' }, deps(model))
    expect(run.status).toBe('ok')
    expect(last(model.requests[1].messages).content).toMatch(/does not match the required format/)
  })

  it('invalid twice ends as invalid_output, with both problems in error', async () => {
    const model = scriptedModel([{ text: '{bad' }, { text: JSON.stringify({ ...good, severity: 'panic' }) }])
    const run = await runSingleShot(makeSpec(), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'invalid_output', output: null })
    expect(run.error).toMatch(/attempt 1: not valid JSON/)
    expect(run.error).toMatch(/attempt 2: does not match/)
  })

  it("spec.check: a schema-valid answer that fails the agent's own check gets one repair with the check's message", async () => {
    const noStops = (o: Feedback) => (/stop-loss/i.test(o.message) ? 'Do not suggest stop-losses: they do not execute here.' : null)
    const bad: Feedback = { ...good, message: 'Next time, set a stop-loss before entering.' }
    const model = scriptedModel([{ text: JSON.stringify(bad) }, { text: JSON.stringify(good) }])
    const run = await runSingleShot({ ...makeSpec(), check: noStops }, { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'ok', output: good })
    expect(last(model.requests[1].messages).content).toMatch(/Do not suggest stop-losses/)
  })

  it('maxSteps: 1 means no repair attempt', async () => {
    const model = scriptedModel([{ text: '{bad' }])
    const run = await runSingleShot(makeSpec(Feedback, { maxSteps: 1 }), { q: 'why' }, deps(model))
    expect(run.status).toBe('invalid_output')
    expect(model.requests).toHaveLength(1)
  })

  it('names truncation when finish_reason is "length"', async () => {
    const model = scriptedModel([{ text: '{"message": "You sold in', finishReason: 'length' }])
    const run = await runSingleShot(makeSpec(Feedback, { maxSteps: 1 }), { q: 'why' }, deps(model))
    expect(run.error).toMatch(/cut off by the token limit/)
  })

  it('a schema strict mode cannot express is an error before any model call', async () => {
    const model = scriptedModel([])
    const loose = z.object({ message: z.string(), severity: z.enum(['info']), bias: z.string().optional() }) as unknown as z.ZodType<Feedback>
    const run = await runSingleShot(makeSpec(loose), { q: 'why' }, deps(model))
    expect(run.status).toBe('error')
    expect(run.error).toMatch(/"bias" is optional/)
    expect(model.requests).toHaveLength(0)
  })

  it('times out a model call that hangs', async () => {
    const model: ModelCaller = req =>
      new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new ModelCallError('aborted', 'aborted'))))
    const started = Date.now()
    const run = await runSingleShot(makeSpec(Feedback, { timeoutMs: 50 }), { q: 'why' }, deps(model))
    expect(Date.now() - started).toBeLessThan(1000)
    expect(run).toMatchObject({ status: 'timeout', output: null })
  })

  it('model errors end the run as error, with the reason', async () => {
    const model = scriptedModel([{ error: new ModelCallError('http', 'Groq 500', 500) }])
    const run = await runSingleShot(makeSpec(), { q: 'why' }, deps(model))
    expect(run).toMatchObject({ status: 'error', error: 'http: Groq 500' })
  })
})
