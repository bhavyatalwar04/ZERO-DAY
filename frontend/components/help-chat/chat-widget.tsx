'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Sparkles, RotateCcw, AlertCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { ALL_ILLUSTRATION_SLUGS, InlineIllustration } from './illustrations'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

const STORAGE_KEY = 'zdm-help-chat'

const INITIAL_GREETING: ChatMessage = {
  role: 'assistant',
  ts: Date.now(),
  content: `Hi — I'm ORUS, your trading-floor assistant. I can answer questions about the platform (Scenarios, Live Sim, AI Coach, Progress, Academy, Ledger) or about trading concepts (patterns, risk, psychology). I can also show you diagrams when they help.

What do you want to figure out?`,
}

export function HelpChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load persisted history on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[]
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed)
      }
    } catch {}
  }, [])

  // Persist on change
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)) } catch {}
  }, [messages])

  // Auto-scroll on new messages
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, open, loading])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg: ChatMessage = { role: 'user', content: input.trim(), ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg]
            .filter(m => m.role === 'user' || m !== INITIAL_GREETING)
            .map(m => ({ role: m.role, content: m.content })),
          availableImages: ALL_ILLUSTRATION_SLUGS,
        }),
      })
      if (res.status === 401) throw new Error('Sign in to chat with ORUS.')
      if (res.status === 429) throw new Error(((await res.json().catch(() => ({}))) as { reply?: string }).reply ?? "You've used ORUS a lot in the last hour. Try again a little later.")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { reply: string }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, ts: Date.now() }])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(msg.startsWith('Sign in') || msg.startsWith("You've used") ? msg : `Couldn't reach the assistant. ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setMessages([INITIAL_GREETING])
    setError(null)
  }

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open help chat"
          style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 95,
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '12px 16px',
            background: 'linear-gradient(135deg, #D4A04D, #8B6520)',
            border: 'none', borderRadius: '999px',
            color: '#000',
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '11px', fontWeight: 800, letterSpacing: '0.20em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(212,160,77,0.40), 0 0 0 1px rgba(212,160,77,0.40)',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)' }}
        >
          <MessageCircle size={14}/> Help me
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 95,
          width: 'min(440px, 92vw)',
          height: 'min(640px, 86vh)',
          display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(160deg, #0D0D0D 0%, #060606 100%)',
          border: '1px solid rgba(212,160,77,0.40)',
          borderTop: '3px solid #D4A04D',
          borderRadius: '12px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.80), 0 0 80px rgba(212,160,77,0.10)',
          animation: 'help-in 0.28s ease-out',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: '1px solid rgba(212,160,77,0.20)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '32px', height: '32px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(212,160,77,0.18)',
                border: '1px solid #D4A04D',
                borderRadius: '50%',
                fontFamily: 'var(--font-anton), sans-serif',
                fontSize: '13px', fontWeight: 800, color: '#D4A04D',
              }}>O</div>
              <div>
                <div style={{
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '11px', fontWeight: 800, color: '#E0E0E0',
                  letterSpacing: '0.06em',
                }}>ORUS · Help</div>
                <div style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '9px', color: '#606060',
                  marginTop: '1px',
                }}>{loading ? 'thinking…' : 'online'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={reset} title="Reset conversation" style={iconBtn}>
                <RotateCcw size={11}/>
              </button>
              <button onClick={() => setOpen(false)} title="Close" style={iconBtn}>
                <X size={11}/>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex', flexDirection: 'column', gap: '14px',
            background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(212,160,77,0.04), transparent 60%)',
          }}>
            {messages.map((m, i) => <Bubble key={i} msg={m}/>)}
            {loading && <TypingIndicator/>}
            {error && (
              <div style={{
                padding: '10px 12px',
                background: 'rgba(255,31,31,0.08)',
                border: '1px solid #FF1F1F44',
                borderLeft: '3px solid #FF1F1F',
                borderRadius: '5px',
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                fontFamily: 'var(--font-fraunces), serif',
                fontStyle: 'italic',
                fontSize: '12px', color: '#FF8888',
              }}>
                <AlertCircle size={12} style={{ flexShrink: 0, marginTop: '2px' }}/>
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{
            padding: '12px',
            borderTop: '1px solid rgba(212,160,77,0.20)',
            background: 'rgba(0,0,0,0.4)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder="Ask anything about trading or this platform…"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: '#000',
                  border: '1px solid rgba(212,160,77,0.30)',
                  borderRadius: '6px',
                  color: '#E0E0E0',
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontSize: '13px',
                  resize: 'none', outline: 'none',
                  minHeight: '38px', maxHeight: '120px',
                }}
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '38px',
                  background: input.trim() && !loading
                    ? 'linear-gradient(135deg, #D4A04D, #8B6520)'
                    : 'rgba(255,255,255,0.06)',
                  border: 'none', borderRadius: '6px',
                  color: input.trim() && !loading ? '#000' : '#606060',
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                }}
              >
                <Send size={14}/>
              </button>
            </div>
            <div style={{
              marginTop: '6px',
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '9px', color: '#404040',
              letterSpacing: '0.10em',
              textAlign: 'right',
            }}>Enter to send · Shift+Enter for newline</div>
          </div>

          <style>{`
            @keyframes help-in {
              from { opacity: 0; transform: translateY(20px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </>
  )
}

// ── Bubble ─────────────────────────────────────────────────

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: '8px',
    }}>
      {!isUser && (
        <div style={{
          flexShrink: 0,
          width: '24px', height: '24px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(212,160,77,0.18)',
          border: '1px solid rgba(212,160,77,0.50)',
          borderRadius: '50%',
          fontFamily: 'var(--font-anton), sans-serif',
          fontSize: '10px', fontWeight: 800, color: '#D4A04D',
          marginTop: '2px',
        }}>O</div>
      )}
      <div style={{
        maxWidth: '82%',
        padding: '10px 14px',
        background: isUser ? 'rgba(212,160,77,0.14)' : 'rgba(0,0,0,0.50)',
        border: `1px solid ${isUser ? 'rgba(212,160,77,0.40)' : 'rgba(255,255,255,0.10)'}`,
        borderRadius: '10px',
        borderTopRightRadius: isUser ? '3px' : '10px',
        borderTopLeftRadius: isUser ? '10px' : '3px',
      }}>
        <RenderMessage content={msg.content}/>
      </div>
    </div>
  )
}

