'use client'

import { useEffect, useRef } from 'react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import { useTracer } from './tracer'

/**
 * Mounts inside both LiveSessionProvider and TracerProvider. Watches state
 * changes and emits trace events. Pure observer — no dispatch back into
 * the live session.
 */
export function TraceBridge() {
  const { state, totalEquity, scenario } = useLiveSession()
  const { track } = useTracer()

  const sessionStartedRef = useRef(false)
  const lastStatusRef = useRef(state.status)
  const seenOrdersRef = useRef<Set<string>>(new Set())
  const seenFillsRef = useRef<Set<string>>(new Set())
  const seenStopsRef = useRef<Map<string, number | undefined>>(new Map())
  const lastActiveRef = useRef(state.activeSymbol)
  const lastSpeedRef = useRef(state.speed)
  const lastHaltRef = useRef<typeof state.currentHalt>(null)
  const lastNewsCountRef = useRef(state.firedNewsIds.length)
  const lastMinuteRef = useRef(-1)

  // ── Session start ──────────────────────────────────────────
  useEffect(() => {
    if (state.started && !sessionStartedRef.current) {
      sessionStartedRef.current = true
      track('session_start', state.currentMinute, { startingCash: state.cash })
    }
  }, [state.started, state.cash, state.currentMinute, track])

  // ── Status transitions: pause/resume/halt/end ──────────────
  useEffect(() => {
    const prev = lastStatusRef.current
    if (prev === state.status) return
    lastStatusRef.current = state.status

    if (state.status === 'PAUSED') track('pause', state.currentMinute)
    else if (prev === 'PAUSED' && state.status === 'LIVE') track('resume', state.currentMinute)
    else if (state.status === 'CLOSED') {
      const openCount = Object.values(state.positions).filter(p => p.qty > 0).length
      track('session_end', state.currentMinute, {
        finalEquity: totalEquity,
        openPositions: openCount,
        realisedPnL: state.realisedPnL,
      })
    }
  }, [state.status, state.currentMinute, state.positions, state.realisedPnL, totalEquity, track])

  // ── Circuit halts ──────────────────────────────────────────
  useEffect(() => {
    const prev = lastHaltRef.current
    const cur = state.currentHalt
    if (!prev && cur) {
      track('circuit_started', state.currentMinute, { level: cur.level, endsAtMin: cur.endsAtMin })
    } else if (prev && !cur) {
      track('circuit_ended', state.currentMinute)
    }
    lastHaltRef.current = cur
  }, [state.currentHalt, state.currentMinute, track])

  // ── Speed changes ──────────────────────────────────────────
  useEffect(() => {
    if (state.speed !== lastSpeedRef.current) {
      lastSpeedRef.current = state.speed
      track('speed_change', state.currentMinute, { speed: state.speed })
    }
  }, [state.speed, state.currentMinute, track])

  // ── Symbol focus ───────────────────────────────────────────
  useEffect(() => {
    if (state.activeSymbol !== lastActiveRef.current) {
      lastActiveRef.current = state.activeSymbol
      track('symbol_focus', state.currentMinute, { symbol: state.activeSymbol })
    }
  }, [state.activeSymbol, state.currentMinute, track])

  // ── Order placement / fill / rejection ─────────────────────
  useEffect(() => {
    for (const o of state.orders) {
      // First-time placement
      if (!seenOrdersRef.current.has(o.id)) {
        seenOrdersRef.current.add(o.id)
        if (o.status === 'REJECTED') {
          track('order_rejected', o.placedAtMin, {
            orderId: o.id, side: o.side, symbol: o.symbol, qty: o.quantity, reason: o.reason ?? 'unknown',
          })
        } else {
          track('order_placed', o.placedAtMin, {
            orderId: o.id,
            side: o.side,
            symbol: o.symbol,
            qty: o.quantity,
            price: o.price ?? null,
            triggerPrice: o.triggerPrice ?? null,
            orderType: o.type,
            thesis: o.reason ?? '',
            walletAtOrder: state.cash + o.quantity * (o.price ?? 0),
          })
        }
      }
      // First-time fill
      if (o.status === 'FILLED' && !seenFillsRef.current.has(o.id)) {
        seenFillsRef.current.add(o.id)
        track('order_filled', o.filledAtMin ?? o.placedAtMin, {
          orderId: o.id,
          side: o.side,
          symbol: o.symbol,
          qty: o.quantity,
          price: o.filledPrice ?? o.price ?? 0,
          orderType: o.type,
          thesis: o.reason ?? '',
          walletAtOrder: state.cash,
        })
        // If this fill is from a stop-loss/SL-market order, also log the trigger
        if (o.type === 'SL' || o.type === 'SL-M') {
          track('sl_triggered', o.filledAtMin ?? o.placedAtMin, {
            orderId: o.id,
            symbol: o.symbol,
            type: o.type,
            triggerPrice: o.triggerPrice ?? null,
            fillPrice: o.filledPrice ?? o.price ?? 0,
          })
        }
      }
      // Cancellation
      if (o.status === 'CANCELLED' && !seenFillsRef.current.has(`cx_${o.id}`)) {
        seenFillsRef.current.add(`cx_${o.id}`)
        track('order_cancelled', state.currentMinute, { orderId: o.id, symbol: o.symbol })
      }
    }
  }, [state.orders, state.cash, state.currentMinute, track])

  // ── Stop loss set / cleared ────────────────────────────────
  useEffect(() => {
    for (const sym in state.positions) {
      const pos = state.positions[sym]
      const prev = seenStopsRef.current.get(sym)
      const cur = pos.stopPrice
      if (prev !== cur) {
        seenStopsRef.current.set(sym, cur)
        if (cur != null && prev == null) {
          track('sl_set', state.currentMinute, { symbol: sym, stopPrice: cur, qty: pos.qty })
        } else if (cur == null && prev != null) {
          track('sl_cleared', state.currentMinute, { symbol: sym })
        }
      }
    }
  }, [state.positions, state.currentMinute, track])

  // ── News drops (when firedNewsIds grows) ───────────────────
  useEffect(() => {
    const cur = state.firedNewsIds.length
    if (cur > lastNewsCountRef.current) {
      const newIds = state.firedNewsIds.slice(lastNewsCountRef.current)
      for (const id of newIds) {
        const evt = scenario.dataset.news.find(n => n.id === id)
        track('news_dropped', state.currentMinute, {
          newsId: id,
          classification: evt?.classification,
          severity: evt?.severity,
          source: evt?.source,
        })
      }
      lastNewsCountRef.current = cur
    }
  }, [state.firedNewsIds, state.currentMinute, track])

  // ── Minute ticks (every 5 sim minutes — sample, not every tick) ──
  useEffect(() => {
    if (state.currentMinute - lastMinuteRef.current >= 5) {
      lastMinuteRef.current = state.currentMinute
      // No track — minute_tick is too noisy. Could enable for fine-grained replay.
    }
  }, [state.currentMinute])

  return null
}
