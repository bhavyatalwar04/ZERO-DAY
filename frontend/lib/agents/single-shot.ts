import 'server-only'
import { z } from 'zod'
import { zodToStrictSchema } from './groq-tools'
import { ModelCallError, type ChatMessage, type ModelCaller, type ModelResponse } from './model'
import { TIMED_OUT, describeError, startDeadline, sumUsage } from './run-support'
import type { AgentRun, AgentSpec, AgentStep, RunStatus } from './types'

// ============================================================================
// Single-shot runner (roadmap 1.5): one LLM call, no tools, output enforced
// twice (ADR-001, used by Coach):
//   1. strict json_schema = constrained decoding: the model can't emit tokens
//      that break the schema's structure;
//   2. our Zod check afterwards: catches what decoding doesn't enforce
//      (refinements, truncation) and anything a non-strict model returns.
// `limits.maxSteps` = attempts: 2 gives one repair attempt, as for
// submit_findings in the loop. Never throws.
// Written by Claude at Bhavya's request (2026-09-23).
// ============================================================================

export interface SingleShotDeps {
  model: ModelCaller
  newRunId?: () => string
}

export async function runSingleShot<In, Out>(
  spec: AgentSpec<In, Out>,
  input: In,
  deps: SingleShotDeps,
): Promise<AgentRun<Out>> {
  const started = Date.now()
  const runId = deps.newRunId?.() ?? crypto.randomUUID()
  const steps: AgentStep[] = []
  const deadline = startDeadline(spec.limits.timeoutMs)

  const finish = (status: RunStatus, output: Out | null = null, error?: string): AgentRun<Out> => {
    deadline.clear()
    return {
      runId, agent: spec.name, ...(spec.model ? { model: spec.model } : {}), status, output, ...(error ? { error } : {}), steps,
      usage: { ...sumUsage(steps), latencyMs: Date.now() - started },
    }
  }

  try {
    if (!spec.model) return finish('error', null, 'AgentSpec.model is required for a single-shot agent')
    // Throws on a schema strict mode can't express: a definition bug, reported before any call.
    const schema = zodToStrictSchema(spec.output)
    const responseFormat = { type: 'json_schema' as const, json_schema: { name: `${spec.name}_output`, strict: true, schema } }
    const messages: ChatMessage[] = [
      { role: 'system', content: spec.systemPrompt ?? '' },
      { role: 'user', content: spec.buildUserMessage?.(input) ?? '' },
    ]
    const problems: string[] = []

    for (let attempt = 1; attempt <= spec.limits.maxSteps; attempt++) {
      let response: ModelResponse
      try {
        const r = await Promise.race([
          deps.model({ model: spec.model, messages, responseFormat, maxTokens: spec.limits.maxTokens, reasoningEffort: spec.reasoningEffort, signal: deadline.signal }),
          deadline.timedOut,
        ])
        if (r === TIMED_OUT) return finish('timeout', null, `Run exceeded ${spec.limits.timeoutMs}ms waiting for the model`)
        response = r
      } catch (err) {
        if (err instanceof ModelCallError && err.kind === 'aborted') return finish('timeout', null, err.message)
        // Strict mode failed to produce valid JSON (no output to show the model): use the attempt and try again.
        if (err instanceof ModelCallError && err.kind === 'json_validate_failed') {
          problems.push(`attempt ${attempt}: the provider could not produce schema-valid JSON (${err.message.slice(0, 160)})`)
          continue
        }
        return finish('error', null, describeError(err))
      }
      steps.push(response.step)

      let checked = check(response, spec.output)
      if (checked.ok && spec.check) {
        // The agent's own content check (e.g. Coach: no new numbers, no stop-loss advice).
        const problem = spec.check(checked.value, steps, input)
        if (problem) checked = { ok: false, problem }
      }
      if (checked.ok) return finish('ok', checked.value)

      problems.push(`attempt ${attempt}: ${checked.problem}`)
      messages.push(response.message, {
        role: 'user',
        content: `Your answer was rejected: ${checked.problem}\nReply again with only the corrected JSON object.`,
      })
    }
    return finish('invalid_output', null, problems.join('\n'))
  } catch (err) {
    return finish('error', null, describeError(err))
  }
}

function check<Out>(response: ModelResponse, schema: z.ZodType<Out>): { ok: true; value: Out } | { ok: false; problem: string } {
  // A reply cut off by the token limit is invalid JSON; say why, so the fix is obvious in the audit log.
  const truncated = response.finishReason === 'length' ? ' (the reply was cut off by the token limit)' : ''
  let parsed: unknown
  try {
    parsed = JSON.parse(response.message.content ?? '')
  } catch {
    return { ok: false, problem: `not valid JSON${truncated}` }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) return { ok: false, problem: `does not match the required format${truncated}:\n${z.prettifyError(result.error)}` }
  return { ok: true, value: result.data }
}
