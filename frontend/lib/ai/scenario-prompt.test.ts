import { describe, it, expect } from 'vitest'
import { SCENARIOS } from '@/lib/engine/scenarios'
import { resolveScenario, scenarioContext, marketTime, buildDebriefSystemPrompt } from './scenario-prompt'

describe('resolveScenario', () => {
  it('returns the requested scenario', () => {
    expect(resolveScenario('GME-21')).toBe(SCENARIOS['GME-21'])
  })

  it('falls back to COV-20 for missing or unknown ids', () => {
    expect(resolveScenario(undefined)).toBe(SCENARIOS['COV-20'])
    expect(resolveScenario('NOPE-99')).toBe(SCENARIOS['COV-20'])
    expect(resolveScenario(42)).toBe(SCENARIOS['COV-20'])
  })
})

describe('marketTime', () => {
  it('uses the scenario market open and time zone', () => {
    expect(marketTime(0, SCENARIOS['COV-20'].market)).toBe('09:15 IST')
    expect(marketTime(30, SCENARIOS['GME-21'].market)).toBe('10:00 ET')
  })
})

describe('scenarioContext', () => {
  it('names the scenario and its briefing', () => {
    const ctx = scenarioContext(SCENARIOS['GME-21'])
    expect(ctx).toContain('27 January 2021')
    expect(ctx).toContain('GameStop')
  })
})

describe('buildDebriefSystemPrompt', () => {
  it('describes a US scenario in dollars and ET, with no COV-20 leftovers', () => {
    const prompt = buildDebriefSystemPrompt(SCENARIOS['GME-21'])
    expect(prompt).toContain('GameStop short squeeze')
    expect(prompt).toContain('$X')
    expect(prompt).toContain('HH:MM ET')
    expect(prompt).toContain('SPX')
    for (const leftover of ['₹', 'NIFTY', 'BRENT', 'IST', 'March 9, 2020', 'Indian', 'rupee']) {
      expect(prompt).not.toContain(leftover)
    }
  })

  it('keeps the Indian-market framing for COV-20', () => {
    const prompt = buildDebriefSystemPrompt(SCENARIOS['COV-20'])
    expect(prompt).toContain('9 March 2020')
    expect(prompt).toContain('₹X')
    expect(prompt).toContain('HH:MM IST')
    expect(prompt).toContain('Indian-English idioms')
  })
})
