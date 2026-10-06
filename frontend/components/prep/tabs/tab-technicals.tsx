'use client'

import { useState, useMemo } from 'react'
import { GraduationCap } from 'lucide-react'
import type { ScenarioStock, OhlcvCandle } from '@/types/scenario'
import { TechnicalsTutorial } from './technicals-tutorial'
import { rsi as wilderRsi, adx as wilderAdx } from '@/lib/indicators/indicators'

// P9 (2026-10-03, Claude at Bhavya's request): RSI and ADX come from the tested lib/indicators
// (Wilder's definitions). With too little data they are NaN and shown as "—": the old code
// showed RSI 50 or a random ADX (20 + Math.random() × 10), i.e. invented numbers.
const num1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—')
const num0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '—')

interface TabTechnicalsProps {
  stock: ScenarioStock
  accent: string
}

export function TabTechnicals({ stock, accent }: TabTechnicalsProps) {
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const candles = stock.candles
  const closes = candles.map(c => c.close)
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const volumes = candles.map(c => c.volume)

  const ind = useMemo(() => computeAll(candles, closes, highs, lows, volumes), [candles, closes, highs, lows, volumes])

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontWeight: 600,
            fontSize: '20px',
            color: '#F4EDE0',
            margin: 0,
          }}>
            Technical Indicators — {stock.symbol}
          </h2>
          <div style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '11px',
            color: '#5C5849',
            fontStyle: 'italic',
            marginTop: '4px',
            letterSpacing: '0.04em',
          }}>
            11 indicators across 5 categories · computed from last 30 sessions · close ₹{stock.closePrice.toFixed(2)}
          </div>
        </div>
        <button
          onClick={() => setTutorialOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: 'linear-gradient(180deg, #06B6D4, #0E7490)',
            border: '1px solid #06B6D4',
            borderRadius: '8px',
            color: '#0B0F15',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            boxShadow: '0 6px 14px rgba(6,182,212,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          <GraduationCap size={15} strokeWidth={2.4}/>
          Indicators Tutorial
        </button>
      </div>

      {/* SECTION 1 — TREND */}
      <Section label="Trend Indicators" sub="Direction + strength of the prevailing move" tone="trend">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <MovingAverageCard ind={ind} accent={accent} />
          <ADXCard ind={ind} />
          <PriceMACard candles={candles} ind={ind} accent={accent} />
        </div>
      </Section>

      {/* SECTION 2 — MOMENTUM */}
      <Section label="Momentum Indicators" sub="How fast the move is unfolding (or running out of steam)" tone="momentum">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
          <RSICard ind={ind} />
          <StochasticCard ind={ind} />
          <WilliamsRCard ind={ind} />
          <MACDCard ind={ind} />
        </div>
      </Section>

      {/* SECTION 3 — VOLATILITY */}
      <Section label="Volatility Indicators" sub="How violent the swings are getting" tone="volatility">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px' }}>
          <BollingerCard candles={candles} ind={ind} accent={accent} />
          <ATRCard ind={ind} />
          <PriceDistanceCard ind={ind} />
        </div>
      </Section>

      {/* SECTION 4 — VOLUME */}
      <Section label="Volume & Money Flow" sub="Whether real money is following the price action" tone="volume">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <OBVCard ind={ind} />
          <VWAPCard ind={ind} />
        </div>
      </Section>

      {/* SECTION 5 — KEY LEVELS */}
      <Section label="Key Levels — Pivots & Fibonacci" sub="Pre-computed price levels many traders watch" tone="levels">
        <PivotFibCard ind={ind} />
      </Section>

      {/* SECTION 6 — VERDICT */}
      <Section label="Combined Verdict" sub="Confluence across all 11 indicators — green / yellow / red tilt" tone="verdict">
        <ConfluenceVerdict ind={ind} />
      </Section>

      <TechnicalsTutorial open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </div>
  )
}

// ─── Section shell ─────────────────────────────────────────

const TONE_COLOR: Record<string, string> = {
  trend:      '#5AB088',
  momentum:   '#06B6D4',
  volatility: '#FFB830',
  volume:     '#A855F7',
  levels:     '#D4A04D',
  verdict:    '#F4EDE0',
}

function Section({ label, sub, tone, children }: { label: string; sub: string; tone: string; children: React.ReactNode }) {
  const c = TONE_COLOR[tone]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
        <span style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '11px',
          fontWeight: 700,
          color: c,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontStyle: 'italic',
          fontSize: '12px',
          color: '#5C5849',
        }}>
          {sub}
        </span>
        <div style={{ flex: 1, height: '1px', background: `linear-gradient(90deg, ${c}40, transparent)` }} />
      </div>
      {children}
    </div>
  )
}

// ─── card shell ────────────────────────────────────────────

