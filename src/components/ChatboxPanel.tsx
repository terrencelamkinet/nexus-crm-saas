import { useState, useRef, useEffect, useCallback } from 'react'
import { apiClient } from '../lib/api'

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
// ChatboxToggleButton
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
      className={`fixed right-0 top-1/2 -translate-y-1/2 z-50
        w-10 h-10 flex items-center justify-center rounded-l-lg
        text-lg leading-none cursor-pointer border-0
        transition-all duration-[${ANIMATION_DURATION}ms] ease-out
        ${visible ? 'opacity-0 pointer-events-none scale-75' : 'opacity-100 pointer-events-auto scale-100'}
      `}
      style={{
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-text-inverse)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      🤖
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
  const [sessionTitle, setSessionTitle] = useState('New Chat')
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

      // Auto-select latest active session, or create new
      const active = list.find(s => s.status === 'active') || list[0]
      if (active) {
        switchSession(active.session_id, active.title)
      } else {
        createNewSession()
      }
    } catch {
      setMessages([assistantMessage('👋 Hi! I\'m NEXUS AI. How can I help you today?')])
    } finally {
      setLoadingSession(false)
    }
  }, [])

  // ── Switch to a session ──
  const switchSession = useCallback(async (sid: string, title?: string) => {
    setSessionId(sid)
    setSessionTitle(title || 'New Chat')
    setShowSessionList(false)
    setLoadingSession(true)
    setMessages([])

    try {
      const resp = await apiClient.get<{ messages: any[] }>(`/api/v1/ai/sessions/${sid}/messages`)
      const msgs = resp?.messages || []
      if (msgs.length === 0) {
        setMessages([assistantMessage('👋 Hi! I\'m NEXUS AI. How can I help you today?')])
      } else {
        setMessages(msgs.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at || Date.now()).getTime(),
        })))
      }
    } catch {
      setMessages([assistantMessage('👋 Hi! I\'m NEXUS AI. How can I help you today?')])
    } finally {
      setLoadingSession(false)
    }
  }, [])

  // ── Create new session ──
  const createNewSession = useCallback(async () => {
    setSessionId(null)
    setSessionTitle('New Chat')
    setMessages([assistantMessage('👋 Hi! I\'m NEXUS AI. How can I help you today?')])
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

      // Save/update session ID from response
      if (body?.session_id && body.session_id !== sessionId) {
        setSessionId(body.session_id)
        // Auto-title from first user message will be set by backend
      }

      const replyText = body?.text || body?.result || JSON.stringify(body)
      const reply = assistantMessage(replyText)
      setMessages(prev => [...prev, reply])

      // Refresh session list to get updated title
      loadSessions()
    } catch (err: any) {
      const errorText = err?.detail || err?.message || 'Something went wrong. Please try again.'
      setError(errorText)
      setMessages(prev => [...prev, assistantMessage(`⚠️ Error: ${errorText}`)])
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
          backgroundColor: 'var(--color-surface)',
          borderLeft: isOpen ? '1px solid var(--color-divider)' : 'none',
          boxShadow: isOpen ? 'var(--shadow-lg)' : 'none',
          transition: `width ${ANIMATION_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between flex-shrink-0 px-4"
          style={{ height: 'var(--topbar-h, 56px)', borderBottom: '1px solid var(--color-divider)' }}
        >
          <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 14,
                  letterSpacing: '-0.01em',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                onClick={() => setShowSessionList(prev => !prev)}
                title={sessionTitle}
              >
                {sessionTitle}
                <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--color-text-faint)' }}>▼</span>
              </div>

              {/* Session dropdown */}
              {showSessionList && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'var(--topbar-h, 56px)',
                    left: 0,
                    right: 0,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-divider)',
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
                      width: '100%',
                      padding: '10px 14px',
                      border: 'none',
                      borderBottom: '1px solid var(--color-divider)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-primary)',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    New Chat
                  </button>
                  {sessionList.slice(0, 20).map(s => (
                    <button
                      key={s.session_id}
                      onClick={() => switchSession(s.session_id, s.title)}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        border: 'none',
                        borderBottom: '1px solid var(--color-divider)',
                        background: s.session_id === sessionId ? 'var(--color-surface-offset)' : 'transparent',
                        color: 'var(--color-text)',
                        fontSize: 12.5,
                        cursor: 'pointer',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && !loadingSession && (
              <button onClick={createNewSession} aria-label="New chat" title="New chat"
                className="flex items-center justify-center border-0 cursor-pointer"
                style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', color: 'var(--color-text-faint)', background: 'transparent', fontSize: 15, transition: 'background 150ms' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            <button onClick={() => setIsOpen(false)} aria-label="Close chat"
              className="flex items-center justify-center border-0 cursor-pointer"
              style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', color: 'var(--color-text-faint)', background: 'transparent', transition: 'background 150ms' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* ── Messages ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollBehavior: 'smooth' }}>
          {loadingSession ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-xs" style={{ color: 'var(--color-text-faint)' }}>Loading...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-xs" style={{ color: 'var(--color-text-faint)' }}>Start a new conversation</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map(msg => (
                <div key={msg.id} className="flex" style={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words"
                    style={{
                      backgroundColor: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface-offset)',
                      color: msg.role === 'user' ? 'var(--color-text-inverse)' : 'var(--color-text)',
                      borderBottomRightRadius: msg.role === 'user' ? 4 : 'var(--radius-lg, 0.75rem)',
                      borderBottomLeftRadius: msg.role === 'assistant' ? 4 : 'var(--radius-lg, 0.75rem)',
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--color-surface-offset)', borderBottomLeftRadius: 4 }}>
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
          <div className="px-4 py-2 text-xs flex items-center gap-2"
            style={{ backgroundColor: 'var(--color-notification-highlight)', color: 'var(--color-notification)', borderTop: '1px solid var(--color-divider)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="border-0 bg-transparent cursor-pointer p-0.5" style={{ color: 'var(--color-notification)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        )}

        {/* ── Input ── */}
        <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--color-divider)', backgroundColor: 'var(--color-surface)' }}>
          <div className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{ backgroundColor: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', transition: 'border-color 150ms' }}
            onFocusCapture={e => { const p = (e.currentTarget as HTMLElement).closest('[style*="border"]') as HTMLElement; if (p) p.style.borderColor = 'var(--color-primary)' }}
            onBlurCapture={e => { const p = (e.currentTarget as HTMLElement).closest('[style*="border"]') as HTMLElement; if (p) p.style.borderColor = 'var(--color-border)' }}
          >
            <textarea ref={inputRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown}
              placeholder="Ask NEXUS AI..." rows={1} disabled={isLoading || loadingSession}
              aria-label="Chat input"
              className="flex-1 resize-none border-0 bg-transparent outline-none text-sm leading-5"
              style={{ color: 'var(--color-text)', fontFamily: 'var(--font-body)', maxHeight: 120, opacity: isLoading || loadingSession ? 0.5 : 1 }}
            />
            <button onClick={sendMessage} disabled={!input.trim() || isLoading || loadingSession}
              aria-label="Send message"
              className="flex items-center justify-center border-0 rounded-lg cursor-pointer flex-shrink-0"
              style={{
                width: 32, height: 32,
                backgroundColor: input.trim() && !isLoading && !loadingSession ? 'var(--color-primary)' : 'var(--color-surface-offset-2)',
                color: input.trim() && !isLoading && !loadingSession ? 'var(--color-text-inverse)' : 'var(--color-text-faint)',
                transition: 'background-color 150ms, color 150ms',
                opacity: isLoading || loadingSession ? 0.5 : 1,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="text-center mt-1.5 text-[10px]" style={{ color: 'var(--color-text-faint)' }}>
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>
    </>
  )
}
