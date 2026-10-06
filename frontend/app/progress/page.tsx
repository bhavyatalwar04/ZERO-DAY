import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { GlobalNav } from '@/components/layout/global-nav'
import { progression, isScorecard } from '@/lib/scoring/progression'
import type { Scorecard } from '@/lib/scoring/scorecard'
import { PATTERN_LABELS } from '@/lib/monitor/templates'
import { SCENARIOS } from '@/lib/engine/scenarios'

// 5.3 scorecard + 5.4/7.4 progression dashboard. Server-rendered from the user's own
// sessions (RLS); every number was computed by the server by replay at session end.
// Written by Claude at Bhavya's request (2026-10-03).

export const dynamic = 'force-dynamic'

const GOLD = '#D4A04D'
const MUTED = '#8A8A8A'
const card: React.CSSProperties = { background: '#0A0A0A', border: '1px solid #1F1F1F', borderRadius: '10px', padding: '18px 20px' }
const label: React.CSSProperties = { fontFamily: 'var(--font-inter), sans-serif', fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: MUTED }
const big: React.CSSProperties = { fontFamily: 'var(--font-jetbrains), monospace', fontSize: '22px', color: '#E8E8E8', marginTop: '6px' }
const pct = (n: number | null | undefined, sign = true) => (n === null || n === undefined ? '—' : `${sign && n > 0 ? '+' : ''}${n}%`)
const tone = (n: number) => (n > 0 ? '#5AB088' : n < 0 ? '#E04A4A' : '#E8E8E8')

