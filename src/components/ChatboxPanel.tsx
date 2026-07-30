import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Plus, MoreHorizontal, Search, Pin, Pencil, Trash2, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { apiClient, getStoredAuth } from '../lib/api'

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

interface SessionItem {
  session_id: string
  title: string
  status: string
  created_at: string | null
  is_pinned?: boolean
}

interface StreamError {
  type: 'network' | 'auth' | 'timeout' | 'server' | 'streaming'
  message: string
  retryable: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'nexus_chat_draft'
const PANEL_WIDTH = 420
const ANIMATION_DURATION = 220

const emptyPrompts = [
  '📊 總結今日 CRM 重點',
  '🔍 搵最近跟進嘅客戶',
  '📋 今日待辦事項',
  '🎯 最需要關注嘅 Deal',
]

const suggestedPromptsCache = { prompts: emptyPrompts, ts: 0 }

const actionBtnStyle = {
  width: 24, height: 24, borderRadius: 4,
  display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  transition: 'color .12s',
}

const SLASH_TRIGGER_PROMPTS: Record<string, string> = {
  summarize: 'Summarize today\'s CRM activity',
  find: 'Find ',
  'create-task': 'Create a task: ',
  'draft-email': 'Draft an email about ',
  pipeline: 'Show me the sales pipeline',
  reset: 'Reset our conversation',
}

// ── Helpers ──

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
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const scale = visible ? 0.75 : pressed ? 0.95 : hovered ? 1.05 : 1
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      aria-label="Toggle AI chat"
      aria-expanded={visible}
      className="fab-btn"
      style={{
        position: 'fixed',
        zIndex: 50,
        bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        right: 'max(24px, env(safe-area-inset-right, 24px))',
        width: 48,
        height: 48,
        borderRadius: '50%',
        backgroundColor: 'var(--color-primary)',
        color: '#fff',
        boxShadow: pressed
          ? '0 2px 8px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.1)'
          : '0 4px 16px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        cursor: 'pointer',
        transition: 'transform 150ms ease-out, opacity 220ms ease-out, box-shadow 150ms ease-out',
        opacity: visible ? 0 : 1,
        pointerEvents: visible ? 'none' : 'auto',
        transform: `scale(${scale})`,
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
  const { t } = useTranslation()
  const SLASH_COMMANDS = [
    { key: 'summarize', label: t('chat.slashCommands.summarize'), icon: '📊' },
    { key: 'find', label: t('chat.slashCommands.find'), icon: '🔍' },
    { key: 'create-task', label: t('chat.slashCommands.createTask'), icon: '📋' },
    { key: 'draft-email', label: t('chat.slashCommands.draftEmail'), icon: '✉️' },
    { key: 'pipeline', label: t('chat.slashCommands.pipeline'), icon: '📈' },
    { key: 'reset', label: t('chat.slashCommands.reset'), icon: '🔄' },
  ]
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
  const [showSessionList, setShowSessionList] = useState(false)
  const [showCheatsheet, setShowCheatsheet] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: SessionItem } | null>(null)
  // ── Slash + mention menu state ──
  const [menuType, setMenuType] = useState<'slash' | 'mention' | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuQuery, setMenuQuery] = useState('')
  const [mentionResults, setMentionResults] = useState<{ id: string; label: string; type: string; sub: string }[]>([])
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>(emptyPrompts)
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({})

