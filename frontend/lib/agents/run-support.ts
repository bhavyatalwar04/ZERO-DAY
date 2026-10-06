import 'server-only'
import { ModelCallError } from './model'
import type { AgentStep } from './types'

// Shared by the runners (react-loop, single-shot): one run-wide deadline,
// usage totals, and error text for AgentRun.error.

export const TIMED_OUT = Symbol('timed out')

export interface RunDeadline {
  /** aborted when the deadline passes: pass to model calls and tools */
  signal: AbortSignal
  /** resolves with TIMED_OUT at the deadline: race every await against it */
  timedOut: Promise<typeof TIMED_OUT>
  /** always call when the run ends */
  clear(): void
}

export function startDeadline(ms: number): RunDeadline {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(TIMED_OUT) }, ms)
  })
  return { signal: controller.signal, timedOut, clear: () => clearTimeout(timer) }
}

export function sumUsage(steps: AgentStep[]): { promptTokens: number; completionTokens: number } {
  let promptTokens = 0
  let completionTokens = 0
  for (const s of steps) {
    if (s.type === 'model') { promptTokens += s.promptTokens; completionTokens += s.completionTokens }
  }
  return { promptTokens, completionTokens }
}

export function describeError(err: unknown): string {
  if (err instanceof ModelCallError) return `${err.kind}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}
