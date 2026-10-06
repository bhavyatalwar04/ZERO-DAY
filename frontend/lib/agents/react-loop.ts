import 'server-only'
import { z } from 'zod'
import { createRegistry, executeTool } from './registry'
import { submitTool, toGroqTool } from './groq-tools'
import { ModelCallError, type ChatMessage, type ModelCaller, type ModelResponse, type ToolChoice } from './model'
import { TIMED_OUT, describeError, startDeadline, sumUsage } from './run-support'
import {
  SUBMIT_TOOL_NAME,
  type AgentRun, type AgentSpec, type AgentStep, type RawToolCall, type RunStatus, type ToolContext, type ToolStep,
} from './types'

// ============================================================================
// ReAct loop (roadmap 1.3)
// Decisions agreed 2026-09-23; react-loop.test.ts checks each one.
// Implementation written by Claude at Bhavya's request (recorded in docs/LEARNINGS.md).
// ============================================================================
//
// Setup
//  - Build the registry from spec.tools (createRegistry). The model's tool list =
//    every tool via toGroqTool() + submitTool(spec.output, <description>).
//  - messages = [system: spec.systemPrompt, user: spec.buildUserMessage(input)].
//  - One AbortController for the whole run; abort it after spec.limits.timeoutMs.
//    Its signal goes to every model call AND into ctx for tools.
//    Clear the timer when the run ends, whatever the outcome.
//    A tool that ignores its signal must not hold the run past timeoutMs:
//    the run ends as 'timeout' on time even if executeTool hasn't returned yet.
//
// Each step (at most spec.limits.maxSteps model calls)
//  - Call deps.model with toolChoice 'required', maxTokens from limits.
//    On the LAST allowed step, force the submit tool instead:
//      toolChoice: { type: 'function', function: { name: SUBMIT_TOOL_NAME } }      [decision 4]
//  - Record response.step, then push response.message onto messages unchanged.
//  - No tool calls (the model replied in prose):
//      push a user message telling it it must call a tool; this counts as a step. [decision 1]
//  - If any call is SUBMIT_TOOL_NAME, handle ONLY that call; don't run the others. [decision 2]
//      Parse + validate its arguments against spec.output and record a ToolStep
//      named SUBMIT_TOOL_NAME (bad JSON → errorKind 'bad_json', schema failure →
//      'invalid_args', success → result = the parsed output).
//      Valid   → finish with status 'ok', output = parsed data.
//      Invalid → send the error back as that call's tool result; ONE repair
//                attempt is allowed. A second invalid submit → 'invalid_output'. [decision 3]
//  - Otherwise run each call in order with executeTool(registry, call, ctx, limits.toolTimeoutMs),
//    record each ToolStep, and push a tool message:
//      { role: 'tool', tool_call_id, name, content }
//      content = JSON.stringify(result), or `ERROR (<errorKind>): <error>` on failure.
//
// Endings
//  - Ran out of steps without a valid submit            → 'step_limit'
//  - ModelCallError 'aborted' (the run timer fired)      → 'timeout'           [decisions 5, 6]
//  - ModelCallError 'tool_use_failed': retry ONCE (push a user nudge, counts as a step);
//    a second one in the same run → 'error'                                    [decision 6]
//  - Any other error (other ModelCallError kinds, or anything thrown) → 'error'
//  - NEVER throws. Every ending returns an AgentRun with all steps so far, output null
//    unless 'ok', and usage summed over model steps (+ total wall-clock latencyMs).
//  - runId = deps.newRunId?.() ?? crypto.randomUUID()

export interface ReactDeps {
  model: ModelCaller
  /** tool context minus the signal: the loop supplies the run's signal */
  ctx: Omit<ToolContext, 'signal'>
  newRunId?: () => string
}

