import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Plus } from 'lucide-react'
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

const PANEL_WIDTH = 420
const ANIMATION_DURATION = 220

const emptyPrompts = [
  '📊 總結今日 CRM 重點',
  '🔍 搵最近跟進嘅客戶',
  '📋 今日待辦事項',
  '🎯 最需要關注嘅 Deal',
]

const actionBtnStyle = {
  width: 24, height: 24, borderRadius: 4,
  display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  transition: 'color .12s',
}

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

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function formatDateLabel(ts: number): string {
  const today = new Date()
  const d = new Date(ts)
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return `${d.getMonth() + 1}/${d.getDate()}`
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
      style={{
        position: 'fixed',
        zIndex: 50,
        bottom: 24,
        right: 24,
        width: 48,
        height: 48,
        borderRadius: '50%',
        backgroundColor: 'var(--color-primary)',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        cursor: 'pointer',
        transition: `all ${ANIMATION_DURATION}ms ease-out`,
        opacity: visible ? 0 : 1,
        pointerEvents: visible ? 'none' : 'auto',
        transform: visible ? 'scale(0.75)' : 'scale(1)',
      }}
    >
      <Sparkles size={22} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// ChatboxPanel — Notion AI style
// ---------------------------------------------------------------------------

export default function ChatboxPanel() {
  // ── State ──
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionList, setSessionList] = useState<SessionItem[]>([])
  const [showSessionList, setShowSessionList] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({})

  // ── Refs ──
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)

  // ── Auto-scroll ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [messages, isStreaming, streamingContent, isLoading])

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

  // ── Abort streaming ──
  const abortStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsStreaming(false)
    setIsLoading(false)
  }, [])

  // ── Send message (streaming) ──
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading || loadingSession) return

    const userMsg = userMessage(text)
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setError(null)
    setIsLoading(true)
    setIsStreaming(true)
    setStreamingContent('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const url = sessionId
        ? `/api/v1/ai/chat/stream`
        : '/api/v1/ai/chat/stream'

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          session_id: sessionId || null,
        }),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(errBody.detail || `Request failed with status ${resp.status}`)
      }

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullReply = ''
      let newSessionId: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            continue // we handle data lines
          }
              if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.text !== undefined) {
                fullReply += data.text
                setStreamingContent(fullReply)
              }
              if (data.session_id) {
                newSessionId = data.session_id
              }
              if (data.input_tokens !== undefined) {
                // usage event — store for reference
              }
              if (data.message) {
                // error event
                setError(data.message)
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
      }

      // Streaming complete — save the final message
      if (fullReply) {
        const reply = assistantMessage(fullReply)
        setMessages(prev => [...prev, reply])
      }

      if (newSessionId && newSessionId !== sessionId) {
        setSessionId(newSessionId)
      }

      setStreamingContent('')
      loadSessions()
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Generation stopped')
      } else {
        const errorText = err?.detail || err?.message || 'Something went wrong. Please try again.'
        setError(errorText)
        setMessages(prev => [...prev, assistantMessage(`Error: ${errorText}`)])
      }
    } finally {
      setIsStreaming(false)
      setIsLoading(false)
      setStreamingContent('')
      abortRef.current = null
    }
  }, [input, isLoading, loadingSession, sessionId, loadSessions])

  // ── Key down ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  // ── Message actions ──
  const copyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
    } catch { /* ignore */ }
  }, [])

  const sendFeedback = useCallback(async (messageId: string, rating: 'up' | 'down') => {
    setFeedbackMap(prev => ({ ...prev, [messageId]: rating }))
    try {
      await apiClient.post(`/api/v1/ai/messages/${messageId}/feedback`, { rating })
    } catch { /* ignore */ }
  }, [])

  const retryMessage = useCallback((msgIdx: number) => {
    if (msgIdx === 0) return
    const lastUserMsg = messages[msgIdx - 1]
    if (lastUserMsg?.role !== 'user') return

    // Set the input to the last user message and send
    setInput(lastUserMsg.content)
    // Send will be triggered by user pressing Enter
  }, [messages])

  // ── Input change ──
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
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
        {/* ── Header: Notion AI style ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            height: 'var(--topbar-h, 56px)',
            padding: '0 14px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface-2)',
          }}
        >
          <div
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
              color: '#fff',
              display: 'grid', placeItems: 'center',
              fontSize: 14, fontWeight: 600, flexShrink: 0,
            }}
          >
            <Sparkles size={14} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--color-text)' }}>
              NEXUS AI
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>
              CRM Assistant · online
            </div>
          </div>
          <button onClick={() => setShowSessionList(prev => !prev)} aria-label="History" title="History"
            style={{
              width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
              background: 'transparent', border: 0, color: 'var(--color-text-muted)',
              cursor: 'pointer', fontSize: 15,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button onClick={() => setIsOpen(false)} aria-label="Close"
            style={{
              width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
              background: 'transparent', border: 0, color: 'var(--color-text-muted)',
              cursor: 'pointer', fontSize: 17,
            }}
          >
            <X size={16} />
          </button>
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
              maxHeight: 280,
              overflowY: 'auto',
              zIndex: 100,
            }}
          >
            <button
              onClick={createNewSession}
              style={{
                width: '100%', padding: '10px 14px', border: 'none',
                borderBottom: '1px solid var(--color-border)',
                background: 'transparent', color: 'var(--color-primary)',
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

        {/* ── Messages Area: Notion AI style ── */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: 'auto',
          padding: messages.length === 0 && !loadingSession ? '0' : '20px 20px',
          scrollBehavior: 'smooth',
          background: 'var(--color-surface)',
        }}>
          {loadingSession ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>Loading...</span>
            </div>
          ) : messages.length === 0 ? (
            /* ── Empty state: Notion AI hero ── */
            <div style={{
              textAlign: 'center',
              padding: '48px 24px 24px',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{
                width: 56, height: 56, margin: '0 auto 16px',
                borderRadius: 14,
                background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
                color: '#fff', display: 'grid', placeItems: 'center',
                fontSize: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}>
                ✏️
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px', color: 'var(--color-text)' }}>
                今日想做啲咩？
              </h1>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 24px' }}>
                問問題、搵 CRM 資料、或者整理今日重點。
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 320 }}>
                {emptyPrompts.map(p => (
                  <button key={p} onClick={() => { setInput(p); inputRef.current?.focus() }}
                    style={{
                      padding: '6px 14px', border: '1px solid var(--color-border)',
                      background: 'var(--color-surface-2)', borderRadius: 999,
                      fontSize: 12.5, color: 'var(--color-text)', cursor: 'pointer',
                      transition: 'background .12s, border-color .12s',
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Messages with Notion bubble style ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {messages.map((msg, idx) => {
                const showDivider = idx === 0 || formatDateLabel(msg.timestamp) !== formatDateLabel(messages[idx - 1].timestamp)
                return (
                  <div key={msg.id}>
                    {showDivider && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        color: 'var(--color-text-faint)', fontSize: 11.5,
                        padding: '0 4px', marginBottom: 16,
                      }}>
                        <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                        <span>{formatDateLabel(msg.timestamp)} · {formatTime(msg.timestamp)}</span>
                        <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                      </div>
                    )}
                    {msg.role === 'user' ? (
                      <div style={{
                        alignSelf: 'flex-end',
                        maxWidth: '82%',
                        padding: '8px 12px',
                        background: 'var(--color-surface-offset)',
                        borderRadius: '14px 14px 4px 14px',
                        whiteSpace: 'pre-wrap',
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        color: 'var(--color-text)',
                        marginLeft: 'auto',
                      }}>
                        {msg.content}
                      </div>
                    ) : (
                      <div
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        onMouseLeave={() => setHoveredMsgId(null)}
                        style={{ position: 'relative' }}
                      >
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: '50%',
                            background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
                            color: '#fff', display: 'grid', placeItems: 'center',
                            fontSize: 11, flexShrink: 0, marginTop: 2,
                          }}>
                            <Sparkles size={11} />
                          </div>
                          <div style={{
                            flex: 1, minWidth: 0,
                            fontSize: 13.5, lineHeight: 1.6,
                            color: 'var(--color-text)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {msg.content}
                          </div>
                        </div>
                        {/* ── Actions row (hover-reveal) ── */}
                        {(hoveredMsgId === msg.id) && (
                          <div style={{
                            display: 'flex', gap: 2,
                            marginTop: 4, paddingLeft: 34,
                            opacity: 0.6, transition: 'opacity .12s',
                          }}>
                            <button onClick={() => copyMessage(msg.content)}
                              title="Copy" aria-label="Copy"
                              style={actionBtnStyle}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                            <button onClick={() => {
                              const idx = messages.findIndex(m => m.id === msg.id)
                              retryMessage(idx)
                            }}
                              title="Retry" aria-label="Retry"
                              style={actionBtnStyle}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                            </button>
                            {(feedbackMap[msg.id] !== 'up') ? (
                              <button onClick={() => sendFeedback(msg.id, 'up')}
                                title="Helpful" aria-label="Helpful"
                                style={{
                                  ...actionBtnStyle,
                                  color: feedbackMap[msg.id] === 'up' ? 'var(--color-primary)' : undefined,
                                }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                              </button>
                            ) : null}
                            {(feedbackMap[msg.id] !== 'down') ? (
                              <button onClick={() => sendFeedback(msg.id, 'down')}
                                title="Not helpful" aria-label="Not helpful"
                                style={{
                                  ...actionBtnStyle,
                                  color: feedbackMap[msg.id] === 'down' ? 'var(--color-notification)' : undefined,
                                }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                              </button>
                            ) : null}
                            <button onClick={() => copyMessage(msg.content)}
                              title="Share" aria-label="Share"
                              style={actionBtnStyle}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {isStreaming ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
                    color: '#fff', display: 'grid', placeItems: 'center',
                    fontSize: 11, flexShrink: 0, marginTop: 2,
                  }}>
                    <Sparkles size={11} />
                  </div>
                  <div style={{
                    flex: 1, minWidth: 0,
                    fontSize: 13.5, lineHeight: 1.6,
                    color: 'var(--color-text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {streamingContent}
                    <span className="streaming-caret" style={{
                      display: 'inline-block',
                      width: 2, height: 14,
                      background: 'var(--color-primary)',
                      marginLeft: 1,
                      verticalAlign: 'text-bottom',
                      animation: 'streaming-blink 0.8s infinite',
                    }} />
                  </div>
                </div>
              ) : isLoading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
                    color: '#fff', display: 'grid', placeItems: 'center',
                    fontSize: 11, flexShrink: 0,
                  }}>
                    <Sparkles size={11} />
                  </div>
                  <div style={{ padding: '6px 0' }}>
                    <div className="typing-dots" style={{ display: 'inline-flex', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-text-muted)', display: 'inline-block', animation: 'blink 1.4s infinite both' }} />
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-text-muted)', display: 'inline-block', animation: 'blink 1.4s infinite both', animationDelay: '.2s' }} />
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-text-muted)', display: 'inline-block', animation: 'blink 1.4s infinite both', animationDelay: '.4s' }} />
                    </div>
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
            <button onClick={() => setError(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-notification)', padding: 0, display: 'grid', placeItems: 'center' }}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* ── Composer: Notion AI style ── */}
        <div style={{
          borderTop: '1px solid var(--color-border)',
          padding: '10px 14px 12px',
          background: 'var(--color-surface-2)',
        }}>
          <div className="composer__box" style={{
            display: 'flex', alignItems: 'flex-end', gap: 0,
            padding: '6px 10px',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            background: 'var(--color-surface)',
            transition: 'border-color .15s, box-shadow .15s',
          }}>
            <textarea ref={inputRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown}
              placeholder="Ask NEXUS AI anything…" rows={1} disabled={isLoading || loadingSession}
              aria-label="Chat input"
              style={{
                flex: 1, border: 0, outline: 'none', resize: 'none',
                background: 'transparent',
                font: 'inherit', color: 'inherit',
                maxHeight: 160, fontSize: 13.5, lineHeight: 1.5,
                padding: '4px 2px',
                opacity: isLoading || loadingSession ? 0.5 : 1,
              }}
            />
            <span className="send-btn-hitarea" style={{ display: 'inline-flex', padding: 0, lineHeight: 0 }}>
            {isStreaming ? (
              <button onClick={abortStreaming}
                aria-label="Stop generating"
                style={{
                  width: 28, height: 28, border: 0, borderRadius: 6,
                  display: 'grid', placeItems: 'center',
                  cursor: 'pointer',
                  background: 'var(--color-notification)',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </button>
            ) : (
            <button onClick={sendMessage} disabled={!input.trim() || isLoading || loadingSession}
              aria-label="Send message"
              style={{
                width: 28, height: 28, border: 0, borderRadius: 6,
                display: 'grid', placeItems: 'center',
                cursor: input.trim() && !isLoading && !loadingSession ? 'pointer' : 'default',
                background: input.trim() && !isLoading && !loadingSession ? 'var(--color-primary)' : 'var(--color-surface-offset-2)',
                color: input.trim() && !isLoading && !loadingSession ? '#fff' : 'var(--color-text-faint)',
                flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
            )}
            </span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            color: 'var(--color-text-faint)', fontSize: 10.5,
            marginTop: 5, padding: '0 4px',
          }}>
            <span><kbd style={{ fontFamily: 'inherit', fontSize: 10, padding: '1px 4px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', borderRadius: 3 }}>⏎</kbd> send · <kbd style={{ fontFamily: 'inherit', fontSize: 10, padding: '1px 4px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', borderRadius: 3 }}>⇧</kbd>+<kbd style={{ fontFamily: 'inherit', fontSize: 10, padding: '1px 4px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', borderRadius: 3 }}>⏎</kbd> new line</span>
          </div>
        </div>
      </div>

      {/* Typing animation keyframes + a11y focus styles */}
      <style>{`
        @keyframes blink {
          0%, 80%, 100% { opacity: .2; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        @keyframes streaming-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .composer__box:focus-within {
          border-color: var(--color-primary) !important;
          box-shadow: 0 0 0 3px rgba(35, 131, 226, 0.15);
        }
        .send-btn-hitarea { padding: 8px; margin: -8px; }
        button:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
      `}</style>
    </>
  )
}
