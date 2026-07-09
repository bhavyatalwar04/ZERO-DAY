'use client'

import type { ReactNode } from 'react'

interface BookFrameProps {
  caseNumber: number
  totalCases: number
  onPrev: () => void
  onNext: () => void
  children: ReactNode
}

/**
 * The leather-bound book itself — outer oxblood cover,
 * inner cream paper, two-page spread, ribbon bookmark, page-flip arrows.
 * Children render the actual case content (fills both pages).
 */
export function BookFrame({ caseNumber, totalCases, onPrev, onNext, children }: BookFrameProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0 8px',
      gap: '14px',
      minWidth: 0,
    }}>
      {/* "THE BOOK" caption */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        width: '100%',
        maxWidth: '880px',
        padding: '0 8px',
        marginBottom: '4px',
      }}>
        <span style={{
          fontFamily: 'var(--font-geist-sans), sans-serif',
          fontSize: '10px',
          letterSpacing: '0.28em',
          color: 'rgba(168,152,128,0.65)',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}>
          The Book
        </span>
        <span style={{
          fontFamily: 'Garamond, "EB Garamond", "Times New Roman", serif',
          fontStyle: 'italic',
          fontSize: '12px',
          color: 'rgba(168,152,128,0.55)',
        }}>
          Case {(caseNumber + 1).toString().padStart(3, '0')} →
        </span>
      </div>

      {/* The book itself */}
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: '880px',
        display: 'flex',
        alignItems: 'center',
      }}>
        {/* Left page-flip arrow */}
        <button
          onClick={onPrev}
          aria-label="Previous case"
          style={{
            position: 'absolute',
            left: '-44px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '36px',
            height: '36px',
            background: 'transparent',
            border: 'none',
            color: 'rgba(232,223,200,0.5)',
            fontSize: '32px',
            fontFamily: 'Garamond, serif',
            lineHeight: 1,
            cursor: 'pointer',
            transition: 'color 0.2s, transform 0.2s',
            zIndex: 10,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#DC2626'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) translateX(-2px)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(232,223,200,0.5)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%)' }}
        >
          ‹
        </button>

        {/* Outer leather cover */}
        <div style={{
          position: 'relative',
          width: '100%',
          padding: '22px',  // leather border thickness
          background: 'linear-gradient(135deg, #3D1F18 0%, #2A1208 50%, #3D1F18 100%)',
          borderRadius: '6px',
          boxShadow: `
            0 18px 50px rgba(0, 0, 0, 0.65),
            0 0 0 1px rgba(201, 164, 95, 0.18),
            inset 0 1px 0 rgba(201, 164, 95, 0.12),
            inset 0 -1px 0 rgba(0, 0, 0, 0.4)
          `,
        }}>
          {/* Gold-leaf inner frame */}
          <div style={{
            position: 'absolute',
            inset: '12px',
            border: '1px solid rgba(201,164,95,0.32)',
            pointerEvents: 'none',
            borderRadius: '2px',
          }} />

          {/* Inner cream page area */}
          <div style={{
            position: 'relative',
            background: '#E8DFC8',
            // Subtle paper-fiber texture
            backgroundImage: `
              radial-gradient(rgba(60, 30, 15, 0.04) 1px, transparent 1px),
              linear-gradient(180deg, rgba(232,223,200,1) 0%, rgba(220,210,188,1) 100%)
            `,
            backgroundSize: '4px 4px, 100% 100%',
            minHeight: '460px',
            boxShadow: 'inset 0 0 50px rgba(80, 50, 20, 0.18)',
            overflow: 'hidden',
          }}>
            {/* Spine seam — subtle vertical shadow on either side of center */}
            <div style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: '24px',
              transform: 'translateX(-50%)',
              background: 'linear-gradient(90deg, transparent 0%, rgba(60,30,15,0.18) 35%, rgba(60,30,15,0.32) 50%, rgba(60,30,15,0.18) 65%, transparent 100%)',
              pointerEvents: 'none',
              zIndex: 1,
            }} />

            {/* Content (case renderer fills both pages) */}
            <div style={{ position: 'relative', zIndex: 2, height: '100%' }}>
              {children}
            </div>

            {/* Red silk ribbon bookmark — bottom-right */}
            <div style={{
              position: 'absolute',
              top: '-22px',
              right: '60px',
              width: '14px',
              bottom: '-30px',
              background: 'linear-gradient(180deg, #8B0000 0%, #6B0000 100%)',
              boxShadow: '1px 0 3px rgba(0,0,0,0.3)',
              zIndex: 3,
            }}>
              {/* Forked tail */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '8px',
                background: 'linear-gradient(180deg, #6B0000 0%, transparent 100%)',
                clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
              }} />
            </div>
          </div>
        </div>

        {/* Right page-flip arrow */}
        <button
          onClick={onNext}
          aria-label="Next case"
          style={{
            position: 'absolute',
            right: '-44px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '36px',
            height: '36px',
            background: 'transparent',
            border: 'none',
            color: 'rgba(232,223,200,0.5)',
            fontSize: '32px',
            fontFamily: 'Garamond, serif',
            lineHeight: 1,
            cursor: 'pointer',
            transition: 'color 0.2s, transform 0.2s',
            zIndex: 10,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#DC2626'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) translateX(2px)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(232,223,200,0.5)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%)' }}
        >
          ›
        </button>
      </div>

      {/* Page number caption */}
      <div style={{
        fontFamily: '"Big Caslon", Caslon, Garamond, serif',
        fontStyle: 'italic',
        fontSize: '11px',
        color: 'rgba(168,152,128,0.55)',
        letterSpacing: '0.04em',
      }}>
        N° {caseNumber.toString().padStart(3, '0')} / {totalCases}
      </div>
    </div>
  )
}