function Card({ title, children, status, statusColor, tutId }: { title: string; children: React.ReactNode; status?: string; statusColor?: string; tutId?: string }) {
  return (
    <div data-tut={tutId} style={{
      padding: '12px 14px',
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(212,160,77,0.14)',
      borderRadius: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px',
          fontWeight: 700,
          color: '#A89A7E',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}>
          {title}
        </span>
        {status && (
          <span style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            color: statusColor ?? '#A89A7E',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '2px 6px',
            background: `${statusColor ?? '#A89A7E'}1A`,
            border: `1px solid ${statusColor ?? '#A89A7E'}60`,
            borderRadius: '3px',
            whiteSpace: 'nowrap',
          }}>
            {status}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// ─── shared inline parts ───────────────────────────────────

function BigNum({ value, color }: { value: string; color?: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-jetbrains), monospace',
      fontSize: '22px',
      fontWeight: 700,
      color: color ?? '#F4EDE0',
      letterSpacing: '0.02em',
    }}>{value}</span>
  )
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px' }}>
      <span style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '10px',
        color: '#A89A7E',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: '11px',
        fontWeight: 600,
        color: color ?? '#F4EDE0',
      }}>{value}</span>
    </div>
  )
}

// ─── Cards ─────────────────────────────────────────────────

function MovingAverageCard({ ind, accent }: { ind: Indicators; accent: string }) {
  const above20 = ind.lastClose > ind.ma20
  const above50 = ind.lastClose > ind.ma50
  const golden  = ind.ma20 > ind.ma50
  const status = golden ? 'GOLDEN CROSS' : 'DEATH CROSS'
  const statusColor = golden ? '#5AB088' : '#E04A4A'
  return (
    <Card title="Moving Averages" status={status} statusColor={statusColor} tutId="ma">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Detail label="MA 20"           value={`₹${ind.ma20.toFixed(2)}`} color={accent} />
        <Detail label="MA 50"           value={`₹${ind.ma50.toFixed(2)}`} color="#A855F7" />
        <Detail label="Price vs MA20"   value={`${above20 ? '+' : ''}${(((ind.lastClose - ind.ma20) / ind.ma20) * 100).toFixed(2)}%`} color={above20 ? '#5AB088' : '#E04A4A'} />
        <Detail label="Price vs MA50"   value={`${above50 ? '+' : ''}${(((ind.lastClose - ind.ma50) / ind.ma50) * 100).toFixed(2)}%`} color={above50 ? '#5AB088' : '#E04A4A'} />
      </div>
    </Card>
  )
}

function ADXCard({ ind }: { ind: Indicators }) {
  const status = !Number.isFinite(ind.adx) ? 'N/A' : ind.adx > 40 ? 'STRONG' : ind.adx > 20 ? 'TRENDING' : 'RANGE'
  const statusColor = ind.adx > 40 ? '#5AB088' : ind.adx > 20 ? '#FFB830' : '#A89A7E'
  return (
    <Card title="ADX · Trend Strength" status={status} statusColor={statusColor} tutId="adx">
      <BigNum value={num1(ind.adx)} color={statusColor} />
      <div style={{ position: 'relative', height: '6px', background: 'rgba(212,160,77,0.10)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          width: `${Number.isFinite(ind.adx) ? Math.min(100, ind.adx) : 0}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #A89A7E, #FFB830, #5AB088)',
        }}/>
        <span style={{ position: 'absolute', left: '20%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.4)' }}/>
        <span style={{ position: 'absolute', left: '40%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.4)' }}/>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-inter), sans-serif', fontSize: '8px', color: '#5C5849', letterSpacing: '0.12em' }}>
        <span>NONE</span><span>20</span><span>40</span><span>STRONG</span>
      </div>
    </Card>
  )
}

function PriceMACard({ candles, ind, accent }: { candles: OhlcvCandle[]; ind: Indicators; accent: string }) {
  const closes = candles.map(c => c.close)
  return (
    <Card title="Price · MA20 · MA50">
      <MiniLineChart
        primary={closes}
        ma20={ind.ma20Series}
        ma50={ind.ma50Series}
        accent={accent}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-inter), sans-serif', fontSize: '9px', letterSpacing: '0.06em' }}>
        <span style={{ color: '#F4EDE0' }}>● Price</span>
        <span style={{ color: accent }}>● MA20</span>
        <span style={{ color: '#A855F7' }}>● MA50</span>
      </div>
    </Card>
  )
}

