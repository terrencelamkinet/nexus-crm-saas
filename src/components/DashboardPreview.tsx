import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { CheckSquare, Activity, Sparkles, X, Plus } from 'lucide-react'

interface Task { id: string; title: string; priority: string; status: string; due_date: string | null }
interface Touchpoint { id: string; type: string; title: string; description: string | null; company?: { name: string } | null; contact?: { name: string } | null; created_at: string }
interface Deal { id: string; name: string; amount: number | null; stage_id: string; probability: number; company?: { name: string } | null }

const stages: Record<string, { label: string; color: string }> = {
  qualification: { label: 'Qualification', color: 'var(--color-blue)' },
  proposal: { label: 'Proposal', color: 'var(--color-warning)' },
  negotiation: { label: 'Negotiation', color: 'var(--color-purple)' },
  closed_won: { label: 'Closed Won', color: 'var(--color-success)' },
  closed_lost: { label: 'Closed Lost', color: 'var(--color-text-faint)' },
}
const stageKeys = ['qualification', 'proposal', 'negotiation', 'closed_won']

const todayStr = () => {
  const d = new Date()
  const days = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${days[d.getDay()]}`
}

// Widget definitions — span-based CSS grid (design01)
type WidgetKey = string
interface WidgetDef { label: string; span: number }
const allWidgets: Record<string, WidgetDef> = {
  kpi_contacts: { label: 'Contacts', span: 3 },
  kpi_companies: { label: 'Companies', span: 3 },
  kpi_deals: { label: 'Deal Count', span: 3 },
  kpi_tasks: { label: 'Tasks', span: 3 },
  pipeline: { label: 'Deal Pipeline', span: 8 },
  tasks: { label: "Today's Tasks", span: 4 },
  touchpoints: { label: 'Recent Touchpoints', span: 4 },
  dealvalue: { label: 'Total Deal Value', span: 4 },
  aiinsight: { label: 'AI Insight', span: 4 },
  activity_feed: { label: 'Activity Feed', span: 12 },
}
const defaultOrder: WidgetKey[] = [
  'kpi_contacts', 'kpi_companies', 'kpi_deals', 'kpi_tasks',
  'pipeline', 'tasks',
  'touchpoints', 'dealvalue', 'aiinsight',
  'activity_feed',
]
const ORDER_KEY = 'dash-preview-order'

export default function DashboardPreview() {
  const navigate = useNavigate()
  const [stats, setStats] = useState({ contacts: 0, deals: 0, dealValue: '', tasks: 0, companies: 0 })
  const [tasks, setTasks] = useState<Task[]>([])
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [editing, setEditing] = useState(false)
  const [aiOn, setAiOn] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  // Widget order — persists to localStorage
  const [order, setOrder] = useState<WidgetKey[]>(() => {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY) || 'null') || [...defaultOrder] }
    catch { return [...defaultOrder] }
  })
  const saveOrder = (o: WidgetKey[]) => {
    setOrder(o)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)) } catch {}
  }

  // Drag state
  const dragKey = useRef<string | null>(null)

  // Data fetching
  const fetchData = useCallback(async () => {
    try {
      const [cRes, coRes, dRes, tRes, tpRes] = await Promise.all([
        apiClient.get<{ total: number }>('/api/v1/crm/contacts?page=1&page_size=1'),
        apiClient.get<{ total: number }>('/api/v1/crm/companies?page=1&page_size=1'),
        apiClient.get<{ items: Deal[]; total: number }>('/api/v1/crm/deals?page=1&page_size=100'),
        apiClient.get<{ items: Task[]; total: number }>('/api/v1/crm/tasks?page=1&page_size=10'),
        apiClient.get<{ items: Touchpoint[]; total: number }>('/api/v1/crm/touchpoints?page=1&page_size=10'),
      ])
      const dealsList = dRes.items || []
      const totalVal = dealsList.reduce((s: number, d: Deal) => s + (d.amount || 0), 0)
      const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`
      setStats({
        contacts: cRes.total || 0, deals: dealsList.length,
        dealValue: totalVal ? fmt(totalVal) : '—', tasks: tRes.total || 0, companies: coRes.total || 0,
      })
      setTasks(tRes.items || [])
      setTouchpoints((tpRes.items || []).slice(0, 5))
      setDeals(dealsList)
    } catch { /* silent */ }
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  const pipeline = stageKeys.map(k => {
    const items = deals.filter(d => d.stage_id === k)
    return {
      key: k, label: stages[k]?.label || k, count: items.length,
      total: items.reduce((s, d) => s + (d.amount || 0), 0),
      color: stages[k]?.color || 'var(--color-primary)',
    }
  })
  const maxPipelineTotal = Math.max(1, ...pipeline.map(p => p.total))

  // Widget actions
  const addWidget = (k: string) => {
    if (order.includes(k)) return
    saveOrder([...order, k])
    setShowPicker(false)
  }
  const removeW = (k: string) => saveOrder(order.filter(x => x !== k))
  const moveW = (from: string, to: string) => {
    const a = order.indexOf(from), b = order.indexOf(to)
    if (a < 0 || b < 0) return
    const next = [...order]
    next.splice(a, 1)
    next.splice(b, 0, from)
    saveOrder(next)
  }

  return (
    <div className="dash-content">
      {/* Toolbar — design01 .dash-toolbar pattern */}
      <div className="dash-toolbar">
        <div>
          <h1>早晨,Terrence 👋</h1>
          <p>{todayStr()}</p>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center'}}>
          {/* AI toggle inline */}
          <div className="ai-toggle-inline">
            <Sparkles size={15} />
            <span>AI</span>
            <button className={`switcher${aiOn ? ' on' : ''}`} onClick={() => setAiOn(!aiOn)} />
          </div>
          <button className={`dash-btn${editing ? ' primary' : ''}`} onClick={() => setEditing(!editing)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 21V9"/></svg>
            {editing ? '完成' : '自訂版面'}
          </button>
        </div>
      </div>

      {/* AI Brief */}
      {aiOn && (
        <section className="ai-brief-card">
          <div className="brief-head">
            <Sparkles size={20} />
            <h2>AI 每日簡報</h2>
            <span>基於即時數據 · 自動更新</span>
          </div>
          <div className="brief-grid">
            <div>
              <h4>今日重點</h4>
              <ul>
                <li>{stats.deals} 個 Deal 進行中,總值 {stats.dealValue}</li>
                <li>本日 {stats.tasks} 項待辦任務</li>
              </ul>
            </div>
            <div>
              <h4>會議準備</h4>
              <ul>
                {touchpoints.slice(0,2).map(tp => <li key={tp.id}>{tp.title}</li>)}
                {touchpoints.length === 0 && <li className="muted">暫無會議</li>}
              </ul>
            </div>
            <div>
              <h4>風險提示</h4>
              <ul>
                <li>{tasks.filter(t=>t.priority==='P0').length} 件緊急任務需跟進</li>
                <li>{stats.companies} 間公司活躍中</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Widget Grid — 12-column CSS grid */}
      <div className="dash-grid">
        {order.map(k => {
          const def = allWidgets[k]
          if (!def) return null
          return (
            <div key={k} className={`dash-widget span-${def.span}${editing && dragKey.current === k ? ' dragging' : ''}`}
              draggable={editing}
              onDragStart={() => { if (editing) dragKey.current = k }}
              onDragOver={e => {
                if (!editing || !dragKey.current || dragKey.current === k) return
                e.preventDefault()
                moveW(dragKey.current, k)
              }}
              onDragEnd={() => { dragKey.current = null }}>
              <div className="w-head">
                <h3>
                  {k.startsWith('kpi_') ? def.label :
                   k === 'tasks' ? <>Today's Tasks <span className="dash-badge" style={{background:'color-mix(in oklch,var(--color-primary)18%,var(--color-surface))',color:'var(--color-primary)'}}>{stats.tasks}</span></> :
                   k === 'touchpoints' ? 'Recent Touchpoints' :
                   k === 'pipeline' ? 'Deal Pipeline' :
                   k === 'dealvalue' ? 'Total Deal Value' :
                   k === 'aiinsight' ? 'AI Insight' :
                   k === 'activity_feed' ? 'Activity Feed' : def.label}
                </h3>
                {editing && (
                  <div className="w-actions">
                    <button className="w-action" title="拖曳"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg></button>
                    <button className="w-action" title="移除" onClick={e => { e.stopPropagation(); removeW(k) }}><X size={14} /></button>
                  </div>
                )}
              </div>
              <div className="w-body">
                {k.startsWith('kpi_') && (
                  <div className="kpi-center">
                    <span className="kpi-val" style={{color:k==='kpi_contacts'?'var(--color-blue)':k==='kpi_companies'?'var(--color-purple)':k==='kpi_deals'?'var(--color-primary)':'var(--color-warning)'}}>
                      {k==='kpi_contacts'?stats.contacts:k==='kpi_companies'?stats.companies:k==='kpi_deals'?stats.deals:stats.tasks}
                    </span>
                    <span className="kpi-lbl">{def.label}</span>
                  </div>
                )}
                {k === 'tasks' && (tasks.length === 0
                  ? <div className="empty">No tasks</div>
                  : tasks.slice(0,5).map(t => (
                    <div key={t.id} className="dash-row" onClick={() => navigate(`/tasks/${t.id}`)}>
                      <CheckSquare size={14} className="row-icon" />
                      <span className="row-name">{t.title}</span>
                      <span className="dash-badge" style={{
                        background: t.priority==='P0'?'color-mix(in oklch,var(--color-notification)18%,var(--color-surface))':t.priority==='P1'?'color-mix(in oklch,var(--color-warning)18%,var(--color-surface))':'color-mix(in oklch,var(--color-success)18%,var(--color-surface))',
                        color: t.priority==='P0'?'var(--color-notification)':t.priority==='P1'?'var(--color-warning)':'var(--color-success)'
                      }}>{t.priority||'P3'}</span>
                    </div>
                  ))
                )}
                {k === 'touchpoints' && (touchpoints.length === 0
                  ? <div className="empty">No recent activity</div>
                  : touchpoints.map(tp => (
                    <div key={tp.id} className="dash-row" onClick={() => navigate(`/touchpoints/${tp.id}`)}>
                      <Activity size={14} className="row-icon" />
                      <span className="row-name">{tp.title}</span>
                      <span className="row-meta">{tp.company?.name||''}</span>
                    </div>
                  ))
                )}
                {k === 'pipeline' && pipeline.map(p => (
                  <div key={p.key} className="stage-row">
                    <div className="stage-labels">
                      <span>{p.label}</span>
                      <span>{p.count} deals · ${p.total.toLocaleString()}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{width:`${(p.total/maxPipelineTotal)*100}%`,background:p.color}} />
                    </div>
                  </div>
                ))}
                {k === 'dealvalue' && (
                  <><div className="kpi-val" style={{color:'var(--color-primary)'}}>{stats.dealValue||'—'}</div>
                  <div className="kpi-delta up">↑ {deals.filter(d=>d.stage_id==='closed_won').length} closed won</div></>
                )}
                {k === 'aiinsight' && (
                  <div style={{fontSize:13,lineHeight:1.5,color:'var(--color-text-muted)'}}>
                    <p>• {stats.contacts} contacts active</p>
                    <p>• {stats.tasks} tasks pending</p>
                    <p>• Pipeline velocity: {deals.length>0?Math.round(deals.filter(d=>d.stage_id==='closed_won').length/Math.max(1,deals.length)*100):0}%</p>
                  </div>
                )}
                {k === 'activity_feed' && (
                  <div style={{fontSize:13}}>
                    {touchpoints.length === 0
                      ? <div className="empty">No recent activity</div>
                      : <table className="feed-table">
                          <thead>
                            <tr><th>Type</th><th>Title</th><th>Company</th><th>Date</th></tr>
                          </thead>
                          <tbody>
                            {touchpoints.map(tp => (
                              <tr key={tp.id} onClick={() => navigate(`/touchpoints/${tp.id}`)}>
                                <td><span className="dash-badge" style={{background:'color-mix(in oklch,var(--color-primary)14%,var(--color-surface))',color:'var(--color-primary)'}}>{tp.type}</span></td>
                                <td className="td-name">{tp.title}</td>
                                <td className="td-muted">{tp.company?.name||'—'}</td>
                                <td className="td-date">{new Date(tp.created_at).toLocaleDateString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                    }
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {/* Add widget tile */}
        {editing && (
          <div className="dash-add-tile" onClick={() => setShowPicker(!showPicker)}>
            <Plus size={24} />
            <span>新增小工具</span>
          </div>
        )}
      </div>

      {/* Widget picker */}
      {showPicker && (
        <div className="picker-bar">
          {Object.entries(allWidgets).filter(([k]) => !order.includes(k)).map(([k, v]) => (
            <button key={k} className="picker-btn" onClick={() => addWidget(k)}>+ {v.label}</button>
          ))}
          {Object.keys(allWidgets).length === order.length && <span className="picker-done">All widgets added</span>}
        </div>
      )}
    </div>
  )
}
