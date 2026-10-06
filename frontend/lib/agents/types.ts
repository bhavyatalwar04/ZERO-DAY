import 'server-only'
import type { z } from 'zod'
import type {
  LiveSessionState, StockTimeline, NewsEvent, CircuitBreakerEvent,
} from '@/types/live'
import type { MarketSpec } from '@/lib/engine/markets'

// ============================================================================
// AGENT RUNTIME — contracts (roadmap 1.2, ADR-001)
// ============================================================================
// Three rules these types encode:
//   1. Failures are data. An agent run always returns an AgentRun with a
//      status; it never throws to the orchestrator.
//   2. Model output is untrusted input. Tool arguments are validated with the
//      tool's Zod schema before anything runs.
//   3. One run shape for all agents, deterministic or LLM, so the orchestrator
//      and the audit log treat Monitor, Research and Coach uniformly.
// ============================================================================

// ─── Context the tools read from ────────────────────────────

/**
 * Session state at the moment of a decision event.
 * `source` records how much to trust it (proposal P1):
 *   - 'client_snapshot': sent by the browser as-is. Untrusted; M1 only.
 *   - 'server_replay':   rebuilt on the server by replaying the action log
 *                        through the engine's reducer. Trusted.
 */
export interface SessionSnapshot {
  source: 'client_snapshot' | 'server_replay'
  scenarioId: string
  simMinute: number
  state: LiveSessionState
}

/** Read-only scenario data. Agents get numbers from here, never from chart images (M6). */
export interface ScenarioDataset {
  scenarioId: string
  timeline: Record<string, StockTimeline>
  news: NewsEvent[]
  circuits: CircuitBreakerEvent[]
  /** Market indices (NIFTY, VIX, …), one point per 5-minute bar; pctChange is a fraction vs the previous close. */
  indices?: Record<string, { minute: number; value: number; pctChange: number }[]>
  /** Trading hours and currency (M4). Absent = NSE, as for COV-20. */
  market?: MarketSpec
}

export interface ToolContext {
  session: SessionSnapshot
  scenario: ScenarioDataset
  /** Aborted when the whole agent run times out. Tools that do I/O should honour it. */
  signal: AbortSignal
}

// ─── Tools ──────────────────────────────────────────────────

/**
 * A tool the model may call. The Zod `input` schema is the single source of
 * truth: it becomes the JSON Schema sent to Groq AND validates the arguments
 * the model sends back.
 *
 * Keep outputs small. Every tool result is re-sent to the model on each later
 * loop step, so return a summary ("RSI(14)=28.4, falling"), not raw bars.
 */
export interface ToolDef<I = unknown, O = unknown> {
  /** snake_case, stable: it appears in audit logs and eval results */
  name: string
  /** The model reads this to decide when to call the tool. Write it for the model. */
  description: string
  input: z.ZodType<I>
  output: z.ZodType<O>
  run(input: I, ctx: ToolContext): Promise<O>
}

// Tools with different I/O types have to live in one list; `any` is confined here.
export type AnyToolDef = ToolDef<any, any>

export type ToolRegistry = ReadonlyMap<string, AnyToolDef>

/** Reserved tool name: calling it ends a ReAct loop. Its arguments are the agent's output. */
export const SUBMIT_TOOL_NAME = 'submit_findings'

/**
 * A tool call exactly as Groq returns it (OpenAI format).
 * NOTE: `arguments` is a JSON *string*, not an object, and the model can
 * produce invalid JSON.
 */
export interface RawToolCall {
  id: string
  name: string
  arguments: string
}

// ─── Agents ─────────────────────────────────────────────────

/** Runtime list (the database CHECK constraints are tested against it). */
export const AGENT_NAMES = ['monitor', 'research', 'coach'] as const
export type AgentName = (typeof AGENT_NAMES)[number]

