'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ChevronLeft, ChevronRight, X, Play, Check } from 'lucide-react'
import { CausalChainBlock } from './tutorial/causal-chain'
import { AnimatedPnLBlock } from './tutorial/animated-pnl'
import { TrialTradeBlock } from './tutorial/trial-trade'
import { CinematicBlock } from './tutorial/cinematic'
import { useTracer } from '@/lib/behavior/tracer'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import type { ScenarioInfo } from '@/lib/engine/scenarios'
import {
  usesHandBuiltIntro, introSlideCopy, sessionSlideCopy, clockSlideCopy, indicesSlideCopy,
  walletSlideBody, practiceSlideBody,
} from '@/lib/session/scenario-copy'

export interface TutorialProps {
  open: boolean
  onClose: () => void
}

type Phase = 'SCENARIO' | 'BASICS' | 'INTERFACE' | 'READY'
type Pos = 'center' | 'right' | 'left' | 'below' | 'above'
type CustomKind = 'causal-chain' | 'animated-pnl' | 'trial-trade' | 'cinematic'

interface Quiz {
  question: string
  options: string[]
  correctIdx: number
  explanation: string
}

interface Slide {
  id: number
  phase: Phase
  phaseLabel: string
  title: string
  targetId: string | null
  pos: Pos
  wide?: boolean
  body: string
  bullets?: string[]
  note?: string
  custom?: CustomKind
  quiz?: Quiz
}

