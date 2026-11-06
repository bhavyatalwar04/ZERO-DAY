'use client'

// 5.4 study consent UI (docs/STUDY.md § Ethics, lib/study/consent.ts).
// - StudyConsentGate: wraps the live room. In study mode, a signed-in user who
//   hasn't answered the current information sheet sees it before the session
//   starts (so no session row exists until they answer). Either answer lets them
//   play; only "I agree" makes them a participant.
// - StudyParticipation: on /progress, shows their status and lets them withdraw
//   (or join later).
// Off unless NEXT_PUBLIC_STUDY_MODE=true: then both render nothing extra.
// Written by Claude at Bhavya's request (2026-11-04).

import { useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { STUDY_MODE } from '@/lib/study/condition'
import { consentOf, consentRecord, isParticipant, needsConsentPrompt, type ConsentRecord, type ConsentStatus } from '@/lib/study/consent'

const GOLD = '#D4A04D'
const MUTED = '#8A8A8A'
const sans = 'var(--font-inter), sans-serif'

type Loaded = { state: 'loading' } | { state: 'none' } | { state: 'user'; record: ConsentRecord | null }

function useConsent(): [Loaded, (status: ConsentStatus) => Promise<string | null>] {
  const [loaded, setLoaded] = useState<Loaded>(STUDY_MODE ? { state: 'loading' } : { state: 'none' })
  useEffect(() => {
    if (!STUDY_MODE) return
    createClient().auth.getUser()
      .then(({ data }: { data: { user: { user_metadata?: unknown } | null } }) =>
        setLoaded(data.user ? { state: 'user', record: consentOf(data.user.user_metadata) } : { state: 'none' }))
      .catch(() => setLoaded({ state: 'none' }))
  }, [])

  async function answer(status: ConsentStatus): Promise<string | null> {
    const record = consentRecord(status)
    const { error } = await createClient().auth.updateUser({ data: { study_consent: record } })
    if (error) return error.message ?? 'Could not save your answer.'
    setLoaded({ state: 'user', record })
    return null
  }
  return [loaded, answer]
}

function InformationSheet() {
  const p: React.CSSProperties = { margin: '0 0 10px', lineHeight: 1.6 }
  return (
    <div style={{ fontFamily: sans, fontSize: '13.5px', color: '#C8C8C8' }}>
      <p style={p}>We are studying whether in-the-moment feedback helps people make fewer impulsive trading decisions over several sessions. It is part of a university project.</p>
      <ul style={{ margin: '0 0 10px', paddingLeft: '18px', lineHeight: 1.6 }}>
        <li><b>What you do:</b> play at least 4 sessions, ideally on different days. Nothing else.</li>
        <li><b>Two groups:</b> you are placed at random in one. One group sees the coach&apos;s feedback during play, the other doesn&apos;t. Both get the same scorecard afterwards.</li>
        <li><b>What we use:</b> your in-game actions and scorecards, linked to an anonymous account id. No name or email leaves the database.</li>
        <li><b>No real money</b> is involved, and there is no penalty for anything you do in the game.</li>
        <li><b>You can withdraw at any time</b> from the Progress page. Your sessions are then excluded from the analysis.</li>
      </ul>
      <p style={{ ...p, color: MUTED }}>If you say no, you can still use Zero Day exactly as normal, with the coach on.</p>
    </div>
  )
}

const button = (primary: boolean): React.CSSProperties => ({
  padding: '10px 16px', borderRadius: '6px', cursor: 'pointer', fontFamily: sans, fontSize: '13px', fontWeight: 600,
  background: primary ? GOLD : 'transparent', color: primary ? '#000' : '#E0E0E0',
  border: `1px solid ${primary ? GOLD : '#333'}`,
})

export function StudyConsentGate({ children }: { children: ReactNode }) {
  const [loaded, answer] = useConsent()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loaded.state === 'none') return <>{children}</>
  if (loaded.state === 'user' && !needsConsentPrompt(loaded.record)) return <>{children}</>
  if (loaded.state === 'loading') return <div style={{ minHeight: '100vh', background: '#000' }} />

  async function choose(status: ConsentStatus) {
    setBusy(true)
    setError(await answer(status))
    setBusy(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000', color: '#E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div role="dialog" aria-labelledby="consent-title" style={{ maxWidth: '620px', width: '100%', background: '#0A0A0A', border: '1px solid #1F1F1F', borderRadius: '10px', padding: '24px' }}>
        <div style={{ fontFamily: sans, fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Research study</div>
        <h1 id="consent-title" style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '26px', fontWeight: 500, margin: '8px 0 14px' }}>Would you like to take part?</h1>
        <InformationSheet />
        {error && <p role="alert" style={{ color: '#E04A4A', fontFamily: sans, fontSize: '13px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
          <button disabled={busy} onClick={() => choose('given')} style={button(true)}>I agree to take part</button>
          <button disabled={busy} onClick={() => choose('declined')} style={button(false)}>No thanks, just play</button>
        </div>
      </div>
    </div>
  )
}

export function StudyParticipation() {
  const [loaded, answer] = useConsent()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (loaded.state !== 'user') return null
  const participant = isParticipant(loaded.record)

  async function choose(status: ConsentStatus) {
    if (status === 'withdrawn' && !window.confirm('Withdraw from the study? Your sessions will be excluded from the analysis. You can keep playing.')) return
    setBusy(true)
    setError(await answer(status))
    setBusy(false)
  }

  return (
    <section style={{ background: '#0A0A0A', border: '1px solid #1F1F1F', borderRadius: '10px', padding: '18px 20px', marginTop: '28px' }}>
      <div style={{ fontFamily: sans, fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: MUTED }}>Research study</div>
      <p style={{ fontFamily: sans, fontSize: '14px', margin: '8px 0 12px', lineHeight: 1.6 }}>
        {participant
          ? 'You are taking part. Thank you. Your group stays the same on every device.'
          : loaded.record?.status === 'withdrawn'
            ? 'You have withdrawn. Your sessions are excluded from the analysis.'
            : 'You are not taking part. The coach is on as normal.'}
      </p>
      {error && <p role="alert" style={{ color: '#E04A4A', fontFamily: sans, fontSize: '13px' }}>{error}</p>}
      {participant
        ? <button disabled={busy} onClick={() => choose('withdrawn')} style={button(false)}>Withdraw from the study</button>
        : <details><summary style={{ cursor: 'pointer', color: GOLD, fontFamily: sans, fontSize: '13px' }}>Read about the study and join</summary>
            <div style={{ marginTop: '12px' }}><InformationSheet /></div>
            <button disabled={busy} onClick={() => choose('given')} style={button(true)}>I agree to take part</button>
          </details>}
    </section>
  )
}