export interface AgentLimits {
  /** react: max model calls before giving up. single_shot: 1. deterministic: ignored. */
  maxSteps: number
  /** max completion tokens per model call */
  maxTokens: number
  /** wall-clock budget for the whole run, tools included */
  timeoutMs: number
  /** per-tool-call timeout */
  toolTimeoutMs: number
  /**
   * react only, optional: total tokens (prompt + completion) for the whole run.
   * Prompt tokens grow every step because the whole conversation is re-sent.
   * Once exceeded, the next call is forced to submit; if that fails → 'budget_exceeded'.
   */
  maxRunTokens?: number
}

export interface AgentSpec<In, Out> {
  name: AgentName
  kind: 'deterministic' | 'single_shot' | 'react'
  /** Groq model id; unused by deterministic agents. Chosen per agent by the eval set (2.7). */
  model?: string
  /** System prompt for LLM agents. */
  systemPrompt?: string
  /** Turns the agent's input into the first user message. */
  buildUserMessage?: (input: In) => string
  /** react only; empty for the others */
  tools: AnyToolDef[]
  /** The agent's final answer. For react agents this becomes the submit tool's arguments. */
  output: z.ZodType<Out>
  limits: AgentLimits
  /**
   * Optional (react and single-shot): a check beyond the schema, run on a schema-valid answer.
   * Return null to accept, or a message telling the model what to fix (one repair, like a
   * schema failure). Research uses it to reject numbers no tool returned (M6.1).
   */
  check?: (output: Out, steps: readonly AgentStep[], input: In) => string | null
  /**
   * Reasoning models only (gpt-oss): how hard to think. Hidden reasoning counts against
   * maxTokens, so 'low' keeps a short structured answer from being starved (2.7 eval, 2026-10-03).
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

// ─── Runs and steps (the audit trail, 3.6) ──────────────────

/** Runtime list (the database CHECK constraints are tested against it). */
export const RUN_STATUSES = [
  'ok',
  'step_limit',       // react loop hit maxSteps without submitting
  'budget_exceeded',  // react loop hit limits.maxRunTokens without a valid submit
  'invalid_output',   // final answer failed the output schema (after the repair retry)
  'timeout',          // whole run exceeded limits.timeoutMs
  'error',            // anything else, e.g. upstream API failure
  'fallback',         // orchestrator substituted a non-LLM result
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Why a single tool call failed. Counted per model in evals (e.g. how often the 8B model sends bad args). */
export type ToolErrorKind =
  | 'unknown_tool'    // model called a name that isn't registered
  | 'bad_json'        // `arguments` wasn't valid JSON
  | 'invalid_args'    // valid JSON, failed the input schema
  | 'timeout'         // tool exceeded toolTimeoutMs
  | 'tool_threw'      // our tool code threw
  | 'invalid_output'  // our tool returned something that fails its output schema (our bug)
  | 'failed_check'    // submission matched the schema but failed the agent's own check (e.g. ungrounded numbers)

export interface ModelStep {
  type: 'model'
  /** any text the model produced alongside (or instead of) tool calls */
  text?: string
  toolCalls: RawToolCall[]
  promptTokens: number
  completionTokens: number
  latencyMs: number
}

export interface ToolStep {
  type: 'tool'
  callId: string
  name: string
  /** parsed arguments if the JSON parsed, otherwise the raw string */
  args: unknown
  /** present on success */
  result?: unknown
  /** present on failure: sent back to the model so it can correct itself */
  error?: string
  errorKind?: ToolErrorKind
  latencyMs: number
}

export type AgentStep = ModelStep | ToolStep

export interface AgentRun<Out> {
  runId: string
  agent: AgentName
  /** Groq model id the run used (absent for deterministic agents): the audit log must say which model produced what */
  model?: string
  status: RunStatus
  output: Out | null
  /** Why the run failed ('error' / 'timeout'). Without it the audit log can't explain a failure. */
  error?: string
  steps: AgentStep[]
  usage: { promptTokens: number; completionTokens: number; latencyMs: number }
}
