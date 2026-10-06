'use client'

import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RotateCcw, TrendingUp, AlertTriangle, Target, BookOpen, User, GraduationCap, FileText, Clock, ArrowRight, Compass } from 'lucide-react'
import { GlobalNav } from '@/components/layout/global-nav'
import { readTrace } from '@/lib/behavior/tracer'
import { computeProfile } from '@/lib/behavior/profile'
import { detectMistakes } from '@/lib/behavior/mistakes'
import { classifyArchetype } from '@/lib/behavior/archetype'
import type { ArchetypeCard, BehaviorProfile, DebriefResponse, Mistake, TraceEvent } from '@/lib/behavior/types'
import { SCENARIOS, DEFAULT_SCENARIO } from '@/lib/engine/scenarios'
import { formatMoney, signedMoney, type MarketSpec } from '@/lib/engine/markets'

type LoadState = 'loading' | 'no-data' | 'computing' | 'streaming' | 'ready' | 'fallback'

export default function DebriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { market } = SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO]
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [profile, setProfile] = useState<BehaviorProfile | null>(null)
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [archetype, setArchetype] = useState<ArchetypeCard | null>(null)
  const [debrief, setDebrief] = useState<DebriefResponse | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])

  useEffect(() => {
    const persisted = readTrace()
    if (!persisted || persisted.events.length === 0) {
      setLoadState('no-data')
      return
    }
    setEvents(persisted.events)
    const p = computeProfile(persisted.events)
    const m = detectMistakes(p, persisted.events)
    const a = classifyArchetype(p, m)
    setProfile(p); setMistakes(m); setArchetype(a)
    setLoadState('streaming')

    // Pick the most diagnostic events for the LLM
    const keyEvents = pickKeyEvents(persisted.events)

    fetch('/api/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: id, archetype: a, profile: p, mistakes: m, keyEvents }),
    })
      .then(r => r.json())
      .then(json => {
        if (json && typeof json.narrative === 'string') {
          setDebrief(json)
          setLoadState('ready')
        } else {
          setLoadState('fallback')
        }
      })
      .catch(() => setLoadState('fallback'))
  }, [id])

  if (loadState === 'loading') return <FullScreenMessage title="Loading session…"/>
  if (loadState === 'no-data') {
    return (
      <FullScreenMessage
        title="No session data found"
        body="Start and complete a live session first. Your trade trace is captured automatically."
        action={{ label: 'Go to Live Room', onClick: () => router.push(`/sim/${id}/live`) }}
      />
    )
  }
  if (!profile || !archetype) return <FullScreenMessage title="Computing your behavior profile…"/>

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000',
      color: '#E0E0E0',
    }}>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(212,160,77,0.06), transparent 55%), #000',
      }}/>

      <GlobalNav accent="D4A04D"/>

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '1100px', margin: '0 auto', padding: '32px 24px 64px' }}>
        {/* Section header strip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
          <div style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontSize: '32px', fontWeight: 700, color: '#F0F0F0',
            letterSpacing: '-0.01em', lineHeight: 1.1,
          }}>Debrief · <span style={{ fontStyle: 'italic', color: '#D4A04D' }}>{id}</span></div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => router.push(`/sim/${id}/live`)} style={topBtn}>
              <ArrowLeft size={12}/> New Session
            </button>
            <button onClick={() => location.reload()} style={topBtn}>
              <RotateCcw size={11}/> Refresh
            </button>
          </div>
        </div>

        {/* PANEL 1 — Headline */}
        <HeadlinePanel profile={profile} archetype={archetype} market={market}/>

        {/* PANEL 2 — Story */}
        <StoryPanel debrief={debrief} loadState={loadState} profile={profile} market={market}/>

        {/* PANEL 3 — Signature stats */}
        <StatsPanel profile={profile}/>

        {/* PANEL · Per-Trade Breakdown */}
        <TradeBreakdownPanel debrief={debrief} loadState={loadState} market={market}/>

        {/* PANEL · Critical Moments timeline */}
        <CriticalMomentsPanel debrief={debrief} loadState={loadState}/>

        {/* PANEL · Market Timing */}
        <MarketTimingPanel debrief={debrief} loadState={loadState}/>

        {/* PANEL · Wins */}
        <WinsPanel debrief={debrief} loadState={loadState} profile={profile}/>

        {/* PANEL · Mistakes (grouped, with counterfactuals) */}
        <MistakesPanel debrief={debrief} mistakes={mistakes} loadState={loadState}/>

        {/* PANEL 6 — Archetype card */}
        <ArchetypePanel archetype={archetype} tomorrow={debrief?.tomorrow}/>

        {/* CROSS-FLOW — refresh in academy */}
        <AcademyRefreshPanel mistakes={mistakes} router={router}/>

        {/* DEV: raw event count */}
        <div style={{
          marginTop: '40px', textAlign: 'center',
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '9px', color: '#404040',
          letterSpacing: '0.12em',
        }}>{events.length} events captured · {mistakes.length} mistakes flagged · archetype confidence {(archetype.confidence * 100).toFixed(0)}%</div>
      </div>
    </div>
  )
}

