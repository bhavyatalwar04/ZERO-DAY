import { describe, it, expect } from 'vitest'
import { scoreFeedback, PATTERN_WORDS, CONTRADICTS, ACTION, type ScoreInput } from './rubric'
import { feedbackTemplate } from '@/lib/monitor/templates'
import { buildCases } from './cases'

const truth = (direction: 'down' | 'up' | 'flat') =>
  ({ symbol: 'INDIGO', price: 1149.49, prevClose: 1247.5, dayChangePct: -7.86, move15Pct: -1.04, direction, niftyDayChangePct: -6.23 })
const input = (over: Partial<ScoreInput> = {}): ScoreInput =>
  ({ expected: 'news_reflex', truth: truth('down'), sources: 'Bought INDIGO at 1149.49, 0 minutes after the headline', ...over })

describe('rubric', () => {
  it('catches the 2026-10-02 production answer: right pattern, wrong market direction', () => {
    // Verbatim from pipeline_runs (path monitor_only), INDIGO −7.86% on the day.
    const prod = {
      message: 'You reacted instantly to the headline by buying INDIGO. This news reflex can lead to buying at a peak. Try pausing a few minutes or writing down your reason before acting.',
      question: 'What would you write down as your reason for buying before placing the order?',
    }
    const s = scoreFeedback(prod, input())
    expect(s.checks).toMatchObject({ valid: true, grounded: true, noStopLoss: true, namesPattern: true, actionable: true, hasQuestion: true })
    expect(s.checks.directionConsistent).toBe(false)
    expect(s.passed).toBe(6)
  })

  it('flags invented numbers and stop-loss advice', () => {
    const s = scoreFeedback({ message: 'You bought on the headline. Set a stop-loss 3% below 1100 next time, then wait.', question: 'Why now?' }, input())
    expect(s.checks.grounded).toBe(false)
    expect(s.ungrounded).toEqual(expect.arrayContaining(['3', '1100']))
    expect(s.checks.noStopLoss).toBe(false)
  })

  it('no feedback fails everything', () => {
    expect(scoreFeedback(null, input()).passed).toBe(0)
  })

  it('direction lexicon: catches contradictions, allows neutral uses', () => {
    expect(CONTRADICTS.down!.test('you may be buying near the top')).toBe(true)
    expect(CONTRADICTS.down!.test('the stock is rising')).toBe(true)
    expect(CONTRADICTS.down!.test('your risk could rise if you add more')).toBe(false)
    expect(CONTRADICTS.up!.test('selling near the bottom')).toBe(true)
    expect(CONTRADICTS.flat).toBeNull()
  })

  it('the deterministic templates pass every check on every eval case (the rubric is satisfiable)', () => {
    for (const c of buildCases()) {
      if (!c.event) continue
      const fb = feedbackTemplate(c.event)
      const s = scoreFeedback(fb, { expected: c.expected!, truth: c.truth, sources: c.event.summary })
      expect({ id: c.id, ...s.checks }).toEqual({ id: c.id, valid: true, grounded: true, noStopLoss: true, namesPattern: true, directionConsistent: true, actionable: true, hasQuestion: true })
    }
  })

  it('lexicons recognise ordinary phrasings', () => {
    expect(PATTERN_WORDS.averaging_down.test('You are adding to a losing position')).toBe(true)
    expect(PATTERN_WORDS.revenge_trade.test('This looks like an attempt to win it back')).toBe(true)
    expect(PATTERN_WORDS.overtrading.test('That is five orders in a few minutes')).toBe(true)
    expect(PATTERN_WORDS.oversized_position.test('that is 44% of your account in one trade')).toBe(true)
    expect(ACTION.test('Next time, wait a few minutes')).toBe(true)
  })
})
