'use client'

import { useEffect, useState } from 'react'
import { Eye, Briefcase, FileText, Newspaper, BookOpen } from 'lucide-react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import { useTracer } from '@/lib/behavior/tracer'

const SECTOR_COLOR: Record<string, string> = {
  airlines: '#3B82F6', pharma: '#10B981', energy: '#E11D48',
  banking: '#06B6D4', luxury: '#FF1F1F', it: '#14B8A6',
}
const SYMBOL_SECTOR: Record<string, keyof typeof SECTOR_COLOR> = {
  INDIGO: 'airlines', SUNPHARMA: 'pharma', RELIANCE: 'energy',
  HDFCBANK: 'banking', TITAN: 'luxury', TCS: 'it',
}

type Tab = 'watch' | 'positions' | 'orders' | 'news' | 'coach'

export function RightRail() {
  const [tab, setTab] = useState<Tab>('watch')
  const { track } = useTracer()
  const { state } = useLiveSession()

  function selectTab(next: Tab) {
    if (next === tab) return
    track('tab_switched', state.currentMinute, { from: tab, to: next })
    setTab(next)
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'watch',     label: 'Watch',     icon: Eye },
    { key: 'positions', label: 'Positions', icon: Briefcase },
    { key: 'orders',    label: 'Orders',    icon: FileText },
    { key: 'news',      label: 'News',      icon: Newspaper },
    { key: 'coach',     label: 'Coach',     icon: BookOpen },
  ]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100%', height: '100%',
      background: 'linear-gradient(180deg, #050505 0%, #000000 100%)',
      borderLeft: '1px solid rgba(255,31,31,0.32)',
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div data-tut="rail-tabs" style={{
        display: 'flex', borderBottom: '1px solid rgba(255,31,31,0.32)',
        background: 'rgba(0,0,0,0.3)',
      }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                padding: '10px 6px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? '#FF1F1F' : 'transparent'}`,
                color: active ? '#E0E0E0' : '#707070',
                cursor: 'pointer',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '9px', fontWeight: 700,
                letterSpacing: '0.16em', textTransform: 'uppercase',
              }}
            >
              <Icon size={14} strokeWidth={2}/>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Body */}
      <div data-tut="rail-watchlist" style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'watch'     && <WatchPanel />}
        {tab === 'positions' && <PositionsPanel />}
        {tab === 'orders'    && <OrdersPanel />}
        {tab === 'news'      && <NewsPanel />}
        {tab === 'coach'     && <CoachPanel />}
      </div>
    </div>
  )
}

// ─── Watch ─────────────────────────────────────────────────

