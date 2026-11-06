'use client'

import { useEffect, useState } from 'react'
import { Play, Pause, FastForward, Check } from 'lucide-react'
import { useTracer } from '@/lib/behavior/tracer'

interface Beat {
  minute: number
  text: string
  trade?: { side: 'BUY' | 'SELL'; qty: number; price: number }
  flash?: 'circuit' | 'news'
}

const BEATS: Beat[] = [
  { minute: 0,  text: 'Bell rings. First thing — read the room. NIFTY −3%, BRENT −12%. Today is going to bleed.' },
  { minute: 3,  text: 'Rule one: never trade the first 5 minutes of a panic open. Liquidity is thin, fills are bad. I wait.' },
  { minute: 7,  text: 'Pharma is defensive in a pandemic narrative. SUNPHARMA is the largest. That is where I am looking.' },
  { minute: 12, text: 'SUNPHARMA dipped to ₹412, bouncing back. Support held — market doesn’t want lower here.' },
  { minute: 15, text: 'Entering. Buying 8 shares at ₹420. Setting SL at ₹408 — max loss ₹96. Risk first, always.', trade: { side: 'BUY', qty: 8, price: 420 } },
  { minute: 22, text: 'Up 0.7%. Patience. Most beginners exit on tiny wins — that is why they never make real money.' },
  { minute: 30, text: 'NIFTY hits −5%. Circuit breaker fires. Trading halts 15 minutes. New traders panic — I take a sip of water.', flash: 'circuit' },
  { minute: 38, text: 'During halts the temptation is to second-guess. The halt is by design — it cools panic. Stick to plan.' },
  { minute: 45, text: 'Trading resumed. SUNPHARMA holds ₹420. Pharma genuinely defensive even in this carnage.' },
  { minute: 55, text: 'Up to ₹426 — +1.4% on entry. Plenty would still hold. I am thinking: lock it in soon.' },
  { minute: 65, text: 'SUNPHARMA at ₹428. Selling 8 shares. Realising +₹64. Small win on a day NIFTY is down 5%.', trade: { side: 'SELL', qty: 8, price: 428 } },
  { minute: 70, text: 'Final state: +₹64 on a brutal day. Most retail traders are down ₹10,000. Survive bad days, prosper on good ones. Now your turn.' },
]

// SUNPHARMA price interpolated across beats — minute → close
const PRICE_TICKS: { minute: number; price: number }[] = [
  { minute: 0, price: 419 }, { minute: 5, price: 416 }, { minute: 10, price: 414 },
  { minute: 15, price: 420 }, { minute: 20, price: 423 }, { minute: 25, price: 421 },
  { minute: 30, price: 419 }, { minute: 45, price: 420 }, { minute: 50, price: 424 },
  { minute: 55, price: 426 }, { minute: 60, price: 428 }, { minute: 65, price: 427 },
  { minute: 70, price: 426 },
]

function priceAt(minute: number): number {
  for (let i = 0; i < PRICE_TICKS.length - 1; i++) {
    const a = PRICE_TICKS[i], b = PRICE_TICKS[i + 1]
    if (minute >= a.minute && minute < b.minute) {
      const t = (minute - a.minute) / (b.minute - a.minute)
      return a.price + (b.price - a.price) * t
    }
  }
  return PRICE_TICKS[PRICE_TICKS.length - 1].price
}

function fmtTime(minute: number): string {
  const total = 9 * 60 + 15 + Math.floor(minute)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')} IST`
}

const BEAT_HOLD_MS = 4500

interface Props {
  onComplete: () => void
}

