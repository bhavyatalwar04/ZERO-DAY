// The live-trading engine (Bhavya's FSM): initial state, actions, reducer.
// Moved verbatim out of lib/contexts/live-session-context.tsx (2026-10-02,
// by Claude at Bhavya's request) so it has no 'use client' boundary: the
// server must be able to replay sessions through it (P1, ADR-005) and Monitor
// (2.1) runs on both sides. Must stay pure: same state + action → same result.
// Multi-scenario (M4, 2026-10-03, by Claude at Bhavya's request): prices, session
// length and circuit breakers come from state.scenarioId's dataset; the trading
// logic itself is unchanged.
// P2 engine fixes (2026-11-04, by Claude at Bhavya's request, AUDIT §1.4 #1–4):
// position stop-losses now execute, headlines are recorded in firedNewsIds, cash
// and shares already committed to pending orders can't be spent twice, and an
// order that can't be honoured at fill time is REJECTED instead of FILLED.

import type { LiveSessionState, Order, Position } from '@/types/live'
import { SCENARIOS, DEFAULT_SCENARIO } from './scenarios'

// ─── Initial state ──────────────────────────────────────────

export const STARTING_CASH = 100000       // in the scenario's currency (₹1,00,000 / $100,000)
/** COV-20's session (9:15 → 15:30 IST). Other markets differ: use sessionMinutesOf(). */
export const SESSION_MINUTES = 375
/** COV-20's stocks. Other scenarios: symbolsOf(). */
export const SYMBOLS = ['INDIGO', 'SUNPHARMA', 'RELIANCE', 'HDFCBANK', 'TITAN', 'TCS']

const scenarioOf = (id: string) => SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO]
export const sessionMinutesOf = (scenarioId: string) => scenarioOf(scenarioId).market.sessionMinutes
export const symbolsOf = (scenarioId: string) => Object.keys(scenarioOf(scenarioId).dataset.timeline)

export function initialState(scenarioId: string = DEFAULT_SCENARIO): LiveSessionState {
  return {
    scenarioId,
    status: 'PRE_OPEN',
    currentMinute: 0,
    speed: 5,
    activeSymbol: symbolsOf(scenarioId)[0],
    cash: STARTING_CASH,
    positions: {},
    orders: [],
    realisedPnL: 0,
    firedNewsIds: [],
    currentHalt: null,
    equityCurve: [],
    started: false,
    coachShown: { orderType: false, stopLoss: false, sizing: false },
  }
}

// ─── Action types ───────────────────────────────────────────

export type Action =
  | { type: 'TICK' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'END' }
  | { type: 'SKIP_HALT' }
  | { type: 'SET_SPEED'; speed: 1 | 5 | 10 }
  | { type: 'SET_ACTIVE'; symbol: string }
  | { type: 'PLACE_ORDER'; order: Omit<Order, 'id' | 'status' | 'placedAtMin'> }
  | { type: 'CANCEL_ORDER'; id: string }
  | { type: 'SET_STOP'; symbol: string; stopPrice: number | null }
  | { type: 'MARK_COACH_SHOWN'; coach: 'orderType' | 'stopLoss' | 'sizing' }

// ─── Helpers ────────────────────────────────────────────────

export function getPriceAtMinute(symbol: string, minute: number, scenarioId: string = DEFAULT_SCENARIO): number {
  const tl = scenarioOf(scenarioId).dataset.timeline[symbol]
  if (!tl) return 0
  // Find the bar covering this minute
  const idx = Math.min(tl.bars.length - 1, Math.floor(minute / 5))
  return tl.bars[idx]?.close ?? tl.prevClose
}

function snapshotPositions(positions: Record<string, Position>, atMinute: number, scenarioId: string): {
  totalValue: number; unrealised: number
} {
  let totalValue = 0
  let unrealised = 0
  for (const sym in positions) {
    const p = positions[sym]
    if (!p.qty) continue
    const ltp = getPriceAtMinute(sym, atMinute, scenarioId)
    totalValue += Math.abs(p.qty) * ltp
    unrealised += p.qty * (ltp - p.avgPrice)
  }
  return { totalValue, unrealised }
}

