'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  message: string | null
}

export function CoachWhisper({ message }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!message) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 6000)
    return () => clearTimeout(t)
  }, [message])

  return (
    <AnimatePresence>
      {visible && message && (
        <motion.div
          initial={{ opacity: 0, y: 12, x: 0 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.35 }}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            maxWidth: '280px',
            background: 'rgba(14,19,24,0.95)',
            border: '1px solid #1e2a35',
            borderRadius: '12px',
            padding: '12px 16px',
            zIndex: 65,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>🎯</span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
              {message}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Hook to manage coach messages with throttling
export function useCoachWhisper(
  isMuted: boolean,
  triggers: {
    heldFalling: boolean
    overConcentrated: boolean
    missedSurge: string | null
  }
) {
  const [message, setMessage] = useState<string | null>(null)
  const lastFiredRef = useRef(0)
  const THROTTLE = 45000

  const fire = async (context: string) => {
    if (isMuted) return
    const now = Date.now()
    if (now - lastFiredRef.current < THROTTLE) return
    lastFiredRef.current = now

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: context }],
          context: 'portfolio',
        }),
      })
      if (!res.ok) return
      const text = await res.text()
      setMessage(text.slice(0, 120))
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (triggers.heldFalling) fire('User held a stock that fell significantly through a negative event.')
  }, [triggers.heldFalling])

  useEffect(() => {
    if (triggers.overConcentrated) fire('User put over 50% in a single stock after rebalancing.')
  }, [triggers.overConcentrated])

  useEffect(() => {
    if (triggers.missedSurge) fire(`User missed buying ${triggers.missedSurge} which surged after the event.`)
  }, [triggers.missedSurge])

  return message
}
