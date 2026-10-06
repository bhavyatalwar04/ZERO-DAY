import type { Action } from '@/lib/engine/live-reducer'
import type { ScenarioDataset } from '@/lib/agents/types'
import type { PipelineResponse } from '@/lib/agents/pipeline-request'
import { monitorSession, type DetectedEvent } from '@/lib/monitor/monitor'
import { feedbackTemplate, type Feedback } from '@/lib/monitor/templates'
import type { JournalEntry } from './journal'
import type { ActionSync } from './sync'

// ============================================================================
// Browser side of the decision pipeline (ADR-002/008), as plain functions so it
// is testable without React. live-agents.tsx is the thin React glue.
//
//   new journal entries → Monitor (the same code the server runs) → newest event
//   → wait until that action is synced → POST /api/pipeline → feedback.
// Anything that goes wrong falls back to the deterministic template, locally:
// the user always gets feedback, and the UI says which kind it is.
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

/** Events triggered by entries after `processedSeq`, newest last. Monitor replays the whole journal (a few ms). */
export function newEvents(journal: readonly JournalEntry<Action>[], processedSeq: number, dataset: ScenarioDataset): DetectedEvent[] {
  return monitorSession(journal, dataset).filter(e => e.actionSeq > processedSeq)
}

export type FeedbackSource =
  | { kind: 'server'; path: Exclude<PipelineResponse['path'], 'rejected'> }
  | { kind: 'local'; reason: 'not_signed_in' | 'sync_failed' | 'sync_slow' | 'network' | 'server_error' | 'rejected' | 'not_synced' | 'rate_limited' }

export interface FeedbackResult { feedback: Feedback; source: FeedbackSource }

export interface FeedbackDeps {
  /** null when sync is off (signed out, demo mode, no Supabase): server feedback is impossible */
  sync: Pick<ActionSync, 'sent' | 'status' | 'sessionId'> | null
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** how long to wait for the action to reach the server */
  syncWaitMs?: number
}

export async function requestFeedback(event: DetectedEvent, deps: FeedbackDeps): Promise<FeedbackResult> {
  const local = (reason: Extract<FeedbackSource, { kind: 'local' }>['reason']): FeedbackResult =>
    ({ feedback: feedbackTemplate(event), source: { kind: 'local', reason } })
  const { sync } = deps
  if (!sync) return local('not_signed_in')

  // The server replays the stored log, so the triggering action must be stored first.
  const deadline = deps.now() + (deps.syncWaitMs ?? 8_000)
  while (sync.sent() <= event.actionSeq) {
    if (sync.status() === 'failed') return local('sync_failed')
    if (deps.now() >= deadline) return local('sync_slow')
    await deps.sleep(200)
  }
  const sessionId = sync.sessionId()
  if (!sessionId) return local('sync_failed')

  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response
    try {
      res = await deps.fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The server's own budget is 12 s (ADR-002); never leave the panel stuck on "reviewing".
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ sessionId, actionSeq: event.actionSeq, claimed: { kind: event.kind, simMinute: event.simMinute, symbol: event.symbol } }),
      })
    } catch {
      return local('network')
    }
    if (res.status === 409) { await deps.sleep(500); continue }   // stored rows not visible yet
    if (res.status === 429) return local('rate_limited')            // 8.4: hourly coach limit reached
    if (!res.ok) return local('server_error')
    const body = await res.json() as PipelineResponse
    // 'rejected' = the server's Monitor disagrees with ours: a bug or a tampered client. Say so.
    if (body.path === 'rejected' || !body.feedback) return local('rejected')
    return { feedback: body.feedback, source: { kind: 'server', path: body.path } }
  }
  return local('not_synced')
}

/** What the panel says about where the feedback came from: honest about fallbacks. */
export function describeSource(source: FeedbackSource): string {
  if (source.kind === 'server') {
    return source.path === 'full' ? 'AI coach · with market research'
      : source.path === 'monitor_only' ? 'AI coach · market research unavailable'
      : 'Standard feedback · AI coach unavailable'
  }
  return source.reason === 'not_signed_in' ? 'Standard feedback · sign in for the AI coach'
    : source.reason === 'rate_limited' ? 'Standard feedback · AI coach limit reached for this hour'
    : 'Standard feedback · AI coach unreachable'
}
