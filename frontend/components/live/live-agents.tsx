'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import { useSessionSync } from '@/lib/session/session-sync'
import { newEvents, requestFeedback, describeSource, type FeedbackResult } from '@/lib/session/decision-coach'
import { createCoalescer, type Coalescer } from '@/lib/agents/coalesce'
import { SCENARIOS } from '@/lib/engine/scenarios'
import { PATTERN_LABELS } from '@/lib/monitor/templates'
import type { DetectedEvent } from '@/lib/monitor/monitor'
import { createClient } from '@/lib/supabase/client'
import { STUDY_MODE, studyCondition } from '@/lib/study/condition'

// ============================================================================
// The live room's agents (ADR-002/005/008): session sync + the decision coach.
// Mounted inside LiveSessionProvider, beside TraceBridge.
//   - every user action → Monitor (same code as the server);
//   - an event → pause the sim (if it was running) and ask /api/pipeline;
//   - feedback → panel; "Continue trading" resumes only if WE paused it.
// One request at a time per session; while one runs, only the newest new event
// waits (coalesce.ts). The sim never waits on the network beyond the pause.
// Written by Claude at Bhavya's request (2026-10-02).
// ============================================================================

interface Card { event: DetectedEvent; result: FeedbackResult | null }

export function LiveAgents() {
  const { state, journal, dispatch } = useLiveSession()
  const sync = useSessionSync()
  const [card, setCard] = useState<Card | null>(null)

  // Refs so the coalescer (created once) always sees current values.
  const syncRef = useRef(sync)
  const statusRef = useRef(state.status)
  useEffect(() => { syncRef.current = sync }, [sync])
  useEffect(() => { statusRef.current = state.status }, [state.status])

  // 5.4 study mode: the control group plays without coach feedback (docs/STUDY.md).
  const controlGroup = useRef(false)
  useEffect(() => {
    if (!STUDY_MODE) return
    createClient().auth.getUser()
      .then(({ data }: { data: { user: { id: string } | null } }) => { if (data.user) controlGroup.current = studyCondition(data.user.id) === 'control' })
      .catch(() => {})
  }, [])

  const processedSeq = useRef(-1)
  const pausedByCoach = useRef(false)
  const coalescer = useRef<Coalescer<DetectedEvent> | null>(null)

  useEffect(() => {
    coalescer.current ??= createCoalescer<DetectedEvent, FeedbackResult>({
      run: event => requestFeedback(event, {
        sync: syncRef.current,
        fetch: (...args) => fetch(...args),
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        now: () => Date.now(),
      }),
      onResult: (result, event) => setCard(c => (c && c.event.actionSeq > event.actionSeq ? c : { event, result })),
      onError: (err, event) => console.warn('[coach] feedback failed for', event.kind, err),
    })
  }, [])

  // New journal entries → Monitor → newest event (if any) → pause + ask.
  useEffect(() => {
    const scenario = SCENARIOS[state.scenarioId]
    const last = journal.at(-1)?.seq ?? -1
    if (!scenario || last <= processedSeq.current) return
    const events = newEvents(journal, processedSeq.current, scenario.dataset)
    processedSeq.current = last
    const event = events.at(-1)
    if (!event || controlGroup.current) return   // control: scored at session end, no feedback now
    if (statusRef.current === 'LIVE') {
      pausedByCoach.current = true
      dispatch({ type: 'PAUSE' })
    }
    setCard({ event, result: null })
    coalescer.current?.submit(event)
  }, [journal, state.scenarioId, dispatch])

  function dismiss() {
    setCard(null)
    if (pausedByCoach.current && statusRef.current === 'PAUSED' && !coalescer.current?.busy) {
      pausedByCoach.current = false
      dispatch({ type: 'RESUME' })
    }
  }

  return <CoachPanel card={card} onDismiss={dismiss} />
}

// ─── Panel ──────────────────────────────────────────────────

const TONE = {
  warning: { color: '#FF1F1F', glow: 'rgba(255,31,31,0.25)' },
  caution: { color: '#D4A04D', glow: 'rgba(212,160,77,0.25)' },
  info: { color: '#8FA3B8', glow: 'rgba(143,163,184,0.2)' },
} as const

function CoachPanel({ card, onDismiss }: { card: Card | null; onDismiss: () => void }) {
  const { clock, market } = useLiveSession()
  const feedback = card?.result?.feedback
  const tone = TONE[feedback?.severity ?? 'info']
  return (
    <AnimatePresence>
      {card && (
        <motion.div
          key={card.event.actionSeq}
          role="dialog"
          aria-live="polite"
          aria-label="Coach feedback"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ type: 'spring', damping: 26, stiffness: 280 }}
          style={{
            position: 'fixed', right: '24px', bottom: '24px',
            width: 'min(420px, calc(100vw - 32px))',
            background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
            border: `1px solid ${tone.color}`,
            borderRadius: '10px',
            boxShadow: `0 16px 38px rgba(0,0,0,0.7), 0 0 30px ${tone.glow}`,
            zIndex: 95, padding: '16px 18px',
          }}
        >
          <div style={{
            fontFamily: 'var(--font-inter), sans-serif', fontSize: '9px', fontWeight: 700,
            color: tone.color, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '8px',
          }}>
            Coach · {PATTERN_LABELS[card.event.kind] ?? card.event.kind}{card.event.symbol ? ` · ${card.event.symbol}` : ''} · {clock(card.event.simMinute)} {market.tz}
          </div>

          {!feedback ? (
            <div style={{ fontFamily: 'var(--font-inter), sans-serif', fontSize: '13px', color: '#A0A0A0', lineHeight: 1.5 }}>
              The clock is paused while the coach reviews this decision…
            </div>
          ) : (
            <>
              <div style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '15px', color: '#E0E0E0', lineHeight: 1.45 }}>
                {feedback.message}
              </div>
              <div style={{ marginTop: '10px', fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '14px', color: '#C8C8C8', lineHeight: 1.4 }}>
                {feedback.question}
              </div>
              <div style={{ marginTop: '12px', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '10px', color: '#606060', letterSpacing: '0.04em' }}>
                {describeSource(card.result!.source)}
              </div>
            </>
          )}

          <button
            onClick={onDismiss}
            disabled={!feedback}
            style={{
              marginTop: '14px', width: '100%', padding: '9px 12px',
              background: feedback ? 'rgba(212,160,77,0.08)' : 'transparent',
              border: `1px solid ${feedback ? 'rgba(212,160,77,0.45)' : '#262626'}`,
              borderRadius: '6px',
              color: feedback ? '#E0E0E0' : '#505050',
              fontFamily: 'var(--font-inter), sans-serif', fontSize: '12px', fontWeight: 600,
              letterSpacing: '0.06em', cursor: feedback ? 'pointer' : 'default',
            }}
          >
            {feedback ? 'Continue trading' : 'Reviewing…'}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