  // ── Refs ──
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastUserTextRef = useRef('')
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
    // Fetch dynamic prompts (cache 5 min)
    const age = Date.now() - suggestedPromptsCache.ts
    if (age > 300000) {
      apiClient.get<{ prompts: string[] }>('/api/v1/ai/prompts/suggested')
        .then(r => {
          if (r?.prompts?.length) {
            setSuggestedPrompts(r.prompts)
            suggestedPromptsCache.prompts = r.prompts
            suggestedPromptsCache.ts = Date.now()
          }
        })
        .catch(() => {})
    } else if (suggestedPromptsCache.prompts.length) {
      setSuggestedPrompts(suggestedPromptsCache.prompts)
    }
    // Restore draft from localStorage
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) setInput(saved)
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

  // ── Session actions: rename, pin, delete, export ──
  const renameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      await apiClient.patch(`/api/v1/ai/sessions/${sessionId}`, { title })
      setSessionList(prev => prev.map(s => s.session_id === sessionId ? { ...s, title } : s))
    } catch { /* ignore */ }
    setRenameId(null)
  }, [])

  const togglePin = useCallback(async (sessionId: string, pinned: boolean) => {
    try {
      await apiClient.patch(`/api/v1/ai/sessions/${sessionId}`, { is_pinned: pinned })
      setSessionList(prev => prev.map(s =>
        s.session_id === sessionId ? { ...s, is_pinned: pinned } : s
      ))
      // Re-fetch to get correct pin sort order
      const resp = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions')
      if (resp?.sessions) setSessionList(resp.sessions)
    } catch { /* ignore */ }
  }, [])

  const deleteSession = useCallback(async (sid: string) => {
    try {
      await apiClient.delete(`/api/v1/ai/sessions/${sid}`)
      setSessionList(prev => {
        const next = prev.filter(s => s.session_id !== sid)
        // If current session was deleted, switch to another
        if (sid === sessionId) {
          const active = next.find(s => s.status === 'active') || next[0]
          if (active) switchSession(active.session_id)
          else createNewSession()
        }
        return next
      })
    } catch { /* ignore */ }
  }, [sessionId])

  const exportSession = useCallback(async (sessionId: string) => {
    try {
      const resp = await apiClient.get<{ messages: any[] }>(`/api/v1/ai/sessions/${sessionId}/messages`)
      const msgs = resp?.messages || []
      const md = msgs.map((m: any) => `**${m.role}**: ${m.content}`).join('\n\n---\n\n')
      await navigator.clipboard.writeText(`# Chat Export\n\n${md}`)
    } catch { /* ignore */ }
  }, [])

  // ── Context menu close on click outside ──
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

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
    localStorage.removeItem(DRAFT_KEY)
    lastUserTextRef.current = text
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
              if (data.citations) {
                // citations array from done event — single source of truth
                if (Array.isArray(data.citations)) {
                  // Deduplicate by id
                  const existingIds = new Set(msgCitations.map(c => c.id))
                  for (const cit of data.citations) {
                    if (!existingIds.has(cit.id)) {
                      msgCitations.push(cit as CitationSource)
                      existingIds.add(cit.id)
                    }
                  }
                }
              }
              if (data.input_tokens !== undefined) {
                // usage event — store for reference
              }
              if (data.message) {
                // streaming error from SSE
                setError({ type: 'streaming', message: data.message, retryable: true })
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
      }

      // Streaming complete — save the final message with citations
      if (fullReply) {
        const reply: ChatMessage = {
          ...assistantMessage(fullReply),
          citations: msgCitations.length > 0 ? msgCitations : undefined,
        }
        setMessages(prev => [...prev, reply])
      }

      if (newSessionId && newSessionId !== sessionId) {
        setSessionId(newSessionId)
      }

      setStreamingContent('')
      // Refresh session list without switching — don't clear messages
      try {
        const resp = await apiClient.get<{ sessions: SessionItem[] }>('/api/v1/ai/sessions')
        if (resp?.sessions) {
          setSessionList(resp.sessions)
        }
      } catch {
        // ignore — session list best-effort
      }
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
  }, [messages])

  // ── Retry last message (re-uses lastUserTextRef) ──
  const retryLastMessage = useCallback(async () => {
    const text = lastUserTextRef.current
    if (!text || isLoading || loadingSession) return

    const userMsg = userMessage(text)
    setMessages(prev => [...prev, userMsg])
    setError(null)
    setIsLoading(true)
    setIsStreaming(true)
    setStreamingContent('')

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
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) continue
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text !== undefined) {
                fullReply += data.text
                setStreamingContent(fullReply)
              }
              if (data.session_id) newSessionId = data.session_id
              if (data.citations && Array.isArray(data.citations)) {
                const existingIds = new Set(msgCitations.map(c => c.id))
                for (const cit of data.citations) {
                  if (!existingIds.has(cit.id)) {
                    msgCitations.push(cit as CitationSource)
                    existingIds.add(cit.id)
                  }
                }
              }
              if (data.message) {
                setError({ type: 'streaming', message: data.message, retryable: true })
              }
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
        const listResp = await fetch('/api/v1/ai/sessions', {
          headers: { 'Authorization': `Bearer ${getStoredAuth()?.access_token || ''}` },
        })
        if (listResp.ok) {
          const listData = await listResp.json()
          if (listData?.sessions) setSessionList(listData.sessions)
        }
      } catch { /* ignore */ }
    } catch (err: any) {
      const msg = err?.message || t('chat.errors.server')
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
  }, [sessionId])

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

  const handleKeyDown2 = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ── Menu keyboard nav ──
    if (menuType) {
      const items = menuType === 'slash' ? SLASH_COMMANDS : mentionResults
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIndex(prev => Math.min(prev + 1, items.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIndex(prev => Math.max(prev - 1, 0)); return }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (menuType === 'slash') setInput(SLASH_TRIGGER_PROMPTS[SLASH_COMMANDS[menuIndex].key])
        else { const item = mentionResults[menuIndex]; if (item) { const at = input.indexOf('@', inputRef.current?.selectionStart ?? input.length); setInput(input.slice(0, at) + `@${item.label}`) } }
        setMenuType(null); setMentionResults([]); return
      }
      if (e.key === 'Escape') { setMenuType(null); setMentionResults([]); e.preventDefault(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
    if (e.key === '?' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { setShowCheatsheet(prev => !prev); e.preventDefault() }
  }, [menuType, menuIndex, mentionResults, input, sendMessage])

  const handleInputChange2 = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value; setInput(val)
    localStorage.setItem(DRAFT_KEY, val)
    const ta = e.target; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
    const selStart = ta.selectionStart ?? val.length
    const m = val.slice(0, selStart).match(/(?:^|\s)([/@])(\w*)$/)
    if (m) {
      setMenuQuery(m[2]); setMenuIndex(0)
      if (m[1] === '/') { setMenuType('slash'); setMentionResults([]) }
      else if (m[2].length >= 1) {
        setMenuType('mention')
        apiClient.get<{ results: any[] }>(`/api/v1/ai/mentions/search?q=${encodeURIComponent(m[2])}`)
          .then(r => setMentionResults(r?.results || [])).catch(() => setMentionResults([]))
      }
    } else if (menuType) { setMenuType(null); setMentionResults([]) }
  }, [menuType])

  // ── Render ──
  return (
    <>
      <ChatboxToggleButton onClick={() => setIsOpen(prev => !prev)} visible={isOpen} />

      <div
        ref={sessionListRef}
        role="dialog"
        aria-label={t('nav.aiChat')}
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
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>
              NEXUS {t('chat.title')}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>
              CRM Assistant
            </div>
          </div>
          <button onClick={() => setShowSessionList(prev => !prev)} aria-label={t('chat.sessionList')} title={t('chat.sessionList')}
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
          <button onClick={() => setIsOpen(false)} aria-label={t('common.close')}
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
              maxHeight: 320,
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
              {t('chat.newChat')}
            </button>

            {/* ── Search field (shown when >5 sessions) ── */}
            {sessionList.length > 5 && (
              <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--color-surface)', borderRadius: 6,
                  padding: '4px 8px', border: '1px solid var(--color-border)',
                }}>
                  <Search size={13} style={{ color: 'var(--color-text-faint)', flexShrink: 0 }} />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('chat.searchSessions')}
                    style={{
                      flex: 1, border: 0, outline: 'none',
                      background: 'transparent',
                      font: 'inherit', color: 'inherit',
                      fontSize: 12, lineHeight: '28px',
                    }}
                  />
                </div>
              </div>
            )}

            {/* ── Session list ── */}
            {(searchQuery
              ? sessionList.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
              : sessionList
            ).slice(0, 20).map(s => (
              <div key={s.session_id} style={{ position: 'relative' }}>
                {renameId === s.session_id ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '6px 10px', borderBottom: '1px solid var(--color-border)',
                  }}>
                    <input
                      value={renameText}
                      onChange={e => setRenameText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') renameSession(s.session_id, renameText)
                        if (e.key === 'Escape') setRenameId(null)
                      }}
                      autoFocus
                      style={{
                        flex: 1, border: '1px solid var(--color-primary)', outline: 'none',
                        borderRadius: 4, padding: '4px 6px',
                        font: 'inherit', fontSize: 12.5,
                        background: 'var(--color-surface)', color: 'inherit',
                      }}
                    />
                    <button onClick={() => renameSession(s.session_id, renameText)}
                      style={{ border: 0, background: 'var(--color-primary)', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      {t('common.save')}
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => { setContextMenu(null); switchSession(s.session_id) }}
                    onContextMenu={e => {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, session: s })
                    }}
                    className="session-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      width: '100%', padding: '8px 10px', border: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      background: s.session_id === sessionId ? 'var(--color-surface-offset)' : 'transparent',
                      color: 'var(--color-text)', fontSize: 12.5, cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      flex: 1, minWidth: 0,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s.title}
                    </span>
                    {s.is_pinned && (
                      <Pin size={11} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    )}
            <button
              onClick={e => {
                e.stopPropagation()
                setContextMenu(ctx =>
                  ctx?.session.session_id === s.session_id ? null
                    : { x: e.clientX - 100, y: e.clientY, session: s }
                )
              }}
              style={{
                width: 22, height: 22, border: 0, borderRadius: 4,
                background: 'transparent', color: 'var(--color-text-faint)',
                cursor: 'pointer', display: 'none', placeItems: 'center',
                flexShrink: 0,
              }}
              className="session-more-btn"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* ── Context menu popup ── */}
            {contextMenu && (
              <div
                style={{
                  position: 'fixed',
                  left: Math.min(contextMenu.x, window.innerWidth - 140),
                  top: Math.min(contextMenu.y, window.innerHeight - 200),
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 999,
                  padding: '4px 0',
                  minWidth: 130,
                }}
              >
                <CtxBtn onClick={() => {
                  setRenameId(contextMenu.session.session_id)
                  setRenameText(contextMenu.session.title)
                  setContextMenu(null)
                }}>
                  <Pencil size={12} /> {t('chat.rename')}
                </CtxBtn>
                <CtxBtn onClick={() => {
                  togglePin(contextMenu.session.session_id, !contextMenu.session.is_pinned)
                  setContextMenu(null)
                }}>
                  <Pin size={12} /> {contextMenu.session.is_pinned ? t('chat.unpin') : t('chat.pin')}
                </CtxBtn>
                <CtxBtn onClick={() => {
                  exportSession(contextMenu.session.session_id)
                  setContextMenu(null)
                }}>
                  <Download size={12} /> {t('chat.export')}
                </CtxBtn>
                <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
                <CtxBtn
                  danger
                  onClick={() => {
                    if (confirm(t('chat.deleteConfirm'))) {
                      deleteSession(contextMenu.session.session_id)
                    }
                    setContextMenu(null)
                  }}
                >
                  <Trash2 size={12} /> {t('chat.delete')}
                </CtxBtn>
              </div>
            )}
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%', padding: '0 32px' }}>
              <div className="skeleton-line" style={{ width: '60%', height: 10, borderRadius: 4, background: 'var(--color-border)' }} />
              <div className="skeleton-line" style={{ width: '40%', height: 10, borderRadius: 4, background: 'var(--color-border)' }} />
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
                {t('chat.emptyTitle')}
              </h1>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 24px' }}>
                {t('chat.emptySubtitle')}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 320 }}>
                {suggestedPrompts.map(p => (
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
                const prev = idx > 0 ? messages[idx - 1] : null
                const isGrouped = !showDivider && prev && prev.role === msg.role && (msg.timestamp - prev.timestamp) < 180000
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
                        maxWidth: '82%',
                        padding: '8px 12px',
                        background: 'var(--color-surface-offset)',
                        borderRadius: '14px 14px 4px 14px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 14,
                        lineHeight: 1.55,
                        color: 'var(--color-text)',
                        marginLeft: 'auto',
                        marginTop: isGrouped ? -14 : 0,
                      }}>
                        {msg.content}
                      </div>
                    ) : (
                      <div
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        onMouseLeave={() => setHoveredMsgId(null)}
                        style={{ position: 'relative' }}
                      >
                        <div style={{ display: 'flex', gap: isGrouped ? 0 : 10, alignItems: 'flex-start' }}>
                          {!isGrouped && <div style={{
                            width: 24, height: 24, borderRadius: '50%',
                            background: 'linear-gradient(135deg, var(--color-primary), #5c9df0)',
                            color: '#fff', display: 'grid', placeItems: 'center',
                            fontSize: 11, flexShrink: 0, marginTop: 2,
                          }}>
                            <Sparkles size={11} />
                          </div>}
                          <div style={{
                            flex: 1, minWidth: 0,
                            fontSize: 14, lineHeight: 1.6,
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
                              title={t('chat.copy')} aria-label={t('chat.copy')}
                              style={actionBtnStyle}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                            <button onClick={() => {
                              const idx = messages.findIndex(m => m.id === msg.id)
                              retryMessage(idx)
                            }}
                              title={t('chat.retry')} aria-label={t('chat.retry')}
                              style={actionBtnStyle}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                            </button>
                            {(feedbackMap[msg.id] !== 'up') ? (
                              <button onClick={() => sendFeedback(msg.id, 'up')}
                                title={t('chat.upvote')} aria-label={t('chat.upvote')}
                                style={{
                                  ...actionBtnStyle,
                                  color: feedbackMap[msg.id] === 'up' ? 'var(--color-primary)' : undefined,
                                }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                              </button>
                            ) : null}
                            {(feedbackMap[msg.id] !== 'down') ? (
                              <button onClick={() => sendFeedback(msg.id, 'down')}
                                title={t('chat.downvote')} aria-label={t('chat.downvote')}
                                style={{
                                  ...actionBtnStyle,
                                  color: feedbackMap[msg.id] === 'down' ? 'var(--color-notification)' : undefined,
                                }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                              </button>
                            ) : null}
                            <button onClick={() => {
                              const url = sessionId
                                ? `https://nexus-crm.kinet-poc.com/chat/${sessionId}?msg=${msg.id}`
                                : `https://nexus-crm.kinet-poc.com/chat?msg=${msg.id}`
                              navigator.clipboard.writeText(url)
                            }}
                              title={t('chat.share')} aria-label={t('chat.share')}
                              style={actionBtnStyle}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                            </button>
                          </div>
                        )}
                        {/* ── Source cards ── */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div style={{ marginTop: 8, paddingLeft: 34 }}>
                            <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginBottom: 6, fontWeight: 600 }}>{t('chat.sources')}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {msg.citations.slice(0, 5).map((cit, ci) => (
                                <div key={ci} style={{
                                  display: 'flex', alignItems: 'center', gap: 6,
                                  padding: '6px 8px',
                                  background: 'var(--color-surface-2)',
                                  borderRadius: 6,
                                  border: '1px solid var(--color-border)',
                                  cursor: 'pointer',
                                }}
                                  onClick={() => {
                                    const routes: Record<string, string> = { company: 'companies', contact: 'contacts', deal: 'deals', project: 'projects' }
                                    const route = routes[cit.type] || cit.type
                                    window.open(`/${route}/${cit.id}`, '_blank')
                                  }}
                                >
                                  <span style={{
                                    width: 16, height: 16, borderRadius: 3,
                                    background: 'var(--color-primary)',
                                    color: '#fff', fontSize: 9, fontWeight: 700,
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                  }}>
                                    {ci + 1}
                                  </span>
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
                    fontSize: 14, lineHeight: 1.6,
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

        {/* ── Per-type error banner with Retry ── */}
        {error && (
          (() => {
            const colors: Record<string, string> = {
              network: '#b91c1c', auth: '#92400e', timeout: '#7c3aed', server: '#b91c1c', streaming: '#b45309',
            }
            const icons: Record<string, string> = {
              network: '📡', auth: '🔒', timeout: '⏱️', server: '⚠️', streaming: '💬',
            }
            const bg = error.type === 'network' || error.type === 'server'
              ? 'rgba(255,59,48,0.08)' : error.type === 'auth'
              ? 'rgba(255,149,0,0.08)' : error.type === 'timeout'
              ? 'rgba(175,82,222,0.08)' : 'rgba(255,159,10,0.08)'
            const borderColor = error.type === 'network' || error.type === 'server'
              ? '1px solid rgba(255,59,48,0.25)' : error.type === 'auth'
              ? '1px solid rgba(255,149,0,0.25)' : error.type === 'timeout'
              ? '1px solid rgba(175,82,222,0.25)' : '1px solid rgba(255,159,10,0.25)'
            return (
              <div style={{
                padding: '8px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
                backgroundColor: bg, borderTop: borderColor,
              }}>
                <span>{icons[error.type] || '⚠️'}</span>
                <span style={{ flex: 1, color: colors[error.type] || 'var(--color-text)' }}>{error.message}</span>
                {error.retryable && (
                  <button
                    onClick={() => { setError(null); setTimeout(() => retryLastMessage(), 0) }}
                    style={{
                      border: '1px solid currentColor', background: 'transparent',
                      color: colors[error.type] || 'var(--color-text)',
                      borderRadius: 999, padding: '2px 10px', fontSize: 11, cursor: 'pointer',
                      fontWeight: 600, whiteSpace: 'nowrap',
                    }}
                  >
                    {t('common.retry')}
                  </button>
                )}
                <button onClick={() => setError(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: colors[error.type] || 'var(--color-text)', padding: 0, display: 'grid', placeItems: 'center' }}>
                  <X size={12} />
                </button>
              </div>
            )
          })()
        )}

        {/* ── Slash / Mention floating menu ── */}
        {menuType && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 14, right: 14,
            maxHeight: 200, overflowY: 'auto',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
            zIndex: 200, marginBottom: 4,
          }}>
            {menuType === 'slash' ? (
              SLASH_COMMANDS.filter(c => c.key.includes(menuQuery)).map((cmd, i) => (
                <div key={cmd.key}
                  onClick={() => { setInput(SLASH_TRIGGER_PROMPTS[cmd.key]); setMenuType(null); inputRef.current?.focus() }}
                  onMouseEnter={() => setMenuIndex(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', cursor: 'pointer', fontSize: 12.5,
                    background: i === menuIndex ? 'var(--color-surface-offset)' : 'transparent',
                    color: 'var(--color-text)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <span style={{ fontSize: 14 }}>{cmd.icon}</span>
                  <span style={{ fontWeight: 500 }}>/{cmd.key}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--color-text-faint)', fontSize: 11 }}>{cmd.label}</span>
                </div>
              ))
            ) : (
              mentionResults.length === 0 ? (
                <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--color-text-faint)' }}>Type to search contacts, companies, deals...</div>
              ) : (
                mentionResults.map((item, i) => (
                  <div key={`${item.type}-${item.id}`}
                    onClick={() => {
                      const at = input.lastIndexOf('@', inputRef.current?.selectionStart ?? input.length)
                      setInput(input.slice(0, at) + `@${item.label}`)
                      setMenuType(null)
                      inputRef.current?.focus()
                    }}
                    onMouseEnter={() => setMenuIndex(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', cursor: 'pointer', fontSize: 12.5,
                      background: i === menuIndex ? 'var(--color-surface-offset)' : 'transparent',
                      color: 'var(--color-text)',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: 4, fontSize: 9, fontWeight: 700,
                      display: 'grid', placeItems: 'center', flexShrink: 0,
                      background: item.type === 'contact' ? 'var(--color-blue)' : item.type === 'company' ? 'var(--color-purple)' : 'var(--color-green)',
                      color: '#fff', textTransform: 'uppercase',
                    }}>{item.type[0]}</span>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                    {item.sub && <span style={{ marginLeft: 'auto', color: 'var(--color-text-faint)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{item.sub}</span>}
                  </div>
                ))
              )
            )}
          </div>
        )}

        {/* ── Composer: Notion AI style ── */}
        <div style={{
          borderTop: '1px solid var(--color-border)',
          padding: '10px 14px 12px',
          background: 'var(--color-surface-2)',
          position: 'relative',
        }}>
          <div className="composer__box" style={{
            display: 'flex', alignItems: 'flex-end', gap: 0,
            padding: '6px 10px',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            background: 'var(--color-surface)',
            transition: 'border-color .15s, box-shadow .15s',
          }}>
            <textarea ref={inputRef} value={input} onChange={handleInputChange2} onKeyDown={handleKeyDown2}
              placeholder={t('chat.placeholder')} rows={1} disabled={isLoading || loadingSession}
              aria-label="Chat input"
              style={{
                flex: 1, border: 0, outline: 'none', resize: 'none',
                background: 'transparent',
                font: 'inherit', color: 'inherit',
                maxHeight: 160, fontSize: 14, lineHeight: 1.5,
                padding: '4px 2px',
                opacity: isLoading || loadingSession ? 0.5 : 1,
              }}
            />
            <span className="send-btn-hitarea" style={{ display: 'inline-flex', padding: 0, lineHeight: 0 }}>
            {isStreaming ? (
              <button onClick={abortStreaming}
                aria-label={t('chat.stop')}
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
              aria-label={t('chat.send')}
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
            color: 'var(--color-text-faint)', fontSize: 11.5,
            marginTop: 5, padding: '0 4px',
          }}>
            <span><kbd style={{ fontFamily: 'inherit', fontSize: 10, padding: '1px 4px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', borderRadius: 3 }}>⏎</kbd> send · <kbd style={{ fontFamily: 'inherit', fontSize: 10, padding: '1px 4px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', borderRadius: 3 }}>⇧</kbd>+<kbd style={{ fontFamily: 'inherit', fontSize: 10, padding: '1px 4px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-border)', borderRadius: 3 }}>⏎</kbd> new line</span>
          </div>
        </div>
      </div>

      {/* ── Keyboard shortcut cheatsheet ── */}
      {showCheatsheet && (
        <div onClick={() => setShowCheatsheet(false)}
          style={{ position: 'absolute', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'grid', placeItems: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--color-surface)', borderRadius: 12, padding: '20px 24px',
            maxWidth: 280, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>⌨️ Shortcuts</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
              {[
                { keys: '⏎', desc: 'Send message' },
                { keys: '⇧⏎', desc: 'New line' },
                { keys: '/', desc: 'Command menu' },
                { keys: '@', desc: 'Search CRM' },
                { keys: '↑', desc: 'Edit last message' },
                { keys: 'Esc', desc: 'Close panel / menu' },
                { keys: '?', desc: 'Toggle shortcuts' },
              ].map(s => (
                <div key={s.keys} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
        .session-row:hover .session-more-btn { display: grid !important; }
        .skeleton-line { animation: skeleton-pulse 1.5s ease-in-out infinite; }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .fab-btn { position: relative; }
        .fab-btn::after {
          content: ''; position: absolute; top: 2px; right: 2px;
          width: 8px; height: 8px; border-radius: 50%;
          background: #ff3b30; border: 2px solid var(--color-primary);
        }
        @media (prefers-reduced-motion: reduce) {
          .typing-dots span, .skeleton-line, .streaming-caret { animation: none !important; }
        }
        @media (prefers-color-scheme: dark) {
          :root { --color-bg: #1a1a1e; --color-surface: #242428; --color-surface-offset: #2c2c30; }
        }
        @supports (bottom: env(safe-area-inset-bottom)) {
          .fab-btn { bottom: calc(24px + env(safe-area-inset-bottom)) !important; }
        }
      `}</style>
    </>
  )
}

// ── Context Menu Button ──
function CtxBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      style={{
        width: '100%', padding: '6px 12px', border: 'none',
        background: 'transparent',
        color: danger ? 'var(--color-notification)' : 'var(--color-text)',
        fontSize: 12, cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 8,
        transition: 'background .1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}