function RSICard({ ind }: { ind: Indicators }) {
  const status = !Number.isFinite(ind.rsi) ? 'N/A' : ind.rsi > 70 ? 'OVERBOUGHT' : ind.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL'
  const statusColor = ind.rsi > 70 ? '#E04A4A' : ind.rsi < 30 ? '#5AB088' : '#A89A7E'
  return (
    <Card title="RSI · 14-day" status={status} statusColor={statusColor} tutId="rsi">
      <BigNum value={num1(ind.rsi)} color={statusColor} />
      <div style={{
        position: 'relative',
        height: '6px',
        background: 'linear-gradient(90deg, #5AB088 0%, #5AB088 30%, #A89A7E 30%, #A89A7E 70%, #E04A4A 70%, #E04A4A 100%)',
        borderRadius: '3px',
      }}>
        <span style={{
          position: 'absolute',
          left: `${Number.isFinite(ind.rsi) ? ind.rsi : 50}%`,
          display: Number.isFinite(ind.rsi) ? undefined : 'none',
          top: '-3px',
          width: '2px', height: '12px',
          background: '#F4EDE0',
          boxShadow: '0 0 5px rgba(244,237,224,0.8)',
        }}/>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-inter), sans-serif', fontSize: '8px', color: '#5C5849', letterSpacing: '0.12em' }}>
        <span>0</span><span>30</span><span>70</span><span>100</span>
      </div>
    </Card>
  )
}

function StochasticCard({ ind }: { ind: Indicators }) {
  const status = ind.stochK > 80 ? 'OVERBOUGHT' : ind.stochK < 20 ? 'OVERSOLD' : ind.stochK > ind.stochD ? 'RISING' : 'FALLING'
  const statusColor = ind.stochK > 80 ? '#E04A4A' : ind.stochK < 20 ? '#5AB088' : ind.stochK > ind.stochD ? '#5AB088' : '#E04A4A'
  return (
    <Card title="Stochastic · 14/3" status={status} statusColor={statusColor} tutId="stoch">
      <BigNum value={ind.stochK.toFixed(1)} color={statusColor} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <Detail label="%K (fast)"  value={ind.stochK.toFixed(1)} color="#06B6D4" />
        <Detail label="%D (slow)"  value={ind.stochD.toFixed(1)} color="#A855F7" />
      </div>
    </Card>
  )
}

function WilliamsRCard({ ind }: { ind: Indicators }) {
  const status = ind.williamsR > -20 ? 'OVERBOUGHT' : ind.williamsR < -80 ? 'OVERSOLD' : 'NEUTRAL'
  const statusColor = ind.williamsR > -20 ? '#E04A4A' : ind.williamsR < -80 ? '#5AB088' : '#A89A7E'
  return (
    <Card title="Williams %R" status={status} statusColor={statusColor} tutId="williams">
      <BigNum value={ind.williamsR.toFixed(1)} color={statusColor} />
      <div style={{
        position: 'relative',
        height: '6px',
        background: 'linear-gradient(90deg, #E04A4A 0%, #E04A4A 20%, #A89A7E 20%, #A89A7E 80%, #5AB088 80%, #5AB088 100%)',
        borderRadius: '3px',
      }}>
        <span style={{
          position: 'absolute',
          left: `${100 + ind.williamsR}%`,
          top: '-3px',
          width: '2px', height: '12px',
          background: '#F4EDE0',
          boxShadow: '0 0 5px rgba(244,237,224,0.8)',
        }}/>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-inter), sans-serif', fontSize: '8px', color: '#5C5849', letterSpacing: '0.12em' }}>
        <span>−100</span><span>−80</span><span>−20</span><span>0</span>
      </div>
    </Card>
  )
}

function MACDCard({ ind }: { ind: Indicators }) {
  const cross = ind.macdHist >= 0 ? 'BULL CROSS' : 'BEAR CROSS'
  const c = ind.macdHist >= 0 ? '#5AB088' : '#E04A4A'
  return (
    <Card title="MACD · 12/26/9" status={cross} statusColor={c} tutId="macd">
      <BigNum value={ind.macd.toFixed(2)} color={c} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <Detail label="Signal"    value={ind.macdSignal.toFixed(2)} color="#A855F7" />
        <Detail label="Histogram" value={`${ind.macdHist >= 0 ? '+' : ''}${ind.macdHist.toFixed(2)}`} color={c} />
      </div>
    </Card>
  )
}

