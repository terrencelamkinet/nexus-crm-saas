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
// ChatboxToggleButton  (named export — flexible mounting)
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
      className={`
        fixed right-0 top-1/2 -translate-y-1/2 z-50
        w-10 h-10 flex items-center justify-center
        rounded-l-lg
        text-lg leading-none
        transition-all duration-[${ANIMATION_DURATION}ms] ease-out
        cursor-pointer border-0
        ${visible
          ? 'opacity-0 pointer-events-none scale-75'
          : 'opacity-100 pointer-events-auto scale-100'
        }
      `}
      style={{
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-text-inverse)',
        boxShadow: 'var(--shadow-md)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-primary-hover)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-primary)'
      }}
    >
      🤖
    </button>
  )
}

// ---------------------------------------------------------------------------
// ChatboxPanel  (default export)
// ---------------------------------------------------------------------------

export default function ChatboxPanel() {
  // ── State ──────────────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    assistantMessage('👋 Hi! I\'m NEXUS AI. How can I help you today?'),
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Refs ───────────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // ── Auto-scroll on new messages ────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [messages, isLoading])

  // ── Focus input when panel opens ───────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), ANIMATION_DURATION + 50)
    }
  }, [isOpen])

  // ── Listen for toggle event from sidebar ────────────────────────────
  useEffect(() => {
    const handler = () => setIsOpen(prev => !prev);
    window.addEventListener('toggle-ai-chat', handler);
    return () => window.removeEventListener('toggle-ai-chat', handler);
  }, []);

  // ── Escape key to close ────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  // ── Send message ───────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return

    // Add user message
    const userMsg = userMessage(text)
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setError(null)
    setIsLoading(true)

    try {
      const body = await apiClient.post(
        `/api/v1/ai/chat?provider=deepseek&model=deepseek-chat`,
        [{ role: 'user', content: text }],
      )

      const replyText = body?.text || body?.result || JSON.stringify(body)
      const reply = assistantMessage(replyText)
      setMessages(prev => [...prev, reply])
    } catch (err: any) {
      const errorText = err?.detail || err?.message || 'Something went wrong. Please try again.'
      setError(errorText)
      setMessages(prev => [
        ...prev,
        assistantMessage(`⚠️ Error: ${errorText}`),
      ])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading])

  // ── Handle key down (Enter to send, Shift+Enter for newline) ──────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage],
  )

  // ── Clear conversation ───────────────────────────────────────────────
  const clearConversation = useCallback(() => {
    setMessages([assistantMessage('👋 Hi! I\'m NEXUS AI. How can I help you today?')])
    setError(null)
  }, [])

  // ── Auto-resize textarea ──────────────────────────────────────────────
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-resize
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Toggle button ── */}
      <ChatboxToggleButton onClick={() => setIsOpen(prev => !prev)} visible={isOpen} />

      {/* ── Panel ── */}
      <div
        ref={panelRef}
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
          style={{
            height: 'var(--topbar-h, 56px)',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>🤖</span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: '-0.01em',
                color: 'var(--color-text)',
              }}
            >
              NEXUS AI
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Clear button */}
            {messages.length > 1 && (
              <button
                onClick={clearConversation}
                aria-label="Clear conversation"
                title="Clear conversation"
                className="flex items-center justify-center border-0 cursor-pointer"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-faint)',
                  background: 'transparent',
                  fontSize: 15,
                  transition: 'background 150ms, color 150ms',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-offset)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-faint)'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            )}

            {/* Close button */}
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
              className="flex items-center justify-center border-0 cursor-pointer"
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-faint)',
                background: 'transparent',
                transition: 'background 150ms, color 150ms',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-offset)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-faint)'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Messages area ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3"
          style={{
            scrollBehavior: 'smooth',
          }}
        >
          <div className="flex flex-col gap-3">
            {messages.map(msg => (
              <div
                key={msg.id}
                className="flex"
                style={{
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words"
                  style={{
                    backgroundColor:
                      msg.role === 'user'
                        ? 'var(--color-primary)'
                        : 'var(--color-surface-offset)',
                    color:
                      msg.role === 'user'
                        ? 'var(--color-text-inverse)'
                        : 'var(--color-text)',
                    borderBottomRightRadius:
                      msg.role === 'user' ? 4 : 'var(--radius-lg, 0.75rem)',
                    borderBottomLeftRadius:
                      msg.role === 'assistant' ? 4 : 'var(--radius-lg, 0.75rem)',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* ── Loading indicator ── */}
            {isLoading && (
              <div className="flex justify-start">
                <div
                  className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
                  style={{
                    backgroundColor: 'var(--color-surface-offset)',
                    borderBottomLeftRadius: 4,
                  }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: 'var(--color-primary)', animationDelay: '0ms' }}
                  />
                  <span
                    className="inline-block w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: 'var(--color-primary)', animationDelay: '150ms' }}
                  />
                  <span
                    className="inline-block w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: 'var(--color-primary)', animationDelay: '300ms' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div
            className="px-4 py-2 text-xs flex items-center gap-2"
            style={{
              backgroundColor: 'var(--color-notification-highlight)',
              color: 'var(--color-notification)',
              borderTop: '1px solid var(--color-divider)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="border-0 bg-transparent cursor-pointer p-0.5"
              style={{ color: 'var(--color-notification)' }}
              aria-label="Dismiss error"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* ── Input area ── */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{
            borderTop: '1px solid var(--color-divider)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{
              backgroundColor: 'var(--color-surface-offset)',
              border: '1px solid var(--color-border)',
              transition: 'border-color 150ms',
            }}
            onFocusCapture={e => {
              const parent = (e.currentTarget as HTMLElement).closest('[style*="border"]') as HTMLElement
              if (parent) parent.style.borderColor = 'var(--color-primary)'
            }}
            onBlurCapture={e => {
              const parent = (e.currentTarget as HTMLElement).closest('[style*="border"]') as HTMLElement
              if (parent) parent.style.borderColor = 'var(--color-border)'
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask NEXUS AI..."
              rows={1}
              disabled={isLoading}
              aria-label="Chat input"
              className="flex-1 resize-none border-0 bg-transparent outline-none text-sm leading-5"
              style={{
                color: 'var(--color-text)',
                fontFamily: 'var(--font-body)',
                maxHeight: 120,
                opacity: isLoading ? 0.5 : 1,
              }}
            />

            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
              className="flex items-center justify-center border-0 rounded-lg cursor-pointer flex-shrink-0"
              style={{
                width: 32,
                height: 32,
                backgroundColor: input.trim() && !isLoading
                  ? 'var(--color-primary)'
                  : 'var(--color-surface-offset-2)',
                color: input.trim() && !isLoading
                  ? 'var(--color-text-inverse)'
                  : 'var(--color-text-faint)',
                transition: 'background-color 150ms, color 150ms, transform 150ms',
                opacity: isLoading ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                if (input.trim() && !isLoading) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-primary-hover)'
                }
              }}
              onMouseLeave={e => {
                if (input.trim() && !isLoading) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-primary)'
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>

          {/* ── Hint text ── */}
          <div
            className="text-center mt-1.5 text-[10px]"
            style={{ color: 'var(--color-text-faint)' }}
          >
            Enter to send &middot; Shift+Enter for new line
          </div>
        </div>
      </div>
    </>
  )
}