// ── Message rendering — text + [img:slug] tokens ──────────

function RenderMessage({ content }: { content: string }) {
  // Split on [img:slug] tokens
  const parts: React.ReactNode[] = []
  const regex = /\[img:([a-z0-9-]+)\]/g
  let lastIndex = 0
  let match
  let key = 0
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<TextChunk key={key++} text={content.slice(lastIndex, match.index)}/>)
    }
    parts.push(<InlineIllustration key={key++} slug={match[1]}/>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    parts.push(<TextChunk key={key++} text={content.slice(lastIndex)}/>)
  }
  return <div>{parts}</div>
}

// The model writes light markdown (bold, lists) whatever the prompt says, and printing it
// raw showed literal "**". Render a small safe subset; headings etc. are unwrapped to text,
// raw HTML is never rendered (react-markdown default). (Claude, 2026-10-03, for Bhavya's review.)
const MD_ALLOWED = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'a', 'br']
const mdText: React.CSSProperties = {
  fontFamily: 'var(--font-inter), sans-serif',
  fontSize: '13px', color: '#E0E0E0', lineHeight: 1.6,
}

function TextChunk({ text }: { text: string }) {
  // Trim leading/trailing whitespace at boundaries with images
  const t = text.trim()
  if (!t) return null
  return (
    <div style={mdText}>
      <ReactMarkdown
        allowedElements={MD_ALLOWED}
        unwrapDisallowed
        components={{
          p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
          strong: ({ children }) => <strong style={{ color: '#FFFFFF', fontWeight: 600 }}>{children}</strong>,
          ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: '18px', listStyle: 'disc' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: '18px', listStyle: 'decimal' }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: '2px' }}>{children}</li>,
          code: ({ children }) => <code style={{ fontFamily: 'var(--font-mono), monospace', fontSize: '12px', color: '#D4A04D' }}>{children}</code>,
          a: ({ href, children }) => <a href={href} style={{ color: '#D4A04D', textDecoration: 'underline' }}>{children}</a>,
        }}
      >{t}</ReactMarkdown>
    </div>
  )
}

// ── Typing indicator ──────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0,
        width: '24px', height: '24px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(212,160,77,0.18)',
        border: '1px solid rgba(212,160,77,0.50)',
        borderRadius: '50%',
        fontFamily: 'var(--font-anton), sans-serif',
        fontSize: '10px', fontWeight: 800, color: '#D4A04D',
      }}>O</div>
      <div style={{
        padding: '12px 14px',
        background: 'rgba(0,0,0,0.50)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '10px', borderTopLeftRadius: '3px',
        display: 'flex', alignItems: 'center', gap: '4px',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: '6px', height: '6px',
            background: '#D4A04D', borderRadius: '50%',
            animation: `dot-pulse 1.2s infinite ${i * 0.2}s`,
          }}/>
        ))}
      </div>
      <style>{`@keyframes dot-pulse { 0%,80%,100%{opacity:0.3;transform:translateY(0)} 40%{opacity:1;transform:translateY(-3px)} }`}</style>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  width: '24px', height: '24px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '4px',
  color: '#909090',
  cursor: 'pointer',
}
