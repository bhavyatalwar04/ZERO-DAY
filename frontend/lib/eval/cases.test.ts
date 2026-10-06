import { describe, it, expect } from 'vitest'
import { buildCases } from './cases'

// The eval set's fixtures are themselves tested: if the data or Monitor changes
// so that a case no longer shows its intended pattern, this fails first.
const cases = buildCases()

describe('2.7 eval cases', () => {
  it('has 15 cases: 2 per Monitor pattern + 3 harmless', () => {
    expect(cases).toHaveLength(15)
    const count = (k: string | null) => cases.filter(c => c.expected === k).length
    for (const k of ['panic_sell', 'averaging_down', 'revenge_trade', 'news_reflex', 'oversized_position', 'overtrading']) expect(count(k)).toBe(2)
    expect(count(null)).toBe(3)
    expect(new Set(cases.map(c => c.id)).size).toBe(15)
  })

  it.each(cases.map(c => [c.id, c] as const))('%s: Monitor labels the decision as intended', (_, c) => {
    expect(c.event?.kind ?? null).toBe(c.expected)
    if (c.event) expect(c.event.actionSeq).toBe(c.targetSeq)
    expect(c.entries.at(-1)!.seq).toBe(c.targetSeq)
    expect(c.entries.at(-1)!.action.type).toBe('PLACE_ORDER')
  })

  it('records the market truth at each decision (used to catch direction contradictions)', () => {
    for (const c of cases) {
      expect(c.truth.price).toBeGreaterThan(0)
      expect(['down', 'up', 'flat']).toContain(c.truth.direction)
    }
    // COV-20 is a crash day: most decisions happen with the stock down on the day.
    expect(cases.filter(c => c.truth.direction === 'down').length).toBeGreaterThan(7)
  })
})
