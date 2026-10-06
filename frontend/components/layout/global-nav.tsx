'use client'

import { usePathname, useRouter } from 'next/navigation'
import { BookOpen, Library, Activity, BarChart3, Home, TrendingUp } from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  match: (pathname: string) => boolean
}

const NAV: NavItem[] = [
  { label: 'Home',     href: '/',                       icon: Home,      match: p => p === '/' },
  { label: 'Academy',  href: '/academy',                icon: BookOpen,  match: p => p.startsWith('/academy') },
  { label: 'Ledger',   href: '/ledger',                 icon: Library,   match: p => p.startsWith('/ledger') },
  { label: 'Scenarios', href: '/scenarios',             icon: Activity,  match: p => p.startsWith('/scenarios') || p.includes('/live') },
  { label: 'Debrief',  href: '/sim/COV-20/debrief',     icon: BarChart3, match: p => p.includes('/debrief') },
  { label: 'Progress', href: '/progress',               icon: TrendingUp, match: p => p.startsWith('/progress') },
]

interface Props {
  accent?: string             // hex without #
  variant?: 'solid' | 'glass'
}

export function GlobalNav({ accent = 'D4A04D', variant = 'glass' }: Props) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 80,
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      alignItems: 'center', gap: '20px',
      padding: '14px 28px',
      background: variant === 'glass'
        ? 'linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0.65))'
        : '#0A0A0A',
      backdropFilter: 'blur(10px)',
      borderBottom: `1px solid rgba(${rgb(accent)}, 0.20)`,
    }}>
      {/* LEFT — brand monogram, click → home */}
      <button
        onClick={() => router.push('/')}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '4px 10px',
          border: `1.5px solid #${accent}`,
          background: 'transparent',
          fontFamily: 'var(--font-anton), sans-serif',
          fontSize: '14px', fontWeight: 700,
          color: '#F0F0F0',
          letterSpacing: '0.18em',
          cursor: 'pointer',
        }}
      >ZDM</button>

      {/* CENTER — primary tabs */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: '4px',
      }}>
        {NAV.map(item => {
          const Icon = item.icon
          const active = item.match(pathname)
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '8px 14px',
                background: active ? `rgba(${rgb(accent)}, 0.12)` : 'transparent',
                border: `1px solid ${active ? `#${accent}88` : 'transparent'}`,
                borderRadius: '6px',
                color: active ? `#${accent}` : '#909090',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: '10.5px', fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.18s',
              }}
              onMouseEnter={e => {
                if (active) return
                ;(e.currentTarget as HTMLButtonElement).style.color = '#E0E0E0'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
              }}
              onMouseLeave={e => {
                if (active) return
                ;(e.currentTarget as HTMLButtonElement).style.color = '#909090'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              <Icon size={11}/>
              {item.label}
            </button>
          )
        })}
      </div>

      {/* RIGHT — current section indicator */}
      <div style={{
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: '10px',
        color: `#${accent}99`,
        letterSpacing: '0.16em', textTransform: 'uppercase',
      }}>
        {NAV.find(n => n.match(pathname))?.label ?? 'Loading'}
      </div>
    </nav>
  )
}

function rgb(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `${r},${g},${b}`
}
