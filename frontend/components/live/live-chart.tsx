'use client'

import { useMemo } from 'react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import type { IntradayBar } from '@/types/live'

const SECTOR_COLOR: Record<string, string> = {
  airlines: '#3B82F6', pharma: '#10B981', energy: '#E11D48',
  banking: '#06B6D4', luxury: '#A855F7', it: '#14B8A6',
}
const SYMBOL_SECTOR: Record<string, keyof typeof SECTOR_COLOR> = {
  INDIGO: 'airlines', SUNPHARMA: 'pharma', RELIANCE: 'energy',
  HDFCBANK: 'banking', TITAN: 'luxury', TCS: 'it',
}
const SYMBOL_NAME: Record<string, string> = {
  INDIGO: 'InterGlobe Aviation Ltd', SUNPHARMA: 'Sun Pharmaceutical Industries',
  RELIANCE: 'Reliance Industries Ltd', HDFCBANK: 'HDFC Bank Ltd',
  TITAN: 'Titan Company Ltd', TCS: 'Tata Consultancy Services',
}

// TradingView default candle colors
const BULL = '#00C853'   // terminal green
const BEAR = '#FF1F1F'   // alert red

export function LiveChart() {
  const { state, getBars, ltp, prevClose, pctChange, clock, market, scenario } = useLiveSession()
  const symbol = state.activeSymbol
  const accent = SECTOR_COLOR[SYMBOL_SECTOR[symbol] ?? 'airlines']

  const allBars = getBars(symbol)
  const visibleBars = useMemo(() => {
    const upTo = Math.floor(state.currentMinute / 5) + 1
    return allBars.slice(0, Math.min(allBars.length, upTo))
  }, [allBars, state.currentMinute])

  const lastPrice = ltp(symbol)
  const prevC = prevClose(symbol)
  const change = pctChange(symbol)
  const isDown = change < 0

  // Live OHLC for current bar
  const currentBar = visibleBars[visibleBars.length - 1]
  const lastBarOpen = currentBar?.open ?? 0
  const lastBarHigh = currentBar?.high ?? 0
  const lastBarLow = currentBar?.low ?? 0
  const lastBarClose = currentBar?.close ?? 0
  const barChange = lastBarClose - lastBarOpen
  const barChangePct = lastBarOpen > 0 ? (barChange / lastBarOpen) * 100 : 0

  // MA20 + VWAP
  const ma20Series = useMemo(() => {
    const closes = visibleBars.map(b => b.close)
    return closes.map((_, i) => {
      if (i < 19) return 0
      return closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20
    })
  }, [visibleBars])

  const vwapSeries = useMemo(() => {
    let pv = 0, v = 0
    return visibleBars.map(b => {
      const tp = (b.high + b.low + b.close) / 3
      pv += tp * b.volume
      v += b.volume
      return v > 0 ? pv / v : tp
    })
  }, [visibleBars])

  return (
    <div data-tut="chart-area" style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#000000',
    }}>
      {/* TOP TOOLBAR */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '8px 14px',
        background: '#0A0A0A',
        borderBottom: '1px solid #1A0808',
        height: '40px',
        flexShrink: 0,
      }}>
        <ToolbarButton label={symbol}/>
        <ToolbarSep/>
        <ToolbarButton label="5m" active/>
        <ToolbarSep/>
        <ToolbarButton label="Indicators · 2"/>
        <ToolbarButton label="Alert"/>
        <ToolbarSep/>
        <span style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '11px', color: '#606060',
          fontWeight: 500,
        }}>
          {SYMBOL_NAME[symbol] ?? scenario.names[symbol] ?? symbol}
          <span style={{ margin: '0 6px', color: '#303030' }}>·</span>
          {market.exchange}
          <span style={{ margin: '0 6px', color: '#303030' }}>·</span>
          INTRADAY · 5min
        </span>
        <div style={{ flex: 1 }}/>
        <span style={{
          padding: '3px 8px',
          background: 'rgba(38,166,154,0.16)',
          border: '1px solid rgba(38,166,154,0.5)',
          borderRadius: '3px',
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '10px', color: BULL, fontWeight: 700, letterSpacing: '0.1em',
          display: 'flex', alignItems: 'center', gap: '5px',
        }}>
          <span style={{ width: '6px', height: '6px', background: BULL, borderRadius: '50%' }}/>
          LIVE · 5×
        </span>
      </div>

      {/* OHLC STRIP — TradingView style */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '14px',
        padding: '6px 14px',
        background: '#000000',
        borderBottom: '1px solid #1A0808',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: '12px',
        flexShrink: 0,
      }}>
        <span style={{ color: '#E0E0E0', fontWeight: 600 }}>{symbol} · {market.exchange} · 5</span>
        <OhlcCell label="O" value={lastBarOpen} color={lastBarClose >= lastBarOpen ? BULL : BEAR}/>
        <OhlcCell label="H" value={lastBarHigh} color={BULL}/>
        <OhlcCell label="L" value={lastBarLow} color={BEAR}/>
        <OhlcCell label="C" value={lastBarClose} color={lastBarClose >= lastBarOpen ? BULL : BEAR}/>
        <span style={{ color: barChange >= 0 ? BULL : BEAR, fontWeight: 700 }}>
          {barChange >= 0 ? '+' : ''}{barChange.toFixed(2)} ({barChange >= 0 ? '+' : ''}{barChangePct.toFixed(2)}%)
        </span>
        <div style={{ flex: 1 }}/>
        <span style={{ color: '#606060' }}>
          PREV CLOSE <span style={{ color: '#E0E0E0' }}>{market.currencySymbol}{prevC.toFixed(2)}</span>
        </span>
        <span style={{ color: '#606060' }}>
          DAY <span style={{ color: isDown ? BEAR : BULL, fontWeight: 700 }}>
            {isDown ? '▼' : '▲'} {Math.abs(change).toFixed(2)}%
          </span>
        </span>
      </div>

      {/* CHART CANVAS */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {visibleBars.length > 0 ? (
          <CandleCanvas
            bars={visibleBars}
            accent={accent}
            ma20={ma20Series}
            vwap={vwapSeries}
            prevClose={prevC}
            symbol={symbol}
            lastPrice={lastPrice}
          />
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%',
            fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
            fontSize: '14px', color: '#606060',
          }}>
            Pre-market · waiting for opening bell at {clock(0)} {market.tz}...
          </div>
        )}
      </div>

      {/* BOTTOM TIME-SCALE STRIP */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 14px',
        background: '#0A0A0A',
        borderTop: '1px solid #1A0808',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: '10px',
        flexShrink: 0,
      }}>
        {['1m','5m','15m','30m','1h','D'].map(tf => (
          <button key={tf} style={{
            padding: '3px 8px',
            background: tf === '5m' ? '#FF1F1F' : 'transparent',
            border: 'none', borderRadius: '3px',
            color: tf === '5m' ? '#FFFFFF' : '#787B86',
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: '10px', fontWeight: 600,
            cursor: 'pointer',
          }}>{tf}</button>
        ))}
        <div style={{ flex: 1 }}/>
        <span style={{ color: '#606060' }}>{clock(state.currentMinute)} {market.tz}</span>
        <span style={{ color: '#303030' }}>·</span>
        <span style={{ color: '#606060' }}>%</span>
        <span style={{ color: '#303030' }}>·</span>
        <span style={{ color: '#606060' }}>log</span>
        <span style={{ color: '#303030' }}>·</span>
        <span style={{ color: '#606060' }}>auto</span>
      </div>
    </div>
  )
}

