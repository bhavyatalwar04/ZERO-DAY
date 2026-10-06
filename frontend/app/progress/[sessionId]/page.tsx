import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GlobalNav } from '@/components/layout/global-nav'
import { PATTERN_LABELS } from '@/lib/monitor/templates'
import { clock } from '@/lib/agents/research/tools'
import type { Action } from '@/lib/engine/live-reducer'

// 7.2 Decision-audit timeline: one session's log replayed as a timeline, with
// every flagged decision, the feedback shown, and each agent's full trace
// (tool calls, results, tokens, errors). Read through RLS: users see only their
// own audit trail (ADR-003). Written by Claude at Bhavya's request (2026-10-03).

export const dynamic = 'force-dynamic'

const GOLD = '#D4A04D'
const MUTED = '#8A8A8A'
const mono = 'var(--font-jetbrains), monospace'
const sans = 'var(--font-inter), sans-serif'

interface ActionRow { seq: number; sim_minute: number; action: Action }
interface EventRow { id: string; action_seq: number; kind: string; sim_minute: number; symbol: string | null; summary: string; facts: Record<string, unknown>; state_before: { cash?: number; positions?: Record<string, { qty: number; avgPrice: number }> } }
interface RunRow { id: string; decision_event_id: string; path: string; feedback: { message: string; question: string; severity: string } | null; timings: Record<string, number> | null }
interface AgentRow { pipeline_run_id: string; agent: string; model: string | null; status: string; error: string | null; steps: Step[]; prompt_tokens: number; completion_tokens: number; latency_ms: number }
type Step = { type: 'model'; toolCalls?: { name: string; arguments: string }[]; text?: string; latencyMs?: number } | { type: 'tool'; name: string; args?: unknown; result?: unknown; error?: string; errorKind?: string }

const PATH_TEXT: Record<string, string> = {
  full: 'AI coach with market research',
  monitor_only: 'AI coach, research unavailable',
  template: 'Standard feedback (AI unavailable)',
  rejected: 'Claim rejected by the server re-check',
}

function describe(a: Action): string {
  switch (a.type) {
    case 'PLACE_ORDER': return `${a.order.side} ${a.order.quantity} ${a.order.symbol} (${a.order.type.toLowerCase()})`
    default: return a.type.replace(/_/g, ' ').toLowerCase()
  }
}

