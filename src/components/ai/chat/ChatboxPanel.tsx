import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { apiClient, getStoredAuth } from '../../../lib/api'
import MarkdownMessage from '../../MarkdownRenderer'
import MessageTimestamp from './MessageTimestamp'
import LoadingIndicator from './LoadingIndicator'
import ErrorBanner from './ErrorBanner'
import ChatInput from './ChatInput'
import SessionSidebar from './SessionSidebar'
import type { SessionItem } from './SessionSidebar'
import type { StreamError } from './ErrorBanner'
import SlashMentionMenu from './SlashMentionMenu'
import type { SlashItem } from './SlashMentionMenu'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  citations?: CitationSource[]
}

interface CitationSource {
  id: string
  type: string
  title: string
  snippet: string
  updated_at?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'nexus_chat_draft'
const PANEL_WIDTH = 400
const MOBILE_BREAKPOINT = 768
const FAB_SIZE = 48

const emptyPrompts = [
  '📊 總結今日 CRM 重點',
  '🔍 搵最近跟進嘅客戶',
  '📋 今日待辦事項',
  '🎯 最需要關注嘅 Deal',
]

const suggestedPromptsCache = { prompts: emptyPrompts, ts: 0 }

const SLASH_TRIGGER_PROMPTS: Record<string, string> = {
  summarize: "Summarize today's CRM activity",
  find: 'Find ',
  'create-task': 'Create a task: ',
  'draft-email': 'Draft an email about ',
  pipeline: 'Show me the sales pipeline',
  reset: 'Reset our conversation',
}

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
// FAB
// ---------------------------------------------------------------------------

export function ChatboxToggleButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      aria-label="Toggle AI chat"
      aria-expanded={open}
      className={`fab-btn ${open ? 'fab-btn--open' : ''}`}
      id="ai-fab"
      style={{
        position: 'fixed',
        zIndex: 50,
        bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        right: 'max(24px, env(safe-area-inset-right, 24px))',
        width: FAB_SIZE,
        height: FAB_SIZE,
        borderRadius: '50%',
        backgroundColor: 'var(--color-primary)',
        color: '#fff',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 150ms ease-out',
        opacity: 1,
        pointerEvents: 'auto',
        transform: `scale(${pressed ? 0.9 : hovered ? 1.08 : 1})`,
        boxShadow: pressed
          ? '0 2px 8px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.1)'
          : '0 4px 16px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.12)',
      }}
    >
      <span style={{
        display: 'grid', placeItems: 'center',
        transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        transform: open ? 'rotate(90deg) scale(0.85)' : 'rotate(0deg) scale(1)',
      }}>
        {open ? <X size={20} /> : <Sparkles size={22} />}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Message components
// ---------------------------------------------------------------------------

function UserMessageBubble({ msg, prevMsg }: { msg: ChatMessage; prevMsg?: ChatMessage }) {
  const prevSameRole = prevMsg && prevMsg.role === 'user' && (msg.timestamp - prevMsg.timestamp) < 180000
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      gap: 4, marginTop: prevSameRole ? -12 : 0,
    }}>
      {/* Avatar + timestamp */}
      {!prevSameRole && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
          <span style={{ fontSize: 'var(--text-xs, 12px)', color: 'var(--color-text-faint)' }}>
            {formatTime(msg.timestamp)}
          </span>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--color-surface-offset-2)',
            color: 'var(--color-text-muted)',
            display: 'grid', placeItems: 'center',
            fontSize: 10, fontWeight: 600, flexShrink: 0,
            border: '1px solid var(--color-border)',
          }}>
            T
          </div>
        </div>
      )}
      <div style={{
        maxWidth: '82%',
        padding: '8px 12px',
        background: 'var(--color-primary-highlight)',
        borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 'var(--text-base, 16px)',
        lineHeight: 1.6,
        color: 'var(--color-text)',
        fontWeight: 400,
      }}>
        {msg.content}
      </div>
    </div>
  )
}