// ── PANELS ───────────────────────────────────────────────────

function HeadlinePanel({ profile, archetype, market }: { profile: BehaviorProfile; archetype: ArchetypeCard; market: MarketSpec }) {
  const isUp = profile.dayPnL >= 0
  return (
    <div style={{
      padding: '36px 40px',
      background: 'linear-gradient(160deg, #0D0D0D 0%, #060606 100%)',
      border: `1px solid ${isUp ? '#10B98155' : '#FF1F1F55'}`,
      borderTop: `3px solid ${isUp ? '#10B981' : '#FF1F1F'}`,
      borderRadius: '12px',
      marginBottom: '20px',
      boxShadow: `0 0 60px ${isUp ? 'rgba(16,185,129,0.15)' : 'rgba(255,31,31,0.15)'}`,
    }}>
      <div style={{
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: '10px', fontWeight: 800,
        color: '#D4A04D', letterSpacing: '0.24em', textTransform: 'uppercase',
        marginBottom: '12px',
      }}>The {archetype.archetype} Trader</div>

      <div style={{
        fontFamily: 'var(--font-fraunces), serif',
        fontSize: '40px', fontWeight: 700,
        color: '#F0F0F0', lineHeight: 1.1, letterSpacing: '-0.02em',
        marginBottom: '8px',
      }}>
        Closed the day {signedMoney(profile.dayPnL, market)}
        <span style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: '20px', fontWeight: 700,
          color: isUp ? '#10B981' : '#FF1F1F',
          marginLeft: '14px',
        }}>{isUp ? '▲ +' : '▼ '}{Math.abs(profile.dayPnLPct).toFixed(2)}%</span>
      </div>

      <p style={{
        fontFamily: 'var(--font-fraunces), serif',
        fontStyle: 'italic',
        fontSize: '15px', color: '#A0A0A0',
        lineHeight: 1.6, margin: 0,
      }}>{archetype.oneLiner}</p>
    </div>
  )
}

function StoryPanel({ debrief, loadState, profile, market }: { debrief: DebriefResponse | null; loadState: LoadState; profile: BehaviorProfile; market: MarketSpec }) {
  return (
    <Section icon={<BookOpen size={11}/>} label="Story of Your Day" color="#D4A04D">
      {loadState === 'streaming' && <SkeletonText lines={6}/>}
      {(loadState === 'ready' || loadState === 'fallback') && (
        <div style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: '15px', color: '#D0D0D0',
          lineHeight: 1.75,
          whiteSpace: 'pre-wrap',
        }}>
          {debrief?.narrative ?? `You placed ${profile.tradeCount} trades and closed ${signedMoney(profile.dayPnL, market)} on the day.`}
        </div>
      )}
    </Section>
  )
}

