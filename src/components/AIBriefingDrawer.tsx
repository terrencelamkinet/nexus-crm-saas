import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import { useSecretarySettings, isInWorkingHours } from '../hooks/useSecretarySettings'
import { Sparkles, X, ChevronDown, Send, RefreshCw, AlertTriangle, CheckSquare, Calendar, History } from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface Deal {
  id: string
  name: string
  amount: number | null
  status: string
  stage_id: string | null
  expected_close_date: string | null
  company_id: string | null
  updated_at: string
  created_at: string
}

interface Quote {
  id: string
  deal_id: string
  quote_number: string
  status: string
  total: number | null
  valid_until: string | null
  created_at: string
}

interface TaskItem {
  id: string
  title: string
  priority: string
  status: string
  due_date: string | null
}

interface ScheduleEvent {
  id: string
  title: string
  time: string
  location?: string
}

// ── Insight model (after aggregation) ──
interface RiskInsight {
  dealId: string
  dealName: string
  companyName: string
  amount: number
  quoteNumber: string
  daysIdle: number
  reason: string        // tooltip text ("why this?")
}

interface BriefingPayload {
  greeting: string
  summary: string  // compact trigger subtitle (no greeting prefix)
  content: string  // LLM-generated briefing (AI-app pipeline)
  slot: string
  risks: RiskInsight[]
  overdueTasks: TaskItem[]
  todayEvents: ScheduleEvent[]
  riskCount: number
  taskCount: number
  eventCount: number
  // 20-module data (Batch B/C)
  weather: any[]
  news: any[]
  traffic: any[]
  birthdays: any[]
  drafts: any[]
  expenses: any[]
  personal: any[]
  conflicts: any[]
  sentiment: any[]
  unread: any[]
}

