import { describe, it, expect } from 'vitest'
import { scriptedModel } from '../model'
import { zodToStrictSchema } from '../groq-tools'
import { EVENT_PRIORITY } from '@/lib/monitor/thresholds'
import { play } from '@/lib/session/test-sessions'
import { monitorSession } from '@/lib/monitor/monitor'
import { COV20_DATASET } from '@/lib/engine/cov20-dataset'
import type { DecisionEvent } from '../pipeline'
import { CoachFeedback, checkCoach, coachSpec, coachTemplate, describeCoachInput, runCoach, type CoachRunInput } from './coach'

const event: DecisionEvent = {
  kind: 'revenge_trade', simMinute: 28, symbol: 'TCS',
  facts: { buyNotional: 29095, previousLoss: 39.48, previousSymbol: 'RELIANCE', minutesAfterLoss: 2, sizeMultiple: 1.94 },
  summary: 'Bought 14 TCS worth 29095, 1.94× the size of the RELIANCE sale that lost 39.48 2 minutes earlier.',
}
const findings = {
  summary: 'TCS was at 2078.18, down 3.63% vs the previous close; NIFTY was down 5.13%.',
  evidence: [{ fact: 'TCS 2078.18, -3.63% vs previous close', tool: 'get_price_window' }],
}
const input = (f: typeof findings | null = findings): CoachRunInput => ({ event, findings: f, scenarioLabel: 'Covid Day Zero' })
const fb = (message: string, question = 'What was your plan before this trade?'): CoachFeedback => ({ message, severity: 'warning', question })

describe('Coach input', () => {
  it('carries the event, its facts, the time and the research findings', () => {
    const msg = describeCoachInput(input())
    expect(msg).toMatch(/Time: 09:43/)
    expect(msg).toMatch(/Pattern detected: revenge_trade \(TCS\)/)
    expect(msg).toMatch(/sizeMultiple: 1.94/)
    expect(msg).toMatch(/TCS was at 2078.18/)
  })
  it('says plainly when research is unavailable (the monitor_only path)', () => {
    expect(describeCoachInput(input(null))).toMatch(/Market context: unavailable/)
  })
})

describe('checkCoach (content rules, enforced)', () => {
  it('accepts feedback that uses only the numbers it was given', () => {
    expect(checkCoach(fb('You bought 1.94× the size of a trade that lost 39.48, two minutes later, while NIFTY was down 5.13%. Wait a few minutes after a loss.'), [], input())).toBeNull()
  })
  it('rejects a number it was not given (a market fact the inputs lack)', () => {
    expect(checkCoach(fb('TCS later recovered to 2150, so you were lucky this time. Wait after a loss.'), [], input())).toMatch(/not in the facts you were given: 2150/)
  })
  it('without research, numbers that only research had are rejected', () => {
    expect(checkCoach(fb('You bought while TCS was down 3.63% on the day. Pause after a loss.'), [], input(null))).toMatch(/3\.63/)
  })
  it.each(['Set a stop-loss next time.', 'Use a stop loss order.', 'Place an SL below your entry.', 'Consider a trailing stop.', 'Put a stop order in.'])(
    'rejects stop-loss advice: "%s"', advice => {
      expect(checkCoach(fb(`You doubled up right after a loss. ${advice}`), [], input())).toMatch(/Do not mention stop-losses/)
    })
  it('does not flag ordinary words that contain "stop" or "sl"', () => {
    expect(checkCoach(fb('Stop and breathe before the next order; go slowly after a loss.'), [], input())).toBeNull()
  })
})

describe('coachTemplate (the deterministic fallback)', () => {
  it.each(EVENT_PRIORITY.map(k => [k]))('%s: passes the same content rules it backs up', kind => {
    const e = { ...event, kind }
    const t = coachTemplate(e)
    expect(CoachFeedback.safeParse(t).success).toBe(true)
    expect(checkCoach(t, [], { event: e, findings: null, scenarioLabel: 'Covid Day Zero' })).toBeNull()
  })

  it('passes the rules for every event real random sessions produce', () => {
    let n = 0
    for (let seed = 1; seed <= 40; seed++) for (const e of monitorSession(play(seed).entries, COV20_DATASET)) {
      expect(checkCoach(coachTemplate(e), [], { event: e, findings: null, scenarioLabel: 'x' }), `${e.kind}: ${e.summary}`).toBeNull()
      n++
    }
    expect(n).toBeGreaterThan(10)
  })
})

describe('Coach agent (scripted model)', () => {
  it('the output schema is expressible in strict mode', () => {
    expect(() => zodToStrictSchema(CoachFeedback)).not.toThrow()
  })

  it('a stop-loss suggestion is rejected and repaired', async () => {
    const good = fb('You bought 1.94× the size of a losing trade two minutes after it. Wait a few minutes after a loss before your next order.')
    const model = scriptedModel([{ text: JSON.stringify(fb('You revenge traded. Always use a stop-loss.')) }, { text: JSON.stringify(good) }])
    const run = await runCoach(input(), { model })
    expect(run).toMatchObject({ status: 'ok', output: good, model: 'openai/gpt-oss-20b' })
    expect(model.requests).toHaveLength(2)
  })

  it('spec: single-shot, strict, check attached', () => {
    const s = coachSpec()
    expect(s).toMatchObject({ name: 'coach', kind: 'single_shot', tools: [] })
    expect(s.check).toBeDefined()
  })
})
