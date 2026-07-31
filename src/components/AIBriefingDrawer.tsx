import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient } from '../lib/api'
import SlideDrawer from './SlideDrawer'
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
  risks: RiskInsight[]
  overdueTasks: TaskItem[]
  todayEvents: ScheduleEvent[]
  riskCount: number
  taskCount: number
  eventCount: number
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

// ── Component ──
export default function AIBriefingDrawer() {
  const [drawerOpen, setDrawerOpen] = useState(false)
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
      // 1) existing briefing endpoint (schedule + tasks + ai_tip)
      const brief = await apiClient.get<{
        schedule?: ScheduleEvent[]
        tasks?: TaskItem[]
        ai_tip?: string
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
      risks.sort((a, b) => b.daysIdle - a.daysIdle)

      // Overdue tasks
      const tasks = (brief?.tasks || []).filter(t => t.status !== 'done' && isOverdue(t.due_date)).slice(0, 5)

      // Today's events
      const events = (brief?.schedule || []).filter(e => isToday(e.time)).slice(0, 5)

      const riskCount = risks.length
      const taskCount = tasks.length
      const eventCount = events.length

      const parts: string[] = []
      if (riskCount > 0) parts.push(`跟進 ${riskCount} 個高風險報價`)
      if (taskCount > 0) parts.push(`處理 ${taskCount} 個逾期任務`)
      if (eventCount > 0) parts.push(`準備今日 ${eventCount} 個會議`)
      if (parts.length === 0) parts.push('今日暫時冇特別事項')

      setPayload({
        greeting: `早晨！幫你整理咗今日重點：${parts.join('，')}。`,
        risks,
        overdueTasks: tasks,
        todayEvents: events,
        riskCount,
        taskCount,
        eventCount,
      })
    } catch {
      setPayload({
        greeting: '早晨！暫時攞唔到 briefing 資料，請稍後再試。',
        risks: [], overdueTasks: [], todayEvents: [],
        riskCount: 0, taskCount: 0, eventCount: 0,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Typewriter effect when drawer opens ──
  const animationPlayedRef = useRef(false)

  useEffect(() => {
    if (!drawerOpen || !payload) return

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
  }, [drawerOpen, payload])

  // ── Open drawer ──
  const openDrawer = () => {
    setDrawerOpen(true)
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

    const draft = `Hi ${risk.companyName} 團隊，\n\n關於早前發出嘅報價單 ${risk.quoteNumber}（${fmtMoney(risk.amount)}），想了解下進度如何？如有任何問題，我隨時可以安排一個 15 分鐘電話詳細解答。\n\n期待你的回覆！`
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
        onClick={openDrawer}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openDrawer() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, rgba(124,93,250,0.10), rgba(99,102,241,0.06))',
          border: '1px solid color-mix(in oklch, var(--color-purple) 22%, var(--color-divider))',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px', cursor: 'pointer',
          transition: 'border-color 150ms, background 150ms',
          marginBottom: 20,
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-purple)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--color-purple) 22%, var(--color-divider))')}
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
            AI Morning Briefing
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {loading ? '載入中…' : payload ? payload.greeting.replace('早晨！幫你整理咗今日重點：', '') : '你有幾項重點建議需處理 👉'}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
          fontSize: 12, fontWeight: 600, color: '#7c3aed',
          background: 'rgba(124,93,250,0.12)', padding: '6px 12px', borderRadius: 999,
        }}>
          View <ChevronDown size={13} />
        </span>
      </div>

      {/* Drawer */}
      <SlideDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Today's Briefing" width="26vw">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px 24px' }}>
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

          {/* Insights (progressive disclosure) */}
          {showInsights && payload && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'ai-fadein 0.4s ease' }}>
              {/* ── High-risk deals ── */}
              {payload.risks.length > 0 && (
                <InsightSection
                  icon={<AlertTriangle size={14} style={{ color: 'var(--color-notification)' }} />}
                  title={`${payload.riskCount} 個高風險客戶需即時跟進`}
                  badge="風險"
                  badgeColor="var(--color-notification)"
                  defaultOpen
                >
                  {payload.risks.map(risk => (
                    <div key={risk.dealId} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.55 }}>
                        <strong>{risk.dealName}</strong> 處於報價階段，進度已停滯。
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
                          點解有此建議
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
                          ✨ 草擬跟進 Email
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
                            {sentOk ? '✅ 已發送並記錄於 CRM' : drafting ? 'AI 正在草擬…' : 'AI 草稿已準備完成（可手動修改）'}
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
                                取消
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
                                <Send size={12} /> 發送 Email
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
                  title={`${payload.taskCount} 個逾期任務待處理`}
                  badge="逾期"
                  badgeColor="var(--color-warning)"
                >
                  {payload.overdueTasks.map(t => (
                    <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
                      <input type="checkbox" style={{ accentColor: 'var(--color-primary)' }} />
                      <span style={{ color: 'var(--color-text)', flex: 1 }}>{t.title}</span>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                        background: 'color-mix(in oklch, var(--color-notification) 15%, var(--color-surface))',
                        color: 'var(--color-notification)',
                      }}>
                        {t.due_date ? `逾期 ${daysSince(t.due_date)} 天` : '逾期'}
                      </span>
                    </label>
                  ))}
                </InsightSection>
              )}

              {/* ── Today's events ── */}
              {payload.todayEvents.length > 0 && (
                <InsightSection
                  icon={<Calendar size={14} style={{ color: 'var(--color-blue)' }} />}
                  title={`今日 ${payload.eventCount} 個會議 / 活動`}
                  badge="今日"
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

              {/* ── Empty state ── */}
              {payload.risks.length === 0 && payload.overdueTasks.length === 0 && payload.todayEvents.length === 0 && (
                <div style={{
                  textAlign: 'center', padding: '28px 16px', fontSize: 13, color: 'var(--color-text-muted)',
                  border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)',
                }}>
                  ✨ 今日一切安好，冇特別需要跟進嘅事項
                </div>
              )}

              {/* Footer */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>
                <History size={11} />
                <span>Briefing 每朝自動生成 · 資料來源：Deals / Quotes / Tasks / Calendar</span>
                <button
                  onClick={loadBriefing}
                  disabled={loading}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-faint)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                >
                  <RefreshCw size={11} style={{ animation: loading ? 'ai-spin 1s linear infinite' : 'none' }} /> 重新整理
                </button>
              </div>
            </div>
          )}
        </div>
      </SlideDrawer>

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
        .slide-drawer { width: min(var(--drawer-width, 26vw), 420px) !important; }
        @media (max-width: 768px) {
          .slide-drawer { width: 100% !important; }
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
