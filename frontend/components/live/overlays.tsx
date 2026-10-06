'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertTriangle, ChevronRight, Info } from 'lucide-react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import { useTracer } from '@/lib/behavior/tracer'
import type { NewsEvent } from '@/types/live'

// ─── News drop overlay ─────────────────────────────────────

export function NewsDropOverlay() {
  const { state, scenario, clock, market } = useLiveSession()
  const { track } = useTracer()
  const [visible, setVisible] = useState<NewsEvent | null>(null)
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())

  useEffect(() => {
    // Find a critical/high signal news that just fired this minute and we haven\'t shown
    const justFired = scenario.dataset.news.find(n =>
      n.fireAt === state.currentMinute &&
      n.classification === 'signal' &&
      (n.severity === 'critical' || n.severity === 'high') &&
      !acknowledged.has(n.id),
    )
    if (justFired) {
      setVisible(justFired)
      // Showing the overlay = the user has seen this headline (full-screen modal)
      track('news_viewed', state.currentMinute, {
        newsId: justFired.id,
        classification: justFired.classification,
        severity: justFired.severity,
        via: 'overlay',
      })
      const t = setTimeout(() => {
        setVisible(null)
      }, 6500)
      return () => clearTimeout(t)
    }
  }, [state.currentMinute, acknowledged, track])

  function handleClose() {
    if (visible) setAcknowledged(prev => new Set(prev).add(visible.id))
    setVisible(null)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -50, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -50, scale: 0.96 }}
          transition={{ type: 'spring', damping: 26, stiffness: 280 }}
          style={{
            position: 'fixed',
            top: '88px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(640px, 90vw)',
            background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
            border: `2px solid ${visible.severity === 'critical' ? '#FF1F1F' : '#FF1F1F'}`,
            borderRadius: '10px',
            boxShadow: `0 16px 38px rgba(0,0,0,0.7), 0 0 36px ${visible.severity === 'critical' ? 'rgba(168,85,247,0.4)' : 'rgba(224,74,74,0.4)'}`,
            zIndex: 90,
            padding: '18px 22px',
            display: 'flex',
            gap: '14px',
            alignItems: 'flex-start',
          }}
        >
          <div style={{
            width: '44px', height: '44px',
            borderRadius: '8px',
            background: `${visible.severity === 'critical' ? '#FF1F1F' : '#FF1F1F'}1A`,
            border: `1px solid ${visible.severity === 'critical' ? '#FF1F1F' : '#FF1F1F'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '24px',
            flexShrink: 0,
          }}>
            {visible.flag}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: '6px',
            }}>
              <span style={{
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '9px', fontWeight: 700,
                color: visible.severity === 'critical' ? '#FF1F1F' : '#FF1F1F',
                letterSpacing: '0.22em', textTransform: 'uppercase',
              }}>
                {visible.severity} · SIGNAL · {clock(visible.fireAt)} {market.tz}
              </span>
              <span style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '10px', color: '#404040',
                letterSpacing: '0.06em',
              }}>{visible.source}</span>
            </div>
            <div style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontWeight: 600, fontSize: '17px',
              color: '#E0E0E0', lineHeight: 1.35,
            }}>
              {visible.headline}
            </div>
            {visible.impacts && visible.impacts.length > 0 && (
              <div style={{
                marginTop: '10px',
                display: 'flex', flexWrap: 'wrap', gap: '6px',
              }}>
                {visible.impacts.map(im => (
                  <span key={im.symbol} style={{
                    padding: '3px 8px',
                    background: im.pctImpact >= 0 ? 'rgba(90,176,136,0.14)' : 'rgba(224,74,74,0.14)',
                    border: `1px solid ${im.pctImpact >= 0 ? '#00C853' : '#FF1F1F'}80`,
                    borderRadius: '4px',
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: '10px', fontWeight: 700,
                    color: im.pctImpact >= 0 ? '#00C853' : '#FF1F1F',
                    letterSpacing: '0.06em',
                  }}>
                    {im.symbol} {im.pctImpact >= 0 ? '▲' : '▼'} {Math.abs(im.pctImpact * 100).toFixed(1)}%
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleClose} style={{
            width: '24px', height: '24px',
            background: 'rgba(212,160,77,0.06)',
            border: '1px solid rgba(212,160,77,0.3)',
            borderRadius: '5px',
            color: '#808080',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}><X size={12}/></button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Circuit breaker BANNER (non-blocking, sits below HUD) ─────────

export function CircuitBreakerOverlay() {
  const { state, dispatch, clock, market } = useLiveSession()
  const halt = state.currentHalt
  if (!halt) return null

  const remaining = Math.max(0, halt.endsAtMin - state.currentMinute)

  return (
    <div style={{
      position: 'sticky',
      top: '64px',
      zIndex: 40,
      width: '100%',
      padding: '8px 18px',
      background: 'linear-gradient(90deg, rgba(255,184,48,0.15), rgba(255,184,48,0.06) 60%, rgba(255,184,48,0.15))',
      borderBottom: '1px solid rgba(255,184,48,0.6)',
      borderTop: '1px solid rgba(255,184,48,0.4)',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
    }}>
      <AlertTriangle size={16} color="#FFB830" strokeWidth={2.4}/>
      <span style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '11px', fontWeight: 700, color: '#FF1F1F',
        letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>
        Trading Halted
      </span>
      <span style={{
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: '12px', color: '#E0E0E0', fontWeight: 600,
      }}>
        NIFTY 50 · ▼{halt.level}% · resumes {clock(halt.endsAtMin)} {market.tz}
      </span>
      <div style={{ flex: 1 }}/>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '4px 10px',
        background: 'rgba(255,184,48,0.18)',
        border: '1px solid #FFB830',
        borderRadius: '4px',
      }}>
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: '#FF1F1F', boxShadow: '0 0 6px #FFB830',
          animation: 'pulse 1.4s ease-in-out infinite',
        }}/>
        <span style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '12px', fontWeight: 700, color: '#FF1F1F',
          letterSpacing: '0.04em',
        }}>
          {remaining} MIN REMAINING
        </span>
      </div>
      <span style={{
        fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
        fontSize: '12px', color: '#808080',
      }}>
        ORUS: when you come back, every screen will be redder than now.
      </span>
      <button
        onClick={() => dispatch({ type: 'SKIP_HALT' })}
        title="Skip the halt — resumes immediately at post-halt prices"
        style={{
          padding: '5px 12px',
          background: 'rgba(255,184,48,0.18)',
          border: '1px solid #FFB830',
          borderRadius: '4px',
          color: '#FF1F1F',
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em',
          textTransform: 'uppercase', cursor: 'pointer',
          flexShrink: 0,
        }}
      >Skip Halt →</button>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.5); opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

// ─── End of day modal ──────────────────────────────────────

export function EndOfDayModal({ onContinue }: { onContinue: () => void }) {
  const { state, totalEquity, dayPnL, dayPnLPct, scenario, market, clock, money } = useLiveSession()
  const isClosed = state.status === 'CLOSED'
  if (!isClosed) return null

  const tradesPlaced = state.orders.filter(o => o.status === 'FILLED').length
  const profitTrades = state.orders.filter(o => {
    if (o.status !== 'FILLED' || o.side !== 'SELL') return false
    return true
  })
  const winRate = profitTrades.length > 0 ? Math.round((state.realisedPnL > 0 ? 1 : 0) * 100) : 0
  const niftyChange = -5.4

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 95,
          background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <motion.div
          initial={{ y: 24, scale: 0.96 }}
          animate={{ y: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 28 }}
          style={{
            width: 'min(560px, 92vw)',
            padding: '32px',
            background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
            border: `2px solid ${dayPnL >= 0 ? '#00C853' : '#FF1F1F'}`,
            borderRadius: '12px',
            boxShadow: `0 30px 80px rgba(0,0,0,0.8), 0 0 50px ${dayPnL >= 0 ? 'rgba(90,176,136,0.4)' : 'rgba(224,74,74,0.4)'}`,
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '11px', fontWeight: 700, color: '#FF1F1F',
              letterSpacing: '0.32em', textTransform: 'uppercase', marginBottom: '8px',
            }}>✦ Trading Day Complete ✦</div>
            <div style={{
              fontFamily: 'var(--font-fraunces), serif', fontWeight: 700,
              fontSize: '28px', color: '#E0E0E0', letterSpacing: '0.04em',
            }}>{scenario.dateLabel} · Bell Rung at {clock(market.sessionMinutes)} {market.tz}</div>
          </div>

          <div style={{
            padding: '18px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(212,160,77,0.18)',
            borderRadius: '8px',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px',
            marginBottom: '20px',
          }}>
            <Stat label="Starting" value={money(totalEquity - dayPnL)}/>
            <Stat label="Closing" value={money(totalEquity)}/>
            <Stat label="Day P&L" value={`${dayPnL >= 0 ? '+' : ''}${money(dayPnL)}`} color={dayPnL >= 0 ? '#00C853' : '#FF1F1F'}/>
            <Stat label="Return" value={`${dayPnL >= 0 ? '+' : ''}${dayPnLPct.toFixed(2)}%`} color={dayPnL >= 0 ? '#00C853' : '#FF1F1F'}/>
            <Stat label="Trades" value={`${tradesPlaced}`}/>
            <Stat label="Realised" value={`${state.realisedPnL >= 0 ? '+' : ''}${money(state.realisedPnL)}`} color={state.realisedPnL >= 0 ? '#00C853' : '#FF1F1F'}/>
          </div>

          <div style={{
            padding: '14px 18px',
            background: dayPnLPct > niftyChange ? 'rgba(90,176,136,0.10)' : 'rgba(224,74,74,0.10)',
            border: `1px solid ${dayPnLPct > niftyChange ? '#00C853' : '#FF1F1F'}66`,
            borderRadius: '6px',
            fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
            fontSize: '14px', color: '#C0C0C0', lineHeight: 1.5,
            marginBottom: '20px',
          }}>
            The market beat: NIFTY closed {niftyChange.toFixed(1)}% today.<br/>
            You closed {dayPnLPct >= 0 ? '+' : ''}{dayPnLPct.toFixed(2)}%.
            {dayPnLPct > niftyChange
              ? ` You outperformed the index by ${(dayPnLPct - niftyChange).toFixed(1)}% — well played.`
              : ` You underperformed the index by ${(niftyChange - dayPnLPct).toFixed(1)}% — review the journal.`}
          </div>

          <button onClick={onContinue} style={{
            width: '100%',
            padding: '14px 22px',
            background: 'linear-gradient(180deg, #C0344B, #8B2545)',
            border: '1px solid #D4A04D', borderRadius: '8px',
            color: '#E0E0E0',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '13px', fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', cursor: 'pointer',
            boxShadow: '0 8px 22px rgba(139,37,69,0.5), 0 0 22px rgba(212,160,77,0.2), inset 0 1px 0 rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
          }}>
            Continue to Debrief <ChevronRight size={16}/>
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '9px', fontWeight: 700, color: '#404040',
        letterSpacing: '0.18em', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: '17px', fontWeight: 700,
        color: color ?? '#E0E0E0',
        marginTop: '2px',
      }}>{value}</div>
    </div>
  )
}

// ─── Order-type coach modal ────────────────────────────────

export function OrderTypeCoach({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 92,
            background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={onClose}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: 'min(520px, 92vw)',
            padding: '24px 26px',
            background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
            border: '1px solid #06B6D4',
            borderRadius: '10px',
            boxShadow: '0 24px 50px rgba(0,0,0,0.7), 0 0 30px rgba(6,182,212,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <Info size={18} color="#06B6D4"/>
              <div>
                <div style={{
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '10px', fontWeight: 700, color: '#00C853',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                }}>First buy · ORUS coach</div>
                <div style={{
                  fontFamily: 'var(--font-fraunces), serif', fontWeight: 700,
                  fontSize: '20px', color: '#E0E0E0', marginTop: '2px',
                }}>How do you want to buy?</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { name: 'MARKET', desc: 'Buy NOW at whatever price the screen shows.', use: 'You want certainty of getting in.', risk: 'You may pay above the LTP shown.', color: '#00C853' },
                { name: 'LIMIT', desc: 'Set a price you\'re willing to pay. Wait.', use: 'You have time, want a better price.', risk: 'Order may never fill.', color: '#FF1F1F' },
                { name: 'SL', desc: 'If price falls below X, sell automatically.', use: 'You want to cap your downside.', risk: 'Gap-down skips your stop.', color: '#FF1F1F' },
                { name: 'SL-M', desc: 'Same as SL but exits at market when triggered.', use: 'You must exit, can\'t risk slippage.', risk: 'Slippage in fast-moving markets.', color: '#FF1F1F' },
              ].map(t => (
                <div key={t.name} style={{
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${t.color}40`,
                  borderLeft: `3px solid ${t.color}`,
                  borderRadius: '5px',
                }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '13px', fontWeight: 700, color: t.color, letterSpacing: '0.06em', marginBottom: '4px' }}>
                    {t.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '12.5px', color: '#C0C0C0', lineHeight: 1.45, marginBottom: '4px' }}>
                    {t.desc}
                  </div>
                  <div style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '10px', color: '#808080' }}>
                    Use when: <span style={{ color: '#E0E0E0' }}>{t.use}</span> · Risk: <span style={{ color: '#FF1F1F' }}>{t.risk}</span>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={onClose} style={{
              marginTop: '16px', width: '100%',
              padding: '12px',
              background: 'linear-gradient(180deg, #06B6D4, #0E7490)',
              border: '1px solid #06B6D4', borderRadius: '6px',
              color: '#0B0F15',
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase', cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(6,182,212,0.4)',
            }}>Got It · Place My Order</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Position-sizing coach modal ───────────────────────────

