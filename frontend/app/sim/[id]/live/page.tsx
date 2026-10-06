'use client'

import { use, useState, useEffect } from 'react'
import { useRouter, notFound } from 'next/navigation'
import { SCENARIOS } from '@/lib/engine/scenarios'
import { LiveSessionProvider, useLiveSession } from '@/lib/contexts/live-session-context'
import { LiveHud } from '@/components/live/live-hud'
import { LiveChart } from '@/components/live/live-chart'
import { RightRail } from '@/components/live/right-rail'
import { BottomDock } from '@/components/live/bottom-dock'
import { LiveTutorial } from '@/components/live/live-tutorial'
import { LiveCoachPrompts } from '@/components/live/live-coach-prompts'
import { TraceBridge } from '@/lib/behavior/trace-bridge'
import { LiveAgents } from '@/components/live/live-agents'
import {
  NewsDropOverlay, CircuitBreakerOverlay, EndOfDayModal,
  OrderTypeCoach, SizingCoach,
} from '@/components/live/overlays'

export default function LiveRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  // M4: the route picks the scenario. Unknown ids 404 instead of silently playing COV-20.
  if (!SCENARIOS[id]) notFound()
  return (
    <LiveSessionProvider scenarioId={id}>
      <TraceBridge />
      <LiveAgents />
      <LiveRoomShell />
    </LiveSessionProvider>
  )
}

function LiveRoomShell() {
  const router = useRouter()
  const [tutorialOpen, setTutorialOpen] = useState(true)
  const [exitConfirm, setExitConfirm] = useState(false)
  const [orderCoach, setOrderCoach] = useState(false)
  const [sizingCoach, setSizingCoach] = useState(false)
  const { state, dispatch } = useLiveSession()

  // Keep the clock frozen while the pre-game tutorial is showing
  useEffect(() => {
    if (tutorialOpen && state.status === 'LIVE') {
      dispatch({ type: 'PAUSE' })
    }
  }, [tutorialOpen, state.status, dispatch])

  function handleExit() {
    if (state.status === 'CLOSED') {
      router.push(`/sim/${state.scenarioId}/debrief`)
    } else {
      setExitConfirm(true)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: '#000000',
      color: '#E0E0E0',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Backdrop accents */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        background:
          'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(255,31,31,0.08), transparent 55%),' +
          'radial-gradient(ellipse 50% 40% at 100% 100%, rgba(255,31,31,0.04), transparent 60%),' +
          '#000000',
      }}/>

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <LiveHud onExit={handleExit}/>

        {/* Main grid: chart + right rail (top), bottom dock */}
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gridTemplateRows: '1fr 280px',
          minHeight: 0,
        }}>
          <div style={{ gridColumn: 1, gridRow: 1, minWidth: 0, minHeight: 0 }}>
            <LiveChart/>
          </div>
          <div style={{ gridColumn: 2, gridRow: '1 / span 2', minHeight: 0 }}>
            <RightRail/>
          </div>
          <div style={{ gridColumn: 1, gridRow: 2, minHeight: 0 }}>
            <BottomDock
              onShowOrderCoach={() => setOrderCoach(true)}
              onShowSizingCoach={() => setSizingCoach(true)}
            />
          </div>
        </div>
      </div>

      {/* Pre-game walkthrough — auto-opens, starts clock on completion */}
      <LiveTutorial
        open={tutorialOpen}
        onClose={() => {
          setTutorialOpen(false)
          dispatch({ type: 'RESUME' })
        }}
      />

      {/* In-session coaching — fires at minutes 0, 5, 12 after bell rings */}
      {!tutorialOpen && <LiveCoachPrompts/>}

      {/* Reactive overlays */}
      <NewsDropOverlay/>
      <CircuitBreakerOverlay/>
      <EndOfDayModal onContinue={() => router.push(`/sim/${state.scenarioId}/debrief`)}/>
      <OrderTypeCoach open={orderCoach} onClose={() => setOrderCoach(false)}/>
      <SizingCoach open={sizingCoach} onClose={() => setSizingCoach(false)}/>

      {/* Exit confirmation */}
      {exitConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 96,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 'min(440px, 92vw)', padding: '24px',
            background: 'linear-gradient(180deg, #0A0A0A 0%, #000000 100%)',
            border: '1px solid #FF1F1F', borderRadius: '10px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
          }}>
            <div style={{
              fontFamily: 'var(--font-fraunces), serif', fontWeight: 700,
              fontSize: '20px', color: '#E0E0E0', marginBottom: '8px',
            }}>Exit live session?</div>
            <p style={{
              fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
              fontSize: '13px', color: '#808080', lineHeight: 1.5, margin: '0 0 18px',
            }}>
              Closing now forfeits the current session. Your trades will be marked-to-market and you\'ll be sent to the debrief.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setExitConfirm(false)} style={{
                  flex: 1, padding: '11px',
                  background: 'transparent', border: '1px solid rgba(212,160,77,0.4)',
                  borderRadius: '6px', color: '#FF1F1F',
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em',
                  textTransform: 'uppercase', cursor: 'pointer',
                }}>Cancel</button>
                <button onClick={() => { setExitConfirm(false); router.push('/ledger?case=35') }} style={{
                  flex: 1, padding: '11px',
                  background: 'linear-gradient(180deg, #FF1F1F, #8B0000)',
                  border: '1px solid #FF1F1F', borderRadius: '6px', color: '#E0E0E0',
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em',
                  textTransform: 'uppercase', cursor: 'pointer',
                }}>Forfeit & Exit</button>
              </div>
              <button onClick={() => router.push('/academy')} style={{
                padding: '9px',
                background: 'rgba(212,160,77,0.06)',
                border: '1px solid rgba(212,160,77,0.30)',
                borderRadius: '6px', color: '#D4A04D',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '10px', fontWeight: 700, letterSpacing: '0.16em',
                textTransform: 'uppercase', cursor: 'pointer',
              }}>Or visit the Academy →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