function BollingerCard({ candles, ind, accent }: { candles: OhlcvCandle[]; ind: Indicators; accent: string }) {
  const closes = candles.map(c => c.close)
  const inside = ind.lastClose < ind.bollUpper && ind.lastClose > ind.bollLower
  const status = ind.lastClose >= ind.bollUpper ? 'UPPER' : ind.lastClose <= ind.bollLower ? 'LOWER' : inside ? 'INSIDE' : 'NEUTRAL'
  const statusColor = ind.lastClose >= ind.bollUpper ? '#E04A4A' : ind.lastClose <= ind.bollLower ? '#5AB088' : '#A89A7E'
  return (
    <Card title="Bollinger Bands · 20/2σ" status={status} statusColor={statusColor} tutId="bollinger">
      <BollingerChart
        closes={closes}
        upper={ind.bollUpperSeries}
        middle={ind.ma20Series}
        lower={ind.bollLowerSeries}
        accent={accent}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '10px' }}>
        <span style={{ color: '#5AB088' }}>L · ₹{ind.bollLower.toFixed(2)}</span>
        <span style={{ color: '#A89A7E' }}>M · ₹{ind.ma20.toFixed(2)}</span>
        <span style={{ color: '#E04A4A' }}>U · ₹{ind.bollUpper.toFixed(2)}</span>
      </div>
    </Card>
  )
}

function ATRCard({ ind }: { ind: Indicators }) {
  return (
    <Card title="ATR · 14-day" tutId="atr">
      <BigNum value={`₹${ind.atr.toFixed(2)}`} color="#FFB830" />
      <Detail label="As % of price" value={`${((ind.atr / ind.lastClose) * 100).toFixed(2)}%`} />
      <Detail label="Stop suggestion (2× ATR)" value={`₹${(ind.lastClose - 2 * ind.atr).toFixed(2)}`} color="#E04A4A" />
    </Card>
  )
}

function PriceDistanceCard({ ind }: { ind: Indicators }) {
  return (
    <Card title="Distance from MA20">
      <BigNum value={`${ind.lastClose > ind.ma20 ? '+' : ''}${(((ind.lastClose - ind.ma20) / ind.ma20) * 100).toFixed(2)}%`} color={ind.lastClose > ind.ma20 ? '#5AB088' : '#E04A4A'} />
      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '10px',
        color: '#A89A7E',
        fontStyle: 'italic',
        lineHeight: 1.45,
      }}>
        {Math.abs(((ind.lastClose - ind.ma20) / ind.ma20) * 100) > 4
          ? 'Stretched — pullback to mean likely.'
          : 'Within normal range of mean.'}
      </div>
    </Card>
  )
}

function OBVCard({ ind }: { ind: Indicators }) {
  const trend = ind.obvTrend > 0 ? 'ACCUMULATING' : 'DISTRIBUTING'
  const c = ind.obvTrend > 0 ? '#5AB088' : '#E04A4A'
  return (
    <Card title="OBV · On-Balance Volume" status={trend} statusColor={c} tutId="obv">
      <BigNum value={`${ind.obv >= 0 ? '+' : ''}${(ind.obv / 100000).toFixed(1)}L`} color={c} />
      <Detail label="20-day Δ" value={`${ind.obvTrend >= 0 ? '+' : ''}${(ind.obvTrend / 100000).toFixed(1)}L`} color={c} />
      <Detail label="Reading" value={ind.obvTrend > 0 ? 'Money flowing IN' : 'Money flowing OUT'} color={c} />
    </Card>
  )
}

function VWAPCard({ ind }: { ind: Indicators }) {
  const above = ind.lastClose > ind.vwap
  const status = above ? 'ABOVE VWAP' : 'BELOW VWAP'
  const c = above ? '#5AB088' : '#E04A4A'
  return (
    <Card title="VWAP · Volume-Weighted Avg" status={status} statusColor={c} tutId="vwap">
      <BigNum value={`₹${ind.vwap.toFixed(2)}`} color="#A855F7" />
      <Detail label="Price vs VWAP" value={`${above ? '+' : ''}${(((ind.lastClose - ind.vwap) / ind.vwap) * 100).toFixed(2)}%`} color={c} />
      <Detail label="Reading" value={above ? 'Buyers in control' : 'Sellers in control'} color={c} />
    </Card>
  )
}

