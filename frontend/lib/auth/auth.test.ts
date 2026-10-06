import { describe, it, expect } from 'vitest'
import { safeNext, DEFAULT_AFTER_LOGIN } from './redirect'
import { isConnectionFailure, shouldUseDemoFallback } from './demo'
import { decideAccess } from './access'

describe('safeNext (open-redirect guard)', () => {
  it('keeps same-site paths, including query strings', () => {
    expect(safeNext('/sim/COV-20/prep')).toBe('/sim/COV-20/prep')
    expect(safeNext('/ledger?case=3')).toBe('/ledger?case=3')
  })

  it.each([
    ['missing', null],
    ['empty', ''],
    ['user@host trick', '@evil.com'],
    ['protocol-relative', '//evil.com'],
    ['backslash host', '/\\evil.com'],
    ['tab-stripped to //', '/\t/evil.com'],
    ['newline-stripped to //', '/\n/evil.com'],
    ['absolute URL', 'https://evil.com/x'],
    ['javascript URL', 'javascript:alert(1)'],
  ])('falls back on %s', (_label, next) => {
    expect(safeNext(next)).toBe(DEFAULT_AFTER_LOGIN)
  })

  it('uses a caller-chosen fallback', () => {
    expect(safeNext('//evil.com', '/welcome')).toBe('/welcome')
  })
})

describe('demo fallback', () => {
  it('recognises genuine connection failures only', () => {
    expect(isConnectionFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isConnectionFailure({ name: 'AuthRetryableFetchError', message: '' })).toBe(true)
    expect(isConnectionFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isConnectionFailure(new TypeError('Load failed'))).toBe(true)
  })

  it('a plain bug (TypeError) or a wrong password is NOT a connection failure', () => {
    expect(isConnectionFailure(new TypeError("Cannot read properties of undefined (reading 'user')"))).toBe(false)
    expect(isConnectionFailure({ name: 'AuthApiError', message: 'Invalid login credentials' })).toBe(false)
    expect(isConnectionFailure(null)).toBe(false)
  })

  it('never falls back unless demo mode is on', () => {
    const offline = new TypeError('Failed to fetch')
    expect(shouldUseDemoFallback(offline, false)).toBe(false)
    expect(shouldUseDemoFallback(offline, true)).toBe(true)
  })
})

describe('decideAccess (route guard rules)', () => {
  const out = { signedIn: false, enforce: true }
  const inn = { signedIn: true, enforce: true }

  it('lets signed-out users reach public pages', () => {
    for (const p of ['/', '/login', '/signup', '/auth/callback']) expect(decideAccess(p, '', out)).toEqual({ action: 'allow' })
  })

  it('sends signed-out users to login, remembering where they were going', () => {
    expect(decideAccess('/sim/COV-20/live', '?speed=5', out))
      .toEqual({ action: 'redirect', to: '/login?next=%2Fsim%2FCOV-20%2Flive%3Fspeed%3D5' })
  })

  it('lets signed-in users through, and away from the login form', () => {
    expect(decideAccess('/ledger', '', inn)).toEqual({ action: 'allow' })
    expect(decideAccess('/login', '', inn)).toEqual({ action: 'redirect', to: DEFAULT_AFTER_LOGIN })
  })

  it('enforces nothing when switched off (no Supabase, or demo mode)', () => {
    expect(decideAccess('/sim/COV-20/live', '', { signedIn: false, enforce: false })).toEqual({ action: 'allow' })
  })

  it('"/authx" is not mistaken for the public "/auth/" prefix', () => {
    expect(decideAccess('/authx', '', out).action).toBe('redirect')
  })
})