export function SizingCoach({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 92,
            background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={onClose}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: 'min(480px, 92vw)',
            padding: '24px 26px',
            background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
            border: '2px solid #FFB830',
            borderRadius: '10px',
            boxShadow: '0 24px 50px rgba(0,0,0,0.7), 0 0 30px rgba(255,184,48,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <AlertTriangle size={18} color="#FFB830"/>
              <div style={{
                fontFamily: 'var(--font-fraunces), serif', fontWeight: 700,
                fontSize: '20px', color: '#E0E0E0',
              }}>Position-sizing warning</div>
            </div>
            <p style={{
              fontFamily: 'var(--font-fraunces), serif', fontSize: '14px',
              color: '#C0C0C0', lineHeight: 1.55, margin: '0 0 12px',
            }}>
              You're putting more than <strong style={{ color: '#FF1F1F' }}>40% of your wallet</strong> into one trade.
              Pros size at <strong>2–5% per position</strong> so a single loser can\'t end them.
            </p>
            <p style={{
              fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
              fontSize: '13px', color: '#808080', lineHeight: 1.5, margin: '0 0 18px',
            }}>
              Why: even great traders are wrong 40% of the time. If one bad trade can wipe 40% of your account, three bad trades end you.
            </p>
            <button onClick={onClose} style={{
              width: '100%', padding: '12px',
              background: 'linear-gradient(180deg, #FFB830, #B07F32)',
              border: '1px solid #FFB830', borderRadius: '6px',
              color: '#0B0F15',
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase', cursor: 'pointer',
            }}>I Understand · Place Order Anyway</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
