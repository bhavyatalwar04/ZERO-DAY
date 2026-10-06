'use client'

import { createContext, useContext, useEffect, useReducer, useRef, useCallback, useMemo, type ReactNode } from 'react'
import type { IntradayBar, LiveSessionState, NewsEvent, OrusWhisper } from '@/types/live'
import {
  reducer, initialState, getPriceAtMinute, STARTING_CASH, type Action,
} from '@/lib/engine/live-reducer'
import { SCENARIOS, DEFAULT_SCENARIO, type ScenarioInfo } from '@/lib/engine/scenarios'
import { clockAt, formatMoney, NSE, type MarketSpec } from '@/lib/engine/markets'
import { withJournal, emptyJournal, type JournalEntry } from '@/lib/session/journal'

// The engine itself lives in lib/engine/live-reducer.ts (no 'use client', so the server can replay it).
// Multi-scenario (M4, 2026-10-03, by Claude at Bhavya's request): all data comes from the
// session's scenario; `market`, `clock` and `money` replace the hardcoded ₹ / IST / 9:15.
export { reducer, initialState, type Action }

// ─── Context ────────────────────────────────────────────────

interface LiveSessionContextValue {
  state: LiveSessionState
  dispatch: React.Dispatch<Action>
  // selectors
  ltp: (symbol: string) => number
  prevClose: (symbol: string) => number
  pctChange: (symbol: string) => number
  totalEquity: number
  dayPnL: number
  dayPnLPct: number
  positionsValue: number
  marginUsed: number
  // helpers
  getBars: (symbol: string) => IntradayBar[]
  getIndexLatest: (key: string) => { value: number; pctChange: number }
  pendingNews: () => NewsEvent[]
  whisperForMinute: (minute: number) => OrusWhisper | undefined
  symbols: string[]
  /** Every non-TICK action with the minute it was applied at (3.3): synced to session_actions. */
  journal: JournalEntry<Action>[]
  // scenario (M4)
  scenario: ScenarioInfo
  market: MarketSpec
  /** session minute → local market time "HH:MM" */
  clock: (minute: number) => string
  /** amount → "₹1,00,000" / "$100,000" */
  money: (amount: number, decimals?: number) => string
}

const LiveSessionContext = createContext<LiveSessionContextValue | null>(null)

// Records each user action inside the reducer, so the logged minute is exact (ADR-005).
const journaledReducer = withJournal(reducer)

export function LiveSessionProvider({ children, scenarioId = DEFAULT_SCENARIO }: { children: ReactNode; scenarioId?: string }) {
  const scenario = SCENARIOS[scenarioId] ?? SCENARIOS[DEFAULT_SCENARIO]
  const { dataset, market } = scenario
  const [journaled, dispatch] = useReducer(journaledReducer, dataset.scenarioId, id => emptyJournal<LiveSessionState, Action>(initialState(id)))
  const state = journaled.live
  const tickRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-start on mount
  useEffect(() => {
    if (!state.started) dispatch({ type: 'START' })
  }, [state.started])

  // Tick loop based on speed
  useEffect(() => {
    if (state.status !== 'LIVE' && state.status !== 'HALTED') {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      return
    }
    // 1 simulated minute every X ms based on speed
    // 1× = 1500ms (real-time-ish); 5× = 300ms; 10× = 150ms
    const ms = state.speed === 1 ? 1500 : state.speed === 5 ? 300 : 150
    tickRef.current = setInterval(() => {
      dispatch({ type: 'TICK' })
    }, ms)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [state.status, state.speed])

  // ─── Selectors ────────────────────────────────────────────
  const sid = state.scenarioId
  const ltp = useCallback((symbol: string) => getPriceAtMinute(symbol, state.currentMinute, sid), [state.currentMinute, sid])
  const prevClose = useCallback((symbol: string) => dataset.timeline[symbol]?.prevClose ?? 0, [dataset])
  const pctChange = useCallback((symbol: string) => {
    const pc = dataset.timeline[symbol]?.prevClose ?? 0
    if (pc === 0) return 0
    return ((getPriceAtMinute(symbol, state.currentMinute, sid) - pc) / pc) * 100
  }, [state.currentMinute, dataset, sid])

  const positionsValue = useMemo(() => {
    let v = 0
    for (const sym in state.positions) {
      v += Math.abs(state.positions[sym].qty) * ltp(sym)
    }
    return v
  }, [state.positions, ltp])

  const marginUsed = useMemo(() => {
    // Simple model: 25% margin used = position value × 0.25
    return positionsValue * 0.25
  }, [positionsValue])

  const totalEquity = state.cash + positionsValue
  const dayPnL = totalEquity - STARTING_CASH
  const dayPnLPct = (dayPnL / STARTING_CASH) * 100

  const getBars = useCallback((symbol: string) => {
    return dataset.timeline[symbol]?.bars ?? []
  }, [dataset])

  const getIndexLatest = useCallback((key: string) => {
    const arr = dataset.indices?.[key] ?? []
    if (arr.length === 0) return { value: 0, pctChange: 0 }
    const idx = Math.min(arr.length - 1, Math.floor(state.currentMinute / 5))
    return { value: arr[idx].value, pctChange: arr[idx].pctChange * 100 }
  }, [state.currentMinute, dataset])

  const pendingNews = useCallback(() => {
    return dataset.news.filter(n => n.fireAt <= state.currentMinute)
  }, [state.currentMinute, dataset])

  const whisperForMinute = useCallback((minute: number) => {
    return scenario.whispers.find(w => Math.abs(w.fireAt - minute) <= 1)
  }, [scenario])

  const symbols = useMemo(() => Object.keys(dataset.timeline), [dataset])
  const clock = useCallback((minute: number) => clockAt(minute, market), [market])
  const money = useCallback((amount: number, decimals = 0) => formatMoney(amount, market, decimals), [market])

  const value = useMemo<LiveSessionContextValue>(() => ({
    state, dispatch,
    ltp, prevClose, pctChange,
    totalEquity, dayPnL, dayPnLPct, positionsValue, marginUsed,
    getBars, getIndexLatest, pendingNews, whisperForMinute,
    symbols,
    journal: journaled.entries,
    scenario, market, clock, money,
  }), [state, journaled.entries, ltp, prevClose, pctChange, totalEquity, dayPnL, dayPnLPct, positionsValue, marginUsed, getBars, getIndexLatest, pendingNews, whisperForMinute, symbols, scenario, market, clock, money])

  return <LiveSessionContext.Provider value={value}>{children}</LiveSessionContext.Provider>
}

export function useLiveSession(): LiveSessionContextValue {
  const ctx = useContext(LiveSessionContext)
  if (!ctx) throw new Error('useLiveSession must be used inside LiveSessionProvider')
  return ctx
}

/** COV-20 / NSE clock (minute since 9:15 → HH:MM). Inside the live room prefer useLiveSession().clock. */
export function fmtIST(minute: number): string {
  return clockAt(minute, NSE)
}
