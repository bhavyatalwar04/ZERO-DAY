import 'server-only'
import type { PipelineRun } from '@/lib/agents/pipeline'

// ============================================================================
// Audit writes (roadmap 3.6 · ADR-003): one PipelineRun → one call to the
// record_pipeline_run() database function, which inserts the decision event,
// pipeline run and agent runs in ONE transaction.
// Written by Claude at Bhavya's request (2026-09-24).
// ============================================================================

export interface AuditInput<Findings, Feedback> {
  sessionId: string
  /** seq of the logged action that triggered the event; null only for 'rejected' */
  actionSeq: number | null
  /** what the user saw at the decision (cash, positions, pending orders, minute) */
  stateBefore: unknown
  run: PipelineRun<Findings, Feedback>
}

/** The JSON shape record_pipeline_run(p jsonb) reads: snake_case, like the table columns. */
export interface AuditPayload {
  id: string
  session_id: string
  path: string
  action_seq: number | null
  state_before: unknown
  event: { kind: string; sim_minute: number; symbol: string | null; facts: Record<string, unknown>; summary: string } | null
  feedback: unknown
  notes: string[]
  timings: Record<string, number>
  agent_runs: {
    id: string; agent: string; model: string | null; status: string; error: string | null
    steps: unknown; prompt_tokens: number; completion_tokens: number; latency_ms: number
  }[]
}

/** Pure mapping, TypeScript camelCase → database snake_case. Throws on an inconsistent run. */
export function toAuditPayload<F, FB>({ sessionId, actionSeq, stateBefore, run }: AuditInput<F, FB>): AuditPayload {
  const rejected = run.path === 'rejected'
  if (!rejected && (run.event === null || actionSeq === null)) {
    throw new Error(`Pipeline ${run.pipelineId} took path '${run.path}' but has no event or triggering action`)
  }
  return {
    id: run.pipelineId,
    session_id: sessionId,
    path: run.path,
    action_seq: rejected ? null : actionSeq,
    state_before: rejected ? null : stateBefore,
    event: rejected || run.event === null ? null : {
      kind: run.event.kind,
      sim_minute: run.event.simMinute,
      symbol: run.event.symbol ?? null,
      facts: run.event.facts,
      summary: run.event.summary,
    },
    feedback: rejected ? null : run.feedback,
    notes: run.notes,
    timings: run.timings,
    agent_runs: [run.research, run.coach].flatMap(r => (r === null ? [] : [{
      id: r.runId,
      agent: r.agent,
      model: r.model ?? null,
      status: r.status,
      error: r.error ?? null,
      steps: r.steps,
      prompt_tokens: r.usage.promptTokens,
      completion_tokens: r.usage.completionTokens,
      latency_ms: r.usage.latencyMs,
    }])),
  }
}

/** The one method we need from a Supabase client, so tests can pass a fake. */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * Never throws: a failed audit write must not stop the user's feedback.
 * The caller logs the error; it is not retried here (see LEARNINGS 3.6).
 */
export async function recordPipelineRun<F, FB>(
  client: RpcClient,
  input: AuditInput<F, FB>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await client.rpc('record_pipeline_run', { p: toAuditPayload(input) })
    if (error) return { ok: false, error: error.message }
    return { ok: true, id: String(data) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
