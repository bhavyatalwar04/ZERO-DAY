'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'

interface BriefingOverlayProps {
  videoSrc: string
  caseCode: string
  caseTitle: string
  onComplete: () => void
  onSkip: () => void
}

type Phase = 'pre-roll' | 'playing' | 'post-roll'

const PRE_ROLL_MS  = 1700
const POST_ROLL_MS = 1500
const FALLBACK_PLAYBACK_MS = 24000

export function BriefingOverlay({
  videoSrc, caseCode, caseTitle, onComplete, onSkip,
}: BriefingOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('pre-roll')
  const [progress, setProgress] = useState(0)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [durationSec, setDurationSec] = useState(24)
  const [showSkip, setShowSkip] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const completedRef = useRef(false)

  const completeOnce = (): void => {
    if (completedRef.current) return
    completedRef.current = true
    onComplete()
  }

  // Phase: pre-roll → playing
  useEffect(() => {
    if (phase !== 'pre-roll') return
    const t = setTimeout(() => setPhase('playing'), PRE_ROLL_MS)
    return () => clearTimeout(t)
  }, [phase])

  // Phase: playing → wire video
  useEffect(() => {
    if (phase !== 'playing') return
    const v = videoRef.current
    if (!v) return

    const onTimeUpdate = (): void => {
      if (v.duration && Number.isFinite(v.duration)) {
        setProgress((v.currentTime / v.duration) * 100)
        setCurrentTimeSec(v.currentTime)
        setDurationSec(v.duration)
      }
    }
    const onLoadedMetadata = (): void => {
      if (v.duration) setDurationSec(v.duration)
    }
    const onEnded = (): void => setPhase('post-roll')
    const onError = (): void => setVideoFailed(true)

    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('loadedmetadata', onLoadedMetadata)
    v.addEventListener('ended', onEnded)
    v.addEventListener('error', onError)

    v.play().catch(() => setVideoFailed(true))

    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('loadedmetadata', onLoadedMetadata)
      v.removeEventListener('ended', onEnded)
      v.removeEventListener('error', onError)
    }
  }, [phase])

  // Fallback timer when video fails
  useEffect(() => {
    if (!videoFailed || phase !== 'playing') return
    const startedAt = Date.now()
    const iv = setInterval(() => {
      const elapsed = Date.now() - startedAt
      setProgress((elapsed / FALLBACK_PLAYBACK_MS) * 100)
      setCurrentTimeSec(elapsed / 1000)
      setDurationSec(FALLBACK_PLAYBACK_MS / 1000)
      if (elapsed >= FALLBACK_PLAYBACK_MS) {
        clearInterval(iv)
        setPhase('post-roll')
      }
    }, 50)
    return () => clearInterval(iv)
  }, [videoFailed, phase])

  // Phase: post-roll → complete
  useEffect(() => {
    if (phase !== 'post-roll') return
    const t = setTimeout(() => completeOnce(), POST_ROLL_MS)
    return () => clearTimeout(t)
  }, [phase])

  // Skip button reveal
  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 2500)
    return () => clearTimeout(t)
  }, [])

  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const ss = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${ss}`
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: '#000',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-geist-sans), sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Ambient floating embers — particles.casberry inspired */}
      <BackgroundEmbers />

      {/* Mouse-following spotlight — 21st.dev magic cursor */}
      <MouseSpotlight />

      {/* (Removed heavy CRT scanlines + grain that were degrading the video signal) */}

      {/* Slow horizontal scan-line that drifts top-to-bottom */}
      <div className="briefing-scan-bar" style={{
        position: 'absolute', left: 0, right: 0, height: '2px', zIndex: 46,
        pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent, rgba(220,38,38,0.55), transparent)',
        boxShadow: '0 0 24px rgba(220,38,38,0.4)',
      }} />

      {/* Subtle global vignette */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 49,
        background: 'radial-gradient(ellipse 95% 80% at 50% 50%, transparent 30%, rgba(0,0,0,0.78) 100%)',
      }} />

      {/* Faint red atmosphere */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 48,
        background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(220,38,38,0.05) 0%, transparent 60%)',
      }} />

      {/* ═══════════ TOP HUD ═══════════ */}
      <header style={{
        position: 'relative', zIndex: 60,
        padding: '18px 32px',
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        borderBottom: '1px solid rgba(220,38,38,0.3)',
        background: 'linear-gradient(180deg, rgba(15,5,5,0.96), rgba(8,4,4,0.86))',
      }}>
        {/* glow line */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: '-1px', height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(220,38,38,0.7), transparent)',
        }} />

        {/* Left — RECEIVING BRIEFING + signal bars */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: '#DC2626',
            boxShadow: '0 0 14px rgba(220,38,38,0.95)',
            animation: 'briefing-pulse 1.4s infinite',
          }} />
          <span style={{
            fontSize: '11px', letterSpacing: '0.32em',
            color: '#DC2626', fontWeight: 700, textTransform: 'uppercase',
          }}>
            Receiving Briefing
          </span>
          <span style={{ width: '1px', height: '12px', background: 'rgba(220,38,38,0.3)' }} />
          {/* Signal bars */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '12px' }}>
            {[5, 8, 11, 9, 12].map((h, i) => (
              <span key={i} style={{
                width: '2px', height: `${h}px`,
                background: '#DC2626',
                opacity: 0.4 + (i * 0.12),
                boxShadow: i === 4 ? '0 0 4px rgba(220,38,38,0.9)' : 'none',
              }} />
            ))}
          </div>
          <span style={{
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: '9px', letterSpacing: '0.18em',
            color: 'rgba(220,38,38,0.85)', fontWeight: 600,
          }}>
            SIGNAL · LOCKED
          </span>
        </div>

        {/* Center — O·R·U·S */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 24px',
          background: 'rgba(220,38,38,0.08)',
          border: '1px solid rgba(220,38,38,0.4)',
          borderRadius: '2px',
          position: 'relative',
        }}>
          <span style={{ position: 'absolute', top: '-3px', left: '-3px', width: '6px', height: '6px', background: '#DC2626' }} />
          <span style={{ position: 'absolute', top: '-3px', right: '-3px', width: '6px', height: '6px', background: '#DC2626' }} />
          <span style={{ position: 'absolute', bottom: '-3px', left: '-3px', width: '6px', height: '6px', background: '#DC2626' }} />
          <span style={{ position: 'absolute', bottom: '-3px', right: '-3px', width: '6px', height: '6px', background: '#DC2626' }} />
          <span style={{
            fontFamily: 'var(--font-anton), sans-serif',
            fontSize: '15px', letterSpacing: '0.28em',
            color: '#FAFAFA', textTransform: 'uppercase',
          }}>
            O · R · U · S
          </span>
        </div>

        {/* Right — case + freq */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px' }}>
          <div style={{
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: '10px', letterSpacing: '0.16em',
            color: 'rgba(168,152,128,0.55)', textTransform: 'uppercase',
          }}>
            CH 04 · 2.401 GHz
          </div>
          <span style={{ width: '1px', height: '12px', background: 'rgba(220,38,38,0.3)' }} />
          <div style={{
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: '11px', letterSpacing: '0.18em',
            color: '#E8DFC8', fontWeight: 600, textTransform: 'uppercase',
          }}>
            {caseCode} · {caseTitle}
          </div>
        </div>
      </header>

      {/* ═══════════ STAGE ═══════════ */}
      <div style={{
        flex: 1,
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '180px 1fr 180px',
        alignItems: 'center',
        gap: '16px',
        padding: '20px',
      }}>
        {/* LEFT side panel — encrypted feed */}
        <SidePanel side="left" phase={phase} caseCode={caseCode} />

        {/* CENTER — pre-roll / video / post-roll */}
        <div style={{
          position: 'relative',
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AnimatePresence mode="wait">
            {phase === 'pre-roll' && (
              <motion.div
                key="pre"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}
              >
                <PreRoll caseCode={caseCode} />
              </motion.div>
            )}

            {phase === 'playing' && (
              <motion.div
                key="play"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: 'relative',
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {/* Cinematic frame */}
                <div style={{
                  position: 'relative',
                  width: 'min(100%, 1280px)',
                  aspectRatio: '16 / 9',
                  background: '#000',
                  border: '1.5px solid rgba(220,38,38,0.6)',
                  boxShadow: `
                    0 0 80px rgba(220,38,38,0.18),
                    0 30px 80px rgba(0,0,0,0.8),
                    inset 0 0 0 1px rgba(220,38,38,0.1)
                  `,
                  overflow: 'hidden',
                }}>
                  {/* Corner brackets */}
                  {[
                    { top: 0,    left: 0,    bt: true,  bl: true },
                    { top: 0,    right: 0,   bt: true,  br: true },
                    { bottom: 0, left: 0,    bb: true,  bl: true },
                    { bottom: 0, right: 0,   bb: true,  br: true },
                  ].map((p, i) => (
                    <span key={i} style={{
                      position: 'absolute',
                      ...(p.top !== undefined ? { top: '6px' } : {}),
                      ...(p.bottom !== undefined ? { bottom: '6px' } : {}),
                      ...(p.left !== undefined ? { left: '6px' } : {}),
                      ...(p.right !== undefined ? { right: '6px' } : {}),
                      width: '20px', height: '20px',
                      borderTop:    p.bt ? '2px solid #DC2626' : 'none',
                      borderBottom: p.bb ? '2px solid #DC2626' : 'none',
                      borderLeft:   p.bl ? '2px solid #DC2626' : 'none',
                      borderRight:  p.br ? '2px solid #DC2626' : 'none',
                      zIndex: 5,
                      pointerEvents: 'none',
                      boxShadow: '0 0 6px rgba(220,38,38,0.6)',
                    }} />
                  ))}

                  {!videoFailed ? (
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      autoPlay
                      playsInline
                      preload="auto"
                      muted={false}
                      controls={false}
                      disablePictureInPicture
                      disableRemotePlayback
                      controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                      className="briefing-video"
                      style={{
                        width: '100%', height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <FallbackBriefing />
                  )}

                  {/* Animated traveling border light — Aceternity magic-card pattern */}
                  <div className="briefing-border-spin" style={{
                    position: 'absolute',
                    inset: '-1.5px',
                    zIndex: 7,
                    pointerEvents: 'none',
                    borderRadius: '0',
                    background: 'conic-gradient(from 0deg, transparent 0deg, #DC2626 30deg, transparent 90deg, transparent 180deg, rgba(220,38,38,0.6) 220deg, transparent 280deg, transparent 360deg)',
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                    padding: '1.5px',
                    opacity: 0.6,
                  }} />

                  {/* Audio waveform pulse along the bottom edge of the frame */}
                  <div style={{
                    position: 'absolute', bottom: '8.5%', left: 0, right: 0,
                    height: '2px', zIndex: 6, pointerEvents: 'none',
                    display: 'flex', alignItems: 'flex-end', gap: '2px',
                    padding: '0 12%',
                  }}>
                    {Array.from({ length: 48 }).map((_, i) => (
                      <span key={i} className="briefing-eq-bar" style={{
                        flex: 1,
                        background: '#DC2626',
                        opacity: 0.6,
                        animationDelay: `${i * 60}ms`,
                      }} />
                    ))}
                  </div>

                  {/* Cinematic letterbox bars */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '8.5%', background: '#000', pointerEvents: 'none', zIndex: 4 }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '8.5%', background: '#000', pointerEvents: 'none', zIndex: 4 }} />

                  {/* REC indicator top-left */}
                  <div style={{
                    position: 'absolute', top: '20px', left: '36px', zIndex: 6,
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '5px 10px',
                    background: 'rgba(0,0,0,0.65)',
                    border: '1px solid rgba(220,38,38,0.4)',
                  }}>
                    <span style={{
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: '#DC2626',
                      boxShadow: '0 0 8px rgba(220,38,38,0.85)',
                      animation: 'briefing-pulse 1.0s infinite',
                    }} />
                    <span style={{
                      fontFamily: 'var(--font-geist-mono), monospace',
                      fontSize: '9px', letterSpacing: '0.22em',
                      color: '#DC2626', fontWeight: 700,
                    }}>
                      REC
                    </span>
                  </div>

                  {/* Timecode top-right */}
                  <div style={{
                    position: 'absolute', top: '20px', right: '36px', zIndex: 6,
                    padding: '5px 10px',
                    background: 'rgba(0,0,0,0.65)',
                    border: '1px solid rgba(168,152,128,0.2)',
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: '10px', letterSpacing: '0.16em',
                    color: '#E8DFC8',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    TC {formatTime(currentTimeSec)}:{Math.floor((currentTimeSec * 24) % 24).toString().padStart(2, '0')}
                  </div>
                </div>
              </motion.div>
            )}

            {phase === 'post-roll' && (
              <motion.div
                key="post"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}
              >
                <PostRoll />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT side panel — encryption + uplink */}
        <SidePanel side="right" phase={phase} caseCode={caseCode} />
      </div>

      {/* ═══════════ BOTTOM HUD ═══════════ */}
      <footer style={{
        position: 'relative', zIndex: 60,
        padding: '18px 32px',
        borderTop: '1px solid rgba(220,38,38,0.3)',
        background: 'linear-gradient(0deg, rgba(15,5,5,0.96), rgba(8,4,4,0.86))',
      }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '-1px', height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(220,38,38,0.7), transparent)',
        }} />

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{
              fontFamily: 'var(--font-anton), sans-serif',
              fontSize: '13px', letterSpacing: '0.22em',
              color: '#E8DFC8', textTransform: 'uppercase',
            }}>
              ORUS
            </span>
            <span style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: '10px', letterSpacing: '0.18em',
              color: 'rgba(232,223,200,0.5)', textTransform: 'uppercase',
            }}>
              · Operations Briefing Officer
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: '11px', letterSpacing: '0.16em',
              color: '#E8DFC8',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatTime(currentTimeSec)} / {formatTime(durationSec)}
            </span>
            {showSkip && phase === 'playing' && (
              <button
                onClick={onSkip}
                style={{
                  background: 'rgba(232,223,200,0.04)',
                  border: '1px solid rgba(232,223,200,0.2)',
                  padding: '7px 14px',
                  borderRadius: '2px',
                  color: 'rgba(232,223,200,0.7)',
                  fontFamily: 'inherit',
                  fontSize: '10px', letterSpacing: '0.22em',
                  fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.color = '#fff'
                  el.style.borderColor = 'rgba(220,38,38,0.5)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.color = 'rgba(232,223,200,0.7)'
                  el.style.borderColor = 'rgba(232,223,200,0.2)'
                }}
              >
                Skip Briefing →
              </button>
            )}
          </div>
        </div>

        {/* Progress bar with end-cap brackets */}
        <div style={{ position: 'relative', height: '4px' }}>
          <span style={{ position: 'absolute', left: '-2px', top: '-3px', width: '4px', height: '10px', background: '#DC2626', boxShadow: '0 0 4px rgba(220,38,38,0.6)' }} />
          <span style={{ position: 'absolute', right: '-2px', top: '-3px', width: '4px', height: '10px', background: 'rgba(220,38,38,0.3)' }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(220,38,38,0.15)',
          }}>
            <motion.div
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.08, ease: 'linear' }}
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #DC2626 0%, #F97316 100%)',
                boxShadow: '0 0 10px rgba(220,38,38,0.85)',
              }}
            />
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes briefing-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.45; transform: scale(0.82); }
        }
        @keyframes briefing-data-scroll {
          0%   { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        @keyframes briefing-flicker {
          0%, 100% { opacity: 1; }
          92%      { opacity: 1; }
          94%      { opacity: 0.4; }
          96%      { opacity: 1; }
        }
        @keyframes briefing-grain-shift {
          0%   { transform: translate(0, 0); }
          25%  { transform: translate(-3%, 2%); }
          50%  { transform: translate(2%, -3%); }
          75%  { transform: translate(-1%, 1%); }
          100% { transform: translate(0, 0); }
        }
        .briefing-scan-bar {
          animation: briefing-scan-bar-anim 7s linear infinite;
        }
        @keyframes briefing-scan-bar-anim {
          0%   { top: -2%; opacity: 0; }
          12%  { opacity: 0.85; }
          88%  { opacity: 0.85; }
          100% { top: 102%; opacity: 0; }
        }
        .briefing-border-spin {
          animation: briefing-border-spin-anim 4.2s linear infinite;
        }
        @keyframes briefing-border-spin-anim {
          to { transform: rotate(360deg); }
        }
        .briefing-eq-bar {
          height: 6px;
          animation: briefing-eq-bar-anim 1.1s ease-in-out infinite;
          transform-origin: bottom;
        }
        @keyframes briefing-eq-bar-anim {
          0%, 100% { height: 4px; opacity: 0.45; }
          25%      { height: 14px; opacity: 0.95; }
          50%      { height: 7px;  opacity: 0.6; }
          75%      { height: 22px; opacity: 1; box-shadow: 0 0 8px rgba(220,38,38,0.85); }
        }
        /* Hide every native browser video control / overlay */
        .briefing-video::-webkit-media-controls,
        .briefing-video::-webkit-media-controls-enclosure,
        .briefing-video::-webkit-media-controls-panel,
        .briefing-video::-webkit-media-controls-overlay-play-button,
        .briefing-video::-webkit-media-controls-start-playback-button,
        .briefing-video::-internal-media-controls-overflow-button,
        .briefing-video::-webkit-media-controls-fullscreen-button,
        .briefing-video::-webkit-media-controls-mute-button,
        .briefing-video::-webkit-media-controls-toggle-closed-captions-button,
        .briefing-video::-webkit-media-controls-volume-slider {
          display: none !important;
          opacity: 0 !important;
          -webkit-appearance: none !important;
        }
        .briefing-video {
          pointer-events: none;
        }
      `}</style>
    </motion.div>
  )
}

