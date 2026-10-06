import { describe, it, expect } from 'vitest'
import { BIAS_TAXONOMY, coachHistory, describeHistory } from './history'
import { checkCoach, describeCoachInput, type CoachRunInput } from './coach'
import { EVENT_PRIORITY } from '@/lib/monitor/thresholds'
import type { DetectedEvent } from '@/lib/monitor/monitor'

const ev = (kind: string, actionSeq: number): DetectedEvent =>
  ({ kind, actionSeq, simMinute: actionSeq * 10, symbol: 'TCS', facts: {}, summary: 'x' } as DetectedEvent)
const scorecardWith = (events: Record<string, number>) => ({ result: { version: 1, financial: {}, behaviour: { events } } })

describe('2.6 coach history', () => {
  it('counts earlier events of the same kind in this session, and across scored past sessions', () => {
    const session = [ev('averaging_down', 3), ev('panic_sell', 5), ev('averaging_down', 8), ev('averaging_down', 12)]
    const past = [scorecardWith({ averaging_down: 2 }), scorecardWith({ averaging_down: 1, panic_sell: 4 }), { result: null }]
    expect(coachHistory('averaging_down', 12, session, past)).toEqual({ earlierThisSession: 2, pastSessions: 2, inPastSessions: 3 })
    expect(coachHistory('panic_sell', 5, session, [])).toEqual({ earlierThisSession: 0, pastSessions: 0, inPastSessions: 0 })
  })

  it('every Monitor pattern has a bias name and a reference', () => {
    for (const k of EVENT_PRIORITY) expect(BIAS_TAXONOMY[k].note).toMatch(/\(\w.*\d{4}\)/)
  })

  it('the Coach input carries the history, so quoting it passes the grounding check', () => {
    const input: CoachRunInput = {
      event: { kind: 'averaging_down', simMinute: 60, symbol: 'TCS', facts: { lossPct: 3.1 }, summary: 'Bought more TCS while 3.1% underwater.' },
      findings: null, scenarioLabel: 'Test', history: { earlierThisSession: 2, pastSessions: 4, inPastSessions: 7 },
    }
    const text = describeCoachInput(input)
    expect(text).toContain('already flagged 2 times before this decision')
    expect(text).toContain('Past sessions: 4 completed; this pattern was flagged 7 times')
    expect(text).toContain('the disposition effect')
    const fb = { message: 'This is the third time today you averaged down: 2 earlier flags, and 7 across your past 4 sessions. Write down a reason first.', severity: 'caution' as const, question: 'What changed?' }
    expect(checkCoach(fb, [], input)).toBeNull()
  })

  it('no history: only the background line; first time is said as such', () => {
    expect(describeHistory('overtrading', undefined)).toHaveLength(1)
    expect(describeHistory('overtrading', { earlierThisSession: 0, pastSessions: 0, inPastSessions: 0 })).toContain('This session: the first time this pattern has been flagged.')
  })
})
