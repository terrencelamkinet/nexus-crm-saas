import { useState, useRef, useEffect, useCallback } from 'react'
import { apiClient } from '../lib/api'
import { Sparkles, X, Plus } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface SessionItem {
  session_id: string
  title: string
  status: string
  created_at: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 380
const ANIMATION_DURATION = 220

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let msgCounter = 0
function nextId(): string {
  msgCounter += 1
  return `msg_${Date.now()}_${msgCounter}`
}

function userMessage(content: string): ChatMessage {
  return { id: nextId(), role: 'user', content, timestamp: Date.now() }
}
function assistantMessage(content: string): ChatMessage {
  return { id: nextId(), role: 'assistant', content, timestamp: Date.now() }
}

// ---------------------------------------------------------------------------
// ChatboxToggleButton — FAB style
// ---------------------------------------------------------------------------

interface ToggleButtonProps {
  onClick: () => void
  visible: boolean
}

export function ChatboxToggleButton({ onClick, visible }: ToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Toggle AI chat"
      aria-expanded={visible}
      className={`fixed z-50 flex items-center justify-center border-0 cursor-pointer
        transition-all duration-[${ANIMATION_DURATION}ms] ease-out
        ${visible ? 'opacity-0 pointer-events-none scale-75' : 'opacity-100 pointer-events-auto scale-100'}
      `}
      style={{
        bottom: 24,
        right: 24,
        width: 48,
        height: 48,
        borderRadius: '50%',
        backgroundColor: 'var(--color-primary)',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.12)',
      }}
    >
      <Sparkles size={22} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// ChatboxPanel
// ---------------------------------------------------------------------------

export default function ChatboxPanel() {
  // ── State ──
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionList, setSessionList] = useState<SessionItem[]>([])
  const [showSessionList, setShowSessionList] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)

  // ── Refs ──
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)

  // ── Auto-scroll ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [messages, isLoading])

  // ── Focus input when panel opens ──
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), ANIMATION_DURATION + 50)
    }
  }, [isOpen])

  // ── Listen for toggle event ──
  useEffect(() => {
    const handler = () => setIsOpen(prev => !prev)
    window.addEventListener('toggle-ai-chat', handler)
    return () => window.removeEventListener('toggle-ai-chat', handler)
  }, [])

  // ── Escape to close ──
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  // ── Load sessions when panel opens ──
  useEffect(() => {
    if (!isOpen) return
    loadSessions()
  }, [isOpen])

  // ── Click outside session list to close ──
  useEffect(() => {
    if (!showSessionList) return
    const handler = (e: MouseEvent) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node)) {
        setShowSessionList(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSessionList])

  // ── Load session list ──
  const loadSessions = useCallback(async () => {
    setLoadingSession(true)
    try {
      const resp = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions')
      const list = resp?.sessions || []
      setSessionList(list)

      const active = list.find(s => s.status === 'active') || list[0]
      if (active) {
        switchSession(active.session_id)
      } else {
        createNewSession()
      }
    } catch {
      setMessages([assistantMessage('Hi! I\'m NEXUS AI. How can I help you today?')])
    } finally {
      setLoadingSession(false)
    }
  }, [])

  // ── Switch to a session ──
  const switchSession = useCallback(async (sid: string) => {
    setSessionId(sid)
    setShowSessionList(false)
    setLoadingSession(true)
    setMessages([])

    try {
      const resp = await apiClient.get<{ messages: any[] }>(`/api/v1/ai/sessions/${sid}/messages`)
      const msgs = resp?.messages || []
      if (msgs.length === 0) {
        setMessages([assistantMessage('Hi! I\'m NEXUS AI. How can I help you today?')])
      } else {
        setMessages(msgs.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at || Date.now()).getTime(),
        })))
      }
    } catch {
      setMessages([assistantMessage('Hi! I\'m NEXUS AI. How can I help you today?')])
    } finally {
      setLoadingSession(false)
    }
  }, [])

  // ── Create new session ──
  const createNewSession = useCallback(async () => {
    setSessionId(null)
    setMessages([assistantMessage('Hi! I\'m NEXUS AI. How can I help you today?')])
    setShowSessionList(false)
    setError(null)
  }, [])

  // ── Send message ──
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading || loadingSession) return

    const userMsg = userMessage(text)
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setError(null)
    setIsLoading(true)

    try {
      const url = sessionId
        ? `/api/v1/ai/chat?session_id=${sessionId}&provider=deepseek&model=deepseek-chat`
        : '/api/v1/ai/chat?provider=deepseek&model=deepseek-chat'

      const body = await apiClient.post(url, [{ role: 'user', content: text }])

      if (body?.session_id && body.session_id !== sessionId) {
        setSessionId(body.session_id)
      }

      const replyText = body?.text || body?.result || JSON.stringify(body)
      const reply = assistantMessage(replyText)
      setMessages(prev => [...prev, reply])

      loadSessions()
    } catch (err: any) {
      const errorText = err?.detail || err?.message || 'Something went wrong. Please try again.'
      setError(errorText)
      setMessages(prev => [...prev, assistantMessage(`Error: ${errorText}`)])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, loadingSession, sessionId, loadSessions])

  // ── Key down ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  // ── Input change ──
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [])

  // ── Render ──
  return (
    <>
      <ChatboxToggleButton onClick={() => setIsOpen(prev => !prev)} visible={isOpen} />

      <div
        ref={sessionListRef}
        role="dialog"
        aria-label="AI Chat"
        aria-hidden={!isOpen}
        className="fixed top-0 right-0 h-screen z-50 flex flex-col"
        style={{
          width: isOpen ? PANEL_WIDTH : 0,
          maxWidth: '100vw',
          backgroundColor: 'var(--color-surface-2)',
          borderLeft: isOpen ? '1px solid var(--color-border)' : 'none',
          boxShadow: isOpen ? 'var(--shadow-lg)' : 'none',
          transition: `width ${ANIMATION_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          overflow: 'hidden',
        }}
      >
        {/* ── Header: design01 style ── */}
        <div
          className="chat-head"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            height: 'var(--topbar-h, 56px)',
            padding: '0 16px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface-2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            <button onClick={() => setShowSessionList(prev => !prev)} aria-label="Session history" title="Session history"
              style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', color: 'var(--color-text-faint)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            <div className="chat-avatar" style={{
              width: 32, height: 32, borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-offset)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-purple)', flexShrink: 0,
            }}>
              <Sparkles size={16} />
            </div>
            <div className="chat-title" style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', display: 'block' }}>
                AI 私人秘書
              </strong>
              <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>在線</span>
            </div>
          </div>
          <div className="chat-head-actions" style={{ display: 'flex', gap: 2 }}>
            {messages.length > 0 && !loadingSession && (
              <button onClick={createNewSession} aria-label="New chat" title="New chat"
                style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', color: 'var(--color-text-faint)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={15} />
              </button>
            )}
            <button onClick={() => setIsOpen(false)} aria-label="Close chat"
              style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', color: 'var(--color-text-faint)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Session dropdown */}
        {showSessionList && (
          <div
            style={{
              position: 'absolute',
              top: 'var(--topbar-h, 56px)',
              left: 0,
              right: 0,
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: '0 0 var(--radius-md) var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              maxHeight: 240,
              overflowY: 'auto',
              zIndex: 100,
            }}
          >
            <button
              onClick={createNewSession}
              style={{
                width: '100%', padding: '10px 14px', border: 'none',
                borderBottom: '1px solid var(--color-border)',
                background: 'var(--color-surface-2)', color: 'var(--color-primary)',
                fontWeight: 600, fontSize: 13, cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Plus size={14} />
              New Chat
            </button>
            {sessionList.slice(0, 20).map(s => (
              <button
                key={s.session_id}
                onClick={() => switchSession(s.session_id)}
                style={{
                  width: '100%', padding: '10px 14px', border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  background: s.session_id === sessionId ? 'var(--color-surface-offset)' : 'transparent',
                  color: 'var(--color-text)', fontSize: 12.5, cursor: 'pointer',
                  textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}

        {/* ── Messages: design01 bubble style ── */}
        <div ref={scrollRef} className="chat-body" style={{
          flex: 1, overflowY: 'auto',
          padding: '12px 16px',
          scrollBehavior: 'smooth',
          background: 'var(--color-surface)',
        }}>
          {loadingSession ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>Loading...</span>
            </div>
          ) : messages.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-offset)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-purple)' }}>
                <Sparkles size={20} />
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-faint)' }}>Start a new conversation</span>
            </div>
          ) : (
            <div ref={scrollRef} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.map(msg => (
                <div key={msg.id} style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: 8,
                }}>
                  {msg.role === 'assistant' && (
                    <div style={{
                      width: 28, height: 28, borderRadius: 'var(--radius-md)',
                      background: 'var(--color-surface-offset)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--color-purple)', flexShrink: 0, marginTop: 4,
                    }}>
                      <Sparkles size={13} />
                    </div>
                  )}
                  <div style={{
                    maxWidth: '80%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    backgroundColor: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface-offset)',
                    color: msg.role === 'user' ? '#fff' : 'var(--color-text)',
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 'var(--radius-md)',
                    background: 'var(--color-surface-offset)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--color-purple)', flexShrink: 0, marginTop: 4,
                  }}>
                    <Sparkles size={13} />
                  </div>
                  <div style={{
                    padding: '12px 18px',
                    borderRadius: '16px 16px 16px 4px',
                    backgroundColor: 'var(--color-surface-offset)',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '0ms' }} />
                    <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '150ms' }} />
                    <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div style={{
            padding: '8px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
            backgroundColor: 'var(--color-notification-highlight)', color: 'var(--color-notification)',
            borderTop: '1px solid var(--color-border)',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-notification)', padding: 0 }}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* ── Input: design01 style ── */}
        <div className="chat-input-row" style={{
          flexShrink: 0, padding: '12px 16px',
          borderTop: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface-2)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            backgroundColor: 'var(--color-surface-offset)',
            border: '1px solid var(--color-border)',
          }}>
            <textarea ref={inputRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown}
              placeholder="Ask NEXUS AI..." rows={1} disabled={isLoading || loadingSession}
              aria-label="Chat input"
              style={{
                flex: 1, resize: 'none', border: 'none', background: 'none', outline: 'none',
                fontSize: 13, lineHeight: 1.5, color: 'var(--color-text)',
                fontFamily: 'var(--font-body)', maxHeight: 120,
                opacity: isLoading || loadingSession ? 0.5 : 1,
              }}
            />
            <button onClick={sendMessage} disabled={!input.trim() || isLoading || loadingSession}
              aria-label="Send message"
              style={{
                width: 30, height: 30, border: 'none', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: input.trim() && !isLoading && !loadingSession ? 'var(--color-primary)' : 'var(--color-surface-offset-2)',
                color: input.trim() && !isLoading && !loadingSession ? '#fff' : 'var(--color-text-faint)',
                opacity: isLoading || loadingSession ? 0.5 : 1,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 6, fontSize: 10, color: 'var(--color-text-faint)' }}>
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>
    </>
  )
}