// ═════════════════════════════════════════════════════════════
// SIDE PANEL — vertical encrypted data feed (decorative)
// ═════════════════════════════════════════════════════════════
function SidePanel({ side, phase, caseCode }: { side: 'left' | 'right'; phase: Phase; caseCode: string }) {
  // Generate stable pseudo-random hex strings
  const lines = Array.from({ length: 30 }, (_, i) => {
    const t = (8 * 60 * 60) + (i * 47) // mock timestamp seconds
    const h = Math.floor(t / 3600).toString().padStart(2, '0')
    const m = Math.floor((t % 3600) / 60).toString().padStart(2, '0')
    const s = (t % 60).toString().padStart(2, '0')
    const hex = Array.from({ length: 8 }, (_, j) => ((i * 113 + j * 37) % 256).toString(16).padStart(2, '0').toUpperCase()).join('')
    return `${h}:${m}:${s}  ${hex.slice(0, 16)}`
  })

  return (
    <aside style={{
      height: '100%',
      maxHeight: '600px',
      padding: '12px',
      background: 'rgba(15,8,4,0.65)',
      border: '1px solid rgba(220,38,38,0.18)',
      borderRadius: '2px',
      display: 'flex', flexDirection: 'column', gap: '10px',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Section header */}
      <div style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: '8px', letterSpacing: '0.24em',
        color: 'rgba(220,38,38,0.85)', fontWeight: 700,
        textTransform: 'uppercase',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(220,38,38,0.2)',
      }}>
        {side === 'left' ? ':: encrypted feed' : ':: uplink status'}
      </div>

      {side === 'left' && (
        <div style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '4px',
            animation: 'briefing-data-scroll 28s linear infinite',
          }}>
            {[...lines, ...lines].map((line, i) => (
              <div key={i} style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: '9px', letterSpacing: '0.06em',
                color: i % 5 === 0 ? '#DC2626' : 'rgba(232,223,200,0.42)',
                opacity: i % 5 === 0 ? 0.85 : 0.45,
              }}>
                {line}
              </div>
            ))}
          </div>
          {/* Top + bottom fade */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '20px', background: 'linear-gradient(180deg, rgba(15,8,4,1), transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '20px', background: 'linear-gradient(0deg, rgba(15,8,4,1), transparent)', pointerEvents: 'none' }} />
        </div>
      )}

      {side === 'right' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
          {[
            { k: 'STATUS',     v: phase === 'pre-roll' ? 'LOCKING' : phase === 'playing' ? 'ACTIVE' : 'CLOSED', color: '#DC2626' },
            { k: 'CHANNEL',    v: '04',                color: '#E8DFC8' },
            { k: 'ENCRYPTION', v: 'AES-256',           color: '#E8DFC8' },
            { k: 'CASE',       v: caseCode,            color: '#FFB830' },
            { k: 'PRIORITY',   v: 'OMEGA',             color: '#DC2626' },
            { k: 'ORIGIN',     v: 'O.R.U.S.',          color: '#E8DFC8' },
          ].map(row => (
            <div key={row.k}>
              <div style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: '8px', letterSpacing: '0.18em',
                color: 'rgba(168,152,128,0.55)',
                marginBottom: '3px',
                textTransform: 'uppercase',
              }}>
                {row.k}
              </div>
              <div style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: '11px', letterSpacing: '0.12em',
                color: row.color,
                fontWeight: 600,
                textTransform: 'uppercase',
              }}>
                {row.v}
              </div>
            </div>
          ))}

          {/* Signal strength meter */}
          <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid rgba(220,38,38,0.18)' }}>
            <div style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: '8px', letterSpacing: '0.18em',
              color: 'rgba(168,152,128,0.55)', marginBottom: '6px',
              textTransform: 'uppercase',
            }}>
              SIGNAL
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '20px' }}>
              {[6, 9, 12, 14, 17, 14, 11].map((h, i) => (
                <span key={i} style={{
                  flex: 1, height: `${h}px`,
                  background: i < 5 ? '#DC2626' : 'rgba(220,38,38,0.25)',
                  boxShadow: i < 5 ? '0 0 4px rgba(220,38,38,0.6)' : 'none',
                }} />
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

// ═════════════════════════════════════════════════════════════
// PRE-ROLL — handshake / signal acquisition (1.7s)
// ═════════════════════════════════════════════════════════════
function PreRoll({ caseCode }: { caseCode: string }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 350),
      setTimeout(() => setStep(2), 750),
      setTimeout(() => setStep(3), 1150),
      setTimeout(() => setStep(4), 1500),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
      {/* Acquiring crosshair */}
      <div style={{
        position: 'relative',
        width: '80px', height: '80px',
        marginBottom: '12px',
      }}>
        <span style={{ position: 'absolute', top: 0, left: '50%', width: '1px', height: '100%', background: 'rgba(220,38,38,0.6)', transform: 'translateX(-50%)' }} />
        <span style={{ position: 'absolute', top: '50%', left: 0, width: '100%', height: '1px', background: 'rgba(220,38,38,0.6)', transform: 'translateY(-50%)' }} />
        <motion.span
          animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.8, repeat: Infinity }}
          style={{
            position: 'absolute', inset: 0,
            border: '1.5px solid #DC2626',
            borderRadius: '50%',
          }}
        />
        <span style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '6px', height: '6px',
          background: '#DC2626',
          boxShadow: '0 0 10px rgba(220,38,38,0.95)',
        }} />
      </div>

      {/* Sequential boot lines */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        gap: '4px', alignItems: 'flex-start',
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: '13px', letterSpacing: '0.14em',
        textAlign: 'left',
        minWidth: '420px',
      }}>
        {[
          { txt: '> INCOMING TRANSMISSION...',         show: step >= 0 },
          { txt: `> CHANNEL 04 · CASE ${caseCode}`,    show: step >= 1 },
          { txt: '> AUTHENTICATING ORUS HANDSHAKE...', show: step >= 2 },
          { txt: '> VERIFIED · AES-256 · SIGNAL LOCKED', show: step >= 3, hot: true },
          { txt: '> PLAYING...',                       show: step >= 4, hot: true },
        ].map((l, i) => l.show && (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              color: l.hot ? '#DC2626' : 'rgba(232,223,200,0.85)',
              fontWeight: l.hot ? 700 : 500,
            }}
          >
            {l.txt}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// POST-ROLL — transmission complete (1.5s)
// ═════════════════════════════════════════════════════════════
function PostRoll() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: '70px', height: '70px',
          borderRadius: '50%',
          border: '2px solid #DC2626',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 32px rgba(220,38,38,0.5)',
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        style={{
          fontFamily: 'var(--font-anton), sans-serif',
          fontSize: 'clamp(28px, 3vw, 42px)',
          letterSpacing: '0.16em',
          color: '#E8DFC8',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        Transmission Complete
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: '11px', letterSpacing: '0.22em',
          color: 'rgba(220,38,38,0.85)',
          textTransform: 'uppercase',
        }}
      >
        Routing to prep room...
      </motion.div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// BACKGROUND EMBERS — particles.casberry inspired
// ═════════════════════════════════════════════════════════════
function BackgroundEmbers() {
  // Stable seeded particles so they don't jitter between renders
  const embers = useMemo(() => Array.from({ length: 38 }, (_, i) => ({
    id: i,
    leftPct: ((i * 137.5) % 100),
    delay: (i * 0.31) % 8,
    duration: 7 + ((i * 1.7) % 6),
    size: 1.5 + ((i * 0.6) % 2.4),
    horizontalDrift: ((i % 2 === 0) ? 1 : -1) * (8 + ((i * 1.1) % 16)),
  })), [])

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
      overflow: 'hidden',
    }}>
      {embers.map(p => (
        <motion.span
          key={p.id}
          initial={{ y: '110vh', x: 0, opacity: 0 }}
          animate={{
            y: '-12vh',
            x: [0, p.horizontalDrift, p.horizontalDrift * 1.5],
            opacity: [0, 0.6, 0.85, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
          style={{
            position: 'absolute',
            left: `${p.leftPct}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: '#DC2626',
            borderRadius: '50%',
            boxShadow: `0 0 ${p.size * 3.5}px rgba(220,38,38,0.6)`,
          }}
        />
      ))}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// MOUSE SPOTLIGHT — 21st.dev / Aceternity
// Soft red radial gradient that follows the cursor with damping
// ═════════════════════════════════════════════════════════════
function MouseSpotlight() {
  const x = useMotionValue(typeof window !== 'undefined' ? window.innerWidth / 2 : 800)
  const y = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 450)
  const sx = useSpring(x, { stiffness: 180, damping: 30, mass: 0.6 })
  const sy = useSpring(y, { stiffness: 180, damping: 30, mass: 0.6 })

  useEffect(() => {
    const move = (e: MouseEvent) => { x.set(e.clientX); y.set(e.clientY) }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [x, y])

  const bg = useTransform([sx, sy], ([cx, cy]) =>
    `radial-gradient(540px circle at ${cx}px ${cy}px, rgba(220,38,38,0.10) 0%, rgba(220,38,38,0.04) 25%, transparent 60%)`,
  )

  return (
    <motion.div
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
        background: bg,
        mixBlendMode: 'screen',
      }}
    />
  )
}

// ═════════════════════════════════════════════════════════════
// FALLBACK — text-only briefing if MP4 fails
// ═════════════════════════════════════════════════════════════
function FallbackBriefing() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '20px', padding: '0 48px',
      background: 'radial-gradient(ellipse at center, rgba(60,5,5,1) 0%, #000 100%)',
    }}>
      <div style={{
        fontFamily: 'var(--font-anton), sans-serif',
        fontSize: '28px',
        color: '#DC2626',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        textAlign: 'center',
      }}>
        Visual Feed Unavailable
      </div>
      <div style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: '11px',
        letterSpacing: '0.2em',
        color: 'rgba(232,223,200,0.5)',
        textTransform: 'uppercase',
      }}>
        ORUS audio transmission active
      </div>
    </div>
  )
}