function WatchPanel() {
  const { state, dispatch, ltp, prevClose, pctChange, symbols, market } = useLiveSession()
  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Header>Watchlist · {symbols.length}</Header>
      {symbols.map(sym => {
        const accent = SECTOR_COLOR[SYMBOL_SECTOR[sym]]
        const price = ltp(sym)
        const pct = pctChange(sym)
        const isDown = pct < 0
        const isActive = state.activeSymbol === sym
        return (
          <button
            key={sym}
            onClick={() => dispatch({ type: 'SET_ACTIVE', symbol: sym })}
            style={{
              position: 'relative',
              display: 'grid', gridTemplateColumns: '1fr auto',
              gap: '4px', alignItems: 'baseline',
              padding: '10px 12px',
              background: isActive ? 'rgba(255,31,31,0.16)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isActive ? '#FF1F1F' : 'rgba(255,31,31,0.16)'}`,
              borderRadius: '6px',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            {isActive && (
              <span style={{
                position: 'absolute', left: '-1px', top: '8px', bottom: '8px',
                width: '3px', background: accent, borderRadius: '2px',
                boxShadow: `0 0 8px ${accent}`,
              }}/>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: accent }}/>
              <span style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: '13px', color: '#E0E0E0' }}>{sym}</span>
            </div>
            <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '12px', color: '#E0E0E0', fontWeight: 600 }}>
              {market.currencySymbol}{price.toFixed(2)}
            </span>
            <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '9px', color: '#404040', letterSpacing: '0.06em' }}>
              prev {market.currencySymbol}{prevClose(sym).toFixed(2)}
            </span>
            <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', color: isDown ? '#FF1F1F' : '#00C853', fontWeight: 700 }}>
              {isDown ? '▼' : '▲'}{Math.abs(pct).toFixed(2)}%
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Positions ─────────────────────────────────────────────

function PositionsPanel() {
  const { state, dispatch, ltp, marginUsed, positionsValue, market } = useLiveSession()
  const positions = Object.values(state.positions)
  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Header>Positions · {positions.length} open</Header>

      <div style={{
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,31,31,0.20)',
        borderRadius: '6px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px',
      }}>
        <KV label="Holdings" value={`${market.currencySymbol}${positionsValue.toFixed(0)}`}/>
        <KV label="Margin" value={`${market.currencySymbol}${marginUsed.toFixed(0)}`}/>
        <KV label="Cash free" value={`${market.currencySymbol}${state.cash.toFixed(0)}`}/>
        <KV label="Realised P&L" value={`${state.realisedPnL >= 0 ? '+' : ''}${market.currencySymbol}${state.realisedPnL.toFixed(0)}`} color={state.realisedPnL >= 0 ? '#00C853' : '#FF1F1F'}/>
      </div>

      {positions.length === 0 && (
        <div style={{
          padding: '24px 12px', textAlign: 'center',
          fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
          fontSize: '13px', color: '#404040',
        }}>
          No open positions yet.<br/>
          <span style={{ fontSize: '11px' }}>Use the Order Ticket below to BUY a stock.</span>
        </div>
      )}

      {positions.map(p => {
        const accent = SECTOR_COLOR[SYMBOL_SECTOR[p.symbol]]
        const last = ltp(p.symbol)
        const pnl = (last - p.avgPrice) * p.qty
        const pnlPct = ((last - p.avgPrice) / p.avgPrice) * 100
        const isProfit = pnl >= 0
        return (
          <div key={p.symbol} style={{
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.025)',
            border: `1px solid ${isProfit ? '#00C853' : '#FF1F1F'}40`,
            borderLeft: `3px solid ${accent}`,
            borderRadius: '6px',
            display: 'flex', flexDirection: 'column', gap: '6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: '14px', color: '#E0E0E0' }}>
                {p.symbol} <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', color: '#808080' }}>· {p.qty}</span>
              </span>
              <span style={{
                fontFamily: 'var(--font-jetbrains), monospace', fontSize: '13px', fontWeight: 700,
                color: isProfit ? '#00C853' : '#FF1F1F',
              }}>
                {isProfit ? '+' : ''}{market.currencySymbol}{Math.abs(pnl).toFixed(0)} ({isProfit ? '+' : ''}{pnlPct.toFixed(2)}%)
              </span>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px',
              fontFamily: 'var(--font-jetbrains), monospace', fontSize: '10px', color: '#808080',
            }}>
              <span>Avg {market.currencySymbol}{p.avgPrice.toFixed(2)}</span>
              <span style={{ textAlign: 'center' }}>LTP {market.currencySymbol}{last.toFixed(2)}</span>
              <span style={{ textAlign: 'right' }}>{p.stopPrice ? `SL ${market.currencySymbol}${p.stopPrice.toFixed(2)}` : 'No SL'}</span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => dispatch({ type: 'PLACE_ORDER', order: {
                  symbol: p.symbol, side: 'SELL', type: 'MARKET', validity: 'DAY', quantity: p.qty,
                }})}
                style={{
                  flex: 1, padding: '6px 10px',
                  background: 'rgba(224,74,74,0.12)',
                  border: '1px solid #E04A4A', borderRadius: '4px',
                  color: '#FF1F1F',
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em',
                  textTransform: 'uppercase', cursor: 'pointer',
                }}
              >Exit Position</button>
              <button
                onClick={() => {
                  const newSL = p.stopPrice ? null : Math.round(p.avgPrice * 0.97 * 100) / 100
                  dispatch({ type: 'SET_STOP', symbol: p.symbol, stopPrice: newSL })
                }}
                style={{
                  flex: 1, padding: '6px 10px',
                  background: p.stopPrice ? 'rgba(255,184,48,0.14)' : 'rgba(255,31,31,0.16)',
                  border: `1px solid ${p.stopPrice ? '#FF1F1F' : '#FF1F1F'}`,
                  borderRadius: '4px',
                  color: p.stopPrice ? '#FF1F1F' : '#FF1F1F',
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em',
                  textTransform: 'uppercase', cursor: 'pointer',
                }}
              >{p.stopPrice ? 'Remove SL' : 'Set SL -3%'}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Orders ────────────────────────────────────────────────

function OrdersPanel() {
  const { state, dispatch } = useLiveSession()
  const pending = state.orders.filter(o => o.status === 'PENDING')
  const filled  = state.orders.filter(o => o.status === 'FILLED')
  const cancelled = state.orders.filter(o => o.status === 'CANCELLED' || o.status === 'REJECTED')

  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Header>Orders · {state.orders.length}</Header>

      {pending.length > 0 && <SubLabel>Pending · {pending.length}</SubLabel>}
      {pending.map(o => (
        <OrderRow key={o.id} order={o} onCancel={() => dispatch({ type: 'CANCEL_ORDER', id: o.id })}/>
      ))}

      {filled.length > 0 && <SubLabel>Filled · {filled.length}</SubLabel>}
      {filled.map(o => <OrderRow key={o.id} order={o}/>)}

      {cancelled.length > 0 && <SubLabel>Cancelled / Rejected · {cancelled.length}</SubLabel>}
      {cancelled.map(o => <OrderRow key={o.id} order={o}/>)}

      {state.orders.length === 0 && (
        <div style={{
          padding: '24px 12px', textAlign: 'center',
          fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
          fontSize: '13px', color: '#404040',
        }}>
          No orders placed yet.
        </div>
      )}
    </div>
  )
}

function OrderRow({ order, onCancel }: { order: ReturnType<typeof useLiveSession>['state']['orders'][number]; onCancel?: () => void }) {
  const { market, clock } = useLiveSession()
  const isBuy = order.side === 'BUY'
  const c = order.status === 'FILLED' ? (isBuy ? '#00C853' : '#FF1F1F')
    : order.status === 'PENDING' ? '#FF1F1F'
    : '#404040'
  return (
    <div style={{
      padding: '8px 10px',
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${c}40`,
      borderLeft: `3px solid ${c}`,
      borderRadius: '5px',
      display: 'flex', flexDirection: 'column', gap: '4px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', fontWeight: 700,
          color: c, letterSpacing: '0.06em',
        }}>
          {order.side} {order.symbol} · {order.quantity} @ {order.type}
          {order.price ? ` ${market.currencySymbol}${order.price}` : ''}
        </span>
        <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '9px', color: '#404040' }}>
          {clock(order.placedAtMin)}
        </span>
      </div>
      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '10px', color: '#808080',
      }}>
        {order.status === 'FILLED' ? `Filled @ ${market.currencySymbol}${order.filledPrice?.toFixed(2)} · ${clock(order.filledAtMin ?? 0)}` :
         order.status === 'PENDING' ? 'Waiting…' :
         order.reason ?? order.status}
      </div>
      {onCancel && (
        <button onClick={onCancel} style={{
          padding: '4px 8px', alignSelf: 'flex-start',
          background: 'transparent',
          border: '1px solid rgba(224,74,74,0.5)',
          borderRadius: '3px',
          color: '#FF1F1F',
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', cursor: 'pointer',
        }}>Cancel</button>
      )}
    </div>
  )
}

// ─── News ──────────────────────────────────────────────────

function NewsPanel() {
  const { pendingNews, state, clock, market } = useLiveSession()
  const { events, track } = useTracer()
  const news = pendingNews().slice().reverse()
  const signals = news.filter(n => n.classification === 'signal')
  const noise = news.filter(n => n.classification === 'noise')

  // Emit news_viewed once per session per id — dedup against the existing trace
  // so re-mounting the panel (tab switching) does not re-emit.
  useEffect(() => {
    const alreadyViewed = new Set(
      events
        .filter(e => e.kind === 'news_viewed')
        .map(e => (e.data as { newsId?: string } | undefined)?.newsId)
        .filter(Boolean) as string[],
    )
    const visible = [...signals.slice(0, 8), ...noise.slice(0, 6)]
    for (const n of visible) {
      if (!alreadyViewed.has(n.id)) {
        track('news_viewed', state.currentMinute, {
          newsId: n.id,
          classification: n.classification,
          severity: (n as { severity?: string }).severity,
          via: 'rail',
        })
      }
    }
  }, [signals.length, noise.length, state.currentMinute, events, track])

  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <Header>News · live wire</Header>

      <div style={{
        padding: '8px 10px',
        background: 'rgba(90,176,136,0.06)',
        border: '1px solid #5AB08840',
        borderRadius: '5px',
      }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px', fontWeight: 700, color: '#00C853',
          letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '6px',
        }}>SIGNAL · {signals.length}</div>
        <div style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '10px', color: '#808080', fontStyle: 'italic', marginBottom: '8px' }}>
          These move prices. React to these.
        </div>
        {signals.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '11px', color: '#404040' }}>
            No signal events yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {signals.slice(0, 8).map(n => <NewsRow key={n.id} item={n}/>)}
          </div>
        )}
      </div>

      <div style={{
        padding: '8px 10px',
        background: 'rgba(168,154,126,0.06)',
        border: '1px solid #A89A7E40',
        borderRadius: '5px',
      }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px', fontWeight: 700, color: '#808080',
          letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '6px',
        }}>NOISE · {noise.length}</div>
        <div style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '10px', color: '#404040', fontStyle: 'italic', marginBottom: '8px' }}>
          Already priced in or speculative. Don\'t react.
        </div>
        {noise.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '11px', color: '#404040' }}>
            No noise yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {noise.slice(0, 6).map(n => <NewsRow key={n.id} item={n} muted/>)}
          </div>
        )}
      </div>

      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '9px', color: '#404040',
        letterSpacing: '0.12em', textAlign: 'center',
        marginTop: '4px',
      }}>
        Session minute: {clock(state.currentMinute)} {market.tz}
      </div>
    </div>
  )
}

function NewsRow({ item, muted }: { item: ReturnType<typeof useLiveSession>['pendingNews'] extends () => infer R ? (R extends Array<infer U> ? U : never) : never; muted?: boolean }) {
  const { clock } = useLiveSession()
  const sevColor: Record<string, string> = {
    low: '#808080', medium: '#FF1F1F', high: '#FF1F1F', critical: '#FF1F1F',
  }
  const c = sevColor[item.severity]
  return (
    <div style={{
      display: 'flex', gap: '6px', alignItems: 'flex-start',
      padding: '5px 8px',
      background: 'rgba(255,255,255,0.02)',
      borderLeft: `2px solid ${c}`,
      borderRadius: '3px',
      opacity: muted ? 0.7 : 1,
    }}>
      <span style={{ fontSize: '11px', flexShrink: 0 }}>{item.flag}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif', fontSize: '11px',
          color: muted ? '#808080' : '#E0E0E0', lineHeight: 1.4,
          fontWeight: muted ? 400 : 500,
        }}>{item.headline}</div>
        <div style={{
          fontFamily: 'var(--font-jetbrains), monospace', fontSize: '8px',
          color: c, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '2px', fontWeight: 700,
        }}>
          {clock(item.fireAt)} · {item.source ?? 'wire'}
        </div>
      </div>
    </div>
  )
}

// ─── Coach (ORUS whispers list) ────────────────────────────

function CoachPanel() {
  const { state, whisperForMinute, scenario, clock, market } = useLiveSession()
  // Show all whispers up to current minute (scripted per scenario; COV-20 only so far)
  const fired = scenario.whispers.filter(w => w.fireAt <= state.currentMinute).reverse()
  const live = whisperForMinute(state.currentMinute)
  void live

  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Header>ORUS · {fired.length} insights</Header>
      <div style={{
        padding: '10px 12px',
        background: 'rgba(255,31,31,0.08)',
        border: '1px solid rgba(255,31,31,0.3)',
        borderRadius: '6px',
        fontFamily: 'var(--font-fraunces), serif',
        fontStyle: 'italic',
        fontSize: '12px', color: '#C0C0C0', lineHeight: 1.5,
      }}>
        Plain-English coaching from your AI mentor. Reactive to what\'s on the tape right now.
      </div>
      {fired.map((w, i) => (
        <div key={i} style={{
          padding: '8px 10px',
          background: 'rgba(255,31,31,0.05)',
          border: '1px solid rgba(168,85,247,0.2)',
          borderLeft: '3px solid #A855F7',
          borderRadius: '4px',
          display: 'flex', flexDirection: 'column', gap: '4px',
        }}>
          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '9px', color: '#FF1F1F', fontWeight: 700, letterSpacing: '0.12em' }}>
            ◆ {clock(w.fireAt)} {market.tz}
          </div>
          <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '12px', color: '#C0C0C0', lineHeight: 1.45 }}>
            {w.text}
          </div>
        </div>
      ))}
      {fired.length === 0 && (
        <div style={{
          padding: '24px 12px', textAlign: 'center',
          fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
          fontSize: '12px', color: '#404040',
        }}>
          ORUS is watching. Hints appear here as the session unfolds.
        </div>
      )}
    </div>
  )
}

// ─── Small parts ──────────────────────────────────────────

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-inter), sans-serif',
      fontSize: '10px', fontWeight: 700, color: '#FF1F1F',
      letterSpacing: '0.22em', textTransform: 'uppercase',
      padding: '0 4px', marginBottom: '4px',
    }}>{children}</div>
  )
}
function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-inter), sans-serif',
      fontSize: '9px', fontWeight: 700, color: '#808080',
      letterSpacing: '0.18em', textTransform: 'uppercase',
      marginTop: '6px', marginBottom: '2px',
    }}>{children}</div>
  )
}
function KV({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '9px', color: '#404040', letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', color: color ?? '#E0E0E0', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