function StatsPanel({ profile }: { profile: BehaviorProfile }) {
  const stats = [
    { label: 'Trades', value: `${profile.tradeCount}`, hint: profile.tradeCount > 6 ? 'High frequency' : profile.tradeCount === 0 ? 'Frozen' : 'Measured' },
    { label: 'Win Rate', value: `${Math.round(profile.winRate * 100)}%`, hint: profile.sellCount === 0 ? 'No closed trades' : profile.winRate >= 0.5 ? 'Strong' : 'Below 50%' },
    { label: 'SL Usage', value: `${Math.round(profile.slUsageRate * 100)}%`, hint: profile.slUsageRate >= 0.7 ? 'Disciplined' : profile.slUsageRate < 0.3 ? 'Risk exposed' : 'Inconsistent' },
    { label: 'Avg Size', value: `${(profile.avgPositionSizePct * 100).toFixed(0)}%`, hint: profile.avgPositionSizePct > 0.30 ? 'Aggressive' : profile.avgPositionSizePct < 0.05 ? 'Tiny' : 'Sensible' },
    { label: 'Thesis Rate', value: `${Math.round(profile.thesisRate * 100)}%`, hint: profile.thesisRate >= 0.6 ? 'Thoughtful' : 'Reflexive' },
    { label: 'News Read', value: `${Math.round(profile.newsViewedRate * 100)}%`, hint: profile.newsViewedRate >= 0.5 ? 'Informed' : 'Uninformed' },
  ]
  return (
    <Section icon={<Target size={11}/>} label="Signature Stats" color="#3B82F6">
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px',
      }}>
        {stats.map(s => (
          <div key={s.label} style={{
            padding: '14px 16px',
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
          }}>
            <div style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '9px', fontWeight: 700, color: '#606060',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              marginBottom: '6px',
            }}>{s.label}</div>
            <div style={{
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '22px', fontWeight: 700, color: '#F0F0F0',
              lineHeight: 1, marginBottom: '4px',
            }}>{s.value}</div>
            <div style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontStyle: 'italic',
              fontSize: '11px', color: '#808080',
            }}>{s.hint}</div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function WinsPanel({ debrief, loadState, profile }: { debrief: DebriefResponse | null; loadState: LoadState; profile: BehaviorProfile }) {
  const wins = debrief?.wins ?? []
  return (
    <Section icon={<TrendingUp size={11}/>} label="What You Got Right" color="#10B981">
      {loadState === 'streaming' && <SkeletonText lines={3}/>}
      {wins.length === 0 && loadState !== 'streaming' && (
        <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '13px', color: '#808080' }}>
          {profile.tradeCount === 0
            ? 'No trades to evaluate — but sitting out a day you do not understand is a legitimate decision.'
            : 'Few clear wins this session. The session was the lesson.'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {wins.map((w, i) => (
          <div key={i} style={{
            padding: '14px 16px',
            background: 'rgba(16,185,129,0.06)',
            border: '1px solid rgba(16,185,129,0.30)',
            borderLeft: '3px solid #10B981',
            borderRadius: '5px',
          }}>
            <div style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '13px', fontWeight: 700, color: '#10B981',
              letterSpacing: '0.04em', marginBottom: '4px',
            }}>{w.headline}</div>
            <div style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontSize: '13px', color: '#C0C0C0', lineHeight: 1.6,
            }}>{w.detail}</div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function MistakesPanel({ debrief, mistakes, loadState }: { debrief: DebriefResponse | null; mistakes: Mistake[]; loadState: LoadState }) {
  const llmMistakes = debrief?.mistakes ?? []
  const ruleSeverityById = new Map<string, string>()
  for (const m of mistakes) ruleSeverityById.set(m.id, m.severity)

  // Group from rules-engine if LLM didn't provide grouped data
  const groupedFallback: Array<{ mistakeId: string; headline: string; explanation: string; counterfactual: string; evidences: string[]; severity: string }> = []
  if (llmMistakes.length === 0 && mistakes.length > 0) {
    const map = new Map<string, { mistakeId: string; headline: string; explanation: string; counterfactual: string; evidences: string[]; severity: string }>()
    for (const m of mistakes) {
      const ex = map.get(m.id)
      if (ex) ex.evidences.push(m.evidence)
      else map.set(m.id, {
        mistakeId: m.id,
        headline: m.id.replace(/_/g, ' ').toLowerCase(),
        explanation: m.evidence,
        counterfactual: 'Apply the relevant rule from the Academy playlists.',
        evidences: [m.evidence],
        severity: m.severity,
      })
    }
    groupedFallback.push(...map.values())
  }

  const items = llmMistakes.length > 0
    ? llmMistakes.map(m => ({ ...m, severity: ruleSeverityById.get(m.mistakeId) ?? 'med' }))
    : groupedFallback

  return (
    <Section icon={<AlertTriangle size={11}/>} label="What to Work On" color="#FF1F1F">
      {loadState === 'streaming' && <SkeletonText lines={5}/>}
      {items.length === 0 && loadState !== 'streaming' && (
        <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '13px', color: '#808080' }}>
          No major mistakes detected. Continue building consistency.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {items.map((m, i) => (
          <div key={i} style={{
            padding: '16px 18px',
            background: 'rgba(255,31,31,0.06)',
            border: '1px solid rgba(255,31,31,0.30)',
            borderLeft: `3px solid ${m.severity === 'high' ? '#FF1F1F' : m.severity === 'med' ? '#D4A04D' : '#808080'}`,
            borderRadius: '5px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '8px', fontWeight: 800,
                color: m.severity === 'high' ? '#FF1F1F' : m.severity === 'med' ? '#D4A04D' : '#808080',
                letterSpacing: '0.2em', textTransform: 'uppercase',
              }}>{m.severity}</span>
              <span style={{
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '14px', fontWeight: 700, color: '#FF1F1F',
                letterSpacing: '0.04em',
              }}>{m.headline}</span>
              {m.evidences.length > 1 && (
                <span style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '10px', color: '#808080',
                  padding: '2px 8px',
                  background: 'rgba(0,0,0,0.4)',
                  borderRadius: '12px',
                }}>×{m.evidences.length}</span>
              )}
            </div>

            <div style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontSize: '13.5px', color: '#D0D0D0', lineHeight: 1.65,
              marginBottom: '12px',
            }}>{m.explanation}</div>

            {m.counterfactual && (
              <div style={{
                marginBottom: '10px',
                padding: '10px 12px',
                background: 'rgba(16,185,129,0.06)',
                border: '1px solid rgba(16,185,129,0.30)',
                borderLeft: '3px solid #10B981',
                borderRadius: '4px',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  marginBottom: '4px',
                }}>
                  <Compass size={11} color="#10B981"/>
                  <span style={{
                    fontFamily: 'var(--font-inter), sans-serif',
                    fontSize: '8.5px', fontWeight: 800, color: '#10B981',
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                  }}>What you should have done</span>
                </div>
                <div style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontSize: '12.5px', color: '#C0E8C0', lineHeight: 1.65,
                }}>{m.counterfactual}</div>
              </div>
            )}

            {m.evidences && m.evidences.length > 0 && (
              <div style={{
                padding: '8px 10px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px',
              }}>
                <div style={{
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '8px', fontWeight: 800, color: '#606060',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  marginBottom: '4px',
                }}>Evidence</div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {m.evidences.map((e, j) => (
                    <li key={j} style={{
                      fontFamily: 'var(--font-jetbrains), monospace',
                      fontSize: '10.5px', color: '#A0A0A0', lineHeight: 1.5,
                      paddingLeft: '10px', position: 'relative',
                    }}>
                      <span style={{ position: 'absolute', left: 0, color: '#FF1F1F' }}>›</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── NEW PANEL: Per-trade breakdown with counterfactuals ──

function TradeBreakdownPanel({ debrief, loadState, market }: { debrief: DebriefResponse | null; loadState: LoadState; market: MarketSpec }) {
  const trades = debrief?.tradeBreakdown ?? []
  if (loadState === 'streaming') {
    return (
      <Section icon={<FileText size={11}/>} label="Trade-by-Trade Breakdown" color="#3B82F6">
        <SkeletonText lines={6}/>
      </Section>
    )
  }
  if (trades.length === 0) return null
  return (
    <Section icon={<FileText size={11}/>} label="Trade-by-Trade Breakdown" color="#3B82F6">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {trades.map((t, i) => (
          <div key={i} style={{
            padding: '16px 18px',
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(59,130,246,0.30)',
            borderLeft: '3px solid #3B82F6',
            borderRadius: '5px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{
                padding: '4px 10px',
                background: 'rgba(59,130,246,0.12)',
                border: '1px solid #3B82F6',
                borderRadius: '4px',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '9px', fontWeight: 800, color: '#3B82F6',
                letterSpacing: '0.20em', textTransform: 'uppercase',
              }}>{t.tradeRef}</span>
              {t.estimatedAvoidableLoss !== undefined && t.estimatedAvoidableLoss > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '11px', fontWeight: 700, color: '#FF8888',
                  padding: '3px 10px',
                  background: 'rgba(255,31,31,0.10)',
                  border: '1px solid rgba(255,31,31,0.30)',
                  borderRadius: '4px',
                }}>Avoidable: {formatMoney(t.estimatedAvoidableLoss, market)}</span>
              )}
            </div>

            <div style={{
              marginBottom: '12px',
              fontFamily: 'var(--font-fraunces), serif',
              fontSize: '13.5px', color: '#D0D0D0', lineHeight: 1.65,
            }}>{t.summary}</div>

            <div style={{
              padding: '10px 12px',
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.30)',
              borderLeft: '3px solid #10B981',
              borderRadius: '4px',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                marginBottom: '4px',
              }}>
                <ArrowRight size={11} color="#10B981"/>
                <span style={{
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '8.5px', fontWeight: 800, color: '#10B981',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                }}>Optimal Path</span>
              </div>
              <div style={{
                fontFamily: 'var(--font-fraunces), serif',
                fontSize: '12.5px', color: '#C0E8C0', lineHeight: 1.65,
              }}>{t.counterfactual}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── NEW PANEL: Critical-moment timeline ──

function CriticalMomentsPanel({ debrief, loadState }: { debrief: DebriefResponse | null; loadState: LoadState }) {
  const moments = debrief?.criticalMoments ?? []
  if (loadState === 'streaming') {
    return (
      <Section icon={<Clock size={11}/>} label="Critical Moments" color="#A855F7">
        <SkeletonText lines={4}/>
      </Section>
    )
  }
  if (moments.length === 0) return null
  return (
    <Section icon={<Clock size={11}/>} label="Critical Moments" color="#A855F7">
      <div style={{ position: 'relative', paddingLeft: '24px' }}>
        {/* Timeline spine */}
        <div style={{
          position: 'absolute', left: '8px', top: '6px', bottom: '6px',
          width: '2px',
          background: 'linear-gradient(180deg, #A855F7, rgba(168,85,247,0.20))',
        }}/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {moments.map((m, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', left: '-22px', top: '4px',
                width: '12px', height: '12px',
                borderRadius: '50%',
                background: '#A855F7',
                boxShadow: '0 0 8px rgba(168,85,247,0.6)',
                border: '2px solid #000',
              }}/>
              <div style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '11px', fontWeight: 800, color: '#A855F7',
                letterSpacing: '0.10em',
                marginBottom: '4px',
              }}>{m.timestamp}</div>
              <div style={{
                fontFamily: 'var(--font-fraunces), serif',
                fontSize: '13px', color: '#D0D0D0', lineHeight: 1.6,
                marginBottom: '8px',
              }}>{m.description}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{
                  padding: '8px 10px',
                  background: 'rgba(255,31,31,0.06)',
                  border: '1px solid rgba(255,31,31,0.30)',
                  borderLeft: '3px solid #FF1F1F',
                  borderRadius: '4px',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-inter), sans-serif',
                    fontSize: '8px', fontWeight: 800, color: '#FF1F1F',
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}>You did</div>
                  <div style={{
                    fontFamily: 'var(--font-fraunces), serif',
                    fontSize: '11.5px', color: '#E0C0C0', lineHeight: 1.55,
                  }}>{m.youDid}</div>
                </div>
                <div style={{
                  padding: '8px 10px',
                  background: 'rgba(16,185,129,0.06)',
                  border: '1px solid rgba(16,185,129,0.30)',
                  borderLeft: '3px solid #10B981',
                  borderRadius: '4px',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-inter), sans-serif',
                    fontSize: '8px', fontWeight: 800, color: '#10B981',
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}>Should have done</div>
                  <div style={{
                    fontFamily: 'var(--font-fraunces), serif',
                    fontSize: '11.5px', color: '#C0E8C0', lineHeight: 1.55,
                  }}>{m.shouldHaveDone}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}

// ── NEW PANEL: Market timing ──

function MarketTimingPanel({ debrief, loadState }: { debrief: DebriefResponse | null; loadState: LoadState }) {
  const text = debrief?.marketTiming
  if (loadState === 'streaming') {
    return (
      <Section icon={<Target size={11}/>} label="Market Timing" color="#F97316">
        <SkeletonText lines={2}/>
      </Section>
    )
  }
  if (!text) return null
  return (
    <Section icon={<Target size={11}/>} label="Market Timing" color="#F97316">
      <div style={{
        padding: '14px 16px',
        background: 'rgba(249,115,22,0.04)',
        border: '1px solid rgba(249,115,22,0.30)',
        borderLeft: '3px solid #F97316',
        borderRadius: '5px',
        fontFamily: 'var(--font-fraunces), serif',
        fontSize: '13.5px', color: '#D0D0D0', lineHeight: 1.7,
      }}>{text}</div>
    </Section>
  )
}

function ArchetypePanel({ archetype, tomorrow }: { archetype: ArchetypeCard; tomorrow?: string }) {
  return (
    <Section icon={<User size={11}/>} label="Your Archetype" color="#A855F7">
      <div style={{
        padding: '20px 24px',
        background: 'linear-gradient(135deg, rgba(168,85,247,0.10), rgba(212,160,77,0.06))',
        border: '1px solid rgba(168,85,247,0.40)',
        borderRadius: '8px',
      }}>
        <div style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: '24px', fontWeight: 700, color: '#F0F0F0',
          marginBottom: '6px',
        }}>The {archetype.archetype}</div>
        <p style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontStyle: 'italic',
          fontSize: '13px', color: '#A0A0A0',
          margin: '0 0 14px', lineHeight: 1.5,
        }}>{archetype.oneLiner}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {archetype.traits.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <span style={{
                marginTop: '5px',
                width: '4px', height: '4px', borderRadius: '50%',
                background: '#A855F7', flexShrink: 0,
              }}/>
              <span style={{
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '12px', color: '#B0B0B0', lineHeight: 1.5,
              }}>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {tomorrow && (
        <div style={{
          marginTop: '14px', padding: '14px 16px',
          background: 'rgba(212,160,77,0.06)',
          border: '1px solid rgba(212,160,77,0.30)',
          borderLeft: '3px solid #D4A04D',
          borderRadius: '5px',
        }}>
          <div style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '8px', fontWeight: 800, color: '#D4A04D',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: '5px',
          }}>One Rule for Tomorrow</div>
          <p style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontSize: '14px', color: '#E0E0E0',
            margin: 0, lineHeight: 1.6,
          }}>{tomorrow}</p>
        </div>
      )}
    </Section>
  )
}