function PivotFibCard({ ind }: { ind: Indicators }) {
  return (
    <div data-tut="levels" style={{
      padding: '14px 16px',
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(212,160,77,0.14)',
      borderRadius: '6px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
    }}>
      {/* Pivot points */}
      <div>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px',
          fontWeight: 700,
          color: '#D4A04D',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}>Pivot Points · Classical</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { label: 'R3', v: ind.pp.r3, c: '#E04A4A' },
            { label: 'R2', v: ind.pp.r2, c: '#E04A4A' },
            { label: 'R1', v: ind.pp.r1, c: '#E04A4A' },
            { label: 'P (Pivot)', v: ind.pp.p, c: '#D4A04D' },
            { label: 'S1', v: ind.pp.s1, c: '#5AB088' },
            { label: 'S2', v: ind.pp.s2, c: '#5AB088' },
            { label: 'S3', v: ind.pp.s3, c: '#5AB088' },
          ].map(p => (
            <div key={p.label} style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '10px', fontWeight: 700, color: p.c, letterSpacing: '0.12em' }}>{p.label}</span>
              <span style={{
                flex: 1,
                height: '6px',
                background: `${p.c}1A`,
                borderRadius: '2px',
                position: 'relative',
              }}>
                <span style={{ position: 'absolute', inset: 0, background: p.c, opacity: ind.lastClose > p.v ? 0.4 : 0.15, borderRadius: '2px' }}/>
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', color: '#F4EDE0', fontWeight: 600 }}>₹{p.v.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Fibonacci */}
      <div>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px',
          fontWeight: 700,
          color: '#D4A04D',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}>Fibonacci Retracement</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { label: '0.0%',   v: ind.fib.f0,    c: '#5AB088' },
            { label: '23.6%',  v: ind.fib.f236,  c: '#5AB088' },
            { label: '38.2%',  v: ind.fib.f382,  c: '#FFB830' },
            { label: '50.0%',  v: ind.fib.f500,  c: '#FFB830' },
            { label: '61.8%',  v: ind.fib.f618,  c: '#E04A4A' },
            { label: '78.6%',  v: ind.fib.f786,  c: '#E04A4A' },
            { label: '100%',   v: ind.fib.f100,  c: '#E04A4A' },
          ].map(f => (
            <div key={f.label} style={{ display: 'grid', gridTemplateColumns: '50px 1fr auto', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '10px', fontWeight: 700, color: f.c, letterSpacing: '0.06em' }}>{f.label}</span>
              <span style={{ flex: 1, height: '6px', background: `${f.c}1A`, borderRadius: '2px' }}/>
              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '11px', color: '#F4EDE0', fontWeight: 600 }}>₹{f.v.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Confluence Verdict ───────────────────────────────────

function ConfluenceVerdict({ ind }: { ind: Indicators }) {
  const signals = computeConfluence(ind)
  const total = signals.length || 1
  const bullish = signals.filter(s => s.tilt === 'bull').length
  const bearish = signals.filter(s => s.tilt === 'bear').length
  const neutral = signals.filter(s => s.tilt === 'neutral').length
  const tilt = bullish > bearish + 1 ? 'BULLISH' : bearish > bullish + 1 ? 'BEARISH' : 'MIXED'
  const tiltColor = tilt === 'BULLISH' ? '#5AB088' : tilt === 'BEARISH' ? '#E04A4A' : '#FFB830'

  return (
    <div data-tut="verdict" style={{
      padding: '16px 18px',
      background: `linear-gradient(180deg, ${tiltColor}10, rgba(255,255,255,0.02))`,
      border: `1px solid ${tiltColor}50`,
      borderRadius: '8px',
      display: 'grid',
      gridTemplateColumns: '1fr 2fr',
      gap: '20px',
    }}>
      {/* Left — overall tilt */}
      <div>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px',
          fontWeight: 700,
          color: '#A89A7E',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          marginBottom: '6px',
        }}>Overall Tilt · {total} signals</div>
        <div style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: '32px',
          fontWeight: 700,
          color: tiltColor,
          letterSpacing: '0.04em',
          lineHeight: 1.1,
        }}>{tilt}</div>
        <div style={{
          display: 'flex',
          height: '8px',
          marginTop: '12px',
          borderRadius: '4px',
          overflow: 'hidden',
          background: 'rgba(212,160,77,0.10)',
        }}>
          <div style={{ width: `${(bullish / total) * 100}%`, background: '#5AB088' }}/>
          <div style={{ width: `${(neutral / total) * 100}%`, background: '#A89A7E' }}/>
          <div style={{ width: `${(bearish / total) * 100}%`, background: '#E04A4A' }}/>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '6px',
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '11px',
        }}>
          <span style={{ color: '#5AB088', fontWeight: 700 }}>{bullish} ↑</span>
          <span style={{ color: '#A89A7E', fontWeight: 700 }}>{neutral} ◇</span>
          <span style={{ color: '#E04A4A', fontWeight: 700 }}>{bearish} ↓</span>
        </div>
      </div>

      {/* Right — signal list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {signals.map((s, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '120px 1fr 70px',
            gap: '10px',
            padding: '5px 8px',
            background: s.tilt === 'bull' ? 'rgba(90,176,136,0.08)' : s.tilt === 'bear' ? 'rgba(224,74,74,0.08)' : 'rgba(168,154,126,0.06)',
            borderLeft: `2px solid ${s.tilt === 'bull' ? '#5AB088' : s.tilt === 'bear' ? '#E04A4A' : '#A89A7E'}`,
            borderRadius: '4px',
            alignItems: 'baseline',
          }}>
            <span style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '11px',
              fontWeight: 600,
              color: '#F4EDE0',
              letterSpacing: '0.04em',
            }}>{s.name}</span>
            <span style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontStyle: 'italic',
              fontSize: '11.5px',
              color: '#A89A7E',
            }}>{s.reading}</span>
            <span style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '9px',
              fontWeight: 700,
              color: s.tilt === 'bull' ? '#5AB088' : s.tilt === 'bear' ? '#E04A4A' : '#A89A7E',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              textAlign: 'right',
            }}>
              {s.tilt === 'bull' ? '↑ BULL' : s.tilt === 'bear' ? '↓ BEAR' : '◇ NEUT'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Mini line chart (price + MA) ─────────────────────────

function MiniLineChart({ primary, ma20, ma50, accent }: {
  primary: number[]; ma20: number[]; ma50: number[]; accent: string
}) {
  const w = 320, h = 70, pad = 4
  const all = [...primary, ...ma20.filter(v => v > 0), ...ma50.filter(v => v > 0)]
  if (all.length === 0) return null
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  const xStep = (w - pad * 2) / (primary.length - 1)
  const y = (v: number) => pad + (1 - (v - min) / range) * (h - pad * 2)
  const linePts = (arr: number[]) => arr.map((v, i) => v > 0 ? `${(pad + i * xStep).toFixed(1)},${y(v).toFixed(1)}` : null).filter(Boolean).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '70px' }}>
      <polyline points={linePts(primary)} fill="none" stroke="#F4EDE0" strokeWidth="1.4" strokeLinejoin="round"/>
      <polyline points={linePts(ma20)} fill="none" stroke={accent} strokeWidth="1.4" strokeLinejoin="round"/>
      <polyline points={linePts(ma50)} fill="none" stroke="#A855F7" strokeWidth="1.4" strokeLinejoin="round" strokeDasharray="4 2"/>
    </svg>
  )
}

// ─── Bollinger band chart ─────────────────────────────────

function BollingerChart({ closes, upper, middle, lower, accent }: {
  closes: number[]; upper: number[]; middle: number[]; lower: number[]; accent: string
}) {
  const w = 480, h = 90, pad = 4
  const all = [...closes, ...upper.filter(v => v > 0), ...lower.filter(v => v > 0)]
  if (all.length === 0) return null
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  const xStep = (w - pad * 2) / (closes.length - 1)
  const y = (v: number) => pad + (1 - (v - min) / range) * (h - pad * 2)
  const linePts = (arr: number[]) => arr.map((v, i) => v > 0 ? `${(pad + i * xStep).toFixed(1)},${y(v).toFixed(1)}` : null).filter(Boolean).join(' ')

  // band fill polygon
  const upperPts: string[] = []
  const lowerPts: string[] = []
  for (let i = 0; i < closes.length; i++) {
    if (upper[i] > 0) upperPts.push(`${(pad + i * xStep).toFixed(1)},${y(upper[i]).toFixed(1)}`)
    if (lower[i] > 0) lowerPts.push(`${(pad + i * xStep).toFixed(1)},${y(lower[i]).toFixed(1)}`)
  }
  const fillPath = `${upperPts.join(' ')} ${lowerPts.reverse().join(' ')}`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '90px' }}>
      {/* band fill */}
      <polygon points={fillPath} fill="rgba(212,160,77,0.10)"/>
      {/* upper / lower / middle */}
      <polyline points={linePts(upper)} fill="none" stroke="#E04A4A" strokeWidth="1" strokeDasharray="3 2"/>
      <polyline points={linePts(lower)} fill="none" stroke="#5AB088" strokeWidth="1" strokeDasharray="3 2"/>
      <polyline points={linePts(middle)} fill="none" stroke={accent} strokeWidth="1.2"/>
      {/* price */}
      <polyline points={linePts(closes)} fill="none" stroke="#F4EDE0" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════
