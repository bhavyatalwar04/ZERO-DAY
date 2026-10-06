// Technical indicators for agents (2.4, 6.3: the text-first chart path).
//
// Pure functions over plain arrays, no React. Unlike the prep-room UI's versions
// (components/prep/tabs/tab-technicals.tsx), these never invent a value: with too
// little data they return null, so an agent can't quote a fabricated "neutral" RSI.
// Written by Claude at Bhavya's request (2026-10-02).

/** Simple moving average of the last `n` values, or null if there are fewer than n. */
export function sma(values: readonly number[], n: number): number | null {
  if (n <= 0 || values.length < n) return null
  let sum = 0
  for (let i = values.length - n; i < values.length; i++) sum += values[i]
  return sum / n
}

/**
 * RSI with Wilder's smoothing (Wilder 1978), the standard definition:
 *   1. changes d_i = close_i − close_{i−1}; gains = max(d, 0), losses = max(−d, 0)
 *   2. seed: simple averages of the first `period` gains and losses
 *   3. then avg = (prev_avg × (period − 1) + current) / period for each later change
 *   4. RSI = 100 − 100 / (1 + avgGain / avgLoss)
 * Needs period + 1 closes. Returns null with fewer. All-gains → 100; no movement → 50 (genuinely flat, not a fallback).
 */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (period <= 0 || closes.length < period + 1) return null
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d
    else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
  }
  if (avgGain === 0 && avgLoss === 0) return 50
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

export interface OhlcvBar { high: number; low: number; close: number; volume: number }

/** Session VWAP: Σ(typical price × volume) / Σ volume, typical price = (H + L + C) / 3. Null without volume. */
export function vwap(bars: readonly OhlcvBar[]): number | null {
  let pv = 0
  let v = 0
  for (const b of bars) {
    pv += ((b.high + b.low + b.close) / 3) * b.volume
    v += b.volume
  }
  return v > 0 ? pv / v : null
}

/**
 * ADX, Wilder's Average Directional Index (Wilder 1978): trend STRENGTH, 0–100,
 * regardless of direction (> 25 is usually read as a trend).
 *   1. per bar: true range TR, +DM (up-move if it beats the down-move), −DM (vice versa)
 *   2. Wilder-smooth TR, +DM, −DM over `period` (seed = sum of the first `period`,
 *      then S = S − S/period + current)
 *   3. +DI = 100·(+DM)/TR, −DI = 100·(−DM)/TR, DX = 100·|+DI − −DI| / (+DI + −DI)
 *   4. ADX = mean of the first `period` DX values, then Wilder-smoothed.
 * Needs 2·period bars; returns null with fewer (P9: the prep room used to show a random number).
 */
export function adx(bars: readonly { high: number; low: number; close: number }[], period = 14): number | null {
  if (period <= 0 || bars.length < 2 * period) return null
  const tr: number[] = [], plus: number[] = [], minus: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1]
    const up = b.high - p.high, down = p.low - b.low
    plus.push(up > down && up > 0 ? up : 0)
    minus.push(down > up && down > 0 ? down : 0)
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)))
  }
  const seed = (xs: number[]) => xs.slice(0, period).reduce((a, b) => a + b, 0)
  let sTr = seed(tr), sPlus = seed(plus), sMinus = seed(minus)
  const dx: number[] = []
  const push = () => {
    if (sTr === 0) { dx.push(0); return }
    const pdi = (100 * sPlus) / sTr, mdi = (100 * sMinus) / sTr
    dx.push(pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi))
  }
  push()
  for (let i = period; i < tr.length; i++) {
    sTr = sTr - sTr / period + tr[i]
    sPlus = sPlus - sPlus / period + plus[i]
    sMinus = sMinus - sMinus / period + minus[i]
    push()
  }
  if (dx.length < period) return null
  let value = dx.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < dx.length; i++) value = (value * (period - 1) + dx[i]) / period
  return value
}
