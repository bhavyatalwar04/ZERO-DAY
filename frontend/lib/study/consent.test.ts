import { describe, it, expect } from 'vitest'
import { CONSENT_VERSION, consentOf, consentRecord, effectiveCondition, isParticipant, needsConsentPrompt } from './consent'
import { studyCondition } from './condition'

const meta = (status: string, version = CONSENT_VERSION) => ({ study_consent: { status, version, at: '2026-11-04T10:00:00.000Z' } })
// Two ids that hash to different arms, found rather than assumed.
const ids = Array.from({ length: 50 }, (_, i) => `user-${i}`)
const controlId = ids.find(id => studyCondition(id, true) === 'control')!
const coachedId = ids.find(id => studyCondition(id, true) === 'coached')!

describe('study consent (5.4 ethics)', () => {
  it('reads a well-formed record and treats anything else as "not asked"', () => {
    expect(consentOf(meta('given'))).toEqual({ status: 'given', version: CONSENT_VERSION, at: '2026-11-04T10:00:00.000Z' })
    for (const bad of [null, undefined, {}, { study_consent: 'yes' }, { study_consent: { status: 'maybe', version: 'x', at: 'y' } },
      { study_consent: { status: 'given', version: 3, at: 'y' } }]) {
      expect(consentOf(bad)).toBeNull()
    }
  })

  it('only "given" on the current version makes a participant', () => {
    expect(isParticipant(consentOf(meta('given')))).toBe(true)
    expect(isParticipant(consentOf(meta('declined')))).toBe(false)
    expect(isParticipant(consentOf(meta('withdrawn')))).toBe(false)
    expect(isParticipant(consentOf(meta('given', '2020-01')))).toBe(false)
    expect(isParticipant(null)).toBe(false)
  })

  it('asks only in study mode, and again when the information sheet changes', () => {
    expect(needsConsentPrompt(null, false)).toBe(false)
    expect(needsConsentPrompt(null, true)).toBe(true)
    expect(needsConsentPrompt(consentOf(meta('declined')), true)).toBe(false)
    expect(needsConsentPrompt(consentOf(meta('given', '2020-01')), true)).toBe(true)
  })

  it('non-participants are always coached, even if their id hashes to control', () => {
    expect(effectiveCondition({ id: controlId, user_metadata: meta('declined') }, true)).toBe('coached')
    expect(effectiveCondition({ id: controlId, user_metadata: meta('withdrawn') }, true)).toBe('coached')
    expect(effectiveCondition({ id: controlId, user_metadata: {} }, true)).toBe('coached')
    expect(effectiveCondition({ id: controlId, user_metadata: meta('given') }, false)).toBe('coached')
  })

  it('participants get their hashed arm', () => {
    expect(effectiveCondition({ id: controlId, user_metadata: meta('given') }, true)).toBe('control')
    expect(effectiveCondition({ id: coachedId, user_metadata: meta('given') }, true)).toBe('coached')
  })

  it('consentRecord stamps the current version and time', () => {
    expect(consentRecord('given', new Date('2026-11-04T10:00:00Z'))).toEqual({ status: 'given', version: CONSENT_VERSION, at: '2026-11-04T10:00:00.000Z' })
  })
})