// Math — all indicators in one shot
// ═══════════════════════════════════════════════════════════

interface Indicators {
  lastClose: number
  ma20: number; ma50: number
  ma20Series: number[]; ma50Series: number[]
  rsi: number
  macd: number; macdSignal: number; macdHist: number
  stochK: number; stochD: number
  williamsR: number
  adx: number
  bollUpper: number; bollLower: number
  bollUpperSeries: number[]; bollLowerSeries: number[]
  atr: number
  obv: number; obvTrend: number
  vwap: number
  pp: { p: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number }
  fib: { f0: number; f236: number; f382: number; f500: number; f618: number; f786: number; f100: number }
}

function computeAll(candles: OhlcvCandle[], closes: number[], highs: number[], lows: number[], volumes: number[]): Indicators {
  const lastClose = closes[closes.length - 1] ?? 0
  const ma20Series = sma(closes, 20)
  const ma50Series = sma(closes, 50)

  // RSI
  const rsi = wilderRsi(closes, 14) ?? NaN

  // MACD
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const macdSeries = closes.map((_, i) => ema12[i] - ema26[i])
  const signalSeries = ema(macdSeries, 9)

  // Stochastic
  const stoch = computeStochastic(highs, lows, closes, 14, 3)

  // Williams %R
  const williamsR = computeWilliamsR(highs, lows, closes, 14)

  // ADX
  const adx = wilderAdx(candles, 14) ?? NaN

  // Bollinger
  const bollUpperSeries: number[] = []
  const bollLowerSeries: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < 19) { bollUpperSeries.push(0); bollLowerSeries.push(0); continue }
    const slice = closes.slice(i - 19, i + 1)
    const m = ma20Series[i]
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length)
    bollUpperSeries.push(m + 2 * std)
    bollLowerSeries.push(m - 2 * std)
  }

  // ATR
  const atr = computeATR(highs, lows, closes, 14)

  // OBV
  const obv = computeOBV(closes, volumes)
  const obvTrend = volumes.length >= 20 ? computeOBVTrend(closes.slice(-20), volumes.slice(-20)) : 0

  // VWAP
  const vwap = computeVWAP(highs, lows, closes, volumes)

  // Pivot points (using last candle as "prev day")
  const last = candles[candles.length - 1]
  const pp = computePivots(last?.high ?? 0, last?.low ?? 0, last?.close ?? 0)

  // Fibonacci on swing high/low
  const swingHigh = Math.max(...highs)
  const swingLow = Math.min(...lows)
  const fib = computeFib(swingHigh, swingLow)

  return {
    lastClose,
    ma20: ma20Series[ma20Series.length - 1] ?? lastClose,
    ma50: ma50Series[ma50Series.length - 1] ?? lastClose,
    ma20Series, ma50Series,
    rsi,
    macd: macdSeries[macdSeries.length - 1] ?? 0,
    macdSignal: signalSeries[signalSeries.length - 1] ?? 0,
    macdHist: (macdSeries[macdSeries.length - 1] ?? 0) - (signalSeries[signalSeries.length - 1] ?? 0),
    stochK: stoch.k, stochD: stoch.d,
    williamsR,
    adx,
    bollUpper: bollUpperSeries[bollUpperSeries.length - 1] ?? lastClose,
    bollLower: bollLowerSeries[bollLowerSeries.length - 1] ?? lastClose,
    bollUpperSeries, bollLowerSeries,
    atr,
    obv, obvTrend,
    vwap,
    pp, fib,
  }
}

