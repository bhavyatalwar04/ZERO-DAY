'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLiveSession } from '@/lib/contexts/live-session-context'
import type { ScenarioInfo } from '@/lib/engine/scenarios'
import { usesHandBuiltIntro, marketReadPrompt, signalNoiseQuestion } from '@/lib/session/scenario-copy'
import { useTracer } from '@/lib/behavior/tracer'
import { Lightbulb, Play, X } from 'lucide-react'

interface Prompt {
  triggerMinute: number
  eyebrow: string
  title: string
  body: string
  question: string
  options: { label: string; correct: boolean; explanation: string }[]
}

const PROMPTS: Prompt[] = [
  {
    triggerMinute: 0,
    eyebrow: 'Coaching Pause · 1 of 3',
    title: 'The Bell Just Rang. Read the Room.',
    body: 'Before you place a single trade, look at the indices ticker at the top. NIFTY, SENSEX, BRENT, USDINR. What is the broader market telling you?',
    question: 'NIFTY opened −3% and BRENT is −12%. What does this most likely mean for the 6 stocks in your watchlist?',
    options: [
      { label: 'They will probably also be red, especially energy and finance',
        correct: true,
        explanation: 'Correct. When NIFTY falls hard, almost every stock falls with it — especially heavyweights like RELIANCE and HDFC. This is the cascade effect we covered in the briefing.' },
      { label: 'They will be unaffected because we hand-picked them',
        correct: false,
        explanation: 'Not quite. Stock selection helps long-term, but on a sharp down day, individual stocks rarely escape the broader market\'s pull.' },
      { label: 'It is impossible to predict — just buy and see',
        correct: false,
        explanation: 'Markets do have patterns. A −3% NIFTY open with crashing BRENT is a strong signal that risk-on trades will struggle today.' },
    ],
  },
  {
    triggerMinute: 5,
    eyebrow: 'Coaching Pause · 2 of 3',
    title: 'Signal vs Noise',
    body: 'A news headline just dropped. Before you react to it, ask: is this a signal (something that genuinely changes a company\'s fundamentals or trading conditions) or noise (analyst opinions, rumours, recycled stories)?',
    question: 'You see a headline: "Brokerage XYZ downgrades RELIANCE to NEUTRAL." How should you treat this?',
    options: [
      { label: 'Sell immediately — analysts know more than I do',
        correct: false,
        explanation: 'No. Analyst rating changes are usually already priced in by the time retail traders see them. Acting reflexively is a classic noise-trap.' },
      { label: 'Note it, but do not change your plan unless the price action confirms it',
        correct: true,
        explanation: 'Correct. The screen tells you what the market actually thinks. If price keeps falling, the downgrade is being absorbed. If price holds, the market disagrees with the analyst.' },
      { label: 'Buy more — it is now cheaper',
        correct: false,
        explanation: 'Buying purely because something is "cheaper" without a thesis is how falling-knife losses happen. Wait for confirmation.' },
    ],
  },
  {
    triggerMinute: 12,
    eyebrow: 'Coaching Pause · 3 of 3',
    title: 'Before You Place Any Trade',
    body: 'You\'re about to start trading independently from here. ORUS will go quieter. Run through this final mental check before every order.',
    question: 'Which of these is the SINGLE most important thing to define before clicking BUY?',
    options: [
      { label: 'Your target profit — how much you want to make',
        correct: false,
        explanation: 'Targets are nice, but markets do not owe you them. Profits are uncertain.' },
      { label: 'Your stop loss — the maximum you will lose if wrong',
        correct: true,
        explanation: 'Correct. Define your loss before your reward. Risk management is the single skill that separates surviving traders from blown-out accounts. Set the SL first, then enter.' },
      { label: 'How much you want to invest',
        correct: false,
        explanation: 'Position size matters but follows from your stop loss. If your SL is wide, your size must be smaller. Define risk first.' },
    ],
  },
]

/**
 * PROMPTS were written for COV-20 (NIFTY −3%, BRENT −12%, a RELIANCE downgrade).
 * Other scenarios keep the same three pauses, with the market read and the
 * downgrade question rewritten for their own indices and stocks.
 */
