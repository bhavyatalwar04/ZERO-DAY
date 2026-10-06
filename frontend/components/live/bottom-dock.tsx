'use client'

import { useState, useEffect } from 'react'
import { ShoppingCart, BookText, GraduationCap } from 'lucide-react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import type { OrderType, OrderSide } from '@/types/live'

type Tab = 'ticket' | 'journal' | 'lessons'

export function BottomDock({ onShowOrderCoach, onShowSizingCoach }: {
  onShowOrderCoach: () => void
  onShowSizingCoach: () => void
}) {
  const [tab, setTab] = useState<Tab>('ticket')

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'ticket',   label: 'Order Ticket',  icon: ShoppingCart },
    { key: 'journal',  label: 'Trade Journal', icon: BookText },
    { key: 'lessons',  label: 'Lessons',       icon: GraduationCap },
  ]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
      background: 'linear-gradient(180deg, #050505 0%, #000000 100%)',
      borderTop: '1px solid rgba(255,31,31,0.32)',
      overflow: 'hidden',
    }}>
      <div data-tut="dock-tabs" style={{
        display: 'flex', borderBottom: '1px solid rgba(255,31,31,0.32)',
        background: 'rgba(0,0,0,0.3)',
      }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 18px',
                background: active ? 'rgba(255,31,31,0.10)' : 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? '#FF1F1F' : 'transparent'}`,
                color: active ? '#E0E0E0' : '#707070',
                cursor: 'pointer',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            ><Icon size={13} strokeWidth={2}/> {t.label}</button>
          )
        })}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'ticket'  && <OrderTicket onShowOrderCoach={onShowOrderCoach} onShowSizingCoach={onShowSizingCoach}/>}
        {tab === 'journal' && <TradeJournal/>}
        {tab === 'lessons' && <Lessons/>}
      </div>
    </div>
  )
}

// ─── Order Ticket ──────────────────────────────────────────

function OrderTicket({ onShowOrderCoach, onShowSizingCoach }: { onShowOrderCoach: () => void; onShowSizingCoach: () => void }) {
  const { state, dispatch, ltp, prevClose, market } = useLiveSession()
  const symbol = state.activeSymbol
  const last = ltp(symbol)

  const [side, setSide] = useState<OrderSide>('BUY')
  const [type, setType] = useState<OrderType>('MARKET')

  // String-state inputs so users can backspace to empty / type freely
  const [qtyStr, setQtyStr] = useState<string>('10')
  const [priceStr, setPriceStr] = useState<string>(last.toFixed(2))
  const [triggerStr, setTriggerStr] = useState<string>((last * 0.97).toFixed(2))
  const [reason, setReason] = useState<string>('')

  // Re-prefill price defaults when active symbol or order type changes
  useEffect(() => {
    setPriceStr(last.toFixed(2))
    setTriggerStr((last * 0.97).toFixed(2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, type])

  // Pre-fill qty when switching to SELL based on position
  useEffect(() => {
    if (side === 'SELL') {
      const pos = state.positions[symbol]
      if (pos && pos.qty > 0) setQtyStr(String(pos.qty))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, symbol])

  // Numeric parsed values (NaN/0-safe)
  const qty = Math.max(0, parseInt(qtyStr) || 0)
  const price = Math.max(0, parseFloat(priceStr) || 0)
  const trigger = Math.max(0, parseFloat(triggerStr) || 0)

  const refPrice = type === 'MARKET' ? last : price
  const cost = qty * refPrice
  const cashAfter = state.cash - cost
  const sizeFraction = cost / 100000
  const exceedsCash = side === 'BUY' && cost > state.cash
  const tooBig = sizeFraction > 0.40
  const positionForSymbol = state.positions[symbol]
  const sellExceedsPosition = side === 'SELL' && (!positionForSymbol || qty > positionForSymbol.qty)

  // Validation
  const qtyValid = qty > 0
  const priceValid = type === 'MARKET' || price > 0
  const triggerValid = (type !== 'SL' && type !== 'SL-M') || trigger > 0
  const sessionLive = state.status === 'LIVE'

  const errorMsg = !qtyValid ? 'Quantity must be at least 1'
    : !priceValid ? 'Limit price must be greater than 0'
    : !triggerValid ? 'Trigger price must be greater than 0'
    : exceedsCash ? `Insufficient funds — short by ${market.currencySymbol}${Math.abs(cashAfter).toFixed(0)}`
    : sellExceedsPosition ? `You only hold ${positionForSymbol?.qty ?? 0} shares of ${symbol}`
    : !sessionLive ? state.status === 'HALTED' ? 'Trading halted — wait for resumption' : state.status === 'CLOSED' ? 'Market closed' : state.status === 'PAUSED' ? 'Resume the simulation to place orders' : 'Pre-market — wait for the bell'
    : null

  const canPlace = !errorMsg

  function placeOrder() {
    if (!canPlace) return
    if (!state.coachShown.orderType && side === 'BUY') {
      onShowOrderCoach()
      dispatch({ type: 'MARK_COACH_SHOWN', coach: 'orderType' })
      return
    }
    if (tooBig && !state.coachShown.sizing && side === 'BUY') {
      onShowSizingCoach()
      dispatch({ type: 'MARK_COACH_SHOWN', coach: 'sizing' })
      return
    }
    dispatch({ type: 'PLACE_ORDER', order: {
      symbol, side, type,
      validity: 'DAY',
      quantity: qty,
      price: type === 'MARKET' ? undefined : price,
      triggerPrice: (type === 'SL' || type === 'SL-M') ? trigger : undefined,
      reason: reason || undefined,
    }})
    setReason('')
  }

  const sideColor = side === 'BUY' ? '#00C853' : '#FF1F1F'

  return (
    <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: '16px' }}>
      {/* LEFT — buy/sell + symbol */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Label>Side · Symbol</Label>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['BUY', 'SELL'] as OrderSide[]).map(s => (
            <button key={s} onClick={() => setSide(s)}
              style={{
                flex: 1, padding: '10px',
                background: side === s ? (s === 'BUY' ? '#00C853' : '#FF1F1F') : 'rgba(255,255,255,0.04)',
                border: `1px solid ${side === s ? (s === 'BUY' ? '#00C853' : '#FF1F1F') : 'rgba(255,31,31,0.30)'}`,
                borderRadius: '6px',
                color: side === s ? '#0B0F15' : '#808080',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '12px', fontWeight: 700, letterSpacing: '0.18em',
                textTransform: 'uppercase', cursor: 'pointer',
              }}>{s}</button>
          ))}
        </div>
        <div style={{
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(212,160,77,0.14)',
          borderRadius: '6px',
        }}>
          <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: '15px', color: '#E0E0E0' }}>
            {symbol} · {market.exchange}
          </div>
          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', color: '#808080', marginTop: '2px' }}>
            LTP {market.currencySymbol}{last.toFixed(2)} · prev {market.currencySymbol}{prevClose(symbol).toFixed(2)}
          </div>
        </div>
        <div>
          <Label>Quantity</Label>
          <input
            type="text"
            inputMode="numeric"
            value={qtyStr}
            placeholder="e.g. 25"
            onChange={e => {
              const v = e.target.value.replace(/[^\d]/g, '')
              setQtyStr(v)
            }}
            onBlur={() => { if (!qtyStr || parseInt(qtyStr) <= 0) setQtyStr('1') }}
            style={INPUT}
          />
          {side === 'SELL' && positionForSymbol && (
            <button
              onClick={() => setQtyStr(String(positionForSymbol.qty))}
              style={{
                marginTop: '4px', padding: '3px 8px',
                background: 'rgba(224,74,74,0.10)',
                border: '1px solid rgba(224,74,74,0.4)',
                borderRadius: '3px',
                color: '#FF1F1F',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em',
                textTransform: 'uppercase', cursor: 'pointer',
              }}
            >Use full position · {positionForSymbol.qty}</button>
          )}
        </div>
      </div>

      {/* MIDDLE — order type + price */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Label>Order Type</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
          {(['MARKET', 'LIMIT', 'SL', 'SL-M'] as OrderType[]).map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              padding: '8px',
              background: type === t ? 'rgba(255,31,31,0.32)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${type === t ? '#FF1F1F' : 'rgba(255,31,31,0.30)'}`,
              borderRadius: '5px',
              color: type === t ? '#FF1F1F' : '#808080',
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '11px', fontWeight: 700,
              cursor: 'pointer',
            }}>{t}</button>
          ))}
        </div>

        {type !== 'MARKET' && (
          <div>
            <Label>Limit price ({market.currencySymbol})</Label>
            <input
              type="text"
              inputMode="decimal"
              value={priceStr}
              placeholder={`e.g. ${last.toFixed(2)}`}
              onChange={e => {
                const v = e.target.value.replace(/[^\d.]/g, '')
                // allow only one dot
                const parts = v.split('.')
                setPriceStr(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : v)
              }}
              onBlur={() => { if (!priceStr || parseFloat(priceStr) <= 0) setPriceStr(last.toFixed(2)) }}
              style={INPUT}
            />
            <button
              onClick={() => setPriceStr(last.toFixed(2))}
              style={{
                marginTop: '4px', padding: '3px 8px',
                background: 'rgba(255,31,31,0.16)',
                border: '1px solid rgba(212,160,77,0.3)',
                borderRadius: '3px',
                color: '#FF1F1F',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em',
                textTransform: 'uppercase', cursor: 'pointer',
              }}
            >Use LTP · {market.currencySymbol}{last.toFixed(2)}</button>
          </div>
        )}
        {(type === 'SL' || type === 'SL-M') && (
          <div>
            <Label>Trigger price ({market.currencySymbol})</Label>
            <input
              type="text"
              inputMode="decimal"
              value={triggerStr}
              placeholder={`e.g. ${(last * 0.97).toFixed(2)}`}
              onChange={e => {
                const v = e.target.value.replace(/[^\d.]/g, '')
                const parts = v.split('.')
                setTriggerStr(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : v)
              }}
              onBlur={() => { if (!triggerStr || parseFloat(triggerStr) <= 0) setTriggerStr((last * 0.97).toFixed(2)) }}
              style={INPUT}
            />
          </div>
        )}
        <div style={{
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(212,160,77,0.14)',
          borderRadius: '5px',
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '10px', color: '#808080',
          display: 'flex', flexDirection: 'column', gap: '3px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Estimated cost</span>
            <span style={{ color: '#E0E0E0', fontWeight: 700 }}>{market.currencySymbol}{cost.toFixed(0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Cash after</span>
            <span style={{ color: cashAfter < 0 ? '#FF1F1F' : '#808080' }}>{market.currencySymbol}{cashAfter.toFixed(0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Position size</span>
            <span style={{ color: tooBig ? '#FF1F1F' : '#808080' }}>{(sizeFraction * 100).toFixed(1)}% of wallet</span>
          </div>
        </div>
      </div>

      {/* RIGHT — thesis + place button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Label>Thesis (required for the journal)</Label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Why this trade? RSI oversold + bounce off support at 1,150… etc."
          rows={3}
          style={{
            ...INPUT, resize: 'none',
            fontFamily: 'var(--font-fraunces), serif',
            fontStyle: 'italic',
            fontSize: '12px', lineHeight: 1.5,
            padding: '8px 10px',
          }}
        />

        {tooBig && side === 'BUY' && canPlace && (
          <div style={{
            padding: '6px 8px',
            background: 'rgba(255,184,48,0.10)',
            border: '1px solid #FFB83080',
            borderRadius: '4px',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '10px', color: '#FF1F1F',
            fontStyle: 'italic',
          }}>
            ⚠ Size is over 40% of wallet. Pros stay below 5–10% per position.
          </div>
        )}

        {errorMsg && (
          <div style={{
            padding: '6px 8px',
            background: 'rgba(224,74,74,0.10)',
            border: '1px solid #E04A4A80',
            borderRadius: '4px',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '10px', color: '#FF1F1F',
            fontWeight: 600,
          }}>
            ⛔ {errorMsg}
          </div>
        )}

        <button
          onClick={placeOrder}
          disabled={!canPlace}
          style={{
            padding: '14px',
            background: !canPlace ? 'rgba(255,255,255,0.04)' : sideColor,
            border: `1px solid ${!canPlace ? 'rgba(255,31,31,0.30)' : sideColor}`,
            borderRadius: '6px',
            color: !canPlace ? '#404040' : '#0B0F15',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '13px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase',
            cursor: !canPlace ? 'not-allowed' : 'pointer',
            boxShadow: !canPlace ? 'none' : `0 4px 14px ${sideColor}66`,
          }}
        >
          {!canPlace ? 'CANNOT PLACE ORDER' : `${side} ${qty} ${symbol} @ ${type}${type !== 'MARKET' ? ` ${market.currencySymbol}${price.toFixed(2)}` : ''}`}
        </button>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px', color: '#404040',
          fontStyle: 'italic', textAlign: 'center',
        }}>
          One tap. Cannot undo. Trade is logged in journal.
        </div>
      </div>
    </div>
  )
}

// ─── Trade Journal ─────────────────────────────────────────

function TradeJournal() {
  const { state, ltp, market, clock } = useLiveSession()
  const filled = state.orders.filter(o => o.status === 'FILLED')
  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '11px', fontWeight: 700, color: '#FF1F1F',
        letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>Trade Journal · {filled.length} entries</div>
      <div style={{
        fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
        fontSize: '12px', color: '#808080', marginBottom: '8px',
      }}>
        Every trade you place is logged here with your stated thesis. Review at end-of-day to see what worked and what didn\'t.
      </div>
      {filled.length === 0 && (
        <div style={{
          padding: '24px 12px', textAlign: 'center',
          fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
          fontSize: '13px', color: '#404040',
        }}>
          No filled trades yet.
        </div>
      )}
      {filled.map(o => {
        const isBuy = o.side === 'BUY'
        const c = isBuy ? '#00C853' : '#FF1F1F'
        const last = ltp(o.symbol)
        const liveDelta = o.filledPrice ? ((last - o.filledPrice) / o.filledPrice) * 100 : 0
        return (
          <div key={o.id} style={{
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.025)',
            border: `1px solid ${c}40`,
            borderLeft: `3px solid ${c}`,
            borderRadius: '5px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '13px', color: c, fontWeight: 700, letterSpacing: '0.06em' }}>
                {o.side} {o.quantity} {o.symbol} @ {market.currencySymbol}{o.filledPrice?.toFixed(2)}
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', color: '#808080' }}>
                {o.filledAtMin != null ? `${clock(o.filledAtMin)} ${market.tz}` : ''}
              </span>
            </div>
            {o.reason && (
              <div style={{
                marginTop: '4px',
                fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
                fontSize: '12px', color: '#C0C0C0',
              }}>"{o.reason}"</div>
            )}
            {isBuy && (
              <div style={{
                marginTop: '4px',
                fontFamily: 'var(--font-jetbrains), monospace', fontSize: '10px',
                color: liveDelta >= 0 ? '#00C853' : '#FF1F1F',
              }}>
                Live unrealised: {liveDelta >= 0 ? '+' : ''}{liveDelta.toFixed(2)}%
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Lessons ───────────────────────────────────────────────

function Lessons() {
  const lessons = [
    { id: 1, title: 'Order Types — when to use which', body: 'MARKET = certainty of fill, uncertainty of price. LIMIT = certainty of price, uncertainty of fill. SL = automated exit when price moves against you. SL-M = same but exits at market when triggered (no slippage protection).' },
    { id: 2, title: 'Stop Loss — the only rule that matters', body: 'Set a stop-loss on every trade BEFORE you place it. ATR-based: entry minus 2× ATR is a good default. Without SL, one bad trade can erase a month of gains.' },
    { id: 3, title: 'Position sizing — the 2% rule', body: 'Risk no more than 2% of capital on a single trade. With ₹1,00,000, that\'s ₹2,000 of risk per trade. If your stop is 5% from entry, max position size is ₹40,000 — not your whole bankroll.' },
    { id: 4, title: 'News — signal vs noise', body: 'Signal: circuit breakers, sector-wide shocks, regulatory action, earnings surprises. Noise: analyst opinions, recycled headlines, vague "under review" memos, social rumours. Trade only signals.' },
    { id: 5, title: 'Volume confirms price', body: 'Price up + volume up = trend confirmed. Price up + volume down = weak rally, watch for reversal. Volume tells you whether real money is behind the move.' },
    { id: 6, title: 'VWAP — institutional benchmark', body: 'VWAP is what funds use to grade their day. Price above VWAP = intraday strength. Price below VWAP = weakness. Returning to VWAP after a stretch is a mean-reversion play.' },
  ]
  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '11px', fontWeight: 700, color: '#FF1F1F',
        letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>Quick Lessons · 6</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
        {lessons.map(l => (
          <div key={l.id} style={{
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(212,160,77,0.14)',
            borderRadius: '6px',
          }}>
            <div style={{
              fontFamily: 'var(--font-fraunces), serif', fontWeight: 700,
              fontSize: '13px', color: '#E0E0E0', marginBottom: '4px',
            }}>{l.title}</div>
            <p style={{
              margin: 0,
              fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
              fontSize: '12px', color: '#808080', lineHeight: 1.5,
            }}>{l.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── small parts ───────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-inter), sans-serif',
      fontSize: '9px', fontWeight: 700, color: '#808080',
      letterSpacing: '0.18em', textTransform: 'uppercase',
      marginBottom: '4px',
    }}>{children}</div>
  )
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(212,160,77,0.2)',
  borderRadius: '5px',
  color: '#E0E0E0',
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: '13px',
  outline: 'none',
}
