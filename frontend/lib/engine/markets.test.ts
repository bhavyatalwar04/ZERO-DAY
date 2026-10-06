import { describe, it, expect } from 'vitest'
import { NSE, NYSE, formatMoney, signedMoney } from './markets'

describe('formatMoney', () => {
  it('uses the market currency and grouping', () => {
    expect(formatMoney(100000, NSE)).toBe('₹1,00,000')
    expect(formatMoney(100000, NYSE)).toBe('$100,000')
  })
})

describe('signedMoney', () => {
  it('prefixes gains with + in the market currency', () => {
    expect(signedMoney(1234.4, NYSE)).toBe('+$1,234')
    expect(signedMoney(0, NYSE)).toBe('+$0')
  })

  it('puts the minus sign before the currency symbol', () => {
    expect(signedMoney(-1500, NSE)).toBe('−₹1,500')
  })
})