/** Price an order is budgeted at: its limit, else its trigger, else the price now. */
function refPriceOf(o: Pick<Order, 'symbol' | 'price' | 'triggerPrice'>, minute: number, scenarioId: string): number {
  return o.price ?? o.triggerPrice ?? getPriceAtMinute(o.symbol, minute, scenarioId)
}

/** Cash promised to pending BUY orders, so a new order can't spend it again (AUDIT §1.4 #3). */
function reservedCash(state: LiveSessionState): number {
  let total = 0
  for (const o of state.orders) {
    if (o.status === 'PENDING' && o.side === 'BUY') total += o.quantity * refPriceOf(o, state.currentMinute, state.scenarioId)
  }
  return total
}

/** Shares promised to pending SELL orders of one symbol. */
function reservedQty(state: LiveSessionState, symbol: string): number {
  let total = 0
  for (const o of state.orders) {
    if (o.status === 'PENDING' && o.side === 'SELL' && o.symbol === symbol) total += o.quantity
  }
  return total
}

/** Records every headline whose time has come (AUDIT §1.4 #2). Catches up after a skipped halt. */
function fireNews(state: LiveSessionState): LiveSessionState {
  const fired = new Set(state.firedNewsIds)
  const due = scenarioOf(state.scenarioId).dataset.news
    .filter(n => n.fireAt <= state.currentMinute && !fired.has(n.id))
    .sort((a, b) => a.fireAt - b.fireAt)
  return due.length ? { ...state, firedNewsIds: [...state.firedNewsIds, ...due.map(n => n.id)] } : state
}

/**
 * Executes position stop-losses (AUDIT §1.4 #1): when the price is at or below
 * a long position's stopPrice, the whole position is sold at the current price,
 * like an SL-M order (a gap below the stop fills at the gap price, not the stop).
 * The sale is recorded as a filled SL-M order so the order book, scoring and the
 * behaviour tracer all see it. Runs only while LIVE, like order matching.
 */
function triggerStops(state: LiveSessionState): LiveSessionState {
  let working = state
  for (const sym of Object.keys(state.positions).sort()) {
    const p = working.positions[sym]
    if (!p || p.stopPrice == null || p.qty <= 0) continue
    const price = getPriceAtMinute(sym, working.currentMinute, working.scenarioId)
    if (price > p.stopPrice) continue
    const order: Order = {
      id: `o${working.orders.length + 1}`,
      symbol: sym, side: 'SELL', type: 'SL-M', validity: 'DAY',
      quantity: p.qty, triggerPrice: p.stopPrice,
      status: 'FILLED', placedAtMin: working.currentMinute,
      filledAtMin: working.currentMinute, filledPrice: price,
      reason: `Stop-loss hit (stop ${p.stopPrice})`,
    }
    const positions = { ...working.positions }
    delete positions[sym]
    // Pending sells of this symbol can no longer be honoured: nothing is left to sell.
    const orders = working.orders.map(o =>
      o.status === 'PENDING' && o.side === 'SELL' && o.symbol === sym
        ? { ...o, status: 'REJECTED' as const, reason: 'Position closed by stop-loss' } : o)
    working = {
      ...working,
      positions,
      orders: [...orders, order],
      cash: working.cash + p.qty * price,
      realisedPnL: working.realisedPnL + (price - p.avgPrice) * p.qty,
    }
  }
  return working
}

// ─── Reducer ────────────────────────────────────────────────

