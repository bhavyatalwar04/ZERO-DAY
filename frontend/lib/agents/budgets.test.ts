import { describe, it, expect } from 'vitest'
import { RESEARCH_LIMITS, COACH_LIMITS, PIPELINE_BUDGET, RETRY_POLICY } from './budgets'
import { backoffDelay } from './retry'

// The budgets must fit together; if someone changes one number, these catch the knock-on effects.
describe('budgets are consistent', () => {
  it("research's own timeout fits inside its share of the pipeline", () => {
    expect(RESEARCH_LIMITS.timeoutMs).toBeLessThanOrEqual(PIPELINE_BUDGET.deadlineMs - PIPELINE_BUDGET.coachReserveMs)
  })

  it("coach's timeout fits inside the reserve kept for it", () => {
    expect(COACH_LIMITS.timeoutMs).toBeLessThanOrEqual(PIPELINE_BUDGET.coachReserveMs)
  })

  it('worst-case retry backoff leaves coach time for at least one real call', () => {
    const worstBackoff = Array.from({ length: RETRY_POLICY.maxRetries }, (_, n) => backoffDelay(n, RETRY_POLICY, () => 1))
      .reduce((a, b) => a + b, 0)
    expect(COACH_LIMITS.timeoutMs - worstBackoff).toBeGreaterThanOrEqual(1_000)
  })

  it('research has a total-token cap and room for a repair step', () => {
    expect(RESEARCH_LIMITS.maxRunTokens).toBeDefined()
    expect(RESEARCH_LIMITS.maxSteps).toBeGreaterThanOrEqual(4)
  })
})