export default async function SessionAuditPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound()
  const supabase = await createClient()
  const { data: session } = await supabase.from('sessions').select('id, scenario_id, status, started_at').eq('id', sessionId).maybeSingle()
  if (!session) notFound()   // not yours, or doesn't exist: RLS makes them look the same

  const [{ data: actions }, { data: events }, { data: runs }] = await Promise.all([
    supabase.from('session_actions').select('seq, sim_minute, action').eq('session_id', sessionId).order('seq'),
    supabase.from('decision_events').select('id, action_seq, kind, sim_minute, symbol, summary, facts, state_before').eq('session_id', sessionId).order('action_seq'),
    supabase.from('pipeline_runs').select('id, decision_event_id, path, feedback, timings').eq('session_id', sessionId),
  ])
  const runIds = ((runs ?? []) as RunRow[]).map(r => r.id)
  const { data: agents } = runIds.length
    ? await supabase.from('agent_runs').select('pipeline_run_id, agent, model, status, error, steps, prompt_tokens, completion_tokens, latency_ms').in('pipeline_run_id', runIds)
    : { data: [] }

  const eventBySeq = new Map((events as EventRow[] ?? []).map(e => [e.action_seq, e]))
  const runByEvent = new Map((runs as RunRow[] ?? []).map(r => [r.decision_event_id, r]))
  const agentsByRun = new Map<string, AgentRow[]>()
  for (const a of (agents as AgentRow[] ?? [])) agentsByRun.set(a.pipeline_run_id, [...(agentsByRun.get(a.pipeline_run_id) ?? []), a])
  const rows = (actions as ActionRow[] ?? []).filter(a => a.action.type !== 'TICK')

  return (
    <div style={{ minHeight: '100vh', background: '#000', color: '#E0E0E0' }}>
      <GlobalNav />
      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '96px 16px 64px' }}>
        <Link href="/progress" style={{ color: GOLD, fontFamily: sans, fontSize: '13px' }}>← Progress</Link>
        <h1 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '30px', fontWeight: 500, margin: '12px 0 4px' }}>Session replay · {(session as { scenario_id: string }).scenario_id}</h1>
        <p style={{ fontFamily: sans, fontSize: '13px', color: MUTED, margin: 0 }}>
          {rows.length} logged actions · {eventBySeq.size} flagged decision{eventBySeq.size === 1 ? '' : 's'} · {(session as { status: string }).status}.
          This is the stored log the server replays: what you see is what the agents were given.
        </p>

        <ol style={{ listStyle: 'none', padding: 0, margin: '28px 0 0', borderLeft: '1px solid #262626' }}>
          {rows.map(a => {
            const ev = eventBySeq.get(a.seq)
            const run = ev ? runByEvent.get(ev.id) : undefined
            return (
              <li key={a.seq} style={{ position: 'relative', padding: '0 0 14px 18px' }}>
                <span style={{ position: 'absolute', left: '-4px', top: '6px', width: '7px', height: '7px', borderRadius: '50%', background: ev ? GOLD : '#3A3A3A' }} />
                <div style={{ fontFamily: mono, fontSize: '12px', color: ev ? '#E8E8E8' : MUTED }}>
                  <span style={{ color: MUTED }}>{clock(a.sim_minute)}</span>  #{a.seq}  {describe(a.action)}
                </div>
                {ev && (
                  <div style={{ marginTop: '8px', background: '#0A0A0A', border: `1px solid ${GOLD}55`, borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ fontFamily: sans, fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
                      Monitor · {PATTERN_LABELS[ev.kind] ?? ev.kind}{ev.symbol ? ` · ${ev.symbol}` : ''}
                    </div>
                    <p style={{ fontFamily: sans, fontSize: '13px', margin: '6px 0' }}>{ev.summary}</p>
                    {ev.state_before?.cash !== undefined && (
                      <p style={{ fontFamily: mono, fontSize: '11px', color: MUTED, margin: '0 0 6px' }}>
                        Before: cash {ev.state_before.cash.toFixed(2)}{Object.values(ev.state_before.positions ?? {}).filter(p => p.qty).map(p => ` · ${p.qty} @ ${p.avgPrice.toFixed(2)}`).join('')}
                      </p>
                    )}
                    {run ? (
                      <>
                        {run.feedback && (
                          <div style={{ borderTop: '1px solid #1F1F1F', paddingTop: '8px', marginTop: '6px' }}>
                            <p style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '14px', margin: 0 }}>{run.feedback.message}</p>
                            <p style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '13px', color: '#C8C8C8', margin: '6px 0 0' }}>{run.feedback.question}</p>
                          </div>
                        )}
                        <p style={{ fontFamily: mono, fontSize: '10px', color: MUTED, margin: '8px 0 0' }}>
                          {PATH_TEXT[run.path] ?? run.path}{run.timings?.totalMs ? ` · ${run.timings.totalMs} ms` : ''}
                        </p>
                        {(agentsByRun.get(run.id) ?? []).map(ag => <AgentTrace key={ag.agent} run={ag} />)}
                      </>
                    ) : (
                      <p style={{ fontFamily: mono, fontSize: '10px', color: MUTED, margin: 0 }}>No coach run recorded for this decision (e.g. the browser fell back to standard feedback).</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </main>
    </div>
  )
}

function AgentTrace({ run }: { run: AgentRow }) {
  return (
    <details style={{ marginTop: '8px', fontFamily: mono, fontSize: '11px' }}>
      <summary style={{ cursor: 'pointer', color: run.status === 'ok' ? '#9FB8A8' : '#E07A5F' }}>
        {run.agent} · {run.model ?? 'deterministic'} · {run.status} · {run.latency_ms} ms · {run.prompt_tokens}+{run.completion_tokens} tokens
      </summary>
      {run.error && <p style={{ color: '#E07A5F', margin: '6px 0' }}>{run.error}</p>}
      <ol style={{ margin: '6px 0 0', paddingLeft: '18px', color: '#B0B0B0' }}>
        {run.steps.map((s, i) => (
          <li key={i} style={{ margin: '3px 0', wordBreak: 'break-word' }}>
            {s.type === 'model'
              ? <>model → {s.toolCalls?.length ? s.toolCalls.map(c => `${c.name}(${c.arguments})`).join(', ') : `“${(s.text ?? '').slice(0, 200)}”`}</>
              : <>tool {s.name}: {s.errorKind ? <span style={{ color: '#E07A5F' }}>{s.errorKind}: {s.error}</span> : JSON.stringify(s.result).slice(0, 300)}</>}
          </li>
        ))}
      </ol>
    </details>
  )
}