function ToolbarButton({ label, active }: { label: string; active?: boolean }) {
  return (
    <button style={{
      padding: '4px 10px',
      background: active ? '#1A0808' : 'transparent',
      border: '1px solid transparent',
      borderRadius: '3px',
      color: active ? '#FF1F1F' : '#606060',
      fontFamily: 'var(--font-inter), sans-serif',
      fontSize: '11px', fontWeight: 600,
      cursor: 'pointer',
    }}>{label}</button>
  )
}
function ToolbarSep() {
  return <span style={{ width: '1px', height: '14px', background: '#1A0808' }}/>
}
function OhlcCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span>
      <span style={{ color: '#606060' }}>{label}</span>
      <span style={{ color, marginLeft: '4px', fontWeight: 600 }}>{value.toFixed(2)}</span>
    </span>
  )
}

// ═══════════════════════════════════════════════════════════
// CandleCanvas — TradingView-faithful candles
// ═══════════════════════════════════════════════════════════

interface ChartProps {
  bars: IntradayBar[]
  accent: string
  ma20: number[]
  vwap: number[]
  prevClose: number
  symbol: string
  lastPrice: number
}

function CandleCanvas({ bars, ma20, vwap, prevClose, symbol, lastPrice }: ChartProps) {
  const { clock } = useLiveSession()
  const W = 1200
  const H = 480
  const PAD_L = 8
  const PAD_R = 80           // price scale gutter
  const PAD_T = 10
  const PAD_B_CHART = 8       // bottom of chart pane (above volume)
  const VOL_H = 64

  const CHART_BOTTOM = H - VOL_H - 18
  const CHART_AREA_H = CHART_BOTTOM - PAD_T

  // X axis: full session always visible (75 slots) — but extend left edge by 1 slot
  // for the "prev close stub" so the chart visibly starts FROM prev close.
  const TOTAL_SLOTS = 75 + 1   // 1 stub at left for prev close
  const chartW = W - PAD_L - PAD_R
  const slotW = chartW / TOTAL_SLOTS
  const candleW = Math.max(2.5, slotW * 0.78)    // tighter, more TV-like
  const wickW = 1                                  // thin wicks

  // Y range — include prev close in extents
  const allHL = [...bars.flatMap(b => [b.high, b.low]), prevClose]
  const minP = Math.min(...allHL)
  const maxP = Math.max(...allHL)
  const padP = (maxP - minP) * 0.05
  const yMin = minP - padP
  const yMax = maxP + padP
  const range = yMax - yMin || 1
  const yPx = (price: number) => PAD_T + (1 - (price - yMin) / range) * CHART_AREA_H

  const volMax = Math.max(...bars.map(b => b.volume), 1)
  const volBaseY = CHART_BOTTOM + 18
  const volH = (vol: number) => (vol / volMax) * (VOL_H - 4)

  const gridLevels = niceGrid(yMin, yMax, 7)
  const lastBar = bars[bars.length - 1]
  const lastClose = lastBar.close
  const isBullLast = lastClose >= lastBar.open

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      {/* CHART AREA BG */}
      <rect x={PAD_L} y={PAD_T} width={chartW} height={CHART_AREA_H} fill="#000000"/>

      {/* Watermark */}
      <text x={PAD_L + chartW / 2} y={PAD_T + CHART_AREA_H / 2 + 30}
        textAnchor="middle"
        fontFamily="var(--font-fraunces), serif"
        fontSize="100" fontWeight="700"
        fill="#FFFFFF" opacity="0.018"
        letterSpacing="0.06em">
        {symbol}
      </text>

      {/* Vertical session split lines (every 12 slots = 60 min) */}
      {[12, 24, 36, 48, 60].map(slot => (
        <line key={`vs-${slot}`}
          x1={PAD_L + (slot + 1) * slotW} y1={PAD_T}
          x2={PAD_L + (slot + 1) * slotW} y2={CHART_BOTTOM}
          stroke="#1A1A1A" strokeWidth="1"/>
      ))}

      {/* Horizontal price grid */}
      {gridLevels.map((p, i) => (
        <g key={`g-${i}`}>
          <line x1={PAD_L} y1={yPx(p)} x2={PAD_L + chartW} y2={yPx(p)}
            stroke="#1A1A1A" strokeWidth="1"/>
          <text x={PAD_L + chartW + 6} y={yPx(p) + 3.5}
            fontFamily="var(--font-jetbrains), monospace"
            fontSize="10" fontWeight="500" fill="#606060">
            {p.toFixed(2)}
          </text>
        </g>
      ))}

      {/* PREV CLOSE LINE — extends across entire chart, starting visibly at the left stub */}
      <line x1={PAD_L} y1={yPx(prevClose)} x2={PAD_L + chartW} y2={yPx(prevClose)}
        stroke="#787B86" strokeDasharray="3 4" strokeWidth="0.8" opacity="0.55"/>
      {/* "Stub" at left — small horizontal segment showing where prev close was, before the bell */}
      <line
        x1={PAD_L}
        y1={yPx(prevClose)}
        x2={PAD_L + slotW * 0.9}
        y2={yPx(prevClose)}
        stroke="#787B86" strokeWidth="2.5"/>
      {/* Prev close right-side tag */}
      <rect x={PAD_L + chartW + 1} y={yPx(prevClose) - 8} width="68" height="16" rx="2"
        fill="#2A2E39" stroke="#787B86" strokeWidth="0.5"/>
      <text x={PAD_L + chartW + 35} y={yPx(prevClose) + 4}
        fontFamily="var(--font-jetbrains), monospace" fontSize="10" fontWeight="600"
        textAnchor="middle" fill="#606060">
        {prevClose.toFixed(2)}
      </text>
      <text x={PAD_L + 6} y={yPx(prevClose) - 4}
        fontFamily="var(--font-jetbrains), monospace" fontSize="9" fill="#606060"
        letterSpacing="0.06em">PREV CLOSE</text>

      {/* GAP LINE — connect prev close to first bar's open */}
      {bars.length > 0 && (
        <line
          x1={PAD_L + slotW * 0.9}
          y1={yPx(prevClose)}
          x2={PAD_L + slotW + slotW / 2}
          y2={yPx(bars[0].open)}
          stroke={bars[0].open < prevClose ? BEAR : BULL}
          strokeWidth="1.2"
          strokeDasharray="2 3"
          opacity="0.7"
        />
      )}

      {/* MA20 line */}
      <polyline
        points={bars.map((_, i) => ma20[i] > 0 ? `${(PAD_L + (i + 1) * slotW + slotW / 2).toFixed(1)},${yPx(ma20[i]).toFixed(1)}` : null).filter(Boolean).join(' ')}
        fill="none" stroke="#E0E0E0" strokeWidth="1.2" strokeLinejoin="round" opacity="0.85"
      />
      {/* VWAP line */}
      <polyline
        points={bars.map((_, i) => vwap[i] > 0 ? `${(PAD_L + (i + 1) * slotW + slotW / 2).toFixed(1)},${yPx(vwap[i]).toFixed(1)}` : null).filter(Boolean).join(' ')}
        fill="none" stroke="#8B0000" strokeWidth="1.2" strokeDasharray="4 2" opacity="0.85"
      />

      {/* CANDLES — TradingView style: thin wicks, body fills */}
      {bars.map((c, i) => {
        const cx = PAD_L + (i + 1) * slotW + slotW / 2
        const isBull = c.close >= c.open
        const color = isBull ? BULL : BEAR
        const yHigh = yPx(c.high)
        const yLow = yPx(c.low)
        const yOpen = yPx(c.open)
        const yClose = yPx(c.close)
        const yTop = Math.min(yOpen, yClose)
        const yBot = Math.max(yOpen, yClose)
        const bodyH = Math.max(1, yBot - yTop)
        return (
          <g key={i}>
            {/* wick */}
            <line x1={cx} y1={yHigh} x2={cx} y2={yLow}
              stroke={color} strokeWidth={wickW}/>
            {/* body */}
            <rect
              x={cx - candleW / 2}
              y={yTop}
              width={candleW}
              height={bodyH}
              fill={color}
              shapeRendering="crispEdges"
            />
          </g>
        )
      })}

      {/* LIVE PRICE TAG (right scale) */}
      <line x1={PAD_L} y1={yPx(lastPrice)} x2={PAD_L + chartW} y2={yPx(lastPrice)}
        stroke={isBullLast ? BULL : BEAR} strokeWidth="1" strokeDasharray="2 2" opacity="0.7"/>
      <rect x={PAD_L + chartW + 1} y={yPx(lastPrice) - 9} width="68" height="18"
        fill={isBullLast ? BULL : BEAR}/>
      <text x={PAD_L + chartW + 35} y={yPx(lastPrice) + 4}
        fontFamily="var(--font-jetbrains), monospace" fontSize="11" fontWeight="700"
        textAnchor="middle" fill="#FFFFFF">
        {lastPrice.toFixed(2)}
      </text>

      {/* MA / VWAP value tags on the right scale */}
      {ma20.length > 0 && ma20[ma20.length - 1] > 0 && (
        <>
          <rect x={PAD_L + chartW + 1} y={yPx(ma20[ma20.length - 1]) - 8} width="68" height="14"
            fill="#2A2E39" stroke="#E0E0E0" strokeWidth="0.5"/>
          <text x={PAD_L + chartW + 35} y={yPx(ma20[ma20.length - 1]) + 3}
            fontFamily="var(--font-jetbrains), monospace" fontSize="9" fontWeight="600"
            textAnchor="middle" fill="#E0E0E0">
            {ma20[ma20.length - 1].toFixed(2)}
          </text>
        </>
      )}

      {/* VOLUME PANE */}
      <line x1={PAD_L} y1={volBaseY - 14} x2={PAD_L + chartW} y2={volBaseY - 14}
        stroke="#2A2E39" strokeWidth="1"/>
      <text x={PAD_L + 4} y={volBaseY - 4}
        fontFamily="var(--font-jetbrains), monospace" fontSize="9" fill="#606060"
        letterSpacing="0.08em">
        Vol · {(volMax / 100000).toFixed(1)}L
      </text>
      {bars.map((c, i) => {
        const cx = PAD_L + (i + 1) * slotW + slotW / 2
        const isBull = c.close >= c.open
        const h = volH(c.volume)
        return (
          <rect key={`v-${i}`}
            x={cx - candleW / 2}
            y={volBaseY + (VOL_H - 4) - h - 14}
            width={candleW} height={h}
            fill={isBull ? BULL : BEAR} fillOpacity="0.6"
            shapeRendering="crispEdges"/>
        )
      })}

      {/* TIME LABELS at bottom */}
      {[0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72].map(slot => {
        const cx = PAD_L + (slot + 1) * slotW + slotW / 2
        return (
          <text key={`t-${slot}`} x={cx} y={H - 4}
            textAnchor="middle"
            fontFamily="var(--font-jetbrains), monospace" fontSize="9"
            fill="#606060">
            {clock(slot * 5)}
          </text>
        )
      })}

      {/* MA / VWAP legend (top-left of chart) */}
      <g transform={`translate(${PAD_L + 14}, ${PAD_T + 14})`} fontFamily="var(--font-inter), sans-serif" fontSize="10">
        <text x="0" y="0" fill="#E0E0E0" fontWeight="600">MA(20)  {ma20.length && ma20[ma20.length - 1] > 0 ? ma20[ma20.length - 1].toFixed(2) : '—'}</text>
        <text x="0" y="14" fill="#8B0000" fontWeight="600">VWAP    {vwap.length ? vwap[vwap.length - 1].toFixed(2) : '—'}</text>
      </g>
    </svg>
  )
}

function niceGrid(min: number, max: number, count: number): number[] {
  const step = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(step || 1)))
  const norm = step / mag
  const niceStep = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const start = Math.ceil(min / niceStep) * niceStep
  const out: number[] = []
  for (let v = start; v <= max; v += niceStep) out.push(v)
  return out
}