function promptsFor(s: ScenarioInfo): Prompt[] {
  if (usesHandBuiltIntro(s)) return PROMPTS
  const [open, news, ...rest] = PROMPTS
  return [
    { ...open, ...marketReadPrompt(s) },
    { ...news, question: signalNoiseQuestion(s) },
    ...rest,
  ]
}

export function LiveCoachPrompts() {
  const { state, dispatch, scenario } = useLiveSession()
  const prompts = useMemo(() => promptsFor(scenario), [scenario])
  const { track } = useTracer()
  const [seenMinutes, setSeenMinutes] = useState<Set<number>>(new Set())
  const [activePrompt, setActivePrompt] = useState<Prompt | null>(null)
  const [skipAll, setSkipAll] = useState(false)

  // Trigger when currentMinute crosses a threshold
  useEffect(() => {
    if (skipAll) return
    if (state.status !== 'LIVE' && state.status !== 'PAUSED') return

    for (const p of prompts) {
      if (seenMinutes.has(p.triggerMinute)) continue
      if (state.currentMinute >= p.triggerMinute) {
        setSeenMinutes(s => {
          const next = new Set(s)
          next.add(p.triggerMinute)
          return next
        })
        setActivePrompt(p)
        track('coach_prompt_shown', state.currentMinute, { promptId: p.triggerMinute, title: p.title })
        if (state.status === 'LIVE') dispatch({ type: 'PAUSE' })
        break
      }
    }
  }, [state.currentMinute, state.status, seenMinutes, skipAll, dispatch, prompts])

  function dismiss() {
    setActivePrompt(null)
    dispatch({ type: 'RESUME' })
  }

  function handleSkipAll() {
    setSkipAll(true)
    setActivePrompt(null)
    track('coach_skipped_all', state.currentMinute)
    dispatch({ type: 'RESUME' })
  }

  if (!activePrompt) return null

  return (
    <PromptModal
      prompt={activePrompt}
      onContinue={dismiss}
      onSkipAll={handleSkipAll}
      onAnswered={(picked, correct) =>
        track('coach_prompt_answered', state.currentMinute, {
          promptId: activePrompt.triggerMinute, pickedIdx: picked, correct,
        })
      }
    />
  )
}

interface ModalProps {
  prompt: Prompt
  onContinue: () => void
  onSkipAll: () => void
  onAnswered?: (pickedIdx: number, correct: boolean) => void
}