export function reducer(state: LiveSessionState, action: Action): LiveSessionState {
  switch (action.type) {
    case 'START':
      return fireNews({ ...state, status: 'LIVE', started: true })

    case 'PAUSE':
      return state.status === 'LIVE' ? { ...state, status: 'PAUSED' } : state

    case 'RESUME':
      return state.status === 'PAUSED' ? { ...state, status: 'LIVE' } : state

    case 'END':
      return { ...state, status: 'CLOSED' }

    case 'SET_SPEED':
      return { ...state, speed: action.speed }

    case 'SET_ACTIVE':
      return { ...state, activeSymbol: action.symbol }

    case 'MARK_COACH_SHOWN':
      return { ...state, coachShown: { ...state.coachShown, [action.coach]: true } }

    case 'SKIP_HALT': {
      if (!state.currentHalt) return state
      // Jump time forward to halt end, resume LIVE
      const next = state.currentHalt.endsAtMin
      return fireNews({ ...state, currentMinute: next, currentHalt: null, status: 'LIVE' })
    }

    case 'TICK': {
      // PAUSED / CLOSED / PRE_OPEN → no time progression
      if (state.status !== 'LIVE' && state.status !== 'HALTED') return state

      const next = state.currentMinute + 1
      const sessionEnd = sessionMinutesOf(state.scenarioId)
      if (next >= sessionEnd) {
        // Square off at close
        const close = squareOffAtMinute(state, sessionEnd - 1)
        return { ...close, currentMinute: sessionEnd, status: 'CLOSED' }
      }

      let working: LiveSessionState = fireNews({ ...state, currentMinute: next })

      // Check circuit halt expiry FIRST (before testing for new circuits)
      if (working.currentHalt && next >= working.currentHalt.endsAtMin) {
        working = { ...working, currentHalt: null, status: 'LIVE' }
      }

      // Check new circuits — only fire if we\'re not already in one
      for (const c of scenarioOf(state.scenarioId).dataset.circuits) {
        if (c.fireAt === next && !working.currentHalt) {
          working = {
            ...working,
            currentHalt: { startedAtMin: next, endsAtMin: next + c.haltMinutes, level: c.level },
            status: 'HALTED',
          }
        }
      }

      // Match pending orders only when actively LIVE (not halted)
      if (working.status === 'LIVE') {
        working = triggerStops(matchOrders(working))
      }

      // Capture equity point every minute
      const snap = snapshotPositions(working.positions, working.currentMinute, working.scenarioId)
      const equity = working.cash + snap.totalValue
      const last = working.equityCurve[working.equityCurve.length - 1]
      if (!last || working.currentMinute - last.minute >= 1) {
        working = {
          ...working,
          equityCurve: [...working.equityCurve, { minute: working.currentMinute, equity }],
        }
      }

      return working
    }

    case 'PLACE_ORDER': {
      if (state.status !== 'LIVE' && state.status !== 'PAUSED') return state
      const order: Order = {
        ...action.order,
        // Deterministic (3.3, ADR-005): replay must recreate the same ids. Orders are never removed.
        id: `o${state.orders.length + 1}`,
        status: 'PENDING',
        placedAtMin: state.currentMinute,
      }
      // Validate funds for BUY, net of cash already promised to pending buys
      if (order.side === 'BUY') {
        const cost = order.quantity * refPriceOf(order, state.currentMinute, state.scenarioId)
        if (cost > state.cash - reservedCash(state)) {
          // Reject
          return {
            ...state,
            orders: [...state.orders, { ...order, status: 'REJECTED', reason: 'Insufficient funds' }],
          }
        }
      }
      // Validate qty for SELL, net of shares already promised to pending sells
      if (order.side === 'SELL') {
        const pos = state.positions[order.symbol]
        if (!pos || pos.qty - reservedQty(state, order.symbol) < order.quantity) {
          return {
            ...state,
            orders: [...state.orders, { ...order, status: 'REJECTED', reason: 'Position too small to sell' }],
          }
        }
      }
      const withOrder = { ...state, orders: [...state.orders, order] }
      // For MARKET orders, fill immediately
      if (order.type === 'MARKET') {
        return matchOrders(withOrder)
      }
      return withOrder
    }

    case 'CANCEL_ORDER':
      return {
        ...state,
        orders: state.orders.map(o =>
          o.id === action.id && o.status === 'PENDING' ? { ...o, status: 'CANCELLED' } : o,
        ),
      }

    case 'SET_STOP': {
      const pos = state.positions[action.symbol]
      if (!pos) return state
      return {
        ...state,
        positions: {
          ...state.positions,
          [action.symbol]: { ...pos, stopPrice: action.stopPrice ?? undefined },
        },
      }
    }
  }
}