// ── Helpers ──
const daysSince = (iso: string): number => {
  const d = new Date(iso)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

const isOverdue = (due: string | null): boolean => {
  if (!due) return false
  const d = new Date(due)
  return d.getTime() < Date.now() - 86400000 // overdue by >1 day
}

const isToday = (time: string): boolean => {
  if (!time) return false
  const t = time.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return t === today
}

const fmtMoney = (n: number | null): string => {
  if (n == null) return ''
  return `$${n.toLocaleString('en-US')}`
}

/** Slot key → friendly label (zh/en aware). */
const slotLabel = (slot: string): string => {
  const map: Record<string, string> = {
    morning: '早安', noon: '午安', afternoon: '午安',
    evening: '晚安', night: '深夜', lateNight: '深夜',
  }
  return map[slot] || slot
}

/** Pick the active greeting slot for `now` (HKT) from backend slots. */
function currentGreetingSlot(slots: { key: string; emoji: string; start: string }[] | undefined) {
  const list = (slots && slots.length ? slots : [
    { key: 'morning', emoji: '🌅', start: '05:00' },
    { key: 'afternoon', emoji: '☀️', start: '12:00' },
    { key: 'evening', emoji: '🌆', start: '18:00' },
    { key: 'lateNight', emoji: '🌙', start: '23:00' },
  ])
  const toM = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  const sorted = [...list].sort((a, b) => toM(a.start) - toM(b.start))
  let current = sorted[sorted.length - 1]
  for (const s of sorted) {
    if (mins >= toM(s.start)) current = s
    else break
  }
  return current
}

// ── Component ──
export default function AIBriefingDrawer() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const secretary = useSecretarySettings()
  const settings = secretary.settings
  const mods = settings.modules

  // Current greeting slot (from backend greeting_slots) — re-evaluated every minute
  const [greeting, setGreeting] = useState(() => currentGreetingSlot(settings.greeting_slots))
  useEffect(() => {
    const check = () => setGreeting(prev => {
      const next = currentGreetingSlot(settings.greeting_slots)
      return prev.key === next.key ? prev : next
    })
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [settings.greeting_slots])

  const inWorkingHours = isInWorkingHours(new Date(), settings)
  const [expanded, setExpanded] = useState(false)
  const [payload, setPayload] = useState<BriefingPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  // Typewriter state
  const [typing, setTyping] = useState(false)
  const [typedText, setTypedText] = useState('')
  const [showInsights, setShowInsights] = useState(false)

  // Inline editor state (per-risk)
  const [editorFor, setEditorFor] = useState<string | null>(null) // dealId
  const [drafting, setDrafting] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [sentOk, setSentOk] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load briefing data ──
  const loadBriefing = useCallback(async () => {
    setLoading(true)
    try {
      // 1) existing briefing endpoint (schedule + tasks + ai_tip + LLM content)
      const brief = await apiClient.get<{
        schedule?: ScheduleEvent[]
        tasks?: TaskItem[]
        ai_tip?: string
        content?: string
        slot?: string
      }>('/api/v1/ai/briefing')

      // 2) open deals
      let deals: Deal[] = []
      try {
        const res = await apiClient.get<{ items?: Deal[] }>('/api/v1/crm/deals?status=open&limit=50')
        deals = res?.items || []
      } catch { /* non-fatal */ }

      // 3) sent quotes (pending reply)
      let quotes: Quote[] = []
      try {
        const res = await apiClient.get<{ items?: Quote[] }>('/api/v1/crm/quotes?limit=100')
        quotes = res?.items || []
      } catch { /* non-fatal */ }

      // ── Build insights ──
      // High-risk: deal open + has sent quote + deal idle > 7 days
      const quoteByDeal = new Map<string, Quote[]>()
      quotes.forEach(q => {
        const arr = quoteByDeal.get(q.deal_id) || []
        arr.push(q)
        quoteByDeal.set(q.deal_id, arr)
      })

      const risks: RiskInsight[] = []
      if (inWorkingHours && (mods.includes('stale_deals') || mods.includes('quote_tracking'))) {
        deals.forEach(d => {
          const dealQuotes = (quoteByDeal.get(d.id) || []).filter(q => q.status === 'sent' || q.status === 'pending')
          const idle = daysSince(d.updated_at || d.created_at)
          if (dealQuotes.length > 0 && idle >= 7) {
            const q = dealQuotes[0]
            risks.push({
              dealId: d.id,
              dealName: d.name,
              companyName: d.company_id || '',
              amount: d.amount != null ? Number(d.amount) : (q.total != null ? Number(q.total) : 0),
              quoteNumber: q.quote_number,
              daysIdle: idle,
              reason: `報價單 ${q.quote_number} 已發出 ${idle} 日未有回覆，金額 ${fmtMoney(q.total)}，建議主動跟進確認意願。`,
            })
          }
        })
      }
      risks.sort((a, b) => b.daysIdle - a.daysIdle)

      // Overdue tasks — task/project items are confined to working hours
      const tasks = inWorkingHours && mods.includes('today_tasks')
        ? (brief?.tasks || []).filter(t => t.status !== 'done' && isOverdue(t.due_date)).slice(0, 5)
        : []

      // Today's events
      const events = mods.includes('meetings')
        ? (brief?.schedule || []).filter(e => isToday(e.time)).slice(0, 5)
        : []

      // 4) 20-module briefing (Batch B/C — weather/news/traffic/birthdays/etc)
      let extra: Record<string, any[]> = {}
      try {
        const res = await apiClient.get<Record<string, any>>('/api/v1/ai-secretary/briefing')
        extra = (res || {}) as Record<string, any[]>
      } catch { /* non-fatal */ }
      const weather = Array.isArray(extra.weather) ? extra.weather : []
      const news = Array.isArray(extra.news_industry) ? extra.news_industry : []
      const traffic = Array.isArray(extra.traffic_commute) ? extra.traffic_commute : []
      const birthdays = Array.isArray(extra.birthdays) ? extra.birthdays : []
      const drafts = Array.isArray(extra.email_draft_review) ? extra.email_draft_review : []
      const expenses = Array.isArray(extra.expense_reminders) ? extra.expense_reminders : []
      const personal = Array.isArray(extra.personal_reminders) ? extra.personal_reminders : []
      const conflicts = Array.isArray(extra.calendar_conflicts) ? extra.calendar_conflicts : []
      const sentiment = Array.isArray(extra.customer_sentiment) ? extra.customer_sentiment : []
      const unread = Array.isArray(extra.unread_messages) ? extra.unread_messages : []

      const riskCount = risks.length
      const taskCount = tasks.length
      const eventCount = events.length

      const parts: string[] = []
      if (riskCount > 0) parts.push(t('pages.briefing.riskItem', { count: riskCount }))
      if (taskCount > 0) parts.push(t('pages.briefing.taskItem', { count: taskCount }))
      if (eventCount > 0) parts.push(t('pages.briefing.meetingItem', { count: eventCount }))
      if (weather.length > 0) {
        const w = weather[0]
        parts.push(t('pages.briefing.weatherSummary', { temp: w.temperature ?? '', hum: w.humidity ?? '' }))
      }
      if (news.length > 0) parts.push(t('pages.briefing.newsSummary', { count: news.length }))
      if (traffic.length > 0) parts.push(t('pages.briefing.trafficSummary', { count: traffic.length }))
      if (birthdays.length > 0) parts.push(t('pages.briefing.birthdaySummary', { count: birthdays.length }))
      if (drafts.length > 0) parts.push(t('pages.briefing.draftSummary', { count: drafts.length }))
      if (expenses.length > 0) parts.push(t('pages.briefing.expenseSummary', { count: expenses.length }))
      if (personal.length > 0) parts.push(t('pages.briefing.personalSummary', { count: personal.length }))
      if (conflicts.length > 0) parts.push(t('pages.briefing.conflictSummary', { count: conflicts.length }))
      if (sentiment.length > 0 && sentiment[0].negative_pct != null) {
        parts.push(t('pages.briefing.sentimentSummary', { neg: sentiment[0].negative_pct }))
      }
      if (unread.length > 0) parts.push(t('pages.briefing.unreadSummary', { count: unread.length }))
      if (parts.length === 0) parts.push(t('pages.briefing.noItems'))

      setPayload({
        greeting: t(`pages.briefing.${greeting.key}Greeting`, { items: parts.join(i18n.language === 'en' ? ', ' : '，') }),
        summary: parts.join(' · '),
        content: brief?.content || '',
        slot: brief?.slot || '',
        risks,
        overdueTasks: tasks,
        todayEvents: events,
        riskCount,
        taskCount,
        eventCount,
        weather, news, traffic, birthdays, drafts, expenses, personal, conflicts, sentiment, unread,
      })
    } catch {
      setPayload({
        greeting: t(`pages.briefing.${greeting.key}GreetingError`),
        summary: t(`pages.briefing.${greeting.key}GreetingError`),
        content: '', slot: '',
        risks: [], overdueTasks: [], todayEvents: [],
        riskCount: 0, taskCount: 0, eventCount: 0,
        weather: [], news: [], traffic: [], birthdays: [], drafts: [], expenses: [],
        personal: [], conflicts: [], sentiment: [], unread: [],
      })
    } finally {
      setLoading(false)
    }
  }, [greeting.key, inWorkingHours, mods])

  // ── Typewriter effect when drawer opens ──
  const animationPlayedRef = useRef(false)

  useEffect(() => {
    if (!expanded || !payload) return

    // If animation already played once, just show full text instantly
    if (animationPlayedRef.current) {
      setTypedText(payload.greeting)
      setShowInsights(true)
      return
    }

    setTyping(true)
    setTypedText('')
    setShowInsights(false)
    let i = 0
    const text = payload.greeting
    timerRef.current = setInterval(() => {
      i += 2
      setTypedText(text.slice(0, i))
      if (i >= text.length) {
        if (timerRef.current) clearInterval(timerRef.current)
        setTyping(false)
        animationPlayedRef.current = true
        setTimeout(() => setShowInsights(true), 250)
      }
    }, 24)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [expanded, payload])

  // ── Toggle expand ──
  const toggleExpand = () => {
    setExpanded(prev => !prev)
    if (!hasLoaded) {
      setHasLoaded(true)
      loadBriefing()
    }
  }

  // Preload briefing on mount so the trigger text is ready
  useEffect(() => {
    loadBriefing()
  }, [loadBriefing])

  // ── Inline draft (simulated AI drafting, graduated autonomy) ──
  const startDraft = (risk: RiskInsight) => {
    setEditorFor(risk.dealId)
    setDrafting(true)
    setDraftText('')
    setSentOk(false)

    const draft = i18n.language === 'en'
      ? `Dear ${risk.companyName} team,\n\nRegarding the quotation ${risk.quoteNumber} (${fmtMoney(risk.amount)}) sent earlier, we would like to follow up on its current status. If you have any questions or require assistance, I am available for a 15-minute call to provide further details.\n\nLooking forward to your reply. Thank you!`
      : `您好，${risk.companyName} 團隊：\n\n關於早前發出的報價單 ${risk.quoteNumber}（${fmtMoney(risk.amount)}），謹此了解目前的進度。如有任何疑問或需要協助，我隨時可以安排 15 分鐘電話詳細說明。\n\n期待您的回覆，謝謝！`
    let j = 0
    timerRef.current = setInterval(() => {
      j += 3
      setDraftText(draft.slice(0, j))
      if (j >= draft.length) {
        if (timerRef.current) clearInterval(timerRef.current)
        setDrafting(false)
      }
    }, 18)
  }

  const cancelDraft = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setEditorFor(null)
    setDrafting(false)
    setDraftText('')
    setSentOk(false)
  }

  const sendDraft = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setSentOk(true)
    setDrafting(false)
  }

  // ── Render trigger widget ──
  return (
    <>
      {/* Trigger widget — compact, non-intrusive */}
      <div
        onClick={toggleExpand}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleExpand() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, rgba(124,93,250,0.10), rgba(99,102,241,0.06))',
          border: `1px solid ${expanded ? 'var(--color-purple)' : 'color-mix(in oklch, var(--color-purple) 22%, var(--color-divider))'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px', cursor: 'pointer',
          transition: 'border-color 150ms, background 150ms',
          marginBottom: expanded ? 0 : 20,
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-purple)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = expanded ? 'var(--color-purple)' : 'color-mix(in oklch, var(--color-purple) 22%, var(--color-divider))')}
      >
        {/* Pulse orb */}
        <div style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle, #a78bfa, #6366f1)',
            boxShadow: '0 0 0 0 rgba(139,92,246,0.45)',
            animation: 'ai-pulse 2.2s infinite',
          }} />
          <div style={{
            position: 'absolute', inset: 7, borderRadius: '50%', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={13} style={{ color: '#7c3aed' }} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)' }}>
            {greeting.emoji} {t('greeting.' + greeting.key, { name: user?.displayName || user?.email?.split('@')[0] || '' })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {loading ? t('common.loading') : payload ? payload.summary : t('pages.briefing.triggerFallback')}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
          fontSize: 12, fontWeight: 600, color: '#7c3aed',
          background: 'rgba(124,93,250,0.12)', padding: '6px 12px', borderRadius: 999,
        }}>
          {expanded ? t('pages.briefing.collapse') : t('pages.briefing.more')} <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
        </span>
      </div>

      {/* Expandable panel — push-down (推移式), inline in document flow */}
      <div style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        transition: 'grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1)',
        marginBottom: expanded ? 20 : 0,
      }}>
        <div style={{
          overflow: 'hidden', minHeight: 0,
          visibility: expanded ? 'visible' : 'hidden',
          transition: expanded ? 'visibility 0s' : 'visibility 0s linear 320ms',
        }}>
          <div
            aria-hidden={!expanded}
            {...(!expanded ? { inert: true } : {})}
            style={{
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-surface)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            padding: '14px 16px 16px',
            marginTop: 12,
            display: 'flex', flexDirection: 'column', gap: 16,
            animation: expanded ? 'ai-fadein 0.3s ease' : 'none',
          }}>
          {/* Panel header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)' }}>
              {t('pages.briefing.title')}
            </span>
            <span style={{ marginLeft: 'auto' }} />
            <button
              onClick={e => { e.stopPropagation(); setExpanded(false) }}
              aria-label={t('pages.briefing.collapse')}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 8, cursor: 'pointer',
                background: 'var(--color-surface-offset)', border: 'none',
                color: 'var(--color-text-faint)', transition: 'background 150ms, color 150ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-divider)'; e.currentTarget.style.color = 'var(--color-text)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface-offset)'; e.currentTarget.style.color = 'var(--color-text-faint)' }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Loading skeleton */}
          {loading && !payload && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="animate-pulse" style={{ height: 44, background: 'var(--color-surface-offset)', borderRadius: 'var(--radius-md)' }} />
              <div className="animate-pulse" style={{ height: 90, background: 'var(--color-surface-offset)', borderRadius: 'var(--radius-md)' }} />
              <div className="animate-pulse" style={{ height: 90, background: 'var(--color-surface-offset)', borderRadius: 'var(--radius-md)' }} />
            </div>
          )}

          {/* AI conversation summary */}
          {payload && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {typing && (
                <div className="ai-typing-dots" style={{ display: 'flex', gap: 4, padding: '6px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', animation: 'ai-bounce 1.2s infinite' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', animation: 'ai-bounce 1.2s infinite 0.15s' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', animation: 'ai-bounce 1.2s infinite 0.3s' }} />
                </div>
              )}
              <p style={{
                fontSize: 14, lineHeight: 1.65, color: 'var(--color-text)',
                fontWeight: 500, minHeight: 46,
              }}>
                {typedText}
                {typing && <span style={{ borderRight: '2px solid #a78bfa', marginLeft: 2 }}>&nbsp;</span>}
              </p>
            </div>
          )}

          {/* ── LLM-generated briefing (AI-app pipeline) ── */}
          {payload?.content && (
            <div style={{
              background: 'color-mix(in oklch, var(--color-purple) 8%, var(--color-surface))',
              border: '1px solid color-mix(in oklch, var(--color-purple) 25%, transparent)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--color-purple)', marginBottom: 6, letterSpacing: 0.3 }}>
                🤖 AI 簡報{payload.slot ? ` · ${slotLabel(payload.slot)}` : ''}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {payload.content}
              </div>
            </div>
          )}

          {/* Insights (progressive disclosure) */}
          {showInsights && payload && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'ai-fadein 0.4s ease' }}>
              {/* ── High-risk deals ── */}
              {payload.risks.length > 0 && (
                <InsightSection
                  icon={<AlertTriangle size={14} style={{ color: 'var(--color-notification)' }} />}
                  title={t('pages.briefing.riskSection', { count: payload.riskCount })}
                  badge={t('pages.briefing.riskBadge')}
                  badgeColor="var(--color-notification)"
                  defaultOpen
                >
                  {payload.risks.map(risk => (
                    <div key={risk.dealId} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.55 }}>
                        <strong>{risk.dealName}</strong> {t('pages.briefing.riskDesc')}
                        <span
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            marginLeft: 6, fontSize: 11.5, color: '#7c3aed', cursor: 'help',
                            borderBottom: '1px dashed #c4b5fd', position: 'relative',
                          }}
                          data-tooltip={risk.reason}
                        >
                          <span style={{
                            display: 'inline-flex', width: 14, height: 14, borderRadius: '50%',
                            background: 'rgba(124,93,250,0.15)', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700,
                          }}>?</span>
                          {t('pages.briefing.whyThis')}
                        </span>
                      </p>

                      {editorFor !== risk.dealId ? (
                        <button
                          onClick={() => startDraft(risk)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                            fontSize: 12, fontWeight: 600, color: '#7c3aed',
                            background: 'rgba(124,93,250,0.10)', border: '1px solid rgba(124,93,250,0.25)',
                            borderRadius: 'var(--radius-md)', padding: '7px 12px', cursor: 'pointer',
                            transition: 'background 150ms',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,93,250,0.18)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(124,93,250,0.10)')}
                        >
                          ✨ {t('pages.briefing.draftEmail')}
                        </button>
                      ) : (
                        <div style={{
                          border: '1px solid var(--color-divider)',
                          borderRadius: 'var(--radius-md)', overflow: 'hidden',
                        }}>
                          <div style={{
                            fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)',
                            padding: '8px 12px', background: 'var(--color-surface-offset)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            {sentOk ? t('pages.briefing.sentRecorded') : drafting ? t('pages.briefing.aiDrafting') : t('pages.briefing.draftReady')}
                            <button onClick={cancelDraft} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-faint)' }}>
                              <X size={13} />
                            </button>
                          </div>
                          <textarea
                            value={draftText}
                            onChange={e => setDraftText(e.target.value)}
                            readOnly={drafting || sentOk}
                            rows={5}
                            style={{
                              width: '100%', border: 'none', outline: 'none', resize: 'vertical',
                              fontSize: 12.5, lineHeight: 1.55, padding: '10px 12px',
                              background: 'var(--color-surface)', color: 'var(--color-text)',
                              fontFamily: 'inherit',
                            }}
                          />
                          {!sentOk && (
                            <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--color-divider)' }}>
                              <button
                                onClick={cancelDraft}
                                style={{
                                  fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius-md)',
                                  background: 'var(--color-surface-offset)', color: 'var(--color-text-muted)',
                                  border: 'none', cursor: 'pointer',
                                }}
                              >
                                {t('pages.briefing.cancel')}
                              </button>
                              <button
                                onClick={sendDraft}
                                disabled={drafting || draftText.trim() === ''}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius-md)',
                                  background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer',
                                  opacity: drafting || draftText.trim() === '' ? 0.5 : 1,
                                }}
                              >
                                <Send size={12} /> {t('pages.briefing.sendEmail')}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Overdue tasks ── */}
              {payload.overdueTasks.length > 0 && (
                <InsightSection
                  icon={<CheckSquare size={14} style={{ color: 'var(--color-warning)' }} />}
                  title={t('pages.briefing.taskSection', { count: payload.taskCount })}
                  badge={t('pages.briefing.overdueBadge')}
                  badgeColor="var(--color-warning)"
                >
                  {payload.overdueTasks.map(task => (
                    <label key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
                      <input type="checkbox" style={{ accentColor: 'var(--color-primary)' }} />
                      <span style={{ color: 'var(--color-text)', flex: 1 }}>{task.title}</span>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                        background: 'color-mix(in oklch, var(--color-notification) 15%, var(--color-surface))',
                        color: 'var(--color-notification)',
                      }}>
                        {task.due_date ? t('pages.briefing.overdueDays', { count: daysSince(task.due_date) }) : t('pages.briefing.overduePlain')}
                      </span>
                    </label>
                  ))}
                </InsightSection>
              )}

              {/* ── Today's events ── */}
              {payload.todayEvents.length > 0 && (
                <InsightSection
                  icon={<Calendar size={14} style={{ color: 'var(--color-blue)' }} />}
                  title={t('pages.briefing.eventSection', { count: payload.eventCount })}
                  badge={t('pages.briefing.todayBadge')}
                  badgeColor="var(--color-blue)"
                >
                  {payload.todayEvents.map(ev => (
                    <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-text-muted)', fontSize: 12.5, minWidth: 46, fontVariantNumeric: 'tabular-nums' }}>
                        {ev.time.slice(11, 16)}
                      </span>
                      <span style={{ color: 'var(--color-text)' }}>{ev.title}</span>
                      {ev.location && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-text-faint)' }}>{ev.location}</span>}
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Weather ── */}
              {payload.weather.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>🌤️</span>}
                  title={t('pages.briefing.weatherSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.weather.slice(0, 2).map((w: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>
                        {w.place}: {w.temperature != null ? `${w.temperature}°C` : ''}
                      </span>
                      {w.humidity != null && <span style={{ color: 'var(--color-text-muted)' }}>{t('pages.briefing.weatherHumidity', { hum: w.humidity })}</span>}
                      {w.rainfall_mm != null && <span style={{ color: 'var(--color-blue)' }}>{t('pages.briefing.weatherRain', { mm: w.rainfall_mm })}</span>}
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Schedule conflicts ── */}
              {payload.conflicts.length > 0 && (
                <InsightSection
                  icon={<AlertTriangle size={14} style={{ color: 'var(--color-notification)' }} />}
                  title={t('pages.briefing.conflictSection')}
                  badge={t('pages.briefing.riskBadge')}
                  badgeColor="var(--color-notification)"
                >
                  {payload.conflicts.map((c: any, i: number) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ color: 'var(--color-text)' }}>
                        <strong>{c.event_a}</strong> ↔ <strong>{c.event_b}</strong>
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)' }}>
                        {c.overlap_start ? t('pages.briefing.conflictOverlap', { time: c.overlap_start.slice(11, 16) }) : ''}
                      </span>
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Traffic ── */}
              {payload.traffic.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>🚗</span>}
                  title={t('pages.briefing.trafficSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.traffic.slice(0, 4).map((tr: any, i: number) => (
                    <div key={i} style={{ fontSize: 12.5, color: 'var(--color-text)', lineHeight: 1.5, padding: '2px 0' }}>
                      {tr.text || tr.ChinText || tr.EngText || ''}
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Birthdays ── */}
              {payload.birthdays.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>🎂</span>}
                  title={t('pages.briefing.birthdaySection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.birthdays.slice(0, 5).map((b: any) => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ color: 'var(--color-text)' }}>{b.name}</span>
                      {b.company_name && <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)' }}>{b.company_name}</span>}
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Drafts to review ── */}
              {payload.drafts.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>✉️</span>}
                  title={t('pages.briefing.draftSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.drafts.slice(0, 5).map((d: any) => (
                    <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{d.title}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.content || ''}
                      </span>
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Expenses ── */}
              {payload.expenses.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>🧾</span>}
                  title={t('pages.briefing.expenseSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.expenses.slice(0, 5).map((e: any) => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ color: 'var(--color-text)' }}>{e.title}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--color-text)' }}>
                        {e.amount != null ? `$${Number(e.amount).toLocaleString()}` : ''} {e.currency || ''}
                      </span>
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Personal reminders ── */}
              {payload.personal.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>📌</span>}
                  title={t('pages.briefing.personalSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.personal.slice(0, 5).map((p: any) => (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{p.title}</span>
                      {p.content && <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)' }}>{p.content}</span>}
                      {p.remind_at && <span style={{ fontSize: 11, color: 'var(--color-warning)' }}>⏰ {p.remind_at.slice(0, 16).replace('T', ' ')}</span>}
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Unread messages ── */}
              {payload.unread.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>💬</span>}
                  title={t('pages.briefing.unreadSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.unread.slice(0, 5).map((u: any, i: number) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13, padding: '2px 0' }}>
                      <span style={{ color: 'var(--color-text)' }}>
                        <strong>{u.from || ''}</strong>{u.subject ? ` — ${u.subject}` : ''}
                      </span>
                      {u.snippet && <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.snippet}</span>}
                    </div>
                  ))}
                </InsightSection>
              )}

              {/* ── Industry news ── */}
              {payload.news.length > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>📰</span>}
                  title={t('pages.briefing.newsSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  {payload.news.slice(0, 5).map((n: any, i: number) => (
                    <a
                      key={i}
                      href={n.link || '#'}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13, padding: '2px 0', color: 'var(--color-text)', textDecoration: 'none' }}
                    >
                      <span style={{ fontWeight: 500, lineHeight: 1.45 }}>{n.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>{n.feed || ''}</span>
                    </a>
                  ))}
                </InsightSection>
              )}

              {/* ── Customer sentiment ── */}
              {payload.sentiment.length > 0 && payload.sentiment[0].total_messages > 0 && (
                <InsightSection
                  icon={<span style={{ fontSize: 13 }}>🙂</span>}
                  title={t('pages.briefing.sentimentSection')}
                  badge={""}
                  badgeColor="var(--color-text-faint)"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: 'var(--color-text)', padding: '2px 0' }}>
                    <span>😊 {payload.sentiment[0].positive ?? 0}</span>
                    <span>😐 {payload.sentiment[0].neutral ?? 0}</span>
                    <span>😠 {payload.sentiment[0].negative ?? 0}</span>
                    {payload.sentiment[0].negative_pct != null && payload.sentiment[0].negative_pct >= 30 && (
                      <span style={{ color: 'var(--color-notification)', fontWeight: 700 }}>{t('pages.briefing.riskBadge')}</span>
                    )}
                  </div>
                </InsightSection>
              )}

              {/* ── Empty state ── */}
              {payload.risks.length === 0 && payload.overdueTasks.length === 0 && payload.todayEvents.length === 0 &&
                payload.weather.length === 0 && payload.news.length === 0 && payload.traffic.length === 0 &&
                payload.birthdays.length === 0 && payload.drafts.length === 0 && payload.expenses.length === 0 &&
                payload.personal.length === 0 && payload.conflicts.length === 0 && payload.sentiment.length === 0 &&
                payload.unread.length === 0 && (
                <div style={{
                  textAlign: 'center', padding: '28px 16px', fontSize: 13, color: 'var(--color-text-muted)',
                  border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)',
                }}>
                  {t('pages.briefing.allGood')}
                </div>
              )}

              {/* Footer */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>
                <History size={11} />
                <span>{t('pages.briefing.footer')}</span>
                <button
                  onClick={loadBriefing}
                  disabled={loading}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-faint)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                >
                  <RefreshCw size={11} style={{ animation: loading ? 'ai-spin 1s linear infinite' : 'none' }} /> {t('pages.briefing.refresh')}
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Global keyframes + tooltip styles */}
      <style>{`
        @keyframes ai-pulse {
          0% { box-shadow: 0 0 0 0 rgba(139,92,246,0.45); }
          70% { box-shadow: 0 0 0 12px rgba(139,92,246,0); }
          100% { box-shadow: 0 0 0 0 rgba(139,92,246,0); }
        }
        @keyframes ai-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes ai-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ai-spin { to { transform: rotate(360deg); } }
        [data-tooltip] { position: relative; }
        [data-tooltip]:hover::after {
          content: attr(data-tooltip);
          position: absolute; bottom: calc(100% + 8px); left: 0;
          background: #1e1b2e; color: #e4e4f0;
          font-size: 11px; line-height: 1.5; font-weight: 500;
          padding: 8px 10px; border-radius: 8px;
          width: 240px; z-index: 50;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
          white-space: normal;
        }
        [data-tooltip]:hover::before {
          content: ''; position: absolute; bottom: calc(100% + 2px); left: 18px;
          border: 5px solid transparent; border-top-color: #1e1b2e;
        }
      `}</style>
    </>
  )
}

// ── Insight Section (accordion) ──
function InsightSection({
  icon,
  title,
  badge,
  badgeColor,
  defaultOpen,
  children,
}: {
  icon: React.ReactNode
  title: string
  badge: string
  badgeColor: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!!defaultOpen)

  return (
    <div style={{
      border: '1px solid var(--color-divider)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      background: 'var(--color-surface)',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '11px 12px', background: 'var(--color-surface-offset)',
          border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
          color: 'var(--color-text)',
        }}
      >
        {icon}
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: '1px 8px', borderRadius: 999,
          background: `color-mix(in oklch, ${badgeColor} 14%, var(--color-surface))`,
          color: badgeColor,
        }}>
          {badge}
        </span>
        <ChevronDown size={14} style={{
          color: 'var(--color-text-faint)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 150ms',
        }} />
      </button>
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      )}
    </div>
  )
}