function AiMessageBubble({ msg, prevMsg, hovered, onHover, onCopy, onRetry, onFeedback, feedback }: {
  msg: ChatMessage
  prevMsg?: ChatMessage
  hovered: boolean
  onHover: (v: boolean) => void
  onCopy: () => void
  onRetry: () => void
  onFeedback: (rating: 'up' | 'down') => void
  feedback?: 'up' | 'down'
}) {
  const prevSameRole = prevMsg && prevMsg.role === 'assistant' && (msg.timestamp - prevMsg.timestamp) < 180000

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ marginTop: prevSameRole ? -12 : 0 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {/* Avatar */}
        {!prevSameRole && (
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
            color: '#fff', display: 'grid', placeItems: 'center',
            fontSize: 12, flexShrink: 0, marginTop: 2,
          }}>
            <Sparkles size={13} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Timestamp */}
          {!prevSameRole && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 'var(--text-xs, 12px)', color: 'var(--color-text-faint)' }}>
                NEXUS AI · {formatTime(msg.timestamp)}
              </span>
            </div>
          )}
          {/* Content */}
          <div className="msg-ai-content" style={{ position: 'relative' }}>
            <MarkdownMessage content={msg.content} />
          </div>

          {/* Citations */}
          {msg.citations && msg.citations.length > 0 && (
            <CitationChip citations={msg.citations} />
          )}

          {/* Bottom toolbar */}
          <div style={{
            display: 'flex', gap: 2, marginTop: 6,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 180ms var(--ease-out)',
          }}
            className="ai-msg-toolbar"
          >
            <GhostBtn onClick={onCopy} ariaLabel="Copy" icon={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            } />
            <GhostBtn onClick={onRetry} ariaLabel="Regenerate" icon={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            } />
            {feedback !== 'up' && (
              <GhostBtn onClick={() => onFeedback('up')} ariaLabel="Like"
                active={false}
                activeColor="var(--color-primary)"
                icon={
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                }
              />
            )}
            {feedback !== 'down' && (
              <GhostBtn onClick={() => onFeedback('down')} ariaLabel="Dislike"
                active={false}
                activeColor="var(--color-notification)"
                icon={
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function GhostBtn({ onClick, icon, ariaLabel, active, activeColor }: {
  onClick: () => void
  icon: React.ReactNode
  ariaLabel: string
  active?: boolean
  activeColor?: string
}) {
  return (
    <button onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        width: 24, height: 24, borderRadius: 4, border: 'none',
        background: 'transparent', color: active ? (activeColor || 'var(--color-primary)') : 'var(--color-text-muted)',
        cursor: 'pointer', display: 'grid', placeItems: 'center',
        transition: 'background var(--transition-interactive), color var(--transition-interactive)',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-surface-offset)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {icon}
    </button>
  )
}

function CitationChip({ citations }: { citations: CitationSource[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', borderRadius: 999,
        background: 'var(--color-surface-offset)',
        fontSize: 11.5, fontWeight: 500, color: 'var(--color-text-muted)',
        cursor: 'pointer',
        transition: 'background var(--transition-interactive)',
      }}
        onClick={() => setExpanded(v => !v)}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset-2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        Source: {citations.length} record{citations.length > 1 ? 's' : ''}
      </div>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {citations.slice(0, 5).map((cit, ci) => (
            <div key={ci}
              onClick={() => {
                const routes: Record<string, string> = { company: 'companies', contact: 'contacts', deal: 'deals', project: 'projects' }
                const route = routes[cit.type] || cit.type
                window.open(`/${route}/${cit.id}`, '_blank')
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 8px', background: 'var(--color-surface-offset)',
                borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--color-divider)',
                transition: 'background var(--transition-interactive)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset-2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
            >
              <span style={{
                width: 16, height: 16, borderRadius: 3,
                background: 'var(--color-primary)', color: '#fff',
                fontSize: 9, fontWeight: 700,
                display: 'grid', placeItems: 'center', flexShrink: 0,
              }}>{ci + 1}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cit.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-faint)', textTransform: 'capitalize' }}>
                  {cit.type}
                </div>
              </div>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-text-faint)', flexShrink: 0 }}>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ prompts, onSelect }: { prompts: string[]; onSelect: (p: string) => void }) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 24px 24px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      animation: 'fadeIn 300ms var(--ease-out) both',
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
        How can I help?
      </h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 24px' }}>
        Ask me anything about your CRM
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 320 }}>
        {prompts.map(p => (
          <button key={p} onClick={() => onSelect(p)}
            style={{
              padding: '6px 14px', border: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)', borderRadius: 999,
              fontSize: 12.5, color: 'var(--color-text)', cursor: 'pointer',
              transition: 'background var(--transition-interactive), border-color var(--transition-interactive)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface-2)' }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ChatboxPanel
// ---------------------------------------------------------------------------

export default function ChatboxPanel() {
  const { t } = useTranslation()

  // ── State ──
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<StreamError | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionList, setSessionList] = useState<SessionItem[]>([])
  const [showSidebar, setShowSidebar] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({})
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>(emptyPrompts)
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT)
  const [animPhase, setAnimPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')

  // ── Slash / mention state ──
  const [menuType, setMenuType] = useState<'slash' | 'mention' | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuQuery, setMenuQuery] = useState('')
  const [mentionResults, setMentionResults] = useState<{ id: string; label: string; type: string; sub: string }[]>([])

  // ── Refs ──
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastUserTextRef = useRef('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [showCheatsheet, setShowCheatsheet] = useState(false)

  // ── Breakpoint listener ──
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches)
    handler(mq)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // ── Open / Close animations ──
  const openPanel = useCallback(() => {
    setAnimPhase('opening')
    setIsOpen(true)
    setTimeout(() => setAnimPhase('open'), 320)
  }, [])

  const closePanel = useCallback(() => {
    setAnimPhase('closing')
    setTimeout(() => {
      setIsOpen(false)
      setAnimPhase('closed')
    }, 200)
  }, [])

  const togglePanel = useCallback(() => {
    if (animPhase === 'open') closePanel()
    else openPanel()
  }, [animPhase, openPanel, closePanel])

  // ── Auto-scroll ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [messages, isStreaming, streamingContent, isLoading])

  // ── Focus input when panel opens ──
  useEffect(() => {
    if (animPhase === 'open') {
      setTimeout(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('.composer__input-row textarea')
        ta?.focus()
      }, 350)
    }
  }, [animPhase])

  // ── Escape to close ──
  useEffect(() => {
    if (animPhase !== 'open') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [animPhase, closePanel])

  // ── Cmd/Ctrl+K to toggle ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePanel])

  // ── Listen for toggle event (from widget etc.) ──
  useEffect(() => {
    const handler = () => togglePanel()
    window.addEventListener('toggle-ai-chat', handler)
    return () => window.removeEventListener('toggle-ai-chat', handler)
  }, [togglePanel])

  // ── Load sessions when panel opens ──
  useEffect(() => {
    if (animPhase !== 'open') return
    loadSessions()
    const age = Date.now() - suggestedPromptsCache.ts
    if (age > 300000) {
      apiClient.get<{ prompts: string[] }>('/api/v1/ai/prompts/suggested')
        .then(r => {
          if (r?.prompts?.length) {
            setSuggestedPrompts(r.prompts)
            suggestedPromptsCache.prompts = r.prompts
            suggestedPromptsCache.ts = Date.now()
          }
        }).catch(() => {})
    } else if (suggestedPromptsCache.prompts.length) {
      setSuggestedPrompts(suggestedPromptsCache.prompts)
    }
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) setInput(saved)
  }, [animPhase])

  // ── Load session list ──
  const loadSessions = useCallback(async () => {
    setLoadingSession(true)
    try {
      const resp = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions')
      const list = resp?.sessions || []
      setSessionList(list)
      const active = list.find(s => s.status === 'active') || list[0]
      if (active) switchSession(active.session_id)
      else createNewSession()
    } catch {
      setMessages([assistantMessage("Hi! I'm NEXUS AI. How can I help you today?")])
    } finally {
      setLoadingSession(false)
    }
  }, [])

  // ── Switch session ──
  const switchSession = useCallback(async (sid: string) => {
    setSessionId(sid)
    setShowSidebar(false)
    setLoadingSession(true)
    setMessages([])
    try {
      const resp = await apiClient.get<{ messages: any[] }>(`/api/v1/ai/sessions/${sid}/messages`)
      const msgs = resp?.messages || []
      if (msgs.length === 0) {
        setMessages([assistantMessage("Hi! I'm NEXUS AI. How can I help you today?")])
      } else {
        setMessages(msgs.map((m: any) => ({
          id: m.id, role: m.role, content: m.content,
          timestamp: new Date(m.created_at || Date.now()).getTime(),
        })))
      }
    } catch {
      setMessages([assistantMessage("Hi! I'm NEXUS AI. How can I help you today?")])
    } finally {
      setLoadingSession(false)
    }
  }, [])

  const createNewSession = useCallback(async () => {
    setSessionId(null)
    setMessages([assistantMessage("Hi! I'm NEXUS AI. How can I help you today?")])
    setShowSidebar(false)
    setError(null)
  }, [])

  // ── Session actions ──
  const renameSession = useCallback(async (sid: string, title: string) => {
    try { await apiClient.patch(`/api/v1/ai/sessions/${sid}`, { title }) } catch {}
    setSessionList(prev => prev.map(s => s.session_id === sid ? { ...s, title } : s))
  }, [])

  const togglePin = useCallback(async (sid: string, pinned: boolean) => {
    try {
      await apiClient.patch(`/api/v1/ai/sessions/${sid}`, { is_pinned: pinned })
      const resp = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions')
      if (resp?.sessions) setSessionList(resp.sessions)
    } catch {}
  }, [])

  const deleteSession = useCallback(async (sid: string) => {
    try {
      await apiClient.delete(`/api/v1/ai/sessions/${sid}`)
      setSessionList(prev => {
        const next = prev.filter(s => s.session_id !== sid)
        if (sid === sessionId) {
          const active = next.find(s => s.status === 'active') || next[0]
          if (active) switchSession(active.session_id)
          else createNewSession()
        }
        return next
      })
    } catch {}
  }, [sessionId])

  const exportSession = useCallback(async (sid: string) => {
    try {
      const resp = await apiClient.get<{ messages: any[] }>(`/api/v1/ai/sessions/${sid}/messages`)
      const msgs = resp?.messages || []
      const md = msgs.map((m: any) => `**${m.role}**: ${m.content}`).join('\n\n---\n\n')
      await navigator.clipboard.writeText(`# Chat Export\n\n${md}`)
    } catch {}
  }, [])

  // ── Streaming ──
  const abortStreaming = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
    setIsStreaming(false)
    setIsLoading(false)
  }, [])

  const doStream = useCallback(async (text: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const resp = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredAuth()?.access_token || ''}`,
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
      const msgCitations: CitationSource[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n').map(l => l.replace('\r', ''))
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text !== undefined) { fullReply += data.text; setStreamingContent(fullReply) }
              if (data.session_id) newSessionId = data.session_id
              if (data.citations && Array.isArray(data.citations)) {
                const existingIds = new Set(msgCitations.map(c => c.id))
                for (const cit of data.citations) {
                  if (!existingIds.has(cit.id)) { msgCitations.push(cit as CitationSource); existingIds.add(cit.id) }
                }
              }
              if (data.message) { setError({ type: 'streaming', message: data.message, retryable: true }) }
            } catch { /* skip */ }
          }
        }
      }

      if (fullReply) {
        const reply: ChatMessage = {
          ...assistantMessage(fullReply),
          citations: msgCitations.length > 0 ? msgCitations : undefined,
        }
        setMessages(prev => [...prev, reply])
      }
      if (newSessionId && newSessionId !== sessionId) setSessionId(newSessionId)
      setStreamingContent('')
      try {
        const resp2 = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions')
        if (resp2?.sessions) setSessionList(resp2.sessions)
      } catch {}
    } catch (err: any) {
      const msg = err?.detail || err?.message || t('chat.errors.server')
      if (err.name === 'AbortError') {
        setError({ type: 'timeout', message: t('chat.errors.timeout'), retryable: true })
      } else if (err.name === 'TypeError' && msg.includes('fetch')) {
        setError({ type: 'network', message: t('chat.errors.network'), retryable: true })
      } else if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('token')) {
        setError({ type: 'auth', message: t('chat.errors.auth'), retryable: false })
      } else if (msg.includes('500') || msg.includes('503') || msg.includes('502') || msg.includes('service')) {
        setError({ type: 'server', message: msg, retryable: true })
      } else {
        setError({ type: 'streaming', message: msg, retryable: true })
      }
    } finally {
      setIsStreaming(false)
      setIsLoading(false)
      setStreamingContent('')
      abortRef.current = null
    }
  }, [sessionId, t])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading || loadingSession) return
    setMessages(prev => [...prev, userMessage(text)])
    setInput('')
    localStorage.removeItem(DRAFT_KEY)
    lastUserTextRef.current = text
    setError(null)
    setIsLoading(true)
    setIsStreaming(true)
    setStreamingContent('')
    await doStream(text)
  }, [input, isLoading, loadingSession, doStream])

  const retryLastMessage = useCallback(async () => {
    const text = lastUserTextRef.current
    if (!text || isLoading || loadingSession) return
    setMessages(prev => [...prev, userMessage(text)])
    setError(null)
    setIsLoading(true)
    setIsStreaming(true)
    setStreamingContent('')
    await doStream(text)
  }, [isLoading, loadingSession, doStream])

  // ── Input change handler ──
  const handleInputChange = useCallback((val: string) => {
    setInput(val)
    localStorage.setItem(DRAFT_KEY, val)
  }, [])

  // ── Copy / Feedback ──
  const copyMessage = useCallback(async (content: string) => {
    try { await navigator.clipboard.writeText(content) } catch {}
  }, [])

  const sendFeedback = useCallback(async (messageId: string, rating: 'up' | 'down') => {
    setFeedbackMap(prev => ({ ...prev, [messageId]: rating }))
    try { await apiClient.post(`/api/v1/ai/messages/${messageId}/feedback`, { rating }) } catch {}
  }, [])

  const retryMessage = useCallback((msgIdx: number) => {
    const lastUserMsg = messages[msgIdx - 1]
    if (lastUserMsg?.role !== 'user') return
    setInput(lastUserMsg.content)
  }, [messages])

  // ── Slash commands ──
  const SLASH_COMMANDS: SlashItem[] = [
    { key: 'summarize', label: t('chat.slashCommands.summarize'), icon: '📊' },
    { key: 'find', label: t('chat.slashCommands.find'), icon: '🔍' },
    { key: 'create-task', label: t('chat.slashCommands.createTask'), icon: '📋' },
    { key: 'draft-email', label: t('chat.slashCommands.draftEmail'), icon: '✉️' },
    { key: 'pipeline', label: t('chat.slashCommands.pipeline'), icon: '📈' },
    { key: 'reset', label: t('chat.slashCommands.reset'), icon: '🔄' },
  ]

  // ── Panel style by breakpoint ──
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-surface)',
        transform: isOpen
          ? 'translateY(0)'
          : 'translateY(100%)',
        transition: animPhase === 'opening' || animPhase === 'closing'
          ? 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1)'
          : 'none',
        height: !isOpen && animPhase === 'closed' ? 0 : '92dvh',
        top: '8dvh',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
        boxShadow: isOpen ? '0 -8px 32px rgba(0,0,0,0.2)' : 'none',
      }
    : {
        position: 'fixed' as const,
        zIndex: 50,
        height: isOpen ? '70dvh' : 0,
        ...(isOpen && animPhase !== 'closed'
          ? { top: '15dvh', right: 'max(24px, env(safe-area-inset-right, 24px))' }
          : { top: 0, right: 0 }),
        width: PANEL_WIDTH,
        maxWidth: 'calc(100vw - 48px)',
        background: 'var(--color-surface)',
        border: isOpen ? '1px solid var(--color-border)' : 'none',
        borderRadius: 'var(--radius-xl)',
        boxShadow: isOpen ? 'var(--shadow-lg)' : 'none',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transformOrigin: 'bottom right',
        transform: isOpen
          ? 'scale(1) translateY(0)'
          : 'scale(0.85) translateY(20px)',
        opacity: animPhase === 'closed' ? 0 : 1,
        transition: animPhase === 'opening' || animPhase === 'closing'
          ? 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms cubic-bezier(0.16, 1, 0.3, 1), height 0s'
          : 'none',
      }

  // ── Render ──
  return (
    <>
      {/* FAB */}
      <ChatboxToggleButton onClick={togglePanel} open={isOpen} />

      {/* Overlay backdrop for mobile */}
      {isMobile && isOpen && (
        <div onClick={closePanel}
          style={{
            position: 'fixed', inset: 0, zIndex: 49,
            background: 'var(--color-overlay, rgba(0,0,0,0.4))',
            animation: 'fadeIn 200ms ease-out both',
          }}
        />
      )}

      {/* Panel */}
      <div ref={panelRef} style={panelStyle as React.CSSProperties}
        role="dialog"
        aria-label={t('nav.aiChat')}
        aria-hidden={!isOpen}
      >
        {/* ── Header ── */}
        {isOpen && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            flexShrink: 0, height: 52,
            padding: '0 12px 0 16px',
            borderBottom: '1px solid var(--color-divider)',
            background: 'var(--color-surface)',
            borderRadius: isMobile ? 'var(--radius-xl) var(--radius-xl) 0 0' : 'var(--radius-xl) var(--radius-xl) 0 0',
          }}>
            {/* Drag handle for mobile */}
            {isMobile && (
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: 'var(--color-divider)',
                position: 'absolute', top: 8, left: '50%', marginLeft: -18,
              }} />
            )}
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
              color: '#fff', display: 'grid', placeItems: 'center',
              fontSize: 14, fontWeight: 600, flexShrink: 0,
            }}>
              <Sparkles size={14} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>
                NEXUS AI
              </div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>
                CRM Assistant
              </div>
            </div>
            <button onClick={createNewSession} aria-label={t('chat.newChat')} title={t('chat.newChat')}
              style={{
                width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
                background: 'transparent', border: 0, color: 'var(--color-text-muted)',
                cursor: 'pointer', transition: 'color var(--transition-interactive), background var(--transition-interactive)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <Plus size={15} />
            </button>

            {/* Session history toggle — Desktop desktop-only sidebar trigger */}
            {!isMobile && (
              <SessionSidebar
                sessions={sessionList}
                currentSessionId={sessionId}
                onSwitch={switchSession}
                onNew={createNewSession}
                onRename={renameSession}
                onDelete={deleteSession}
                onPin={togglePin}
                onExport={exportSession}
                isOpen={showSidebar}
                onToggle={() => setShowSidebar(v => !v)}
              />
            )}

            <button onClick={closePanel} aria-label={t('common.close')}
              style={{
                width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
                background: 'transparent', border: 0, color: 'var(--color-text-muted)',
                cursor: 'pointer', transition: 'color var(--transition-interactive), background var(--transition-interactive)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ── Mobile session list (full screen) ── */}
        {isMobile && showSidebar && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <SessionSidebar
              sessions={sessionList}
              currentSessionId={sessionId}
              onSwitch={switchSession}
              onNew={createNewSession}
              onRename={renameSession}
              onDelete={deleteSession}
              onPin={togglePin}
              onExport={exportSession}
              isOpen={true}
              onToggle={() => setShowSidebar(false)}
            />
          </div>
        )}

        {/* ── Sidebar overlay for desktop ── */}
        {!isMobile && showSidebar && (
          <SessionSidebar
            sessions={sessionList}
            currentSessionId={sessionId}
            onSwitch={switchSession}
            onNew={createNewSession}
            onRename={renameSession}
            onDelete={deleteSession}
            onPin={togglePin}
            onExport={exportSession}
            isOpen={true}
            onToggle={() => setShowSidebar(false)}
          />
        )}

        {/* ── Messages area ── */}
        {isOpen && !showSidebar && (
          <div ref={scrollRef} style={{
            flex: 1, overflowY: 'auto',
            padding: messages.length === 0 && !loadingSession ? '0' : '16px 16px',
            background: 'var(--color-surface)',
            scrollBehavior: 'smooth',
          }}>
            {loadingSession ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%' }}>
                <div className="skeleton-line" style={{ width: '60%', height: 10, borderRadius: 4, background: 'var(--color-border)' }} />
                <div className="skeleton-line" style={{ width: '40%', height: 10, borderRadius: 4, background: 'var(--color-border)' }} />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState prompts={suggestedPrompts} onSelect={(p) => { setInput(p); setTimeout(() => {
                const ta = document.querySelector<HTMLTextAreaElement>('.composer__input-row textarea')
                ta?.focus()
              }, 100) }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {messages.map((msg, idx) => {
                  const prev = idx > 0 ? messages[idx - 1] : undefined
                  return (
                    <div key={msg.id}>
                      <MessageTimestamp timestamp={msg.timestamp} prevTimestamp={prev?.timestamp} />
                      {msg.role === 'user' ? (
                        <UserMessageBubble msg={msg} prevMsg={prev} />
                      ) : (
                        <AiMessageBubble
                          msg={msg}
                          prevMsg={prev}
                          hovered={hoveredMsgId === msg.id}
                          onHover={(v) => setHoveredMsgId(v ? msg.id : null)}
                          onCopy={() => copyMessage(msg.content)}
                          onRetry={() => { const mIdx = messages.findIndex(m => m.id === msg.id); retryMessage(mIdx) }}
                          onFeedback={(rating) => sendFeedback(msg.id, rating)}
                          feedback={feedbackMap[msg.id]}
                        />
                      )}
                    </div>
                  )
                })}
                {isStreaming || isLoading ? (
                  <LoadingIndicator isStreaming={isStreaming} />
                ) : null}
                {streamingContent && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
                      color: '#fff', display: 'grid', placeItems: 'center',
                      fontSize: 12, flexShrink: 0, marginTop: 2,
                    }}>
                      <Sparkles size={13} />
                    </div>
                    <div className="msg-ai-content" style={{ flex: 1, minWidth: 0 }}>
                      <MarkdownMessage content={streamingContent} streaming />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Error banner ── */}
        {error && (
          <ErrorBanner
            error={error}
            onDismiss={() => setError(null)}
            onRetry={() => { setError(null); setTimeout(() => retryLastMessage(), 0) }}
          />
        )}

        {/* ── Cheatsheet ── */}
        {showCheatsheet && isOpen && (
          <div onClick={() => setShowCheatsheet(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'grid', placeItems: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: 'var(--color-surface)', borderRadius: 12, padding: '20px 24px',
              maxWidth: 300, width: '90%', boxShadow: 'var(--shadow-lg)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>⌨️ Shortcuts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                {[
                  { keys: '⌘K', desc: 'Open AI panel' },
                  { keys: '⏎', desc: 'Send message' },
                  { keys: '⇧⏎', desc: 'New line' },
                  { keys: 'Esc', desc: 'Close panel' },
                  { keys: '?', desc: 'Toggle shortcuts' },
                ].map(s => (
                  <div key={s.keys} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <kbd style={{ fontFamily: 'inherit', fontSize: 11, padding: '1px 6px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', borderRadius: 4, fontWeight: 600 }}>{s.keys}</kbd>
                    <span style={{ color: 'var(--color-text-muted)' }}>{s.desc}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setShowCheatsheet(false)}
                style={{ marginTop: 14, width: '100%', padding: '6px 0', border: '1px solid var(--color-border)', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--color-text)' }}>
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {/* ── Input area ── */}
        {isOpen && !showSidebar && (
          <>
            <SlashMentionMenu
              menuType={menuType}
              menuIndex={menuIndex}
              menuQuery={menuQuery}
              slashCommands={SLASH_COMMANDS}
              mentionResults={mentionResults}
              onSelect={(type, item) => {
                if (type === 'slash') setInput(SLASH_TRIGGER_PROMPTS[item.key])
                else {
                  const ta = document.querySelector<HTMLTextAreaElement>('.composer__input-row textarea')
                  const at = input.lastIndexOf('@', ta?.selectionStart ?? input.length)
                  setInput(input.slice(0, at) + `@${item.label}`)
                }
                setMenuType(null)
                setMentionResults([])
                const ta = document.querySelector<HTMLTextAreaElement>('.composer__input-row textarea')
                ta?.focus()
              }}
              onHover={setMenuIndex}
            />
            <div onPointerDown={(e) => {
              const ta = e.currentTarget.querySelector('textarea')
              if (ta) {
                const selStart = ta.selectionStart ?? input.length
                // Detect slash/mention
                const m = input.slice(0, selStart).match(/(?:^|\s)([/@])(\w*)$/)
                if (m) {
                  setMenuQuery(m[2]); setMenuIndex(0)
                  if (m[1] === '/') { setMenuType('slash'); setMentionResults([]) }
                  else if (m[2].length >= 1) {
                    setMenuType('mention')
                    apiClient.get<{ results: any[] }>(`/api/v1/ai/mentions/search?q=${encodeURIComponent(m[2])}`)
                      .then(r => setMentionResults(r?.results || [])).catch(() => setMentionResults([]))
                  }
                } else if (menuType) { setMenuType(null); setMentionResults([]) }
              }
            }}>
              <ChatInput
                input={input}
                onInputChange={handleInputChange}
                onSend={sendMessage}
                onAbort={abortStreaming}
                isStreaming={isStreaming}
                isLoading={isLoading}
                loadingSession={loadingSession}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Global styles ── */}
      <style>{`
        @keyframes thinking-dot {
          0%, 80%, 100% { opacity: .2; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .send-btn-hitarea { padding: 8px; margin: -8px; }
        .skeleton-line { animation: skeleton-pulse 1.5s ease-in-out infinite; }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .fab-btn::after {
          content: ''; position: absolute; top: 2px; right: 2px;
          width: 8px; height: 8px; border-radius: 50%;
          background: #ff3b30; border: 2px solid var(--color-primary);
          display: none;
        }
        .fab-btn--has-unread::after {
          display: block;
        }
        @media (prefers-reduced-motion: reduce) {
          .fab-btn, .typing-dots span, .streaming-caret, .skeleton-line {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
          .fab-btn { transition: none !important; }
        }
        @media (max-width: 767px) {
          .ai-msg-toolbar { opacity: 1 !important; }
        }
      `}</style>
    </>
  )
}