export async function runReactAgent<In, Out>(
  spec: AgentSpec<In, Out>,
  input: In,
  deps: ReactDeps,
): Promise<AgentRun<Out>> {
  const started = Date.now()
  const runId = deps.newRunId?.() ?? crypto.randomUUID()
  const steps: AgentStep[] = []

  // One deadline for the whole run [decision 5]. Its signal cancels the
  // in-flight model call and tells tools to stop; racing against `timedOut`
  // guarantees we return on time even if something ignores the signal.
  const deadline = startDeadline(spec.limits.timeoutMs)
  const { timedOut } = deadline

  // Every ending goes through here, so the deadline is always cleared.
  const finish = (status: RunStatus, output: Out | null = null, error?: string): AgentRun<Out> => {
    deadline.clear()
    return {
      runId, agent: spec.name, ...(spec.model ? { model: spec.model } : {}), status, output, ...(error ? { error } : {}), steps,
      usage: { ...sumUsage(steps), latencyMs: Date.now() - started },
    }
  }

  try {
    if (!spec.model) return finish('error', null, 'AgentSpec.model is required for a react agent')
    const registry = createRegistry(spec.tools)
    const tools = [...spec.tools.map(toGroqTool), submitTool(spec.output, SUBMIT_DESCRIPTION)]
    const messages: ChatMessage[] = [
      { role: 'system', content: spec.systemPrompt ?? '' },
      { role: 'user', content: spec.buildUserMessage?.(input) ?? '' },
    ]
    const ctx: ToolContext = { ...deps.ctx, signal: deadline.signal }
    let invalidSubmits = 0
    let malformedCalls = 0
    let budgetForced = false   // 1.7: we already gave the over-budget "last chance"

    for (let step = 1; step <= spec.limits.maxSteps; step++) {
      // 1.7 token budget: first time over → force a submit; still over after that → stop.
      const { promptTokens, completionTokens } = sumUsage(steps)
      const used = promptTokens + completionTokens
      const overBudget = spec.limits.maxRunTokens !== undefined && used >= spec.limits.maxRunTokens
      if (overBudget && budgetForced) {
        return finish('budget_exceeded', null, `Used ${used} tokens; budget is ${spec.limits.maxRunTokens}`)
      }
      if (overBudget) budgetForced = true

      // [decision 4] the last step (or the first step over budget) can only submit
      const toolChoice: ToolChoice = step === spec.limits.maxSteps || overBudget
        ? { type: 'function', function: { name: SUBMIT_TOOL_NAME } }
        : 'required'

      let response: ModelResponse
      try {
        const r = await Promise.race([
          deps.model({ model: spec.model, messages, tools, toolChoice, maxTokens: spec.limits.maxTokens, signal: deadline.signal }),
          timedOut,
        ])
        if (r === TIMED_OUT) return finish('timeout', null, `Run exceeded ${spec.limits.timeoutMs}ms waiting for the model`)
        response = r
      } catch (err) {
        if (err instanceof ModelCallError && err.kind === 'aborted') return finish('timeout', null, err.message)   // [decision 6]
        if (err instanceof ModelCallError && err.kind === 'tool_use_failed' && ++malformedCalls === 1) {
          messages.push({ role: 'user', content: NUDGE_MALFORMED })                                        // retry once
          // The retry doesn't use up a step: Groq rejected the call, so no step happened.
          // Otherwise a malformed FORCED submit on the last step leaves no step to retry it in
          // (live 2026-10-02: gpt-oss, step_limit twice). Bounded: this branch runs at most once.
          step--
          continue
        }
        return finish('error', null, describeError(err))
      }

      steps.push(response.step)
      messages.push(response.message)
      const calls = response.step.toolCalls

      // [decision 1] prose instead of a tool call: nudge, and it counts as a step
      if (calls.length === 0) {
        messages.push({ role: 'user', content: NUDGE_PROSE })
        continue
      }

      // [decision 2] a submit ends the turn; the other calls in it are not run
      const submit = calls.find(c => c.name === SUBMIT_TOOL_NAME)
      if (submit) {
        let checked = checkSubmit(submit, spec.output)
        if (!checked.errorKind && spec.check) {
          // The agent's own check (e.g. grounding) runs only on a schema-valid answer.
          const problem = spec.check(checked.result as Out, steps, input)
          if (problem) checked = { ...checked, result: undefined, errorKind: 'failed_check', error: problem }
        }
        steps.push(checked)
        if (!checked.errorKind) return finish('ok', checked.result as Out)
        if (++invalidSubmits === 2) return finish('invalid_output')                                     // [decision 3]
        // Answer EVERY call from this turn: the API rejects a request that
        // leaves any tool call from the previous assistant message unanswered.
        for (const call of calls) {
          messages.push(call === submit
            ? toolMessage(call, checked)
            : { role: 'tool', tool_call_id: call.id, name: call.name, content: SKIPPED_BESIDE_SUBMIT })
        }
        continue
      }

      for (const call of calls) {
        const r = await Promise.race([executeTool(registry, call, ctx, spec.limits.toolTimeoutMs), timedOut])
        if (r === TIMED_OUT) return finish('timeout', null, `Run exceeded ${spec.limits.timeoutMs}ms during tool "${call.name}"`)
        steps.push(r)
        messages.push(toolMessage(call, r))
      }
    }
    return budgetForced
      ? finish('budget_exceeded', null, `Token budget ${spec.limits.maxRunTokens} exceeded and the forced submit failed`)
      : finish('step_limit')
  } catch (err) {
    return finish('error', null, describeError(err))   // anything unexpected: the loop never throws
  }
}

// ─── Helpers and the fixed messages the model sees ──────────


const SUBMIT_DESCRIPTION =
  'Submit your final findings. Call this once you have enough evidence from the other tools. Its arguments are your answer.'
const NUDGE_PROSE =
  'Do not reply in plain text. Call one of the tools, or call submit_findings with your final answer.'
const NUDGE_MALFORMED =
  'Your last tool call was malformed. Call a tool again with arguments that are a valid JSON object.'
const SKIPPED_BESIDE_SUBMIT =
  'ERROR (skipped): not run, because submit_findings was called in the same turn. Fix your submission, or call tools on their own first.'

/** Tool results go back as JSON; failures as "ERROR (<kind>): <message>" so the model can correct itself. */
function toolMessage(call: RawToolCall, step: ToolStep): ChatMessage {
  return {
    role: 'tool', tool_call_id: call.id, name: call.name,
    content: step.errorKind ? `ERROR (${step.errorKind}): ${step.error}` : JSON.stringify(step.result),
  }
}

/** Validates a submit_findings call against the agent's output schema, recorded as a ToolStep for the audit log. */
function checkSubmit<Out>(call: RawToolCall, schema: z.ZodType<Out>): ToolStep {
  const started = Date.now()
  const base = { type: 'tool' as const, callId: call.id, name: call.name }
  let args: unknown
  try {
    args = JSON.parse(call.arguments)
  } catch {
    return { ...base, args: call.arguments, errorKind: 'bad_json', error: 'Your submission is not valid JSON. Resend it as a JSON object.', latencyMs: Date.now() - started }
  }
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return { ...base, args, errorKind: 'invalid_args', error: `Your submission does not match the required format:\n${z.prettifyError(parsed.error)}`, latencyMs: Date.now() - started }
  }
  return { ...base, args, result: parsed.data, latencyMs: Date.now() - started }
}