// Match all pending orders against current tick
function matchOrders(state: LiveSessionState): LiveSessionState {
  let cash = state.cash
  let positions = { ...state.positions }
  let realisedPnL = state.realisedPnL
  const orders = state.orders.map(o => {
    if (o.status !== 'PENDING') return o
    const price = getPriceAtMinute(o.symbol, state.currentMinute, state.scenarioId)
    let fill = false
    let fillPrice = price
    if (o.type === 'MARKET') { fill = true }
    else if (o.type === 'LIMIT') {
      if (o.side === 'BUY' && price <= (o.price ?? Infinity)) { fill = true; fillPrice = Math.min(price, o.price!) }
      else if (o.side === 'SELL' && price >= (o.price ?? 0))   { fill = true; fillPrice = Math.max(price, o.price!) }
    } else if (o.type === 'SL' || o.type === 'SL-M') {
      // Trigger logic
      const trig = o.triggerPrice ?? 0
      if (o.side === 'SELL' && price <= trig) { fill = true; fillPrice = o.type === 'SL-M' ? price : (o.price ?? price) }
      else if (o.side === 'BUY' && price >= trig) { fill = true; fillPrice = o.type === 'SL-M' ? price : (o.price ?? price) }
    }
    if (!fill) return o

    // Apply fill to portfolio. Re-check at fill time: a trigger order can fill above
    // its budget, and a position can shrink after a sell was placed (AUDIT §1.4 #3–4).
    const cost = o.quantity * fillPrice
    if (o.side === 'BUY' && cost > cash) {
      return { ...o, status: 'REJECTED' as const, reason: 'Insufficient funds at fill' }
    }
    if (o.side === 'SELL' && (positions[o.symbol]?.qty ?? 0) < o.quantity) {
      return { ...o, status: 'REJECTED' as const, reason: 'Position too small to sell at fill' }
    }
    if (o.side === 'BUY') {
      const cur = positions[o.symbol]
      if (cur && cur.qty > 0) {
        const newQty = cur.qty + o.quantity
        const newAvg = ((cur.qty * cur.avgPrice) + cost) / newQty
        positions[o.symbol] = { ...cur, qty: newQty, avgPrice: newAvg }
      } else {
        positions[o.symbol] = {
          symbol: o.symbol, qty: o.quantity, avgPrice: fillPrice, realisedPnL: 0,
        }
      }
      cash -= cost
    } else {
      // SELL
      const cur = positions[o.symbol]
      if (cur) {
        const closeQty = Math.min(cur.qty, o.quantity)
        const realised = (fillPrice - cur.avgPrice) * closeQty
        realisedPnL += realised
        const remaining = cur.qty - closeQty
        if (remaining <= 0) {
          delete positions[o.symbol]
        } else {
          positions[o.symbol] = { ...cur, qty: remaining }
        }
        cash += closeQty * fillPrice
      }
    }
    return { ...o, status: 'FILLED' as const, filledAtMin: state.currentMinute, filledPrice: fillPrice }
  })

  return { ...state, orders, cash, positions, realisedPnL }
}

// Square off all positions at end of session
function squareOffAtMinute(state: LiveSessionState, minute: number): LiveSessionState {
  let cash = state.cash
  let realisedPnL = state.realisedPnL
  for (const sym in state.positions) {
    const p = state.positions[sym]
    if (!p.qty) continue
    const ltp = getPriceAtMinute(sym, minute, state.scenarioId)
    const realised = (ltp - p.avgPrice) * p.qty
    realisedPnL += realised
    cash += p.qty * ltp
  }
  return { ...state, cash, positions: {}, realisedPnL }
}
