'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  GamePhase,
  RevealPhase,
  Allocation,
  AllocationSnapshot,
  PulsePayload,
  PortfolioRunResult,
  PortfolioScenario,
} from '@/types/portfolio'
import {
  computePortfolioValue,
  computePnlPct,
  computeDiversificationScore,
  computeDoNothingHistory,
  computePerfectPlayHistory,
  detectMistakes,
  detectUnlockedRules,
} from '@/lib/utils/portfolio-math'

const REVEAL_THRESHOLDS: Record<RevealPhase, number> = {
  sparkline:  0,
  volume:    120,
  orderbook: 240,
  heatmap:   360,
}

const STARTING_CAPITAL = 100000

export interface PortfolioGameState {
  phase: GamePhase
  revealPhase: RevealPhase
  elapsedSeconds: number
  currentPrices: Record<string, number>
  pendingAllocations: Record<string, number>   // symbol → rupees (pre-lock)
  allocations: Record<string, Allocation>
  cashRemaining: number
  portfolioValue: number
  pnlRupees: number
  pnlPct: number
  activeEventId: string | null
  rebalanceSecondsLeft: number
  rebalanceAllocations: Record<string, number>  // symbol → rupees (mid-rebalance)
  flashCrashActive: boolean
  flashCrashSecondsLeft: number
  didPanicSell: boolean
  pendingPulses: PulsePayload[]
  pnlHistory: { second: number; value: number }[]
  snapshots: AllocationSnapshot[]
  runResult: PortfolioRunResult | null
  isMuted: boolean
}

export interface PortfolioGameActions {
  startAllocating: () => void
  setPendingAllocation: (symbol: string, rupees: number) => void
  lockInAllocation: () => void
  applyRebalance: (newAllocations: Record<string, number>) => void
  holdPosition: () => void
  panicSell: () => void
  holdThroughCrash: () => void
  clearPulses: () => void
  setMuted: (muted: boolean) => void
  updateRebalanceAllocation: (symbol: string, rupees: number) => void
}

