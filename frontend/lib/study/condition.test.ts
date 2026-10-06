import { describe, it, expect } from 'vitest'
import { fnv1a, studyCondition } from './condition'

describe('study condition (5.4)', () => {
  it('FNV-1a matches the reference values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
    expect(fnv1a('foobar')).toBe(0xbf9cf968)
  })

  it('everyone is coached unless study mode is on', () => {
    expect(studyCondition('any-user', false)).toBe('coached')
  })

  it('study mode: stable per user and close to a 50/50 split', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(studyCondition(ids[7], true)).toBe(studyCondition(ids[7], true))
    const control = ids.filter(id => studyCondition(id, true) === 'control').length
    expect(control).toBeGreaterThan(900)
    expect(control).toBeLessThan(1100)
  })
})