export function CinematicBlock({ onComplete }: Props) {
  const { track } = useTracer()
  const [beatIdx, setBeatIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [trades, setTrades] = useState<Beat['trade'][]>([])

  // Fire once on mount
  useEffect(() => {
    track('cinematic_started', 0, { totalBeats: BEATS.length })
  }, [])

  const beat = BEATS[beatIdx]
  const isLast = beatIdx === BEATS.length - 1
  const minute = beat.minute
  const price = priceAt(minute)
  const pct = ((price - 419) / 419) * 100

  // Auto-advance
  useEffect(() => {
    if (!playing || isLast) return
    const t = setTimeout(() => setBeatIdx(i => Math.min(i + 1, BEATS.length - 1)), BEAT_HOLD_MS)
    return () => clearTimeout(t)
  }, [playing, beatIdx, isLast])

  // Record trade when a beat fires one
  useEffect(() => {
    if (beat.trade) {
      setTrades(prev => prev.some(t => t === beat.trade) ? prev : [...prev, beat.trade])
    }
  }, [beat])

  function skipToEnd() {
    track('cinematic_skipped', 0, { atBeat: beatIdx, totalBeats: BEATS.length })
    setBeatIdx(BEATS.length - 1)
    setPlaying(false)
    const allTrades = BEATS.filter(b => b.trade).map(b => b.trade)
    setTrades(allTrades)
  }

  function handleComplete() {
    track('cinematic_completed', 0, { totalBeats: BEATS.length })
    onComplete()
  }

  const realised = trades.reduce((acc, t) => {
    if (!t) return acc
    return t.side === 'SELL' ? acc + (t.price - 420) * t.qty : acc
  }, 0)

  return (
    <div style={{
      marginTop: '14px',
      padding: '16px 18px',
      background: 'linear-gradient(160deg, #1a1208 0%, #060606 100%)',
      border: '1px solid rgba(212,160,77,0.4)',
      borderRadius: '8px',
    }}>
      {/* Top strip: time + price + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '10px', color: '#D4A04D', fontWeight: 700,
          letterSpacing: '0.12em',
          padding: '4px 8px',
          background: 'rgba(212,160,77,0.1)',
          border: '1px solid rgba(212,160,77,0.4)',
          borderRadius: '4px',
        }}>{fmtTime(minute)}</div>
        <div style={{ flex: 1, fontFamily: 'var(--font-inter), sans-serif', fontSize: '10px', fontWeight: 700, color: '#808080', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          SUNPHARMA
          <span style={{ color: '#404040', margin: '0 6px' }}>·</span>
          <span style={{ color: pct >= 0 ? '#10B981' : '#FF1F1F', fontFamily: 'var(--font-jetbrains), monospace', letterSpacing: 0 }}>
            ₹{price.toFixed(0)} {pct >= 0 ? '▲ +' : '▼ '}{Math.abs(pct).toFixed(2)}%
          </span>
        </div>
        <button onClick={() => setPlaying(p => !p)} title={playing ? 'Pause' : 'Resume'} style={ctrlBtn(playing)}>
          {playing ? <Pause size={11}/> : <Play size={11}/>}
        </button>
        <button onClick={skipToEnd} disabled={isLast} title="Skip to end" style={{ ...ctrlBtn(false), opacity: isLast ? 0.4 : 1 }}>
          <FastForward size={11}/>
        </button>
      </div>

      {/* Sparkline-style mini chart */}
      <MiniChart minute={minute} flash={beat.flash}/>

      {/* Aarav narration */}
      <div style={{
        marginTop: '12px',
        padding: '12px 14px',
        background: 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(212,160,77,0.30)',
        borderLeft: '3px solid #D4A04D',
        borderRadius: '5px',
        minHeight: '78px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{
            width: '22px', height: '22px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(212,160,77,0.18)',
            border: '1px solid #D4A04D',
            borderRadius: '50%',
            fontFamily: 'var(--font-anton), sans-serif',
            fontSize: '10px', fontWeight: 800, color: '#D4A04D',
          }}>A</div>
          <span style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '8.5px', fontWeight: 800, color: '#D4A04D',
            letterSpacing: '0.22em', textTransform: 'uppercase',
          }}>Aarav · thinking aloud</span>
        </div>
        <p key={beatIdx} style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontStyle: 'italic',
          fontSize: '12.5px', color: '#E0E0E0',
          lineHeight: 1.6, margin: 0,
          animation: 'narr-fade 0.3s ease-out',
        }}>&ldquo;{beat.text}&rdquo;</p>
      </div>

      {/* Trades + progress strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
        <div style={{ flex: 1, fontFamily: 'var(--font-jetbrains), monospace', fontSize: '10px', color: '#A0A0A0' }}>
          {trades.length === 0 && <span style={{ color: '#606060', fontStyle: 'italic' }}>No trades yet · reading the room</span>}
          {trades.map((t, i) => t && (
            <span key={i} style={{ marginRight: '10px' }}>
              <span style={{ color: t.side === 'BUY' ? '#10B981' : '#FF1F1F', fontWeight: 700 }}>{t.side}</span> {t.qty} @ ₹{t.price}
            </span>
          ))}
          {realised !== 0 && (
            <span style={{ color: realised >= 0 ? '#10B981' : '#FF1F1F', fontWeight: 700, marginLeft: '6px' }}>
              · Realised {realised >= 0 ? '+' : ''}₹{realised}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '2px' }}>
          {BEATS.map((_, i) => (
            <div key={i} style={{
              width: i === beatIdx ? '12px' : '4px', height: '4px',
              background: i <= beatIdx ? '#D4A04D' : 'rgba(212,160,77,0.18)',
              borderRadius: '2px', transition: 'all 0.3s',
            }}/>
          ))}
        </div>
      </div>

      {/* Continue button — appears at end */}
      {isLast && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
          <button onClick={handleComplete} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 14px',
            background: 'linear-gradient(135deg, #10B981, #059669)',
            border: 'none', borderRadius: '5px', color: '#000',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '11px', fontWeight: 800, letterSpacing: '0.14em',
            textTransform: 'uppercase', cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(16,185,129,0.5)',
          }}>
            <Check size={12}/> Continue
          </button>
        </div>
      )}

      <style>{`@keyframes narr-fade { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </div>
  )
}

function ctrlBtn(active: boolean): React.CSSProperties {
  return {
    width: '24px', height: '24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? 'rgba(212,160,77,0.20)' : 'transparent',
    border: '1px solid rgba(212,160,77,0.4)',
    borderRadius: '4px', color: '#D4A04D',
    cursor: 'pointer',
  }
}

function MiniChart({ minute, flash }: { minute: number; flash?: Beat['flash'] }) {
  const W = 600, H = 80
  const pad = 4
  const visible = PRICE_TICKS.filter(t => t.minute <= minute)
  const minP = Math.min(...PRICE_TICKS.map(t => t.price)) - 1
  const maxP = Math.max(...PRICE_TICKS.map(t => t.price)) + 1
  const last = visible[visible.length - 1] ?? PRICE_TICKS[0]
  const xFor = (m: number) => pad + (m / 70) * (W - pad * 2)
  const yFor = (p: number) => pad + (1 - (p - minP) / (maxP - minP)) * (H - pad * 2)
  const path = visible.map((t, i) => `${i === 0 ? 'M' : 'L'} ${xFor(t.minute).toFixed(1)} ${yFor(t.price).toFixed(1)}`).join(' ')

  return (
    <div style={{
      position: 'relative',
      background: '#000',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '5px',
      overflow: 'hidden',
      height: `${H + 8}px`,
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <path d={path} fill="none" stroke="#D4A04D" strokeWidth="1.5"/>
        {/* Live price dot */}
        <circle cx={xFor(last.minute)} cy={yFor(last.price)} r="3" fill="#D4A04D"/>
        <circle cx={xFor(last.minute)} cy={yFor(last.price)} r="6" fill="#D4A04D" opacity="0.3"/>
      </svg>
      {flash === 'circuit' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,31,31,0.18)',
          backdropFilter: 'blur(2px)',
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px', fontWeight: 800, color: '#FF1F1F',
          letterSpacing: '0.2em', textTransform: 'uppercase',
        }}>⛔ CIRCUIT BREAKER · HALTED</div>
      )}
    </div>
  )
}