function sma(arr: number[], n: number): number[] {
  if (n <= 0) return arr.map(() => 0)
  return arr.map((_, i) => {
    if (i < n - 1) return 0
    return arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n
  })
}
function ema(arr: number[], n: number): number[] {
  if (arr.length === 0) return []
  const k = 2 / (n + 1)
  const out: number[] = [arr[0]]
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k))
  return out
}
function computeStochastic(highs: number[], lows: number[], closes: number[], k: number, d: number): { k: number; d: number } {
  if (closes.length < k) return { k: 50, d: 50 }
  const hh = Math.max(...highs.slice(-k))
  const ll = Math.min(...lows.slice(-k))
  const last = closes[closes.length - 1]
  const kVal = ((last - ll) / Math.max(0.0001, hh - ll)) * 100
  // %D = SMA of last d %K values
  const kSeries: number[] = []
  for (let i = closes.length - d; i < closes.length; i++) {
    if (i < k - 1) { kSeries.push(50); continue }
    const slice_h = highs.slice(i - k + 1, i + 1)
    const slice_l = lows.slice(i - k + 1, i + 1)
    const hh2 = Math.max(...slice_h)
    const ll2 = Math.min(...slice_l)
    kSeries.push(((closes[i] - ll2) / Math.max(0.0001, hh2 - ll2)) * 100)
  }
  const dVal = kSeries.reduce((a, b) => a + b, 0) / Math.max(1, kSeries.length)
  return { k: kVal, d: dVal }
}
function computeWilliamsR(highs: number[], lows: number[], closes: number[], period: number): number {
  if (closes.length < period) return -50
  const hh = Math.max(...highs.slice(-period))
  const ll = Math.min(...lows.slice(-period))
  const last = closes[closes.length - 1]
  return ((hh - last) / Math.max(0.0001, hh - ll)) * -100
}
function computeATR(highs: number[], lows: number[], closes: number[], period: number): number {
  if (closes.length < 2) return 0
  const tr: number[] = []
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  const sliceTR = tr.slice(-period)
  return sliceTR.reduce((a, b) => a + b, 0) / sliceTR.length
}
function computeOBV(closes: number[], volumes: number[]): number {
  let obv = 0
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i]
    else if (closes[i] < closes[i - 1]) obv -= volumes[i]
  }
  return obv
}
function computeOBVTrend(closes: number[], volumes: number[]): number {
  let obv = 0
  let firstHalf = 0
  for (let i = 1; i < closes.length; i++) {
    const dir = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0
    obv += dir * volumes[i]
    if (i === Math.floor(closes.length / 2)) firstHalf = obv
  }
  return obv - firstHalf
}
function computeVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
  let pv = 0, v = 0
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3
    pv += tp * volumes[i]
    v += volumes[i]
  }
  return v > 0 ? pv / v : closes[closes.length - 1] ?? 0
}
function computePivots(h: number, l: number, c: number) {
  const p = (h + l + c) / 3
  return {
    p,
    r1: 2 * p - l,
    r2: p + (h - l),
    r3: h + 2 * (p - l),
    s1: 2 * p - h,
    s2: p - (h - l),
    s3: l - 2 * (h - p),
  }
}
function computeFib(swingHigh: number, swingLow: number) {
  const range = swingHigh - swingLow
  return {
    f0:    swingHigh,
    f236:  swingHigh - range * 0.236,
    f382:  swingHigh - range * 0.382,
    f500:  swingHigh - range * 0.500,
    f618:  swingHigh - range * 0.618,
    f786:  swingHigh - range * 0.786,
    f100:  swingLow,
  }
}

