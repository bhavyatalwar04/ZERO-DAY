import { describe, it, expect } from 'vitest'
import { SCENARIOS } from '@/lib/engine/scenarios'
import {
  usesHandBuiltIntro, introSlideCopy, sessionSlideCopy, clockSlideCopy, indicesSlideCopy,
  walletSlideBody, practiceSlideBody, marketReadPrompt, signalNoiseQuestion,
} from './scenario-copy'

const GME = SCENARIOS['GME-21']
const TAX = SCENARIOS['TAX-19']

/** Every string a copy function produced, flattened, for leftover checks. */
const allText = (...parts: unknown[]): string => JSON.stringify(parts)

describe('usesHandBuiltIntro', () => {
  it('is true only for COV-20, whose walkthrough was written by hand', () => {
    expect(usesHandBuiltIntro(SCENARIOS['COV-20'])).toBe(true)
    expect(usesHandBuiltIntro(GME)).toBe(false)
    expect(usesHandBuiltIntro(TAX)).toBe(false)
  })
})

describe('walkthrough copy for a US scenario (GME-21)', () => {
  const text = allText(
    introSlideCopy(GME), sessionSlideCopy(GME), clockSlideCopy(GME), indicesSlideCopy(GME),
    walletSlideBody(GME), practiceSlideBody(GME), marketReadPrompt(GME), signalNoiseQuestion(GME),
  )

  it('uses the scenario day, money, hours and tickers', () => {
    expect(introSlideCopy(GME).title).toBe('27 January 2021 — The GameStop Squeeze')
    expect(text).toContain('$100,000')
    expect(sessionSlideCopy(GME).body).toContain('09:30 ET')
    expect(sessionSlideCopy(GME).body).toContain('16:00 ET')
    expect(sessionSlideCopy(GME).body).toContain('390 minutes')
    expect(text).toContain('NYSE')
    expect(text).toContain('SPX')
    expect(signalNoiseQuestion(GME)).toContain('GME')
  })

  it('has no COV-20 leftovers', () => {
    for (const leftover of ['₹', 'NIFTY', 'BRENT', 'IST', 'March 9, 2020', 'RELIANCE', 'COV-20', 'circuit breaker']) {
      expect(text).not.toContain(leftover)
    }
  })

  it('marks exactly one coaching answer as correct', () => {
    expect(marketReadPrompt(GME).options.filter(o => o.correct)).toHaveLength(1)
  })
})

describe('walkthrough copy for another Indian scenario (TAX-19)', () => {
  it('keeps rupees and IST but drops the Covid story', () => {
    const text = allText(introSlideCopy(TAX), sessionSlideCopy(TAX), clockSlideCopy(TAX))
    expect(text).toContain('₹1,00,000')
    expect(sessionSlideCopy(TAX).body).toContain('09:15 IST')
    expect(clockSlideCopy(TAX).body).toContain(TAX.dateLabel)
    expect(text).not.toContain('Covid')
    expect(text).not.toContain('March 9, 2020')
  })
})