// ── Helpers / shared chrome ──────────────────────────────────

function Section({ icon, label, color, children }: { icon: React.ReactNode; label: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '24px 28px',
      background: 'linear-gradient(160deg, #0D0D0D 0%, #060606 100%)',
      border: `1px solid ${color}33`,
      borderRadius: '10px',
      marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <span style={{ color }}>{icon}</span>
        <span style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px', fontWeight: 800, color,
          letterSpacing: '0.24em', textTransform: 'uppercase',
        }}>{label}</span>
        <div style={{ flex: 1, height: '1px', background: `linear-gradient(90deg, ${color}33, transparent)` }}/>
      </div>
      {children}
    </div>
  )
}

function SkeletonText({ lines }: { lines: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{
          height: '14px',
          width: i === lines - 1 ? '60%' : '100%',
          background: 'linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
          backgroundSize: '200% 100%',
          borderRadius: '4px',
          animation: 'sk-shimmer 1.4s ease-in-out infinite',
        }}/>
      ))}
      <style>{`@keyframes sk-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  )
}

function FullScreenMessage({ title, body, action }: { title: string; body?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#000',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '22px', color: '#E0E0E0', marginBottom: '8px' }}>{title}</div>
      {body && <p style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '13px', color: '#808080', maxWidth: '420px' }}>{body}</p>}
      {action && (
        <button onClick={action.onClick} style={{
          marginTop: '20px', padding: '10px 18px',
          background: 'linear-gradient(135deg, #D4A04D, #8B6520)',
          border: 'none', borderRadius: '6px', color: '#000',
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '11px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase',
          cursor: 'pointer',
        }}>{action.label}</button>
      )}
    </div>
  )
}

const topBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  padding: '7px 12px',
  background: 'rgba(212,160,77,0.08)',
  border: '1px solid rgba(212,160,77,0.4)',
  borderRadius: '6px',
  color: '#D4A04D',
  fontFamily: 'var(--font-inter), sans-serif',
  fontSize: '10px', fontWeight: 700,
  letterSpacing: '0.16em', textTransform: 'uppercase',
  cursor: 'pointer',
}

// ── Academy refresh panel — maps mistakes → recommended playlists ─────────

const MISTAKE_TO_PLAYLIST: Record<string, { slug: string; label: string }> = {
  NO_STOP_LOSS:           { slug: 'risk-management',     label: 'Risk Management Strategies' },
  OVERSIZED_POSITION:     { slug: 'risk-management',     label: 'Risk Management Strategies' },
  REVENGE_TRADE:          { slug: 'market-psychology',   label: 'Market Psychology' },
  PANIC_SELL:             { slug: 'market-psychology',   label: 'Market Psychology' },
  FOMO_BUY:               { slug: 'market-psychology',   label: 'Market Psychology' },
  NEWS_REFLEX:            { slug: 'volume-structure',    label: 'Volume & Market Structure' },
  NO_THESIS:              { slug: 'trading-plan',        label: 'Trading Plan Development' },
  CIRCUIT_BREAKER_ATTEMPT:{ slug: 'trading-plan',        label: 'Trading Plan Development' },
  DISPOSITION_EFFECT:     { slug: 'swing-trading',       label: 'Swing Trading Techniques' },
  OVERTRADING:            { slug: 'trading-plan',        label: 'Trading Plan Development' },
  IGNORED_NEWS:           { slug: 'volume-structure',    label: 'Volume & Market Structure' },
  HELD_THROUGH_CLOSE:     { slug: 'risk-management',     label: 'Risk Management Strategies' },
}

function AcademyRefreshPanel({ mistakes, router }: { mistakes: Mistake[]; router: ReturnType<typeof useRouter> }) {
  // Pick top 3 unique playlists from mistakes
  const seen = new Set<string>()
  const recommendations = mistakes
    .map(m => MISTAKE_TO_PLAYLIST[m.id])
    .filter(Boolean)
    .filter(rec => { if (seen.has(rec.slug)) return false; seen.add(rec.slug); return true })
    .slice(0, 3)

  const fallbacks = [
    { slug: 'market-psychology',   label: 'Market Psychology' },
    { slug: 'risk-management',     label: 'Risk Management Strategies' },
    { slug: 'trading-plan',        label: 'Trading Plan Development' },
  ]
  const cards = recommendations.length > 0 ? recommendations : fallbacks

  return (
    <Section icon={<GraduationCap size={11}/>} label="Brush Up in Academy" color="#10B981">
      <p style={{
        fontFamily: 'var(--font-fraunces), serif',
        fontStyle: 'italic',
        fontSize: '13px', color: '#A0A0A0',
        margin: '0 0 14px', lineHeight: 1.6,
      }}>
        Based on what we observed, these playlists target your weak spots most directly.
        Watch a few videos, run the mini-game, then come back and trade again.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
        {cards.map(c => (
          <button
            key={c.slug}
            onClick={() => router.push(`/academy/${c.slug}`)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '14px 16px',
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.30)',
              borderLeft: '3px solid #10B981',
              borderRadius: '6px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.12)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.06)' }}
          >
            <BookOpen size={14} color="#10B981" style={{ marginTop: '2px', flexShrink: 0 }}/>
            <div>
              <div style={{
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '8px', fontWeight: 800, color: '#10B981',
                letterSpacing: '0.2em', textTransform: 'uppercase',
                marginBottom: '4px',
              }}>Recommended</div>
              <div style={{
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '13px', fontWeight: 700, color: '#E0E0E0',
              }}>{c.label}</div>
            </div>
          </button>
        ))}
      </div>
    </Section>
  )
}

// Pick the most diagnostic events for the LLM (cap context size)
function pickKeyEvents(events: TraceEvent[]): TraceEvent[] {
  const priority: Record<string, number> = {
    order_filled: 10, order_placed: 8, sl_set: 9, news_dropped: 7,
    circuit_started: 8, panic_sell: 9, session_end: 7, session_start: 5,
    pause: 3, news_viewed: 4,
  }
  return [...events]
    .map(e => ({ e, p: priority[e.kind] ?? 1 }))
    .sort((a, b) => b.p - a.p || a.e.t - b.e.t)
    .slice(0, 25)
    .map(({ e }) => e)
    .sort((a, b) => a.t - b.t)
}
