import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import FocusTimer from './FocusTimer'
import CalendarViews from '../modules/projects/CalendarViews/CalendarViews'
import type { CalendarEventFormatted } from '../modules/projects/CalendarViews/types'
import { formatEvents } from '../modules/projects/CalendarViews/types'
import DnDSortableGroup from './DnDSortableGroup'
import QuickAddTouchpoint from './QuickAddTouchpoint'
import QuickAddTask from './QuickAddTask'

interface Task { id: string; title: string; priority: string; status: string; due_date: string | null }
interface Touchpoint {
  id: string; type: string; title: string; description: string | null
  company?: { name: string } | null; contact?: { name: string } | null
  created_at: string
}
interface Deal {
  id: string; name: string; amount: number | null
  stage_id: string; probability: number
  company?: { name: string } | null
}

export default function DashboardPreview() {
  const navigate = useNavigate()
  const [stats, setStats] = useState({ contacts: '—', deals: '—', dealValue: '', tasks: '—', companies: '—' })
  const [tasks, setTasks] = useState<Task[]>([])
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [calEvents, setCalEvents] = useState<CalendarEventFormatted[]>([])
  const [calLoading, setCalLoading] = useState(true)
  const [showNewTp, setShowNewTp] = useState(false)
  const [showNewTask, setShowNewTask] = useState(false)

  // Drag-and-drop order for dashboard cards
  const [topOrder, setTopOrder] = useState<string[]>(['focus', 'tasks', 'touchpoints'])
  const [botOrder, setBotOrder] = useState<string[]>(['activity', 'deals', 'stats'])

  // Load layout from localStorage (fast) then fetch from server
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dash-order-top') || 'null')
      if (saved?.length === 3) setTopOrder(saved)
    } catch {}
    try {
      const saved = JSON.parse(localStorage.getItem('dash-order-bot') || 'null')
      if (saved?.length === 3) setBotOrder(saved)
    } catch {}

    // Fetch from server as authoritative source
    apiClient.get<{ layout: Record<string, string[]> }>('/api/v1/dashboard/layout')
      .then(res => {
        if (res.layout) {
          if (res.layout.top?.length === 3) { setTopOrder(res.layout.top); localStorage.setItem('dash-order-top', JSON.stringify(res.layout.top)) }
          if (res.layout.bot?.length === 3) { setBotOrder(res.layout.bot); localStorage.setItem('dash-order-bot', JSON.stringify(res.layout.bot)) }
        }
      })
      .catch(() => {})
  }, [])

  // Debounced server sync
  const syncLayout = useCallback(async (top: string[], bot: string[]) => {
    try {
      await apiClient.put('/api/v1/dashboard/layout', { layout: { top, bot } })
    } catch {}
  }, [])

  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const handleTopOrder = useCallback((next: string[]) => {
    setTopOrder(next)
    localStorage.setItem('dash-order-top', JSON.stringify(next))
    clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = setTimeout(() => { syncLayout(next, botOrder) }, 500)
  }, [botOrder, syncLayout])

  const handleBotOrder = useCallback((next: string[]) => {
    setBotOrder(next)
    localStorage.setItem('dash-order-bot', JSON.stringify(next))
    clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = setTimeout(() => { syncLayout(topOrder, next) }, 500)
  }, [topOrder, syncLayout])

  const fetchDashboard = async () => {
    setLoading(true)
    setError(null)
    try {
      const [cRes, dRes, tRes, coRes, tpRes] = await Promise.all([
        apiClient.get<{ total: number }>('/api/v1/crm/contacts?page=1&page_size=1'),
        apiClient.get<{ items: Deal[]; total: number }>('/api/v1/crm/deals?page=1&page_size=100'),
        apiClient.get<{ items: Task[]; total: number }>('/api/v1/crm/tasks?page=1&page_size=10'),
        apiClient.get<{ total: number }>('/api/v1/crm/companies?page=1&page_size=1'),
        apiClient.get<{ items: Touchpoint[]; total: number }>('/api/v1/crm/touchpoints?page=1&page_size=10'),
      ])
      const dealsList = dRes.items || []
      const totalVal = dealsList.reduce((s: number, d: Deal) => s + (d.amount || 0), 0)
      const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`
      setStats({
        contacts: String(cRes.total || 0),
        deals: String(dealsList.length),
        dealValue: totalVal ? fmt(totalVal) : '',
        tasks: String(tRes.total || 0),
        companies: String(coRes.total || 0),
      })
      setTasks(tRes.items || [])
      setTouchpoints((tpRes.items || []).slice(0, 5))
      setDeals(dealsList)
    } catch (e: any) {
      setError(e.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchCalendarEvents = async () => {
    setCalLoading(true)
    try {
      const projRes = await apiClient.get<{ items: { id: string }[] }>('/api/v1/crm/projects?page=1&page_size=20')
      const projects = projRes.items || []
      const allEvents: CalendarEventFormatted[] = []
      for (const p of projects) {
        const evRes = await apiClient.get<any[]>(`/api/v1/crm/projects/${p.id}/calendar-events`)
        if (evRes && Array.isArray(evRes)) {
          allEvents.push(...formatEvents(evRes.map((ev: any) => ({ ...ev, project_name: ev.project_name || '' }))))
        }
      }
      setCalEvents(allEvents)
    } catch {
      // No events — empty state is fine
    } finally {
      setCalLoading(false)
    }
  }

  useEffect(() => { fetchDashboard(); fetchCalendarEvents() }, [])

  // Activity data: count touchpoints per day for last 7 days
  const activityData = (() => {
    const days: { label: string; pct: number; active: boolean }[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      const dayStr = d.toISOString().slice(0, 10)
      const count = touchpoints.filter(tp => tp.created_at?.startsWith(dayStr)).length
      const maxCount = Math.max(1, ...touchpoints.map(tp => {
        const tpDay = tp.created_at?.slice(0, 10)
        return tpDay ? touchpoints.filter(x => x.created_at?.startsWith(tpDay)).length : 0
      }))
      days.push({
        label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        pct: maxCount > 0 ? (count / maxCount) * 100 : 0,
        active: i === 0,
      })
    }
    return days
  })()

  // Donut chart data: deals grouped by company
  const dealGroups = (() => {
    const map: Record<string, number> = {}
    deals.forEach(d => {
      const name = d.company?.name || 'Other'
      map[name] = (map[name] || 0) + (d.amount || 0)
    })
    const total = Object.values(map).reduce((s, v) => s + v, 0) || 1
    const colors = ['var(--color-notification)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-blue)', 'var(--color-purple)', 'var(--color-text-faint)']
    let cumPct = 0
    const segments = Object.entries(map).slice(0, 6).map(([name, val], i) => {
      const pct = (val / total) * 100
      const seg = { name, pct: Math.round(pct), color: colors[i % colors.length], start: cumPct, end: cumPct + pct / 100 }
      cumPct += pct / 100
      return seg
    })
    // Cover remaining to 1 full turn
    if (cumPct < 1) segments.push({ name: '', pct: 0, color: 'var(--color-surface-offset)', start: cumPct, end: 1 })
    return { segments, total: Object.keys(map).length, conic: segments.map(s => `${s.color} ${(s.start * 360).toFixed(0)}deg ${(s.end * 360).toFixed(0)}deg`).join(', ') }
  })()

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.floor(hrs / 24)}d`
  }

  if (loading) {
    return (
      <div className="main-content">
        <div className="page-header"><div><h1>Dashboard</h1><p>Loading...</p></div></div>
        <div className="top-row">
          {[1, 2, 3].map(i => <div key={i} className="panel" style={{ height: 200, background: 'var(--color-surface-offset)' }} />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="main-content">
        <div className="page-header"><div><h1>Dashboard</h1></div></div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--color-notification-highlight)', border: '1px solid var(--color-notification)', borderRadius: 'var(--radius-md)', color: 'var(--color-notification)', fontSize: 13 }}>
          <span>{error}</span>
          <button onClick={fetchDashboard} style={{ fontWeight: 600, textDecoration: 'underline', marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="main-content">
      <div className="breadcrumb"><span>Workspace</span><span className="sep" style={{ margin: '0 6px', color: 'var(--color-text-faint)' }}>/</span><span className="current" style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Dashboard</span></div>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div><h1>Dashboard</h1><p>Daily &amp; weekly review of meetings, tasks, and pipeline. <span style={{ color: 'var(--color-text-muted)' }}>{stats.contacts} contacts · {stats.deals} deals · {stats.tasks} tasks</span></p></div>
      </div>

      {/* Top Row */}
      <div className="top-row animate-in">
        <DnDSortableGroup items={topOrder} onChange={handleTopOrder}>
          {(id) => {
            switch (id) {
              case 'focus':
                return (
                  <div className="panel">
                    <FocusTimer />
                  </div>
                )
              case 'tasks':
                return (
                  <div className="panel">
                    <div className="panel-head"><h3>Today's tasks{stats.tasks !== '—' ? <span className="count-chip">{stats.tasks}</span> : null}</h3><span className="link" style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate('/tasks')}>View all →</span></div>
                    <div>
                      {tasks.length === 0 ? (
                        <div style={{ padding: '16px 18px', fontSize: 12, color: 'var(--color-text-faint)' }}>No tasks</div>
                      ) : tasks.slice(0, 5).map(t => (
                        <div key={t.id} className="task-row" onClick={() => navigate(`/tasks/${t.id}`)} style={{cursor:'pointer'}}>
                          <div className="play-mini"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 9-14 9V3z"/></svg></div>
                          <div className="info"><div className="t">{t.title}</div><div className="s">{t.priority} · {t.status}</div></div>
                        </div>
                      ))}
                      {tasks.length > 5 && <div style={{ padding: '10px 18px', fontSize: 11.5, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>+{tasks.length - 5} more</div>}
                      <div className="schedule-cta" style={{ margin: '0 18px 12px' }} onClick={() => setShowNewTask(true)}>+ Add Task</div>
                    </div>
                  </div>
                )
              case 'touchpoints':
                return (
                  <div className="panel">
                    <div className="panel-head"><h3>Touchpoints</h3><span className="link" style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate('/touchpoints')}>View all →</span></div>
                    <div>
                      {touchpoints.length === 0 ? (
                        <div style={{ padding: '16px 18px', fontSize: 12, color: 'var(--color-text-faint)' }}>No recent activity</div>
                      ) : touchpoints.map(tp => (
                        <div key={tp.id} className="meeting-slot" onClick={() => navigate(`/touchpoints/${tp.id}`)} style={{cursor:'pointer'}}>
                          <div className="time"><b>{timeAgo(tp.created_at)}</b>ago</div>
                          <div className="meeting-card">
                            <div className="m-title">{tp.title}</div>
                            <div className="m-sub">{tp.company?.name || ''}{tp.description ? ` · ${tp.description.slice(0, 40)}${tp.description.length > 40 ? '…' : ''}` : ''}</div>
                          </div>
                        </div>
                      ))}
                      <div className="schedule-cta" style={{ margin: '0 18px 12px' }} onClick={() => setShowNewTp(true)}>+ Schedule meeting</div>
                    </div>
                  </div>
                )
              default:
                return null
            }
          }}
        </DnDSortableGroup>
      </div>

      {/* Calendar Panel - uses project CalendarViews */}
      <div className="panel animate-in" style={{ padding: '16px 18px' }}>
        <CalendarViews events={calEvents} loading={calLoading} onRefresh={fetchCalendarEvents} />
      </div>

      {/* Bottom Row */}
      <div className="dash-grid animate-in">
        <DnDSortableGroup items={botOrder} onChange={handleBotOrder}>
          {(id) => {
            switch (id) {
              case 'activity':
                return (
                  <div className="panel activity-panel">
                    <div className="panel-head" style={{ padding: 0, border: 'none', marginBottom: 4 }}><h3>Activity</h3></div>
                    <div className="big-num tabular">{touchpoints.length > 0 ? `${Math.round(activityData.reduce((s, d) => s + d.pct, 0) / Math.max(1, activityData.length))}%` : '—'}</div>
                    <div className="bars">
                      {activityData.map((d, i) => (
                        <div key={i} className="bar-col">
                          <span className="val">{touchpoints.filter(tp => tp.created_at?.startsWith(new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10))).length}</span>
                          <div className={`bar${d.active ? ' active' : ''}`} style={{ height: `${Math.max(4, d.pct)}%` }} />
                          <span className="lbl">{d.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              case 'deals':
                return (
                  <div className="panel">
                    <div className="panel-head"><h3>Deals</h3><span className="delta" style={{ fontSize: 11, background: 'var(--color-success-highlight)', color: 'var(--color-success)', padding: '2px 7px', borderRadius: 'var(--radius-full)', fontWeight: 600 }}>{stats.deals} deals</span></div>
                    <div className="donut-wrap">
                      <div className="donut" style={{ background: `conic-gradient(${dealGroups.conic})` }}>
                        <div className="center"><b>{dealGroups.total}</b><span>deals</span></div>
                      </div>
                      <div className="legend-list">
                        {dealGroups.segments.filter(s => s.name).map((s, i) => (
                          <div key={i} className="row">
                            <span className="sw" style={{ background: s.color }} />
                            <span className="name">{s.name}</span>
                            <span className="pct">{s.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              case 'stats':
                return (
                  <div className="panel">
                    <div className="panel-head"><h3>Quick Stats</h3></div>
                    {[
                      { label: 'Total Contacts', value: stats.contacts, color: 'var(--color-blue)' },
                      { label: 'Companies', value: stats.companies, color: 'var(--color-purple)' },
                      { label: 'Deal Value', value: stats.dealValue || stats.deals, color: 'var(--color-primary)' },
                      { label: 'Open Tasks', value: stats.tasks, color: 'var(--color-warning)' },
                    ].map(s => (
                      <div key={s.label} className="list-row">
                        <div className="list-icon" style={{ color: s.color, background: `color-mix(in oklch, ${s.color} 12%, transparent)` }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        </div>
                        <div className="list-main">
                          <div className="list-title">{s.value}</div>
                          <div className="list-sub">{s.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              default:
                return null
            }
          }}
        </DnDSortableGroup>
      </div>

      <QuickAddTouchpoint open={showNewTp} onClose={() => setShowNewTp(false)} onCreated={fetchDashboard} />
      <QuickAddTask open={showNewTask} onClose={() => setShowNewTask(false)} onCreated={fetchDashboard} />
    </div>
  )
}
