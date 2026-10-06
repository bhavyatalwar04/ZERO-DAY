import Link from 'next/link'
import { GlobalNav } from '@/components/layout/global-nav'
import { SCENARIOS, OUT_OF_SCOPE } from '@/lib/engine/scenarios'

// 7.3 Scenario selection: the playable days (M4, ADR-009/011), each with its
// briefing (what was known BEFORE the open, no spoilers) and an honest note on
// where its prices come from. Written by Claude at Bhavya's request (2026-10-03).

const GOLD = '#D4A04D'
const MUTED = '#8A8A8A'
const sans = 'var(--font-inter), sans-serif'

export default function ScenariosPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(212,160,77,0.06), transparent 55%), #000', color: '#E0E0E0' }}>
      <GlobalNav />
      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '96px 16px 64px' }}>
        <h1 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '34px', fontWeight: 500, margin: 0 }}>Choose a trading day</h1>
        <p style={{ fontFamily: sans, fontSize: '14px', color: MUTED, marginTop: '8px', maxWidth: '700px', lineHeight: 1.6 }}>
          Each scenario replays one real market day, minute by minute, without telling you how it ends. You start with 1,00,000 in the local currency.
        </p>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px', marginTop: '28px' }}>
          {Object.entries(SCENARIOS).map(([id, s]) => (
            <article key={id} style={{ background: '#0A0A0A', border: '1px solid #1F1F1F', borderRadius: '10px', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontFamily: sans, fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
                {id} · {s.market.exchange} · {s.dateLabel}
              </div>
              <div>
                <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: '22px', fontWeight: 500, margin: 0 }}>{s.title}</h2>
                <div style={{ fontFamily: sans, fontSize: '13px', color: MUTED, marginTop: '2px' }}>{s.subtitle}</div>
              </div>
              <p style={{ fontFamily: sans, fontSize: '13px', lineHeight: 1.6, margin: 0 }}>{s.briefing}</p>
              <p style={{ fontFamily: sans, fontSize: '13px', lineHeight: 1.6, margin: 0, color: '#C8C8C8' }}><b>Your task:</b> {s.objective}</p>
              <div style={{ fontFamily: sans, fontSize: '12px', color: MUTED }}>
                Difficulty {'●'.repeat(s.difficulty)}{'○'.repeat(5 - s.difficulty)} · {Object.keys(s.dataset.timeline).length} stocks · {s.market.currency} · {s.market.tz}
              </div>
              <p style={{ fontFamily: sans, fontSize: '11px', color: '#6A6A6A', lineHeight: 1.5, margin: 0 }}>{s.dataNote}</p>
              <div style={{ marginTop: 'auto', display: 'flex', gap: '10px' }}>
                <Link href={`/sim/${id}/live`} style={{ fontFamily: sans, fontSize: '13px', fontWeight: 600, color: '#000', background: GOLD, borderRadius: '6px', padding: '8px 14px', textDecoration: 'none' }}>Play</Link>
                {s.hasPrepRoom && (
                  <Link href={`/sim/${id}/prep`} style={{ fontFamily: sans, fontSize: '13px', color: GOLD, border: `1px solid ${GOLD}66`, borderRadius: '6px', padding: '8px 14px', textDecoration: 'none' }}>Prep room</Link>
                )}
              </div>
            </article>
          ))}
        </section>

        <h2 style={{ fontFamily: sans, fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: MUTED, marginTop: '40px' }}>Not playable (and why)</h2>
        <ul style={{ fontFamily: sans, fontSize: '13px', color: '#A0A0A0', lineHeight: 1.7, paddingLeft: '18px' }}>
          {OUT_OF_SCOPE.map(o => <li key={o.id}><b style={{ color: '#D0D0D0' }}>{o.title}:</b> {o.reason}</li>)}
        </ul>
      </main>
    </div>
  )
}
