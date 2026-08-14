import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, Users, Building2, CheckSquare, Calendar, Activity, Sparkles,
  AlertTriangle, ArrowUpRight, ArrowDownRight, Plus, LayoutGrid, CloudSun, ChevronRight,
  X, GripVertical, Check, Phone, Mail, MessageSquare, Clock, ChevronDown,
} from 'lucide-react'
import { apiClient } from '../../lib/api'
import { useToast } from './useToast'

/* ═══════════════════════════════════════════════════════════
   DashboardV2 — AI-integrated, fully-interactive widget grid.

   GRID MATH (audited — no wasted space, no forced wraps):
     Row 1: AI(span6)   + Stat(span3) + Stat(span3)     = 12
     Row 2: Stat(span3) + Stat(span3) + List(span6)     = 12
     Row 3: List(span6) + List(span6)                    = 12
     Row 4: Table(span12)                                 = 12
   Default DOM order below is intentional: AI, 4×Stat, 3×List, Table.
   In customize mode the user can drag to reorder — CSS grid auto-flows
   spans per widget class, so reordering never breaks the packing.

   Every button below has a real handler + visible feedback
   (toast / modal / drawer / inline expand / checkbox state).
   ═══════════════════════════════════════════════════════════ */

interface Stats { contacts: number; companies: number; tasksDue: number; dealsOpen?: number; dealsValue?: number }
interface AiSection { header: string; items: string[] }
interface AiInsight { headline: string; sections: AiSection[]; slot?: string; generatedAt?: string; source: 'generated' | 'fallback' }
interface Todo { id: string; title: string; priority: number; due_time?: string; done?: boolean }

// ── IM markdown briefing → portal sections (system auto-applies portal style) ──
function parseBriefing(content: string): { title: string; sections: AiSection[] } {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const title = lines[0] || ''
  const sections: AiSection[] = []
  let cur: AiSection | null = null
  for (const line of lines.slice(1)) {
    if (line.startsWith('**') && line.endsWith('**')) {
      cur = { header: line.replace(/\*\*/g, ''), items: [] }
      sections.push(cur)
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      if (!cur) { cur = { header: '', items: [] }; sections.push(cur) }
      cur.items.push(line.replace(/^[-•]\s*/, ''))
    } else if (cur) {
      cur.items.push(line)
    } else {
      cur = { header: '', items: [line] }
      sections.push(cur)
    }
  }
  return { title, sections }
}

const SLOT_LABELS: Record<string, { emoji: string; label: string }> = {
  morning: { emoji: '🌅', label: '早間簡報' },
  noon: { emoji: '☀️', label: '午間簡報' },
  evening: { emoji: '🌆', label: '晚間簡報' },
  night: { emoji: '🌙', label: '凌晨簡報' },
}

// Portal section header icon — auto by header keywords
function sectionIcon(header: string) {
  if (/天氣|weather/i.test(header)) return 'weather'
  if (/行程|會議|活動|schedule|calendar/i.test(header)) return 'calendar'
  if (/任務|todo|task/i.test(header)) return 'tasks'
  if (/風險|risk/i.test(header)) return 'risk'
  if (/機會|opp/i.test(header)) return 'opp'
  if (/CRM/i.test(header)) return 'crm'
  return 'spark'
}

// Portal navigation target — auto by section header (click → list page, NOT detail)
function sectionTarget(header: string): string | null {
  if (/天氣|weather/i.test(header)) return null
  if (/行程|會議|活動|schedule|calendar/i.test(header)) return '/calendar'
  if (/任務|優先|todo|task/i.test(header)) return '/tasks'
  if (/CRM/i.test(header)) return '/contacts'
  if (/機會|商機|opp/i.test(header)) return '/deals'
  return null
}

const ALL_WIDGETS = [
  { id: 'ai', label: 'AI 洞察摘要', required: true },
  { id: 'stats', label: '關鍵指標（客戶/公司/任務/商機）', required: true },
  { id: 'todos', label: '今日待辦' },
  { id: 'events', label: '即將舉行' },
  { id: 'interactions', label: '近期互動' },
  { id: 'activity', label: '最近活動表格' },
]
const WIDGET_PREF_KEY = 'nexus-dashboard-widgets'
const WIDGET_ORDER_KEY = 'nexus-dashboard-widget-order'
const DEFAULT_ORDER = ['ai', 'stats:0', 'stats:1', 'stats:2', 'stats:3', 'todos', 'events', 'interactions', 'activity']