const SLIDES: Slide[] = [
  // ── SCENARIO ─────────────────────────────────────────────────────
  {
    id: 1, phase: 'SCENARIO', phaseLabel: 'Scenario · 1 of 3',
    title: 'March 9, 2020 — Black Monday',
    targetId: null, pos: 'center', wide: true,
    body: 'COVID-19 is spreading globally. Overnight, Saudi Arabia and Russia failed to agree on oil production cuts — Brent crashed 30%. Indian markets are about to open. History says NIFTY will fall ~8% today. The question is: what will you do?',
    bullets: [
      'This is a simulation of a real market day — prices and news are historically accurate',
      'Circuit breakers will halt trading when NIFTY falls −5% and −10%',
      'You have ₹1,00,000 and 6 stocks to trade across one session',
      'Every trade must have a written thesis — that log becomes your debrief',
    ],
    note: 'The simulation runs on a clock you control. It is currently PAUSED. It will not start until you click "Begin Trading" at the end of this walkthrough.',
  },
  {
    id: 2, phase: 'SCENARIO', phaseLabel: 'Scenario · 2 of 3',
    title: 'Your Starting Position',
    targetId: null, pos: 'center', wide: true,
    body: 'Market opens at 9:15 IST and closes at 15:30 IST — 375 minutes of live trading. You will watch news drop in real time, see circuit breakers fire, and decide whether to buy, hold, or sell under pressure.',
    bullets: [
      'Cash: ₹1,00,000 — fully available at market open',
      'Stocks: 6 pre-screened NSE-listed companies across sectors',
      'No shorting — you can only sell what you own',
      'At closing bell, all positions are marked-to-market for your debrief score',
    ],
    note: 'You cannot lose real money. But the psychological pressure of watching positions move against you is real — that is the point of the simulation.',
  },
  {
    id: 3, phase: 'SCENARIO', phaseLabel: 'Scenario · 3 of 3',
    title: 'How One Crash Becomes Many',
    targetId: null, pos: 'center', wide: true,
    custom: 'causal-chain',
    body: 'A stock can drop sharply with zero bad news about that specific company. It is being dragged by a chain of cause and effect. Today you will see this cascade in real time. Understanding it is the difference between panic-selling and informed action.',
  },

  // ── BASICS ───────────────────────────────────────────────────────
  {
    id: 4, phase: 'BASICS', phaseLabel: 'Basics · 1 of 5',
    title: 'What is Buying a Stock?',
    targetId: null, pos: 'center', wide: true,
    body: 'When you BUY a stock, you exchange cash for shares in a company. If the price rises after you buy, your position is worth more. If it falls, less. The gain or loss is only real when you SELL.',
    bullets: [
      'BUY 10 shares of RELIANCE at ₹1,400 → you spend ₹14,000 cash',
      'RELIANCE moves to ₹1,500 → position is now worth ₹15,000',
      'SELL all 10 shares → ₹15,000 back into cash, profit = ₹1,000',
      'Buying does NOT change your total — cash is simply converted to stock',
    ],
    quiz: {
      question: 'You buy 10 RELIANCE at ₹1,400 each (total ₹14,000). The price moves to ₹1,420. You haven\'t sold yet. What happened to your TOTAL portfolio value?',
      options: [
        'It went UP by ₹200',
        'It stayed exactly the same',
        'It went DOWN by ₹14,000 because you spent cash',
      ],
      correctIdx: 0,
      explanation: 'Correct. Buying didn\'t change your total — it converted ₹14,000 cash into ₹14,000 of stock. Then the stock rose ₹20 × 10 = +₹200 unrealised P&L. Your total is now ₹100,200.',
    },
  },
  {
    id: 5, phase: 'BASICS', phaseLabel: 'Basics · 2 of 5',
    title: 'P&L in Motion',
    targetId: null, pos: 'center', wide: true,
    custom: 'animated-pnl',
    body: 'Watch a complete trade cycle. Notice how cash, position, and P&L move together — and how P&L changes from "unrealised" to "realised" only after you sell.',
  },
  {
    id: 6, phase: 'BASICS', phaseLabel: 'Basics · 3 of 5',
    title: 'What is a Stop Loss?',
    targetId: null, pos: 'center', wide: true,
    body: 'A Stop Loss (SL) is a pre-set exit order that fires automatically when a stock\'s price drops to a level you define. It is the primary tool for limiting how much you lose on any single trade.',
    bullets: [
      'You buy HDFC at ₹900 — you decide your maximum loss is 5%',
      'Set SL at ₹855 — if the price falls there, the system sells automatically',
      'Without a stop loss, you must watch manually and sell by hand',
      'SL-M = market stop (sells at best available price when triggered)',
    ],
    note: 'Rule: define your risk before your reward. Professionals set a stop loss before they enter any position. Never skip this step.',
    quiz: {
      question: 'You buy a stock at ₹500. You can comfortably lose ₹5,000 on this trade if you\'re wrong. You bought 200 shares. Where should your stop loss go?',
      options: [
        'At ₹490 — that locks in only a small loss',
        'At ₹475 — ₹25 below entry × 200 shares = ₹5,000 loss',
        'No stop loss — I\'ll exit manually if it falls',
      ],
      correctIdx: 1,
      explanation: 'Correct. ₹500 − ₹475 = ₹25 per share × 200 shares = ₹5,000 maximum loss, exactly your tolerance. SL placement is math: max-loss ÷ shares = distance from entry.',
    },
  },
  {
    id: 7, phase: 'BASICS', phaseLabel: 'Basics · 4 of 5',
    title: 'The Four Order Types',
    targetId: null, pos: 'center', wide: true,
    body: 'Every trade you place uses one of four order types. Each trades certainty of execution against certainty of price.',
    bullets: [
      'MARKET — buys/sells immediately at current screen price. Always fills.',
      'LIMIT — only fills at your specified price or better. May not fill.',
      'SL (Stop Loss) — becomes a LIMIT order when your trigger price is hit.',
      'SL-M (Stop Loss Market) — becomes a MARKET order when triggered. Always fills.',
    ],
    note: 'For beginners: use MARKET to enter and SL-M to protect. LIMIT orders require more experience to manage effectively.',
    quiz: {
      question: 'A stock is moving fast — RELIANCE is plunging −6% and you want OUT of your position right now. Which order type guarantees you exit?',
      options: [
        'LIMIT order at the last seen price',
        'MARKET order',
        'SL order at −2% below current',
      ],
      correctIdx: 1,
      explanation: 'Correct. MARKET orders always fill at whatever price is available — you sacrifice price certainty for execution certainty. In a fast-falling market, a LIMIT order may never fill because the price keeps moving away.',
    },
  },
  {
    id: 8, phase: 'BASICS', phaseLabel: 'Basics · 5 of 5',
    title: 'Try It Yourself',
    targetId: null, pos: 'center', wide: true,
    custom: 'trial-trade',
    body: 'A practice trade in a sandbox. Make a complete BUY → set SL → wait → SELL cycle. Click each button when prompted. Nothing here counts toward your real ₹1,00,000 session.',
  },

  // ── DEMO PLAYTHROUGH ─────────────────────────────────────────────
  {
    id: 9, phase: 'BASICS', phaseLabel: 'Demo · Watch a Pro',
    title: 'Watch Aarav Trade the Open',
    targetId: null, pos: 'center', wide: true,
    custom: 'cinematic',
    body: 'Before you start your own session, watch a fictional trader (Aarav) play through the first hour of March 9, 2020. His thinking is narrated as the day unfolds. This is what informed decision-making sounds like in real time.',
  },

  // ── INTERFACE ────────────────────────────────────────────────────
  {
    id: 10, phase: 'INTERFACE', phaseLabel: 'Interface · 1 of 8',
    title: 'Status Indicator & Clock',
    targetId: 'hud-status', pos: 'below',
    body: 'The pulsing dot is the market status indicator. Green = LIVE and ticking. Red = HALTED by circuit breaker. Grey = PAUSED. The clock shows simulated IST time — March 9, 2020.',
    bullets: [
      'When status shows HALTED, trading is suspended for 15 minutes (historically accurate)',
      'The session label COV-20 refers to this specific simulation scenario',
    ],
  },
  {
    id: 11, phase: 'INTERFACE', phaseLabel: 'Interface · 2 of 8',
    title: 'Live Indices Ticker',
    targetId: 'hud-indices', pos: 'below',
    body: 'Seven market-wide indicators ticking in real time. NIFTY and SENSEX are the primary Indian equity benchmarks. VIX is the fear index — high VIX means high volatility.',
    bullets: [
      '▲ green = trading above yesterday\'s close · ▼ red = below',
      'When NIFTY falls sharply, almost every individual stock will follow',
      'BRENT oil is especially relevant today — it cratered overnight',
    ],
  },
  {
    id: 12, phase: 'INTERFACE', phaseLabel: 'Interface · 3 of 8',
    title: 'Simulation Speed',
    targetId: 'hud-speed', pos: 'below',
    body: 'Control how fast simulated time passes. 5× is the recommended setting — the full trading day completes in about 5 real minutes. The pause button freezes time completely so you can think.',
    bullets: [
      '1× — close to real-time, very slow, highly immersive',
      '5× — recommended for first-time users',
      '10× — speedrun mode, hard to react to breaking news',
    ],
  },
  {
    id: 13, phase: 'INTERFACE', phaseLabel: 'Interface · 4 of 8',
    title: 'Cash Wallet',
    targetId: 'hud-wallet', pos: 'below',
    body: 'Your spendable cash. Starts at ₹1,00,000. Decreases when you buy shares, increases when you sell. The line below shows the current market value of all stocks you hold.',
  },
  {
    id: 14, phase: 'INTERFACE', phaseLabel: 'Interface · 5 of 8',
    title: 'Portfolio Value & Day P&L',
    targetId: 'hud-portfolio', pos: 'below',
    body: 'Total wealth = cash + all current stock positions. The bottom line is your live Day P&L. Green border means you\'re ahead of your starting value. Red means behind.',
    bullets: [
      'Updates every second as prices move',
      'Green ▲ = profitable session so far · Red ▼ = losing session',
    ],
  },
  {
    id: 15, phase: 'INTERFACE', phaseLabel: 'Interface · 6 of 8',
    title: 'Candlestick Chart',
    targetId: 'chart-area', pos: 'center',
    body: 'The main panel shows 5-minute candlesticks for the selected stock. Each candle covers 5 minutes of price action. New candles appear as simulated time advances.',
    bullets: [
      'Green candle: price finished higher than it opened that 5-min window',
      'Red candle: price finished lower',
      'Dashed grey line = yesterday\'s closing price (your reference)',
      'White line = MA20 (20-period moving average)',
    ],
  },
  {
    id: 16, phase: 'INTERFACE', phaseLabel: 'Interface · 7 of 8',
    title: 'Watchlist & Rail Tabs',
    targetId: 'rail-watchlist', pos: 'left',
    body: 'The watchlist shows your six stocks with live price and % change. Click any row to load it in the chart. The tab bar above switches between Watchlist, Positions, Orders, News, and Coach (ORUS).',
    bullets: [
      'Positions tab — stocks you own with live P&L and one-tap Exit/SL',
      'News tab — real-time SIGNAL vs NOISE headlines',
      'Coach tab — ORUS reacts to circuit breakers, news drops, your trades',
    ],
  },
  {
    id: 17, phase: 'INTERFACE', phaseLabel: 'Interface · 8 of 8',
    title: 'Order Ticket — Where You Trade',
    targetId: 'dock-tabs', pos: 'above',
    body: 'The Order Ticket in the bottom dock is where you execute trades. Fill in side (BUY/SELL), order type, quantity, price, and your trade thesis — then Place Order.',
    bullets: [
      'BUY = spend cash to open a new position',
      'SELL = close an existing position and receive cash',
      'Thesis field is required — write your reason before you commit',
    ],
    note: 'If you type a very large quantity (over 40% of wallet), a sizing coach warning will appear. This is intentional — it teaches you about position sizing before you over-bet.',
  },

  // ── READY ────────────────────────────────────────────────────────
  {
    id: 18, phase: 'READY', phaseLabel: 'Ready',
    title: 'Pre-Trade Checklist',
    targetId: null, pos: 'center', wide: true,
    body: 'Before you place your first trade, run through this checklist. It will feel slow the first time. With repetition it becomes automatic. That is the goal.',
    bullets: [
      '① Check indices — is the broad market up, down, or crashing?',
      '② Select your stock — view the chart, find where it sits vs. yesterday',
      '③ Write your thesis — one sentence: WHY this trade, WHY now',
      '④ Set a stop loss — decide the maximum loss you will accept before you enter',
      '⑤ Size small — 2–5% of wallet per trade until you build conviction',
    ],
    note: 'ORUS will pause the session and coach you three more times after the bell rings — at the open, on the first news drop, and before you place your first trade. After that you\'re on your own. Good luck.',
  },
]

