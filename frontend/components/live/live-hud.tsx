'use client'

import { Pause, Play, ArrowLeft, BookOpen } from 'lucide-react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import { useEffect, useState } from 'react'

interface LiveHudProps {
  onExit: () => void
}


export function LiveHud({ onExit }: LiveHudProps) {
  const { state, dispatch, totalEquity, dayPnL, dayPnLPct, positionsValue, getIndexLatest, scenario, market, clock, money } = useLiveSession()
  const indexKeys = Object.keys(scenario.dataset.indices ?? {})

  const sessionPct = Math.min(1, state.currentMinute / market.sessionMinutes)
  const minutesLeft = Math.max(0, market.sessionMinutes - state.currentMinute)
  const hoursLeft = Math.floor(minutesLeft / 60)
  const minsLeft = minutesLeft % 60

  const isRunning = state.status === 'LIVE'
  const isPaused = state.status === 'PAUSED'
  const isHalted = state.status === 'HALTED'
  const isClosed = state.status === 'CLOSED'

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50,
      height: '64px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      padding: '0 16px',
      background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
      borderBottom: '1px solid rgba(255,31,31,0.32)',
      boxShadow: '0 8px 22px rgba(0,0,0,0.5)',
    }}>
      {/* Back */}
      <button
        onClick={onExit}
        title="Exit (forfeits session)"
        style={{
          background: 'rgba(255,31,31,0.08)',
          border: '1px solid rgba(212,160,77,0.3)',
          borderRadius: '6px',
          padding: '7px 10px',
          color: '#FF1F1F',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '6px',
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '11px', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase',
        }}
      ><ArrowLeft size={12}/> Exit</button>

      {/* ZDM monogram + LIVE label */}
      <div data-tut="hud-status" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          fontFamily: 'var(--font-anton), sans-serif',
          fontSize: '13px', letterSpacing: '0.18em',
          color: '#EF4444', fontWeight: 700,
          padding: '6px 10px',
          border: '1px solid #EF4444',
          borderRadius: '4px',
          boxShadow: '0 0 14px rgba(239,68,68,0.35)',
        }}>[ZDM]</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isClosed ? '#5C5849' : isHalted ? '#FF1F1F' : isRunning ? '#10B981' : '#A89A7E',
              boxShadow: !isClosed && !isPaused ? `0 0 8px ${isHalted ? '#FF1F1F' : '#10B981'}` : 'none',
              animation: isRunning ? 'live-pulse 1.4s ease-in-out infinite' : 'none',
            }}/>
            <span style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '11px', fontWeight: 700,
              color: isClosed ? '#5C5849' : isHalted ? '#FF1F1F' : '#EF4444',
              letterSpacing: '0.2em', textTransform: 'uppercase',
            }}>
              {isClosed ? 'CLOSED' : isHalted ? 'HALTED' : isPaused ? 'PAUSED' : 'LIVE'}
              <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 6px' }}>·</span>
              {state.scenarioId}
            </span>
          </div>
          <div style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: '10px', color: '#808080', letterSpacing: '0.06em',
          }}>
            {scenario.dateLabel} · {clock(state.currentMinute)} {market.tz}
          </div>
        </div>
      </div>

      {/* Indices ticker */}
      <div data-tut="hud-indices" style={{
        flex: 1,
        height: '40px',
        background: 'rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,31,31,0.20)',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        padding: '0 14px',
        overflow: 'hidden',
      }}>
        {indexKeys.map(k => {
          const ix = getIndexLatest(k)
          const up = ix.pctChange >= 0
          return (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px', whiteSpace: 'nowrap' }}>
              <span style={{
                fontFamily: 'var(--font-inter), sans-serif', fontSize: '9px',
                color: '#808080', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700,
              }}>{k}</span>
              <span style={{
                fontFamily: 'var(--font-jetbrains), monospace', fontSize: '12px',
                color: '#E0E0E0', fontWeight: 600,
              }}>
                {k === 'USDINR' ? `₹${ix.value.toFixed(2)}` :
                 k === 'BRENT' ? `$${ix.value.toFixed(2)}` :
                 k === 'GOLD' ? `₹${(ix.value/1000).toFixed(1)}K` :
                 ix.value.toLocaleString(market.locale, { maximumFractionDigits: 2 })}
              </span>
              <span style={{
                fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px',
                color: up ? '#00C853' : '#FF1F1F', fontWeight: 700,
              }}>
                {up ? '▲' : '▼'}{Math.abs(ix.pctChange).toFixed(2)}%
              </span>
            </span>
          )
        })}
      </div>

      {/* Session progress + clock */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px',
      }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '9px', color: '#404040', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700,
        }}>
          {isClosed ? 'BELL RUNG · DAY OVER' : `BELL IN ${hoursLeft}h ${minsLeft}m · SIM ${state.speed}×`}
        </div>
        <div style={{
          width: '180px', height: '4px',
          background: 'rgba(255,31,31,0.20)', borderRadius: '2px', overflow: 'hidden',
        }}>
          <div style={{
            width: `${sessionPct * 100}%`, height: '100%',
            background: 'linear-gradient(90deg, #FF1F1F, #C0344B)',
            transition: 'width 0.3s',
          }}/>
        </div>
      </div>

      {/* Speed selector */}
      <div data-tut="hud-speed" style={{
        display: 'flex', gap: '2px', padding: '3px',
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(212,160,77,0.2)',
        borderRadius: '6px',
      }}>
        {[1, 5, 10].map(s => (
          <button
            key={s}
            onClick={() => dispatch({ type: 'SET_SPEED', speed: s as 1 | 5 | 10 })}
            disabled={isClosed}
            style={{
              padding: '5px 10px',
              background: state.speed === s ? '#FF1F1F28' : 'transparent',
              border: 'none', borderRadius: '4px',
              color: state.speed === s ? '#FF1F1F' : '#A89A7E',
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
              cursor: isClosed ? 'not-allowed' : 'pointer',
              opacity: isClosed ? 0.5 : 1,
            }}
          >{s}×</button>
        ))}
      </div>

      {/* Pause / Play */}
      <button
        onClick={() => dispatch({ type: isRunning ? 'PAUSE' : 'RESUME' })}
        disabled={isClosed || isHalted}
        title={isRunning ? 'Pause' : 'Resume'}
        style={{
          padding: '7px 10px',
          background: isRunning ? 'rgba(255,31,31,0.20)' : 'rgba(90,176,136,0.14)',
          border: `1px solid ${isRunning ? '#FF1F1F' : '#00C853'}`,
          borderRadius: '6px',
          color: isRunning ? '#FF1F1F' : '#00C853',
          cursor: isClosed || isHalted ? 'not-allowed' : 'pointer',
          opacity: isClosed || isHalted ? 0.5 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isRunning ? <Pause size={14}/> : <Play size={14}/>}
      </button>

      {/* WALLET pill — cash on hand */}
      <div data-tut="hud-wallet" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px',
        padding: '6px 12px',
        background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
        border: '1px solid rgba(255,31,31,0.32)',
        borderRadius: '8px',
      }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif', fontSize: '9px',
          color: '#FF1F1F', letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
        }}>Wallet · Cash</div>
        <div style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '15px', fontWeight: 700, color: '#E0E0E0',
        }}>{money(state.cash)}</div>
        <div style={{
          fontFamily: 'var(--font-jetbrains), monospace', fontSize: '9px',
          color: '#808080', letterSpacing: '0.04em',
        }}>
          + {money(positionsValue)} in stocks
        </div>
      </div>

      {/* PORTFOLIO pill — total value + day P&L */}
      <div data-tut="hud-portfolio" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px',
        padding: '6px 14px',
        background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
        border: `1px solid ${dayPnL >= 0 ? '#00C853' : '#FF1F1F'}`,
        borderRadius: '8px',
        boxShadow: `0 0 14px ${dayPnL >= 0 ? '#00C853' : '#FF1F1F'}28`,
      }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif', fontSize: '9px',
          color: dayPnL >= 0 ? '#00C853' : '#FF1F1F',
          letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
        }}>Portfolio · Total</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: '17px', fontWeight: 700, color: '#E0E0E0',
          }}>{money(totalEquity)}</span>
        </div>
        <div style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '11px', fontWeight: 700,
          color: dayPnL >= 0 ? '#00C853' : '#FF1F1F',
          letterSpacing: '0.04em',
        }}>
          {dayPnL >= 0 ? '▲ +' : '▼ '}{money(Math.abs(dayPnL))} · {dayPnL >= 0 ? '+' : ''}{dayPnLPct.toFixed(2)}%
        </div>
      </div>

      <style>{`
        @keyframes live-pulse {
          0%   { transform: scale(1);   opacity: 1; }
          50%  { transform: scale(1.4); opacity: 0.6; }
          100% { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export function ClockReadout() {
  const { state, clock } = useLiveSession()
  const [_, force] = useState(0)
  // Force a tick on the visible second
  useEffect(() => {
    const i = setInterval(() => force(x => x + 1), 1000)
    return () => clearInterval(i)
  }, [])
  return <span>{clock(state.currentMinute)}</span>
}

// unused-import noinspection
void BookOpen