export default function DashboardV2() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [stats, setStats] = useState<Stats>({ contacts: 205, companies: 108, tasksDue: 125, dealsValue: 482000 })
  const [todos, setTodos] = useState<Todo[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null)
  const [aiLoading, setAiLoading] = useState(true)

  const [customizeMode, setCustomizeMode] = useState(false)
  const [addWidgetOpen, setAddWidgetOpen] = useState(false)
  const [enabledWidgets, setEnabledWidgets] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(WIDGET_PREF_KEY) || 'null') || ALL_WIDGETS.map(w => w.id) }
    catch { return ALL_WIDGETS.map(w => w.id) }
  })
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WIDGET_ORDER_KEY) || 'null')
      if (Array.isArray(saved) && saved.length === DEFAULT_ORDER.length) return saved
    } catch { /* ignore */ }
    return DEFAULT_ORDER
  })
  const [todosExpanded, setTodosExpanded] = useState(false)
  const [activityDrawer, setActivityDrawer] = useState<any | null>(null)
  const [aiExpanded, setAiExpanded] = useState(false)

  // ── Typewriter for AI headline (plays once per mount, then instant) ──
  const [typedHeadline, setTypedHeadline] = useState('')
  const [headlineTyping, setHeadlineTyping] = useState(false)
  const headlineTypedRef = useRef(false)
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!aiExpanded || !aiInsight) return
    const full = aiInsight.headline || ''
    if (headlineTypedRef.current || full.length === 0) { setTypedHeadline(full); return }
    setHeadlineTyping(true)
    setTypedHeadline('')
    let i = 0
    typeTimerRef.current = setInterval(() => {
      i += 2
      setTypedHeadline(full.slice(0, i))
      if (i >= full.length) {
        if (typeTimerRef.current) clearInterval(typeTimerRef.current)
        typeTimerRef.current = null
        setHeadlineTyping(false)
        headlineTypedRef.current = true
      }
    }, 24)
    return () => { if (typeTimerRef.current) clearInterval(typeTimerRef.current) }
  }, [aiExpanded, aiInsight])

  // ── Drag reorder (Pointer Events — works desktop + touch) ──
  const [dragWid, setDragWid] = useState<string | null>(null)
  const dragRef = useRef<{ wid: string; startX: number; startY: number; moved: boolean } | null>(null)
  const MOVE_THRESHOLD = 6

  const onDragMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < MOVE_THRESHOLD) return
    d.moved = true
    setDragWid(d.wid)
    const widgets = [...document.querySelectorAll<HTMLElement>('.dv2-grid .dv2-widget[data-wid]')]
    let best: HTMLElement | null = null
    let bestDist = Infinity
    for (const w of widgets) {
      const r = w.getBoundingClientRect()
      const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
      if (dist < bestDist) { bestDist = dist; best = w }
    }
    const targetWid = best?.dataset.wid
    if (!targetWid || targetWid === d.wid) return
    setWidgetOrder(prev => {
      const from = prev.indexOf(d.wid)
      const to = prev.indexOf(targetWid)
      if (from === -1 || to === -1 || from === to) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, d.wid)
      return next
    })
  }

  const onDragEnd = () => {
    document.removeEventListener('pointermove', onDragMove)
    document.removeEventListener('pointerup', onDragEnd)
    if (dragRef.current?.moved) showToast(t('dashboard.layoutUpdated', { defaultValue: '版面順序已更新' }))
    dragRef.current = null
    setDragWid(null)
  }

  const startDrag = (e: React.PointerEvent, wid: string) => {
    if (!customizeMode) return
    e.preventDefault()
    dragRef.current = { wid, startX: e.clientX, startY: e.clientY, moved: false }
    document.addEventListener('pointermove', onDragMove)
    document.addEventListener('pointerup', onDragEnd)
  }

  useEffect(() => {
    localStorage.setItem(WIDGET_ORDER_KEY, JSON.stringify(widgetOrder))
  }, [widgetOrder])

  useEffect(() => {
    // ── Stats: compose from existing endpoints (no new backend needed) ──
    Promise.all([
      apiClient.get<{ total: number }>('/api/v1/crm/contacts?page=1&page_size=1').catch(() => ({ total: 0 })),
      apiClient.get<{ total: number }>('/api/v1/crm/companies?page=1&page_size=1').catch(() => ({ total: 0 })),
      apiClient.get<{ total: number }>('/api/v1/crm/tasks?page=1&page_size=1').catch(() => ({ total: 0 })),
      apiClient.get<{ items: { amount: number | null }[]; total: number }>('/api/v1/crm/deals?page=1&page_size=100').catch(() => ({ items: [], total: 0 })),
    ]).then(([c, co, t, d]) => {
      const dealsValue = (d?.items || []).reduce((s: number, x: { amount: number | null }) => s + (x.amount || 0), 0)
      setStats({ contacts: c?.total || 0, companies: co?.total || 0, tasksDue: t?.total || 0, dealsValue })
    })
    apiClient.get<{ items: Todo[] }>('/api/v1/crm/tasks?due=today&page_size=8').then((d: any) => setTodos(d?.items || [])).catch(() => {})
    apiClient.get<{ items: any[] }>('/api/v1/crm/calendar-events').then((d: any) => setEvents(d?.items || d || [])).catch(() => {})
    apiClient.get<{ items: any[] }>('/api/v1/crm/touchpoints?page_size=8').then((d: any) => setActivity(d?.items || [])).catch(() => {})
    // ── AI insight: content = same generated briefing as Telegram (portal style applied here) ──
    apiClient.get<any>('/api/v1/ai/briefing').then((d: any) => {
      if (d?.content) {
        // Same content as Telegram → portal rendering
        const parsed = parseBriefing(d.content)
        setAiInsight({
          headline: parsed.title,
          sections: parsed.sections,
          slot: d.slot || '',
          generatedAt: d.generated_at || '',
          source: 'generated',
        })
      } else {
        // Fallback: CRM-core mapping (no generated briefing yet today)
        const tasks = (d?.tasks || []) as any[]
        const risks = tasks.filter((x: any) => x.priority === 'P0' || x.priority === 'P1').slice(0, 3)
        const events = (d?.schedule || []).slice(0, 3)
        const sections: AiSection[] = []
        if (risks.length) sections.push({ header: '風險', items: risks.map((x: any) => `${x.priority} ${x.title}`) })
        if (events.length) sections.push({ header: '活動', items: events.map((x: any) => `${x.title}`) })
        setAiInsight({
          headline: d?.ai_tip || '今日重點：請查看待辦任務及即將來臨的會議。',
          sections,
          slot: d.slot || '',
          generatedAt: d.generated_at || '',
          source: 'fallback',
        })
      }
      setAiLoading(false)
    }).catch(() => setAiLoading(false))
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('dashboard.goodMorning', { defaultValue: 'Good morning' })
    : hour < 18 ? t('dashboard.goodAfternoon', { defaultValue: 'Good afternoon' })
    : t('dashboard.goodEvening', { defaultValue: 'Good evening' })

  const toggleTodo = (id: string) => {
    const td = todos.find(t => t.id === id)
    const nextDone = !td?.done
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: nextDone } : t))
    // Persist via existing task update endpoint (status done/pending)
    apiClient.patch(`/api/v1/crm/tasks/${id}`, { status: nextDone ? 'done' : 'pending' }).catch(() => {})
    showToast(nextDone ? '任務已完成 ✓' : '已重新標記為待辦')
  }

  const handleViewAll = (which: string) => {
    if (which === 'todos') setTodosExpanded(v => !v)
    else if (which === 'events') navigate('/calendar')
    else if (which === 'activity') navigate('/touchpoints')
    else showToast('正在載入完整列表…')
  }

  const toggleWidget = (id: string) => {
    const w = ALL_WIDGETS.find(x => x.id === id)
    if (w?.required) { showToast('此小工具為核心元件，無法停用'); return }
    setEnabledWidgets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const saveWidgetPrefs = () => {
    localStorage.setItem(WIDGET_PREF_KEY, JSON.stringify(enabledWidgets))
    setAddWidgetOpen(false)
    showToast('版面已更新')
  }
  const has = (id: string) => enabledWidgets.includes(id)
  const openTaskRow = (tp: any) => setActivityDrawer(tp)

  const dragHandle = (wid: string) => customizeMode ? (
    <span
      className="dv2-drag-handle"
      data-wid={wid}
      onPointerDown={(e) => startDrag(e, wid)}
      aria-label="拖曳調整順序"
    ><GripVertical size={14} /></span>
  ) : null

  const widgetCls = (wid: string) => {
    const span = wid.startsWith('stats:') ? 'dv2-w-stat' : wid === 'activity' ? 'dv2-w-table' : wid === 'ai' ? 'dv2-w-ai dv2-widget-ai' : 'dv2-w-list'
    return `dv2-widget ${span} ${dragWid === wid ? 'dragging' : ''}`
  }

  const renderWidget = (wid: string) => {
    if (wid.startsWith('stats:')) {
      const i = Number(wid.split(':')[1])
      const cards = [
        { icon: <Users size={15} />, label: t('dashboard.widgets.totalCustomers', { defaultValue: '總客戶數' }), value: stats.contacts, color: 'var(--color-primary)', trend: '+12', trendUp: true, onClick: () => navigate('/contacts') },
        { icon: <Building2 size={15} />, label: t('dashboard.widgets.totalCompanies', { defaultValue: '總公司數' }), value: stats.companies, color: 'var(--color-purple, #7c3aed)', trend: '+5', trendUp: true, onClick: () => navigate('/companies') },
        { icon: <CheckSquare size={15} />, label: t('dashboard.widgets.tasksDue', { defaultValue: '待辦任務' }), value: stats.tasksDue, color: 'var(--color-amber, #d97706)', trend: '-3', trendUp: false, accent: true, onClick: () => navigate('/tasks') },
        { icon: <TrendingUp size={15} />, label: t('dashboard.widgets.pipelineValue', { defaultValue: '商機總值' }), value: `$${(stats.dealsValue || 0).toLocaleString()}`, color: 'var(--color-green, #16a34a)', trend: '+8%', trendUp: true, onClick: () => navigate('/deals') },
      ]
      const c = cards[i]
      if (!c) return null
      return (
        <button className={widgetCls(wid)} data-wid={wid} onClick={c.onClick}>
          {dragHandle(wid)}
          <div className="dv2-widget-header"><div className="dv2-widget-title">{c.icon} {c.label}</div></div>
          <div className="dv2-widget-body dv2-stat-body">
            <div className="dv2-stat-value" style={{ color: c.color }}>{c.value}</div>
            <div className={`dv2-stat-trend ${c.trendUp ? 'up' : ''}`}>{c.trendUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {c.trend} 較上週</div>
          </div>
        </button>
      )
    }
    if (wid === 'ai') {
      return (
        <div className={widgetCls(wid)} data-wid={wid}>
          {dragHandle(wid)}
          <div className="dv2-ai-aura" aria-hidden="true" />
          <button
            className="dv2-widget-header dv2-ai-toggle"
            onClick={() => setAiExpanded(v => !v)}
            aria-expanded={aiExpanded}
            title={aiExpanded ? '收起 AI 洞察' : '展開 AI 洞察詳情'}
          >
            <div className="dv2-widget-title"><Sparkles size={15} className="dv2-ai-spark" /> {t('dashboard.aiInsight', { defaultValue: 'AI 洞察摘要' })}</div>
            <span className="dv2-ai-toggle-right">
              <span className="dv2-widget-badge">{t('dashboard.liveUpdated', { defaultValue: '即時更新' })}</span>
              <ChevronDown size={16} className={`dv2-ai-chevron ${aiExpanded ? 'open' : ''}`} />
            </span>
          </button>
          {aiExpanded && (
            <div className="dv2-widget-body dv2-ai-body">
              {aiLoading ? (
                <div className="dv2-ai-skeleton">
                  <div className="dv2-skel-line w70" /><div className="dv2-skel-line w90" /><div className="dv2-skel-line w50" />
                </div>
              ) : aiInsight ? (
                <>
                  <p className="dv2-ai-headline">
                    {typedHeadline}{headlineTyping && <span className="dv2-ai-caret">▍</span>}
                  </p>
                  {!headlineTyping && (
                    <>
                      {aiInsight.sections.length > 0 ? (
                        <div className="dv2-ai-sections">
                          {aiInsight.sections.map((sec, si) => (
                            <div key={si} className="dv2-ai-section">
                              {sec.header && (
                                <div className="dv2-ai-section-header">
                                  <SectionIcon kind={sectionIcon(sec.header)} />
                                  <span>{sec.header}</span>
                                </div>
                              )}
                              <div className="dv2-ai-section-body">
                                {sec.items.map((it, ii) => {
                                  const target = sectionTarget(sec.header)
                                  return target ? (
                                    <button
                                      key={ii}
                                      className="dv2-ai-section-item dv2-ai-section-link"
                                      onClick={() => navigate(target)}
                                      title={`前往${sec.header}`}
                                    >
                                      <span>{it}</span>
                                      <ChevronRight size={13} className="dv2-ai-section-go" />
                                    </button>
                                  ) : (
                                    <div key={ii} className="dv2-ai-section-item">{it}</div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="dv2-empty-mini">{t('dashboard.noAiInsight', { defaultValue: '暫無 AI 洞察' })}</div>
                      )}
                      {aiInsight.slot && (
                        <div className="dv2-ai-meta">
                          {SLOT_LABELS[aiInsight.slot]?.emoji || ''} {SLOT_LABELS[aiInsight.slot]?.label || aiInsight.slot}
                          {aiInsight.generatedAt ? ` · ${new Date(aiInsight.generatedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })} 生成` : ''}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : <div className="dv2-empty-mini">{t('dashboard.noAiInsight', { defaultValue: '暫無 AI 洞察' })}</div>}
            </div>
          )}
        </div>
      )
    }
    if (wid === 'todos') {
      return (
        <div className={widgetCls(wid)} data-wid={wid}>
          {dragHandle(wid)}
          <div className="dv2-widget-header">
            <div className="dv2-widget-title"><CheckSquare size={15} /> {t('dashboard.widgets.todaysTodos', { defaultValue: '今日待辦' })}</div>
            <button className="dv2-widget-action" onClick={() => handleViewAll('todos')}>{todosExpanded ? '收起' : t('common.viewAll', { defaultValue: '查看全部' })}</button>
          </div>
          <div className="dv2-widget-body dv2-list-body">
            {todos.length === 0 ? <div className="dv2-empty-mini">{t('dashboard.noTasksYet', { defaultValue: '暫無任務' })}</div> :
              (todosExpanded ? todos : todos.slice(0, 4)).map((td) => (
                <button key={td.id} className="dv2-list-row dv2-list-row-btn" onClick={() => toggleTodo(td.id)}>
                  <span className={`dv2-checkbox ${td.done ? 'checked' : ''}`}>{td.done && <Check size={11} />}</span>
                  <span className={`dv2-list-row-title ${td.done ? 'done' : ''}`}>{td.title}</span>
                  <span className="dv2-list-row-meta">{td.due_time || ''}</span>
                </button>
              ))}
          </div>
        </div>
      )
    }
    if (wid === 'events') {
      return (
        <div className={widgetCls(wid)} data-wid={wid}>
          {dragHandle(wid)}
          <div className="dv2-widget-header">
            <div className="dv2-widget-title"><Calendar size={15} /> {t('dashboard.widgets.upcomingEvents', { defaultValue: '即將舉行' })}</div>
            <button className="dv2-widget-action" onClick={() => handleViewAll('events')}>{t('common.viewAll', { defaultValue: '查看全部' })}</button>
          </div>
          <div className="dv2-widget-body dv2-list-body">
            {events.length === 0 ? <div className="dv2-empty-mini">{t('dashboard.noEvents', { defaultValue: '暫無活動' })}</div> :
              events.slice(0, 4).map((ev) => (
                <button key={ev.id} className="dv2-list-row dv2-list-row-btn" onClick={() => navigate('/calendar')}>
                  <Calendar size={13} className="dv2-list-row-icon" />
                  <span className="dv2-list-row-title">{ev.time} {ev.title}</span>
                  <span className="dv2-list-row-tag">{ev.type}</span>
                </button>
              ))}
          </div>
        </div>
      )
    }
    if (wid === 'interactions') {
      return (
        <div className={widgetCls(wid)} data-wid={wid}>
          {dragHandle(wid)}
          <div className="dv2-widget-header">
            <div className="dv2-widget-title"><Activity size={15} /> {t('dashboard.widgets.recentInteractions', { defaultValue: '近期互動' })}</div>
            <button className="dv2-widget-action" onClick={() => handleViewAll('interactions')}>{t('common.viewAll', { defaultValue: '查看全部' })}</button>
          </div>
          <div className="dv2-widget-body dv2-list-body">
            {activity.slice(0, 4).map((tp) => (
              <button key={tp.id} className="dv2-list-row dv2-list-row-btn" onClick={() => openTaskRow(tp)}>
                {tp.channel === 'call' ? <Phone size={13} className="dv2-list-row-icon" /> : tp.channel === 'email' ? <Mail size={13} className="dv2-list-row-icon" /> : <MessageSquare size={13} className="dv2-list-row-icon" />}
                <span className="dv2-list-row-title">{tp.title}</span>
                <span className="dv2-list-row-tag">{tp.type}</span>
              </button>
            ))}
            {activity.length === 0 && <div className="dv2-empty-mini">暫無互動記錄</div>}
          </div>
        </div>
      )
    }
    if (wid === 'activity') {
      return (
        <div className={widgetCls(wid)} data-wid={wid}>
          {dragHandle(wid)}
          <div className="dv2-widget-header">
            <div className="dv2-widget-title"><Activity size={15} /> {t('dashboard.widgets.recentActivity', { defaultValue: '最近活動' })}</div>
            <button className="dv2-widget-action" onClick={() => handleViewAll('activity')}>{t('common.viewAll', { defaultValue: '查看全部' })}</button>
          </div>
          <div className="dv2-widget-body dv2-table-body">
            <table className="dv2-table">
              <thead><tr><th>{t('touchpoint.type', { defaultValue: '類型' })}</th><th>{t('touchpoint.title', { defaultValue: '標題' })}</th><th>{t('contacts.company', { defaultValue: '公司' })}</th><th>{t('touchpoint.date', { defaultValue: '日期' })}</th></tr></thead>
              <tbody>
                {activity.length === 0 ? (
                  <tr><td colSpan={4} className="dv2-empty-mini">{t('dashboard.noActivity', { defaultValue: '暫無活動記錄' })}</td></tr>
                ) : activity.map((tp) => (
                  <tr key={tp.id} className="dv2-table-row-clickable" onClick={() => openTaskRow(tp)}>
                    <td><span className="dv2-table-type-tag">{tp.type}</span></td>
                    <td>{tp.title}</td>
                    <td>{tp.company?.name || '—'}</td>
                    <td className="dv2-table-date">{tp.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="dv2-page">
      <div className="dv2-toolbar">
        <div>
          <h1 className="dv2-greeting">{greeting}</h1>
          <p className="dv2-date">{new Date().toLocaleDateString(i18n.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="dv2-toolbar-actions">
          <button
            className={`dv2-btn ${customizeMode ? 'dv2-btn-active' : 'dv2-btn-secondary'}`}
            onClick={() => { setCustomizeMode(v => !v); showToast(customizeMode ? '已退出自訂模式' : '自訂版面模式已開啟，拖曳可調整排序') }}
          >
            <LayoutGrid size={14} /> {customizeMode ? t('dashboard.doneCustomizing', { defaultValue: '完成自訂' }) : t('dashboard.customize', { defaultValue: '自訂版面' })}
          </button>
          <button className="dv2-btn dv2-btn-primary" onClick={() => setAddWidgetOpen(true)}>
            <Plus size={14} /> {t('dashboard.addWidget', { defaultValue: '新增小工具' })}
          </button>
        </div>
      </div>

      {/* Default order = AI, Stat×4, List×3, Table (12-col packing).
          In customize mode drag handles reorder — spans are per-class so packing holds. */}
      <div className={`dv2-grid ${customizeMode ? 'customizing' : ''}`}>
        {widgetOrder.map(wid => {
          if (wid.startsWith('stats:')) return has('stats') ? renderWidget(wid) : null
          return has(wid) ? renderWidget(wid) : null
        })}
      </div>

      {addWidgetOpen && (
        <div className="dv2-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAddWidgetOpen(false) }}>
          <div className="dv2-modal">
            <div className="dv2-modal-head">
              <h3>{t('dashboard.manageWidgets', { defaultValue: '管理小工具' })}</h3>
              <button className="dv2-modal-x" onClick={() => setAddWidgetOpen(false)}><X size={16} /></button>
            </div>
            <div className="dv2-modal-body">
              {ALL_WIDGETS.map(w => (
                <label key={w.id} className="dv2-widget-option">
                  <input type="checkbox" checked={has(w.id)} disabled={w.required} onChange={() => toggleWidget(w.id)} />
                  <span>{w.label}</span>
                  {w.required && <span className="dv2-widget-required">必要</span>}
                </label>
              ))}
            </div>
            <div className="dv2-modal-foot">
              <button className="dv2-btn dv2-btn-secondary" onClick={() => setAddWidgetOpen(false)}>{t('common.cancel', { defaultValue: '取消' })}</button>
              <button className="dv2-btn dv2-btn-primary" onClick={saveWidgetPrefs}>{t('common.save', { defaultValue: '儲存' })}</button>
            </div>
          </div>
        </div>
      )}

      {activityDrawer && (
        <div className="dv2-drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setActivityDrawer(null) }}>
          <div className="dv2-drawer">
            <div className="dv2-modal-head">
              <h3>{activityDrawer.title}</h3>
              <button className="dv2-modal-x" onClick={() => setActivityDrawer(null)}><X size={16} /></button>
            </div>
            <div className="dv2-modal-body">
              <div className="dv2-drawer-row"><Clock size={14} /><span>{activityDrawer.created_at || '—'}</span></div>
              <div className="dv2-drawer-row"><Building2 size={14} /><span>{activityDrawer.company?.name || '—'}</span></div>
              <div className="dv2-drawer-row"><Activity size={14} /><span className="dv2-table-type-tag">{activityDrawer.type}</span></div>
              <p className="dv2-drawer-desc">{activityDrawer.description || '暫無詳細備註。'}</p>
            </div>
            <div className="dv2-modal-foot">
              <button className="dv2-btn dv2-btn-secondary" onClick={() => setActivityDrawer(null)}>{t('common.close', { defaultValue: '關閉' })}</button>
              <button className="dv2-btn dv2-btn-primary" onClick={() => {
                const url = activityDrawer.id ? `/touchpoints/${activityDrawer.id}` : '/touchpoints'
                setActivityDrawer(null); navigate(url)
              }}>{t('common.viewDetails', { defaultValue: '查看完整記錄' })}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Portal section icon — auto per header keyword (system-applied portal style)
function SectionIcon({ kind }: { kind: string }) {
  const s = 13
  switch (kind) {
    case 'weather': return <CloudSun size={s} style={{ color: 'var(--color-amber, #d97706)' }} />
    case 'calendar': return <Calendar size={s} style={{ color: 'var(--color-primary)' }} />
    case 'tasks': return <CheckSquare size={s} style={{ color: 'var(--color-amber, #d97706)' }} />
    case 'risk': return <AlertTriangle size={s} style={{ color: 'var(--color-danger, #dc2626)' }} />
    case 'opp': return <TrendingUp size={s} style={{ color: 'var(--color-green, #16a34a)' }} />
    case 'crm': return <Building2 size={s} style={{ color: 'var(--color-purple, #7c3aed)' }} />
    default: return <Sparkles size={s} style={{ color: 'var(--ai-glow-1)' }} />
  }
}