/** The oil-crash cascade and Aarav's 9 March 2020 replay only make sense on COV-20. */
const COV20_ONLY_SLIDE_IDS = new Set([3, 9])

/**
 * The walkthrough for a scenario. SLIDES above were written for COV-20 and stay
 * as they are there; other scenarios get their own day, money, hours and indices
 * (lib/session/scenario-copy) and skip the COV-20-only demos.
 */
function slidesFor(s: ScenarioInfo): Slide[] {
  if (usesHandBuiltIntro(s)) return SLIDES
  const overrides: Record<number, Partial<Slide>> = {
    1: { ...introSlideCopy(s), phaseLabel: 'Scenario · 1 of 2' },
    2: { ...sessionSlideCopy(s), phaseLabel: 'Scenario · 2 of 2' },
    8: { body: practiceSlideBody(s) },
    10: clockSlideCopy(s),
    11: indicesSlideCopy(s),
    13: { body: walletSlideBody(s) },
  }
  return SLIDES
    .filter(slide => !COV20_ONLY_SLIDE_IDS.has(slide.id))
    .map(slide => ({ ...slide, ...overrides[slide.id] }))
}

const PHASE_COLORS: Record<Phase, string> = {
  SCENARIO: '#D4A04D',
  BASICS: '#3B82F6',
  INTERFACE: '#FF1F1F',
  READY: '#10B981',
}