export default async function ProgressPage() {
  const supabase = await createClient()
  const { data } = await supabase.from('sessions')
    .select('id, scenario_id, status, started_at, ended_at, result')
    .order('started_at', { ascending: false }).limit(100)
  const rows = (data ?? []) as { id: string; scenario_id: string; status: string; started_at: string; ended_at: string | null; result: unknown }[]
  const prog = progression(rows)
  const latestRow = rows.find(r => isScorecard(r.result))
  const latest = latestRow?.result as Scorecard | undefined

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(212,160,77,0.06), transparent 55%), #000', color: '#E0E0E0' }}>
      <GlobalNav />
      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '96px 16px 64px' }}>
        <h1 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '34px', fontWeight: 500, margin: 0 }}>Your progress</h1>
        <p style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '14px', color: MUTED, marginTop: '8px', maxWidth: '680px', lineHeight: 1.6 }}>
          Every number here is recomputed on the server from your session log when a session ends, so it is the same whether you look today or in a month.
        </p>

        {!latest ? (
          <div style={{ ...card, marginTop: '28px' }}>
            <div style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '18px' }}>No scored sessions yet.</div>
            <p style={{ color: MUTED, fontSize: '14px', fontFamily: 'var(--font-inter), sans-serif' }}>
              Play a session to the closing bell (or end it) while signed in, and your scorecard appears here.
            </p>
            <Link href="/sim/COV-20/live" style={{ color: GOLD, fontFamily: 'var(--font-inter), sans-serif', fontSize: '14px' }}>Start COV-20 →</Link>
          </div>
        ) : (
          <>
            <h2 style={{ ...label, marginTop: '36px', fontSize: '11px' }}>
              Latest session · {SCENARIOS[latest.scenarioId]?.label ?? latest.scenarioId}{latest.reachedClose ? '' : ' · ended early'}
            </h2>
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '12px' }}>
              <div style={card}><div style={label}>Return</div><div style={{ ...big, color: tone(latest.financial.returnPct) }}>{pct(latest.financial.returnPct)}</div></div>
              <div style={card}><div style={label}>vs buy-and-hold</div><div style={{ ...big, color: tone(latest.vsBuyAndHoldPts) }}>{latest.vsBuyAndHoldPts > 0 ? '+' : ''}{latest.vsBuyAndHoldPts} pts</div></div>
              <div style={card}><div style={label}>Max drawdown</div><div style={big}>{pct(latest.financial.maxDrawdownPct, false)}</div></div>
              <div style={card}><div style={label}>Session Sharpe</div><div style={big}>{latest.financial.sessionSharpe ?? '—'}</div></div>
              <div style={card}><div style={label}>Win rate</div><div style={big}>{pct(latest.financial.winRatePct, false)}</div></div>
              <div style={card}><div style={label}>Avg hold</div><div style={big}>{latest.financial.avgHoldMinutes === null ? '—' : `${latest.financial.avgHoldMinutes} min`}</div></div>
              <div style={card}><div style={label}>Discipline</div><div style={{ ...big, color: GOLD }}>{latest.behaviour.disciplineScore ?? '—'}{latest.behaviour.disciplineScore !== null ? '/100' : ''}</div></div>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px', marginTop: '12px' }}>
              <div style={card}>
                <div style={label}>Decisions flagged by the Monitor</div>
                <table style={{ width: '100%', marginTop: '10px', fontFamily: 'var(--font-inter), sans-serif', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <tbody>
                    {Object.entries(latest.behaviour.events).map(([k, n]) => (
                      <tr key={k} style={{ borderTop: '1px solid #161616' }}>
                        <td style={{ padding: '6px 0', color: n ? '#E0E0E0' : MUTED }}>{PATTERN_LABELS[k] ?? k}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-jetbrains), monospace', color: n ? GOLD : MUTED }}>{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ color: MUTED, fontSize: '12px', fontFamily: 'var(--font-inter), sans-serif', marginTop: '10px' }}>
                  {latest.behaviour.flaggedOrders} of {latest.behaviour.acceptedOrders} orders flagged. Discipline = share of orders with none of these patterns.
                </p>
              </div>
              <div style={card}>
                <div style={label}>Same day, other strategies (same engine, same prices)</div>
                <table style={{ width: '100%', marginTop: '10px', fontFamily: 'var(--font-inter), sans-serif', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ color: MUTED, textAlign: 'left' }}><th style={{ fontWeight: 500 }}>Strategy</th><th style={{ fontWeight: 500, textAlign: 'right' }}>Return</th><th style={{ fontWeight: 500, textAlign: 'right' }}>Max DD</th></tr></thead>
                  <tbody>
                    {[
                      ['You', latest.financial.returnPct, latest.financial.maxDrawdownPct],
                      ['Buy & hold (equal weight)', latest.baselines.buyAndHold.returnPct, latest.baselines.buyAndHold.maxDrawdownPct],
                      ['Rule: sell any stock 3% under cost', latest.baselines.ruleBased.returnPct, latest.baselines.ruleBased.maxDrawdownPct],
                      ['Stay in cash', 0, 0],
                    ].map(([name, ret, dd]) => (
                      <tr key={name as string} style={{ borderTop: '1px solid #161616' }}>
                        <td style={{ padding: '6px 0' }}>{name}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-jetbrains), monospace', color: tone(ret as number) }}>{pct(ret as number)}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-jetbrains), monospace' }}>{pct(dd as number, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <h2 style={{ ...label, marginTop: '36px', fontSize: '11px' }}>Across sessions</h2>
        <div style={{ ...card, marginTop: '12px' }}>
          <TrendLine prog={prog} />
          {prog.points.length > 0 && (
            <table style={{ width: '100%', marginTop: '14px', fontFamily: 'var(--font-inter), sans-serif', fontSize: '13px', borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ fontWeight: 500 }}>#</th><th style={{ fontWeight: 500 }}>Ended</th><th style={{ fontWeight: 500 }}>Scenario</th>
                <th style={{ fontWeight: 500, textAlign: 'right' }}>Flagged / 10 orders</th><th style={{ fontWeight: 500, textAlign: 'right' }}>Return</th><th style={{ fontWeight: 500, textAlign: 'right' }}>Audit</th>
              </tr></thead>
              <tbody>
                {prog.points.map((p, i) => (
                  <tr key={p.sessionId} style={{ borderTop: '1px solid #161616' }}>
                    <td style={{ padding: '6px 0', color: MUTED }}>{i + 1}</td>
                    <td style={{ padding: '6px 0' }}>{new Date(p.endedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td style={{ padding: '6px 0' }}>{p.scenarioId}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-jetbrains), monospace' }}>{p.flaggedPer10 ?? '—'}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--font-jetbrains), monospace', color: tone(p.returnPct) }}>{pct(p.returnPct)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}><Link href={`/progress/${p.sessionId}`} style={{ color: GOLD }}>Replay →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}

function TrendLine({ prog }: { prog: ReturnType<typeof progression> }) {
  const text = { fontFamily: 'var(--font-inter), sans-serif', fontSize: '14px', lineHeight: 1.6 } as const
  if (prog.judged < 2) return <p style={{ ...text, color: MUTED, margin: 0 }}>Play at least two sessions with trades to see a trend. {prog.points.length ? `${prog.points.length} scored so far.` : ''}</p>
  const better = prog.secondHalf! < prog.firstHalf!
  const series = prog.points.map(p => p.flaggedPer10).filter((v): v is number => v !== null)
  const max = Math.max(1, ...series)
  const w = 320, h = 70
  const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1)) * w},${h - (v / max) * (h - 8) - 4}`).join(' ')
  return (
    <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Flagged decisions per 10 orders, by session">
        <polyline points={pts} fill="none" stroke={GOLD} strokeWidth="2" />
      </svg>
      <p style={{ ...text, margin: 0, maxWidth: '520px' }}>
        Flagged decisions per 10 orders went from <b>{prog.firstHalf}</b> (first half of your sessions) to <b>{prog.secondHalf}</b> (second half){' '}
        <span style={{ color: better ? '#5AB088' : '#E04A4A' }}>{better ? '· fewer mistakes' : prog.secondHalf === prog.firstHalf ? '· no change' : '· more mistakes'}</span>.
        {prog.flaggedSlope !== null && <> Trend: {prog.flaggedSlope > 0 ? '+' : ''}{prog.flaggedSlope} per session.</>}
        <span style={{ color: MUTED }}> Descriptive only: with a handful of sessions this is not a statistical result.</span>
      </p>
    </div>
  )
}