function PromptModal({ prompt, onContinue, onSkipAll, onAnswered }: ModalProps) {
  const [picked, setPicked] = useState<number | null>(null)
  const chosen = picked !== null ? prompt.options[picked] : null

  function pick(i: number) {
    if (picked !== null) return
    setPicked(i)
    onAnswered?.(i, prompt.options[i].correct)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 250,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: 'min(620px, 95vw)',
        maxHeight: '90vh', overflowY: 'auto',
        background: 'linear-gradient(160deg, #0D0D0D 0%, #060606 100%)',
        border: '1px solid rgba(212,160,77,0.5)',
        borderTop: '3px solid #D4A04D',
        borderRadius: '10px',
        boxShadow: '0 32px 64px rgba(0,0,0,0.85), 0 0 40px rgba(212,160,77,0.2)',
        padding: '24px 28px 22px',
        animation: 'coach-in 0.25s ease-out',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '14px',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '4px 10px',
            background: 'rgba(212,160,77,0.12)',
            border: '1px solid rgba(212,160,77,0.4)',
            borderRadius: '4px',
          }}>
            <Lightbulb size={11} color="#D4A04D"/>
            <span style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '9px', fontWeight: 800, color: '#D4A04D',
              letterSpacing: '0.22em', textTransform: 'uppercase',
            }}>{prompt.eyebrow}</span>
          </div>
          <button
            onClick={onSkipAll}
            title="Skip all coaching prompts"
            style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '9px', fontWeight: 700,
              color: '#606060', letterSpacing: '0.16em',
              textTransform: 'uppercase',
              background: 'transparent', border: 'none',
              cursor: 'pointer', padding: '4px 8px',
            }}
          >Skip All</button>
        </div>

        <div style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: '22px', fontWeight: 700, color: '#F0F0F0',
          lineHeight: 1.2, marginBottom: '10px', letterSpacing: '-0.01em',
        }}>{prompt.title}</div>

        <div style={{ height: '1px', background: 'linear-gradient(90deg, rgba(212,160,77,0.4), transparent)', marginBottom: '14px' }}/>

        <p style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: '13.5px', color: '#B0B0B0',
          lineHeight: 1.6, margin: '0 0 16px',
        }}>{prompt.body}</p>

        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '10px', fontWeight: 800, color: '#D4A04D',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          marginBottom: '8px',
        }}>Quick Check</div>

        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontSize: '13px', color: '#E0E0E0', fontWeight: 600,
          marginBottom: '10px', lineHeight: 1.5,
        }}>{prompt.question}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          {prompt.options.map((opt, i) => {
            const isPicked = picked === i
            const reveal = picked !== null
            const correct = opt.correct
            const showAsCorrect = reveal && correct
            const showAsWrong = reveal && isPicked && !correct
            const borderColor = showAsCorrect ? '#10B981' : showAsWrong ? '#FF1F1F' : isPicked ? '#D4A04D' : 'rgba(255,255,255,0.12)'
            const bg = showAsCorrect ? 'rgba(16,185,129,0.08)' : showAsWrong ? 'rgba(255,31,31,0.08)' : 'rgba(0,0,0,0.4)'
            return (
              <button
                key={i}
                onClick={() => pick(i)}
                disabled={picked !== null}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  padding: '10px 12px',
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '5px',
                  cursor: picked === null ? 'pointer' : 'default',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{
                  flexShrink: 0,
                  width: '18px', height: '18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: showAsCorrect ? '#10B981' : showAsWrong ? '#FF1F1F' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '4px',
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '9px', fontWeight: 800,
                  color: showAsCorrect || showAsWrong ? '#000' : '#A0A0A0',
                }}>{showAsCorrect ? '✓' : showAsWrong ? '✕' : String.fromCharCode(65 + i)}</span>
                <span style={{
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '12px',
                  color: showAsCorrect ? '#10B981' : showAsWrong ? '#FF1F1F' : '#C0C0C0',
                  fontWeight: showAsCorrect || showAsWrong ? 600 : 400,
                  lineHeight: 1.5,
                }}>{opt.label}</span>
              </button>
            )
          })}
        </div>

        {chosen && (
          <div style={{
            padding: '10px 12px',
            background: chosen.correct ? 'rgba(16,185,129,0.06)' : 'rgba(255,31,31,0.06)',
            border: `1px solid ${chosen.correct ? '#10B98144' : '#FF1F1F44'}`,
            borderLeft: `3px solid ${chosen.correct ? '#10B981' : '#FF1F1F'}`,
            borderRadius: '4px',
            marginBottom: '14px',
          }}>
            <div style={{
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '8px', fontWeight: 800,
              color: chosen.correct ? '#10B981' : '#FF1F1F',
              letterSpacing: '0.2em', textTransform: 'uppercase',
              marginBottom: '4px',
            }}>{chosen.correct ? 'Correct' : 'Not quite'}</div>
            <p style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontSize: '12px', color: '#C0C0C0',
              lineHeight: 1.55, margin: 0,
            }}>{chosen.explanation}</p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '12px' }}>
          <button
            onClick={onContinue}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px',
              background: 'linear-gradient(135deg, #10B981, #059669)',
              border: 'none', borderRadius: '5px',
              color: '#000',
              fontFamily: 'var(--font-inter), sans-serif',
              fontSize: '11px', fontWeight: 800, letterSpacing: '0.14em',
              textTransform: 'uppercase', cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(16,185,129,0.5)',
            }}
          >
            <Play size={12}/> Resume Trading
          </button>
        </div>
      </div>

      <style>{`@keyframes coach-in { from { opacity:0; transform:scale(0.96) } to { opacity:1; transform:scale(1) } }`}</style>
    </div>
  )
}