export function LiveTutorial({ open, onClose }: TutorialProps) {
  const [idx, setIdx] = useState(0)
  const [bounds, setBounds] = useState<DOMRect | null>(null)
  const { track } = useTracer()
  const slideEnterRef = useRef<number>(Date.now())

  const { scenario } = useLiveSession()
  const slides = useMemo(() => slidesFor(scenario), [scenario])
  const phases = useMemo(() => slides.map(s => s.phase), [slides])
  const slide = slides[idx]
  const isLast = idx === slides.length - 1

  useEffect(() => { if (open) { setIdx(0); track('tutorial_opened', 0) } }, [open, track])

  // Track slide views with dwell time
  useEffect(() => {
    if (!open) return
    slideEnterRef.current = Date.now()
    return () => {
      const dwellMs = Date.now() - slideEnterRef.current
      track('tutorial_slide_viewed', 0, { slideId: slide.id, phase: slide.phase, dwellMs })
    }
  }, [open, idx, slide.id, slide.phase, track])

  useEffect(() => {
    if (!open || !slide.targetId) { setBounds(null); return }
    const el = document.querySelector(`[data-tut="${slide.targetId}"]`) as HTMLElement | null
    if (!el) { setBounds(null); return }
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    let cancelled = false
    const t = setTimeout(() => {
      if (!cancelled) setBounds(el.getBoundingClientRect())
    }, 350)
    const onResize = () => { if (!cancelled) setBounds(el.getBoundingClientRect()) }
    window.addEventListener('resize', onResize)
    return () => {
      cancelled = true
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
  }, [open, idx, slide.targetId])

  const next = useCallback(() => {
    if (isLast) { track('tutorial_completed', 0); onClose(); return }
    setIdx(i => i + 1)
  }, [isLast, onClose, track])

  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), [])

  const handleClose = useCallback(() => {
    if (!isLast) track('tutorial_skipped', 0, { atSlideId: slide.id })
    onClose()
  }, [isLast, slide.id, onClose, track])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, next, prev, handleClose])

  if (!open) return null

  const phaseColor = PHASE_COLORS[slide.phase]
  const useSpotlight = !slide.wide && !!bounds && !!slide.targetId

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
      <TutBackdrop bounds={useSpotlight ? bounds : null} />

      {useSpotlight && bounds && (
        <div style={{
          position: 'fixed',
          left: bounds.left - 6,
          top: bounds.top - 6,
          width: bounds.width + 12,
          height: bounds.height + 12,
          border: `2px solid ${phaseColor}`,
          borderRadius: '8px',
          boxShadow: `0 0 0 4px ${phaseColor}22, 0 0 28px ${phaseColor}88`,
          pointerEvents: 'none',
          transition: 'left 0.22s ease, top 0.22s ease, width 0.22s ease, height 0.22s ease',
        }} />
      )}

      <TutDialog
        slide={slide}
        bounds={useSpotlight ? bounds : null}
        idx={idx}
        total={slides.length}
        phases={phases}
        phaseColor={phaseColor}
        isLast={isLast}
        onPrev={prev}
        onNext={next}
        onClose={handleClose}
        onJump={setIdx}
      />

      <style>{`@keyframes tut-in { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </div>
  )
}

function TutBackdrop({ bounds }: { bounds: DOMRect | null }) {
  if (!bounds) {
    return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(2px)' }} />
  }
  const cx = bounds.left + bounds.width / 2
  const cy = bounds.top + bounds.height / 2
  const rw = Math.max(140, bounds.width * 0.9)
  const rh = Math.max(60, bounds.height * 1.3)
  const mask = `radial-gradient(ellipse ${rw}px ${rh}px at ${cx}px ${cy}px, transparent 30%, rgba(0,0,0,0.88) 72%)`
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.88)',
      backdropFilter: 'blur(2px)',
      maskImage: mask,
      WebkitMaskImage: mask,
      transition: 'mask-image 0.22s, -webkit-mask-image 0.22s',
    }} />
  )
}

function TutDialog({
  slide, bounds, idx, total, phases, phaseColor, isLast,
  onPrev, onNext, onClose, onJump,
}: {
  slide: Slide
  bounds: DOMRect | null
  idx: number
  total: number
  phases: Phase[]
  phaseColor: string
  isLast: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onJump: (i: number) => void
}) {
  const width = slide.wide ? 640 : 360
  const pos = calcPosition(slide, bounds, width)

  return (
    <div key={idx} style={{ position: 'fixed', ...pos, width, zIndex: 301 }}>
      <div style={{
        maxHeight: '90vh',
        overflowY: 'auto',
        background: 'linear-gradient(160deg, #0D0D0D 0%, #060606 100%)',
        border: `1px solid ${phaseColor}55`,
        borderTop: `3px solid ${phaseColor}`,
        borderRadius: '10px',
        boxShadow: `0 32px 64px rgba(0,0,0,0.85), 0 0 40px ${phaseColor}18`,
        padding: slide.wide ? '24px 28px 20px' : '18px 20px 16px',
        animation: 'tut-in 0.22s ease-out',
      }}>
        <DialogHeader slide={slide} phaseColor={phaseColor} onClose={onClose}/>

        <div style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: slide.wide ? '22px' : '17px',
          fontWeight: 700, color: '#F0F0F0',
          lineHeight: 1.2, marginBottom: '10px',
          letterSpacing: '-0.01em',
        }}>{slide.title}</div>

        <div style={{ height: '1px', background: `linear-gradient(90deg, ${phaseColor}44, transparent)`, marginBottom: '12px' }} />

        <p style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: slide.wide ? '13.5px' : '12.5px',
          color: '#B0B0B0', lineHeight: 1.65,
          margin: 0,
        }}>{slide.body}</p>

        {/* Custom interactive blocks */}
        {slide.custom === 'causal-chain' && <CausalChainBlock/>}
        {slide.custom === 'animated-pnl' && <AnimatedPnLBlock/>}
        {slide.custom === 'trial-trade' && <TrialTradeBlock onComplete={onNext}/>}
        {slide.custom === 'cinematic' && <CinematicBlock onComplete={onNext}/>}

        {/* Bullets */}
        {slide.bullets && (
          <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {slide.bullets.map((b, i) => (
              <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <span style={{
                  flexShrink: 0, marginTop: '3px',
                  width: '14px', height: '14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${phaseColor}18`,
                  border: `1px solid ${phaseColor}44`,
                  borderRadius: '3px',
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '8px', fontWeight: 700, color: phaseColor,
                }}>{i + 1}</span>
                <span style={{
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '12px', color: '#909090', lineHeight: 1.55,
                }}>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Note */}
        {slide.note && (
          <div style={{
            marginTop: '14px', padding: '10px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderLeft: `3px solid ${phaseColor}88`,
            borderRadius: '4px',
          }}>
            <div style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '8px', fontWeight: 800,
              color: phaseColor, letterSpacing: '0.2em',
              textTransform: 'uppercase', marginBottom: '4px',
            }}>NOTE</div>
            <p style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontStyle: 'italic',
              fontSize: '12px', color: '#808080',
              lineHeight: 1.55, margin: 0,
            }}>{slide.note}</p>
          </div>
        )}

        {/* Inline quiz */}
        {slide.quiz && <QuizBlock quiz={slide.quiz} phaseColor={phaseColor} slideId={slide.id}/>}

        <NavigationFooter
          idx={idx}
          total={total}
          phases={phases}
          phaseColor={phaseColor}
          isLast={isLast}
          hideNext={slide.custom === 'trial-trade' || slide.custom === 'cinematic'}
          onPrev={onPrev}
          onNext={onNext}
          onJump={onJump}
        />

        {idx === 0 && (
          <div style={{
            marginTop: '10px', textAlign: 'center',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '9px', color: '#404040',
            letterSpacing: '0.12em',
          }}>
            ← → arrow keys or Enter to navigate · Esc to skip
          </div>
        )}
      </div>
    </div>
  )
}