export function usePortfolioGame(scenario: PortfolioScenario): PortfolioGameState & PortfolioGameActions {
  const [phase, setPhase] = useState<GamePhase>('intro')
  const [revealPhase, setRevealPhase] = useState<RevealPhase>('sparkline')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(scenario.stocks.map(s => [s.symbol, s.openPrice]))
  )
  const [pendingAllocations, setPendingAllocations] = useState<Record<string, number>>(
    Object.fromEntries(scenario.stocks.map(s => [s.symbol, 0]))
  )
  const [allocations, setAllocations] = useState<Record<string, Allocation>>({})
  const [cashRemaining, setCashRemaining] = useState(STARTING_CAPITAL)
  const [portfolioValue, setPortfolioValue] = useState(STARTING_CAPITAL)
  const [pnlRupees, setPnlRupees] = useState(0)
  const [pnlPct, setPnlPct] = useState(0)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [rebalanceSecondsLeft, setRebalanceSecondsLeft] = useState(0)
  const [rebalanceAllocations, setRebalanceAllocations] = useState<Record<string, number>>({})
  const [flashCrashActive, setFlashCrashActive] = useState(false)
  const [flashCrashSecondsLeft, setFlashCrashSecondsLeft] = useState(0)
  const [didPanicSell, setDidPanicSell] = useState(false)
  const [pendingPulses, setPendingPulses] = useState<PulsePayload[]>([])
  const [pnlHistory, setPnlHistory] = useState<{ second: number; value: number }[]>([])
  const [snapshots, setSnapshots] = useState<AllocationSnapshot[]>([])
  const [runResult, setRunResult] = useState<PortfolioRunResult | null>(null)
  const [isMuted, setIsMuted] = useState(false)

  const gameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rebalanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const firedEventIds = useRef(new Set<string>())
  const flashCrashFired = useRef(false)
  const elapsedRef = useRef(0)
  const allocRef = useRef<Record<string, Allocation>>({})
  const cashRef = useRef(STARTING_CAPITAL)
  const snapshotsRef = useRef<AllocationSnapshot[]>([])
  const panicRef = useRef(false)

  // Keep refs in sync for use inside setInterval callbacks
  useEffect(() => { allocRef.current = allocations }, [allocations])
  useEffect(() => { cashRef.current = cashRemaining }, [cashRemaining])
  useEffect(() => { snapshotsRef.current = snapshots }, [snapshots])
  useEffect(() => { panicRef.current = didPanicSell }, [didPanicSell])

  const stopGameTimer = useCallback(() => {
    if (gameTimerRef.current) {
      clearInterval(gameTimerRef.current)
      gameTimerRef.current = null
    }
  }, [])

  const stopRebalanceTimer = useCallback(() => {
    if (rebalanceTimerRef.current) {
      clearInterval(rebalanceTimerRef.current)
      rebalanceTimerRef.current = null
    }
  }, [])

  const buildSnapshot = useCallback((
    second: number,
    reason: AllocationSnapshot['reason'],
    prices: Record<string, number>,
    allocs: Record<string, Allocation>,
    cash: number
  ): AllocationSnapshot => {
    const updatedAllocs: Record<string, Allocation> = {}
    for (const [symbol, alloc] of Object.entries(allocs)) {
      const price = prices[symbol] ?? alloc.avgCost
      const currentValue = alloc.shares * price
      updatedAllocs[symbol] = {
        ...alloc,
        currentValue,
        pnlRupees: currentValue - alloc.shares * alloc.avgCost,
        pnlPct: ((price - alloc.avgCost) / alloc.avgCost) * 100,
      }
    }
    const total = computePortfolioValue(updatedAllocs, cash)
    return { atSecond: second, reason, allocations: updatedAllocs, cash, portfolioValue: total }
  }, [])

  const updatePricesAndPnl = useCallback((second: number): Record<string, number> => {
    const prices: Record<string, number> = {}
    for (const stock of scenario.stocks) {
      const candle = stock.candles[Math.min(second, stock.candles.length - 1)]
      prices[stock.symbol] = candle.price
    }
    setCurrentPrices(prices)

    const updatedAllocs: Record<string, Allocation> = {}
    for (const [symbol, alloc] of Object.entries(allocRef.current)) {
      const price = prices[symbol] ?? alloc.avgCost
      const currentValue = alloc.shares * price
      updatedAllocs[symbol] = {
        ...alloc,
        currentValue,
        pnlRupees: currentValue - alloc.shares * alloc.avgCost,
        pnlPct: ((price - alloc.avgCost) / alloc.avgCost) * 100,
      }
    }
    setAllocations(updatedAllocs)

    const total = computePortfolioValue(updatedAllocs, cashRef.current)
    const pnl = total - STARTING_CAPITAL
    const pnlP = computePnlPct(total, STARTING_CAPITAL)
    setPortfolioValue(total)
    setPnlRupees(pnl)
    setPnlPct(pnlP)
    setPnlHistory(prev => [...prev, { second, value: Math.round(total) }])

    return prices
  }, [scenario.stocks])

  const openRebalanceWindow = useCallback((eventId: string, prices: Record<string, number>) => {
    setActiveEventId(eventId)
    setRebalanceSecondsLeft(15)
    // Pre-fill rebalance with current rupee values
    const current: Record<string, number> = {}
    for (const [symbol, alloc] of Object.entries(allocRef.current)) {
      current[symbol] = Math.round(alloc.shares * (prices[symbol] ?? alloc.avgCost))
    }
    setRebalanceAllocations(current)
    setPhase('rebalance')
    stopGameTimer()

    let countdown = 15
    rebalanceTimerRef.current = setInterval(() => {
      countdown--
      setRebalanceSecondsLeft(countdown)
      if (countdown <= 0) {
        stopRebalanceTimer()
        setPhase('running')
        setActiveEventId(null)
        startGameTimer()
      }
    }, 1000)
  }, [stopGameTimer, stopRebalanceTimer])

  const startGameTimer = useCallback(() => {
    if (gameTimerRef.current) return
    gameTimerRef.current = setInterval(() => {
      elapsedRef.current += 1
      const s = elapsedRef.current

      // End of game
      if (s >= 480) {
        stopGameTimer()
        setElapsedSeconds(480)
        setPhase('closed')
        return
      }

      setElapsedSeconds(s)

      // Update reveal phase
      if (s >= REVEAL_THRESHOLDS.heatmap) setRevealPhase('heatmap')
      else if (s >= REVEAL_THRESHOLDS.orderbook) setRevealPhase('orderbook')
      else if (s >= REVEAL_THRESHOLDS.volume) setRevealPhase('volume')

      // Update prices
      const prices = updatePricesAndPnl(s)

      // Flash crash
      if (!flashCrashFired.current && s === scenario.flashCrash.realSecond) {
        flashCrashFired.current = true
        setFlashCrashActive(true)
        setFlashCrashSecondsLeft(scenario.flashCrash.durationSeconds)
        setPhase('flash_crash')
        stopGameTimer()

        let fc = scenario.flashCrash.durationSeconds
        const fcTimer = setInterval(() => {
          fc--
          setFlashCrashSecondsLeft(fc)
          if (fc <= 0) {
            clearInterval(fcTimer)
            setFlashCrashActive(false)
            if (!panicRef.current) {
              setPhase('running')
              startGameTimer()
            }
          }
        }, 1000)
        return
      }

      // Check events
      for (const event of scenario.events) {
        if (!firedEventIds.current.has(event.id) && s === event.realSecond) {
          firedEventIds.current.add(event.id)

          // Build causal pulses
          const pulses: PulsePayload[] = event.causalImpacts.map((impact, i) => ({
            id: `${event.id}-${impact.symbol}-${s}`,
            fromId: 'news-banner',
            toId: `stock-card-${impact.symbol}`,
            polarity: impact.polarity,
            delayMs: i * 150,
          }))
          setPendingPulses(pulses)
          stopGameTimer()
          openRebalanceWindow(event.id, prices)
          break
        }
      }
    }, 1000)
  }, [scenario, updatePricesAndPnl, stopGameTimer, openRebalanceWindow])

  // Build final run result when phase closes
  useEffect(() => {
    if (phase !== 'closed') return

    const finalPrices = Object.fromEntries(
      scenario.stocks.map(s => [s.symbol, s.candles[479]?.price ?? s.closePrice])
    )
    const finalSnap = buildSnapshot(480, 'initial', finalPrices, allocRef.current, cashRef.current)

    const allSnaps = [...snapshotsRef.current, finalSnap]
    const doNothing = computeDoNothingHistory(snapshotsRef.current[0] ?? finalSnap, scenario.stocks)
    const perfectPlay = computePerfectPlayHistory(scenario.stocks, scenario.events, STARTING_CAPITAL)
    const mistakes = detectMistakes(allSnaps, scenario.flashCrash.realSecond, panicRef.current, scenario.events, scenario.stocks)
    const unlockedRuleIds = detectUnlockedRules(allSnaps, panicRef.current, scenario.causalRules)
    const divScore = computeDiversificationScore(finalSnap.allocations, finalSnap.portfolioValue)

    const result: PortfolioRunResult = {
      startingCapital: STARTING_CAPITAL,
      finalValue: Math.round(finalSnap.portfolioValue),
      pnlRupees: Math.round(finalSnap.portfolioValue - STARTING_CAPITAL),
      pnlPct: Math.round(computePnlPct(finalSnap.portfolioValue, STARTING_CAPITAL) * 100) / 100,
      snapshots: allSnaps,
      mistakes,
      unlockedRuleIds,
      diversificationScore: divScore,
      didPanicSell: panicRef.current,
      pnlHistory: [],
      doNothingHistory: doNothing,
      perfectPlayHistory: perfectPlay,
    }
    setRunResult(result)
  }, [phase, scenario, buildSnapshot])

  // Actions

  const setPendingAllocation = useCallback((symbol: string, rupees: number) => {
    setPendingAllocations(prev => ({ ...prev, [symbol]: rupees }))
  }, [])

  const lockInAllocation = useCallback(() => {
    const prices = Object.fromEntries(scenario.stocks.map(s => [s.symbol, s.openPrice]))
    const newAllocs: Record<string, Allocation> = {}
    let totalInvested = 0

    for (const stock of scenario.stocks) {
      const rupees = pendingAllocations[stock.symbol] ?? 0
      if (rupees > 0) {
        const shares = rupees / stock.openPrice
        newAllocs[stock.symbol] = {
          symbol: stock.symbol,
          shares,
          avgCost: stock.openPrice,
          currentValue: rupees,
          pnlRupees: 0,
          pnlPct: 0,
        }
        totalInvested += rupees
      }
    }

    const cash = STARTING_CAPITAL - totalInvested
    setAllocations(newAllocs)
    setCashRemaining(Math.max(0, cash))
    setPortfolioValue(STARTING_CAPITAL)
    allocRef.current = newAllocs
    cashRef.current = Math.max(0, cash)

    const initialSnap = buildSnapshot(0, 'initial', prices, newAllocs, Math.max(0, cash))
    setSnapshots([initialSnap])
    snapshotsRef.current = [initialSnap]

    setPhase('running')
    elapsedRef.current = 0
    startGameTimer()
  }, [scenario.stocks, pendingAllocations, buildSnapshot, startGameTimer])

  const applyRebalance = useCallback((newRupees: Record<string, number>) => {
    stopRebalanceTimer()
    const prices = Object.fromEntries(
      scenario.stocks.map(s => {
        const candle = s.candles[Math.min(elapsedRef.current, s.candles.length - 1)]
        return [s.symbol, candle.price]
      })
    )

    const totalAvailable = Object.values(allocRef.current).reduce((sum, a) => sum + a.currentValue, 0) + cashRef.current
    const newAllocs: Record<string, Allocation> = {}
    let totalInvested = 0

    for (const stock of scenario.stocks) {
      const rupees = Math.min(newRupees[stock.symbol] ?? 0, totalAvailable)
      if (rupees > 0) {
        const price = prices[stock.symbol] ?? stock.openPrice
        const shares = rupees / price
        newAllocs[stock.symbol] = {
          symbol: stock.symbol,
          shares,
          avgCost: price,
          currentValue: rupees,
          pnlRupees: 0,
          pnlPct: 0,
        }
        totalInvested += rupees
      }
    }

    const cash = totalAvailable - totalInvested
    setAllocations(newAllocs)
    setCashRemaining(Math.max(0, cash))
    allocRef.current = newAllocs
    cashRef.current = Math.max(0, cash)

    const snap = buildSnapshot(elapsedRef.current, 'event', prices, newAllocs, Math.max(0, cash))
    setSnapshots(prev => [...prev, snap])
    snapshotsRef.current = [...snapshotsRef.current, snap]

    setActiveEventId(null)
    setPhase('running')
    startGameTimer()
  }, [scenario.stocks, stopRebalanceTimer, buildSnapshot, startGameTimer])

  const holdPosition = useCallback(() => {
    stopRebalanceTimer()
    setActiveEventId(null)
    setPhase('running')
    startGameTimer()
  }, [stopRebalanceTimer, startGameTimer])

  const panicSell = useCallback(() => {
    setDidPanicSell(true)
    panicRef.current = true

    // Sell everything at current (crashed) prices
    const prices = Object.fromEntries(
      scenario.stocks.map(s => {
        const candle = s.candles[Math.min(elapsedRef.current, s.candles.length - 1)]
        return [s.symbol, candle.price]
      })
    )
    const totalValue = Object.entries(allocRef.current).reduce((sum, [symbol, alloc]) => {
      return sum + alloc.shares * (prices[symbol] ?? alloc.avgCost)
    }, cashRef.current)

    const snap = buildSnapshot(elapsedRef.current, 'flash_crash', prices, allocRef.current, cashRef.current)
    setSnapshots(prev => [...prev, snap])
    snapshotsRef.current = [...snapshotsRef.current, snap]

    setAllocations({})
    setCashRemaining(Math.round(totalValue))
    allocRef.current = {}
    cashRef.current = Math.round(totalValue)

    setFlashCrashActive(false)
    setPhase('running')
    startGameTimer()
  }, [scenario.stocks, buildSnapshot, startGameTimer])

  const holdThroughCrash = useCallback(() => {
    // Just resume — flash crash recovery happens naturally via price candles
    setFlashCrashActive(false)
    setPhase('running')
    startGameTimer()
  }, [startGameTimer])

  const clearPulses = useCallback(() => {
    setPendingPulses([])
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    setIsMuted(muted)
  }, [])

  const updateRebalanceAllocation = useCallback((symbol: string, rupees: number) => {
    setRebalanceAllocations(prev => ({ ...prev, [symbol]: rupees }))
  }, [])

  const startAllocating = useCallback(() => setPhase('allocating'), [])

  // Cleanup on unmount
  useEffect(() => () => {
    stopGameTimer()
    stopRebalanceTimer()
  }, [stopGameTimer, stopRebalanceTimer])

  return {
    phase, revealPhase, elapsedSeconds, currentPrices,
    pendingAllocations, allocations, cashRemaining,
    portfolioValue, pnlRupees, pnlPct,
    activeEventId, rebalanceSecondsLeft, rebalanceAllocations,
    flashCrashActive, flashCrashSecondsLeft, didPanicSell,
    pendingPulses, pnlHistory, snapshots, runResult, isMuted,
    startAllocating, setPendingAllocation, lockInAllocation, applyRebalance,
    holdPosition, panicSell, holdThroughCrash,
    clearPulses, setMuted, updateRebalanceAllocation,
  }
}