// ─── confluence scoring ───────────────────────────────────

interface Signal {
  name: string
  reading: string
  tilt: 'bull' | 'bear' | 'neutral'
}
function computeConfluence(ind: Indicators): Signal[] {
  const out: Signal[] = []
  // Trend
  const above20 = ind.lastClose > ind.ma20
  out.push({ name: 'MA20',         reading: above20 ? 'Price above MA20' : 'Price below MA20', tilt: above20 ? 'bull' : 'bear' })
  const above50 = ind.lastClose > ind.ma50
  out.push({ name: 'MA50',         reading: above50 ? 'Price above MA50' : 'Price below MA50', tilt: above50 ? 'bull' : 'bear' })
  out.push({ name: 'ADX',          reading: !Number.isFinite(ind.adx) ? 'Not enough data' : ind.adx > 25 ? `Strong trend (${num0(ind.adx)})` : `Weak (${num0(ind.adx)})`, tilt: ind.adx > 25 ? (above20 ? 'bull' : 'bear') : 'neutral' })
  // Momentum
  out.push({ name: 'RSI',          reading: !Number.isFinite(ind.rsi) ? 'Not enough data' : ind.rsi > 70 ? `Overbought (${num0(ind.rsi)})` : ind.rsi < 30 ? `Oversold (${num0(ind.rsi)})` : `Neutral (${num0(ind.rsi)})`, tilt: ind.rsi > 70 ? 'bear' : ind.rsi < 30 ? 'bull' : 'neutral' })
  out.push({ name: 'Stochastic',   reading: ind.stochK > 80 ? `Overbought (${ind.stochK.toFixed(0)})` : ind.stochK < 20 ? `Oversold (${ind.stochK.toFixed(0)})` : `Neutral (${ind.stochK.toFixed(0)})`, tilt: ind.stochK > 80 ? 'bear' : ind.stochK < 20 ? 'bull' : 'neutral' })
  out.push({ name: 'Williams %R',  reading: ind.williamsR > -20 ? 'Overbought' : ind.williamsR < -80 ? 'Oversold' : 'Neutral', tilt: ind.williamsR > -20 ? 'bear' : ind.williamsR < -80 ? 'bull' : 'neutral' })
  out.push({ name: 'MACD',         reading: ind.macdHist >= 0 ? 'Bull crossover' : 'Bear crossover', tilt: ind.macdHist >= 0 ? 'bull' : 'bear' })
  // Volatility
  const bb = ind.lastClose >= ind.bollUpper ? 'Touching upper band' : ind.lastClose <= ind.bollLower ? 'Touching lower band' : 'Inside bands'
  out.push({ name: 'Bollinger',    reading: bb, tilt: ind.lastClose >= ind.bollUpper ? 'bear' : ind.lastClose <= ind.bollLower ? 'bull' : 'neutral' })
  // Volume
  out.push({ name: 'OBV',          reading: ind.obvTrend > 0 ? 'Money flowing in' : 'Money flowing out', tilt: ind.obvTrend > 0 ? 'bull' : 'bear' })
  out.push({ name: 'VWAP',         reading: ind.lastClose > ind.vwap ? 'Above VWAP' : 'Below VWAP', tilt: ind.lastClose > ind.vwap ? 'bull' : 'bear' })
  // Pivots
  out.push({ name: 'Pivot',        reading: ind.lastClose > ind.pp.p ? 'Above pivot' : 'Below pivot', tilt: ind.lastClose > ind.pp.p ? 'bull' : 'bear' })
  return out
}