function DialogHeader({ slide, phaseColor, onClose }: { slide: Slide; phaseColor: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '3px 8px',
        background: `${phaseColor}14`,
        border: `1px solid ${phaseColor}44`,
        borderRadius: '4px',
      }}>
        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: phaseColor }} />
        <span style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '9px', fontWeight: 800,
          color: phaseColor, letterSpacing: '0.22em', textTransform: 'uppercase',
        }}>{slide.phaseLabel}</span>
      </div>
      <button
        onClick={onClose}
        title="Skip walkthrough"
        style={{
          width: '22px', height: '22px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '4px', color: '#808080',
          cursor: 'pointer', flexShrink: 0,
        }}
      ><X size={11} /></button>
    </div>
  )
}

function QuizBlock({ quiz, phaseColor, slideId }: { quiz: Quiz; phaseColor: string; slideId: number }) {
  const [picked, setPicked] = useState<number | null>(null)
  const { track } = useTracer()
  const reveal = picked !== null
  const isCorrect = reveal && picked === quiz.correctIdx

  function pick(i: number) {
    if (picked !== null) return
    setPicked(i)
    track('tutorial_quiz_answered', 0, {
      slideId, pickedIdx: i, correct: i === quiz.correctIdx,
    })
  }

  return (
    <div style={{
      marginTop: '14px',
      padding: '14px 16px',
      background: 'rgba(0,0,0,0.4)',
      border: `1px dashed ${phaseColor}55`,
      borderRadius: '6px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        marginBottom: '10px',
      }}>
        <Check size={11} color={phaseColor}/>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '9px', fontWeight: 800, color: phaseColor,
          letterSpacing: '0.22em', textTransform: 'uppercase',
        }}>Quick Check</div>
      </div>

      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '12.5px', color: '#E0E0E0', fontWeight: 600,
        lineHeight: 1.55, marginBottom: '10px',
      }}>{quiz.question}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {quiz.options.map((opt, i) => {
          const isPick = picked === i
          const showCorrect = reveal && i === quiz.correctIdx
          const showWrong = reveal && isPick && i !== quiz.correctIdx
          const borderColor = showCorrect ? '#10B981' : showWrong ? '#FF1F1F' : 'rgba(255,255,255,0.10)'
          const bg = showCorrect ? 'rgba(16,185,129,0.08)' : showWrong ? 'rgba(255,31,31,0.08)' : 'rgba(0,0,0,0.4)'
          const labelColor = showCorrect ? '#10B981' : showWrong ? '#FF1F1F' : '#B0B0B0'
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={picked !== null}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '8px 10px',
                background: bg,
                border: `1px solid ${borderColor}`,
                borderRadius: '4px',
                cursor: picked === null ? 'pointer' : 'default',
                textAlign: 'left',
                transition: 'all 0.2s',
              }}
            >
              <span style={{
                flexShrink: 0,
                width: '16px', height: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: showCorrect ? '#10B981' : showWrong ? '#FF1F1F' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${borderColor}`,
                borderRadius: '3px',
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '8px', fontWeight: 800,
                color: showCorrect || showWrong ? '#000' : '#A0A0A0',
              }}>{showCorrect ? '✓' : showWrong ? '✕' : String.fromCharCode(65 + i)}</span>
              <span style={{
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '11.5px',
                color: labelColor,
                fontWeight: showCorrect || showWrong ? 600 : 400,
                lineHeight: 1.5,
              }}>{opt}</span>
            </button>
          )
        })}
      </div>

      {reveal && (
        <div style={{
          marginTop: '10px', padding: '8px 10px',
          background: isCorrect ? 'rgba(16,185,129,0.06)' : 'rgba(255,31,31,0.06)',
          border: `1px solid ${isCorrect ? '#10B98144' : '#FF1F1F44'}`,
          borderLeft: `3px solid ${isCorrect ? '#10B981' : '#FF1F1F'}`,
          borderRadius: '4px',
        }}>
          <div style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '8px', fontWeight: 800,
            color: isCorrect ? '#10B981' : '#FF1F1F',
            letterSpacing: '0.2em', textTransform: 'uppercase',
            marginBottom: '4px',
          }}>{isCorrect ? 'Correct' : 'Not quite'}</div>
          <p style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontSize: '11.5px', color: '#C0C0C0',
            lineHeight: 1.55, margin: 0,
          }}>{quiz.explanation}</p>
        </div>
      )}
    </div>
  )
}

function NavigationFooter({
  idx, total, phases, phaseColor, isLast, hideNext, onPrev, onNext, onJump,
}: {
  idx: number
  total: number
  phases: Phase[]
  phaseColor: string
  isLast: boolean
  hideNext: boolean
  onPrev: () => void
  onNext: () => void
  onJump: (i: number) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginTop: '16px', paddingTop: '12px',
      borderTop: '1px solid rgba(255,255,255,0.07)',
      gap: '10px',
    }}>
      <button
        onClick={onPrev}
        disabled={idx === 0}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '7px 12px',
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '5px',
          color: idx === 0 ? '#333' : '#707070',
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
          cursor: idx === 0 ? 'not-allowed' : 'pointer',
          opacity: idx === 0 ? 0.4 : 1,
        }}
      ><ChevronLeft size={12} /> Back</button>

      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center', flex: 1 }}>
        {phases.map((phase, i) => {
          const pc = PHASE_COLORS[phase]
          const active = i === idx
          return (
            <button
              key={i}
              onClick={() => onJump(i)}
              title={`Step ${i + 1}`}
              style={{
                width: active ? '16px' : '5px',
                height: '5px',
                borderRadius: '3px',
                background: active ? pc : i < idx ? `${pc}66` : 'rgba(255,255,255,0.12)',
                border: 'none', padding: 0, cursor: 'pointer',
                transition: 'width 0.2s, background 0.2s',
                boxShadow: active ? `0 0 6px ${pc}88` : 'none',
              }}
            />
          )
        })}
      </div>

      {!hideNext ? (
        <button
          onClick={onNext}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px',
            background: isLast
              ? 'linear-gradient(135deg, #10B981, #059669)'
              : `linear-gradient(135deg, ${phaseColor}, ${darken(phaseColor)})`,
            border: 'none',
            borderRadius: '5px',
            color: '#000',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '11px', fontWeight: 800,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            cursor: 'pointer',
            boxShadow: isLast ? '0 4px 14px rgba(16,185,129,0.5)' : `0 4px 14px ${phaseColor}55`,
            whiteSpace: 'nowrap',
          }}
        >
          {isLast ? <><Play size={12} /> Begin Trading</> : <>Next <ChevronRight size={12} /></>}
        </button>
      ) : (
        <span style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '9px', color: '#606060',
          letterSpacing: '0.16em', textTransform: 'uppercase',
        }}>Complete the section above</span>
      )}
    </div>
  )
}

function calcPosition(slide: Slide, bounds: DOMRect | null, width: number): React.CSSProperties {
  if (!bounds || slide.pos === 'center') {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  }
  const margin = 18
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const cy = bounds.top + bounds.height / 2
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  switch (slide.pos) {
    case 'below':
      return {
        left: `${clamp(bounds.left + bounds.width / 2 - width / 2, 12, vw - width - 12)}px`,
        top: `${Math.min(bounds.bottom + margin, vh - 200)}px`,
      }
    case 'above':
      return {
        left: `${clamp(bounds.left + bounds.width / 2 - width / 2, 12, vw - width - 12)}px`,
        bottom: `${Math.max(vh - bounds.top + margin, 12)}px`,
      }
    case 'left':
      if (bounds.left - margin - width > 0) {
        return { right: `${vw - bounds.left + margin}px`, top: `${clamp(cy - 100, 12, vh - 400)}px` }
      }
      return { left: `${bounds.right + margin}px`, top: `${clamp(cy - 100, 12, vh - 400)}px` }
    case 'right':
      if (bounds.right + margin + width < vw) {
        return { left: `${bounds.right + margin}px`, top: `${clamp(cy - 100, 12, vh - 400)}px` }
      }
      return { right: `${vw - bounds.left + margin}px`, top: `${clamp(cy - 100, 12, vh - 400)}px` }
    default:
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  }
}

function darken(hex: string): string {
  const map: Record<string, string> = {
    '#D4A04D': '#8B6520',
    '#3B82F6': '#1D4ED8',
    '#FF1F1F': '#8B0000',
    '#10B981': '#059669',
  }
  return map[hex] ?? hex
}
