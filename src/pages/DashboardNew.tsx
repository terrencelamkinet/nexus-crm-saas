import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import {
  LayoutDashboard, Users, Building2, TrendingUp, FolderKanban,
  CheckSquare, Truck, UsersRound, Moon, Sun, Bell,
  Search, Plus, Sparkles, X, Minus, Send,
  Activity, DollarSign, Layout, ScanLine,
} from 'lucide-react'

interface Task { id: string; title: string; priority: string; status: string; due_date: string | null }
interface Touchpoint { id: string; type: string; title: string; description: string | null; company?: { name: string } | null; contact?: { name: string } | null; created_at: string }
interface Deal { id: string; name: string; amount: number | null; stage_id: string; probability: number; company?: { name: string } | null }

const navSections = [
  { label: 'Workspace', items: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/contacts', label: 'Contacts', icon: Users },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/deals', label: 'Deals', icon: TrendingUp },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  ]},
  { label: 'Records', items: [
    { to: '/touchpoints', label: 'Touchpoints', icon: Activity },
    { to: '/namecards', label: 'NameCards', icon: ScanLine },
  ]},
  { label: 'Organization', items: [
    { to: '/team', label: 'Team', icon: UsersRound },
  ]},
]

const newItems = [
  { label: 'New Task', icon: CheckSquare, route: '/tasks/new' },
  { label: 'New Contact', icon: Users, route: '/contacts/new' },
  { label: 'New Company', icon: Building2, route: '/companies/new' },
  { label: 'New Deal', icon: TrendingUp, route: '/deals/new' },
  { label: 'New Project', icon: FolderKanban, route: '/projects/new' },
  { label: 'New Shipment', icon: Truck, route: '/shipping/new' },
]

const todayStr = () => {
  const d = new Date()
  const days = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${days[d.getDay()]}`
}

const stages: Record<string, { label: string; color: string }> = {
  qualification: { label: 'Qualification', color: 'var(--color-blue)' },
  proposal: { label: 'Proposal', color: 'var(--color-warning)' },
  negotiation: { label: 'Negotiation', color: 'var(--color-purple)' },
  closed_won: { label: 'Closed Won', color: 'var(--color-success)' },
  closed_lost: { label: 'Closed Lost', color: 'var(--color-text-faint)' },
}
const stageKeys = ['qualification', 'proposal', 'negotiation', 'closed_won']

// Widget defs — matching design01 span-based grid
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
const ORDER_KEY = 'dash01-order'

export default function DashboardNew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [dark, setDark] = useState(() => localStorage.getItem('dash01-theme') === 'dark')
  useEffect(() => {
    const t = dark ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', t)
    localStorage.setItem('dash01-theme', t)
  }, [dark])
  const [aiOn, setAiOn] = useState(false)
  const [editing, setEditing] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsg, setChatMsg] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)
  const [showPicker, setShowPicker] = useState(false)
  const chatBodyRef = useRef<HTMLDivElement>(null)
  const chatOpenedRef = useRef(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  // Drag state
  const dragKey = useRef<string | null>(null)
  // Widget order - persists to localStorage
  const [order, setOrder] = useState<WidgetKey[]>(() => {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY) || 'null') || [...defaultOrder] }
    catch { return [...defaultOrder] }
  })
  const saveOrder = (o: WidgetKey[]) => {
    setOrder(o)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)) } catch {}
  }
  // Data
  const [stats, setStats] = useState({ contacts: 0, deals: 0, dealValue: '', tasks: 0, companies: 0 })
  const [tasks, setTasks] = useState<Task[]>([])
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([])
  const [deals, setDeals] = useState<Deal[]>([])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

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

  const initials = user?.email ? user.email.split('@')[0].split('.').map(s => s[0]).join('').toUpperCase().slice(0, 2) : 'TL'
  const displayName = user?.email?.split('@')[0].replace('.', ' ') || 'Terrence Lam'

  // Add/remove widget
  const addWidget = (k: string) => {
    if (order.includes(k)) return
    saveOrder([...order, k])
    setShowPicker(false)
  }
  const removeW = (k: string) => {
    saveOrder(order.filter(x => x !== k))
  }
  // Move widget (swap on drag over)
  const moveWidget = (from: string, to: string) => {
    const idxFrom = order.indexOf(from)
    const idxTo = order.indexOf(to)
    if (idxFrom < 0 || idxTo < 0) return
    const next = [...order]
    next.splice(idxFrom, 1)
    next.splice(idxTo, 0, from)
    saveOrder(next)
  }

  // ── Chat helpers ──
  const appendMsg = useCallback((role: 'ai' | 'user', html: string) => {
    const body = chatBodyRef.current
    if (!body) return
    const m = document.createElement('div')
    m.className = `msg ${role}`
    m.innerHTML = role === 'ai'
      ? '<div class="msg-avatar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"/></svg></div><div class="msg-bubble">' + html + '</div>'
      : '<div class="msg-avatar" style="background:var(--color-primary)"><span style="font-weight:700;font-size:10px">TL</span></div><div class="msg-bubble">' + html + '</div>'
    body.appendChild(m)
    body.scrollTop = body.scrollHeight
  }, [])
  const showTyping = useCallback(() => {
    const body = chatBodyRef.current
    if (!body) return
    const t = document.createElement('div')
    t.className = 'msg ai'
    t.id = 'chatTyping'
    t.innerHTML = '<div class="msg-avatar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"/></svg></div><div class="msg-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>'
    body.appendChild(t)
    body.scrollTop = body.scrollHeight
  }, [])
  const removeTyping = () => document.getElementById('chatTyping')?.remove()
  const sendInitialReport = useCallback(() => {
    showTyping()
    setTimeout(() => {
      removeTyping()
      appendMsg('ai', `<div class="chat-report">
        <h4><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"/></svg>今日業務摘要</h4>
        <div class="chat-report-section"><div class="label">重點</div><ul>
          <li><b>${stats.deals}個Deal</b>進行中,合共${stats.dealValue}</li>
          <li>本日<b>${stats.tasks}</b>項待辦任務</li>
        </ul></div>
        <div class="chat-report-section"><div class="label">風險</div><ul>
          <li>${tasks.filter(t => t.priority === 'P0').length}件緊急任務需跟進</li>
          <li>${stats.companies}間公司活躍中</li>
        </ul></div>
      </div>`)
      setTimeout(() => {
        appendMsg('ai', '我已經幫你準備好今日重點。想我幫手做啲乜？')
        setSuggestions(['分析呢週Deal轉換率', '邊個客戶最需要關注？', '安排今日跟進事項'])
      }, 500)
    }, 900)
  }, [showTyping, appendMsg, stats, tasks])
  const userSend = useCallback((text: string) => {
    if (!text.trim()) return
    appendMsg('user', text)
    setChatMsg('')
    setSuggestions([])
    showTyping()
    setTimeout(() => {
      removeTyping()
      appendMsg('ai', `已收到:「${text}」。我會根據你嘅CRM數據整理相關資訊並跟進。`)
      setSuggestions(['顯示相關記錄', '安排跟進任務'])
    }, 900)
  }, [appendMsg, showTyping])

  return (
    <div className="dash01-shell" data-theme={dark ? 'dark' : 'light'}>
      <div className="app">
        {/* SIDEBAR — design01 */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <svg viewBox="0 0 32 32" fill="none"><path d="M16 3L27 9V23L16 29L5 23V9L16 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M16 3V15M16 15L27 9M16 15L5 9M16 15V29" stroke="currentColor" strokeWidth="2"/></svg>
            <span>Nexus CRM</span>
          </div>
          <nav className="sidebar-nav">
            {navSections.map(section => (
              <div key={section.label}>
                <p className="nav-section-label">{section.label}</p>
                {section.items.map(item => (
                  <button key={item.to} className={`nav-item${location.pathname === item.to ? ' active' : ''}`}
                    onClick={() => navigate(item.to)}>
                    <item.icon size={18} /><span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
            <button className={`nav-item${location.pathname === '/notifications' ? ' active' : ''}`}
              onClick={() => navigate('/notifications')}>
              <Bell size={18} /><span>Notifications</span>
            </button>
          </nav>
          <div className="sidebar-user">
            <div className="avatar">{initials}</div>
            <div className="info"><strong>{displayName}</strong><span>{user?.email || 'Terrence_PRO'}</span></div>
            <button className="icon-btn" style={{width:28,height:28}} onClick={() => setDark(!dark)} aria-label="Toggle theme">
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <div className="main">
          {/* TOPBAR — design01 */}
          <header className="topbar">
            <div className="topbar-left">
              <h1 className="page-title">Dashboard</h1>
              <div className="ai-toggle">
                <Sparkles size={15} />
                <span>AI 秘書</span>
                <button className={`switch${aiOn ? ' on' : ''}`} role="switch" aria-checked={aiOn}
                  onClick={() => setAiOn(!aiOn)} />
              </div>
            </div>
            <div className="topbar-right">
              <button className="icon-btn" aria-label="Search"><Search size={19} /></button>
              <button className="icon-btn" aria-label="Notifications"><Bell size={19} /></button>
              <div className="new-menu-wrap" ref={newRef}>
                <button className="new-btn" aria-label="Create new" onClick={() => setNewOpen(!newOpen)}>
                  <Plus size={20} />
                </button>
                {newOpen && (
                  <div className="new-dropdown">
                    {newItems.map(item => (
                      <button key={item.label} className="new-dropdown-item" onClick={() => { setNewOpen(false); navigate(item.route) }}>
                        <item.icon size={16} />{item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* CONTENT — design01 main-content exactly */}
          <main className="content">
            <div className="dash-toolbar">
              <div>
                <h1>早晨,Terrence 👋</h1>
                <p>{todayStr()}</p>
              </div>
              <div style={{display:'flex', gap:10}}>
                <button className={`btn ${editing ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setEditing(!editing)}>
                  <Layout size={15} />{editing ? '完成' : '自訂版面'}
                </button>
              </div>
            </div>

            {/* AI Daily Brief */}
            <section className={`ai-brief${aiOn ? ' show' : ''}`}>
              <div className="ai-brief-head">
                <Sparkles size={20} />
                <h2>AI 每日簡報</h2>
                <span>基於即時數據 · 自動更新</span>
              </div>
              <div className="ai-brief-grid">
                <div className="ai-brief-col">
                  <h4>今日重點</h4>
                  <ul>
                    <li>{stats.deals} 個 Deal 進行中,總值 {stats.dealValue}</li>
                    <li>本日 {stats.tasks} 項待辦任務</li>
                  </ul>
                </div>
                <div className="ai-brief-col">
                  <h4>會議準備</h4>
                  <ul>
                    {touchpoints.slice(0, 2).map(tp => (
                      <li key={tp.id}>{tp.title}</li>
                    ))}
                    {touchpoints.length === 0 && <li style={{color:'var(--color-text-muted)'}}>暫無會議</li>}
                  </ul>
                </div>
                <div className="ai-brief-col">
                  <h4>風險提示</h4>
                  <ul>
                    <li>{tasks.filter(t => t.priority === 'P0').length} 件緊急任務需跟進</li>
                    <li>{stats.companies} 間公司活躍中</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* WIDGET GRID — CSS grid, 12-column, span classes */}
            <div className="grid">
              {order.map((k) => {
                const def = allWidgets[k]
                if (!def) return null
                return (
                  <div key={k} className={`widget span-${def.span}${dragKey.current === k ? ' dragging' : ''}`}
                    draggable={editing}
                    onDragStart={() => { if (editing) dragKey.current = k }}
                    onDragOver={(e) => {
                      if (!editing || !dragKey.current || dragKey.current === k) return
                      e.preventDefault()
                      moveWidget(dragKey.current, k)
                    }}
                    onDragEnd={() => { dragKey.current = null }}>
                    <div className="widget-head">
                      <h3>
                        {k.startsWith('kpi_') ? def.label :
                         k === 'tasks' ? <>Today's Tasks <span className="badge" style={{background:'color-mix(in oklch,var(--color-primary)18%,var(--color-surface))',color:'var(--color-primary)'}}>{stats.tasks}</span></> :
                         k === 'touchpoints' ? 'Recent Touchpoints' :
                         k === 'pipeline' ? 'Deal Pipeline' :
                         k === 'dealvalue' ? <><DollarSign size={15} style={{color:'var(--color-text-muted)'}} /> Total Deal Value</> :
                         k === 'aiinsight' ? <><Sparkles size={15} style={{color:'var(--color-purple)'}} /> AI Insight</> :
                         k === 'activity_feed' ? <><Activity size={15} style={{color:'var(--color-text-muted)'}} /> Activity Feed</> :
                         def.label}
                      </h3>
                      {editing && (
                        <div className="widget-actions">
                          <button aria-label="拖曳排序"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg></button>
                          <button aria-label="移除" onClick={(e) => { e.stopPropagation(); removeW(k) }}><X size={14} /></button>
                        </div>
                      )}
                    </div>
                    <div className="widget-body">
                      {k.startsWith('kpi_') && (
                        <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
                          <span className="kpi-val" style={{fontSize:26,color:k==='kpi_contacts'?'var(--color-blue)':k==='kpi_companies'?'var(--color-purple)':k==='kpi_deals'?'var(--color-primary)':'var(--color-warning)'}}>
                            {k==='kpi_contacts'?stats.contacts:k==='kpi_companies'?stats.companies:k==='kpi_deals'?stats.deals:stats.tasks}
                          </span>
                          <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{def.label}</span>
                        </div>
                      )}
                      {k === 'tasks' && (
                        tasks.length === 0
                          ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No tasks</div>
                          : tasks.slice(0,5).map(t => (
                            <div key={t.id} className="list-row" onClick={() => navigate(`/tasks/${t.id}`)} style={{cursor:'pointer'}}>
                              <CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                              <span className="name">{t.title}</span>
                              <span className="badge" style={{
                                background: t.priority==='P0'?'color-mix(in oklch,var(--color-notification)18%,var(--color-surface))':t.priority==='P1'?'color-mix(in oklch,var(--color-warning)18%,var(--color-surface))':'color-mix(in oklch,var(--color-success)18%,var(--color-surface))',
                                color: t.priority==='P0'?'var(--color-notification)':t.priority==='P1'?'var(--color-warning)':'var(--color-success)'
                              }}>{t.priority||'P3'}</span>
                            </div>
                          ))
                      )}
                      {k === 'touchpoints' && (
                        touchpoints.length === 0
                          ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No recent activity</div>
                          : touchpoints.map(tp => (
                            <div key={tp.id} className="list-row" onClick={() => navigate(`/touchpoints/${tp.id}`)} style={{cursor:'pointer'}}>
                              <Activity size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                              <span className="name">{tp.title}</span>
                              <span className="meta">{tp.company?.name||''}</span>
                            </div>
                          ))
                      )}
                      {k === 'pipeline' && pipeline.map(p => (
                        <div key={p.key} className="stage-row">
                          <div className="stage-label">
                            <span>{p.label}</span>
                            <span>{p.count} deals · ${p.total.toLocaleString()}</span>
                          </div>
                          <div className="bar-track">
                            <div className="bar-fill" style={{width:`${(p.total/maxPipelineTotal)*100}%`,background:p.color}} />
                          </div>
                        </div>
                      ))}
                      {k === 'dealvalue' && (
                        <><div className="kpi-val" style={{fontSize:26,color:'var(--color-primary)'}}>{stats.dealValue||'—'}</div>
                        <div className="kpi-delta" style={{color:'var(--color-success)'}}>↑ {deals.filter(d=>d.stage_id==='closed_won').length} closed won</div></>
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
                            ? <div style={{padding:'16px 0',textAlign:'center',fontSize:12,color:'var(--color-text-faint)'}}>No recent activity</div>
                            : <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
                                <thead>
                                  <tr style={{color:'var(--color-text-faint)',fontWeight:600,borderBottom:'1px solid var(--color-divider)'}}>
                                    <th style={{textAlign:'left',padding:'6px 4px'}}>Type</th>
                                    <th style={{textAlign:'left',padding:'6px 4px'}}>Title</th>
                                    <th style={{textAlign:'left',padding:'6px 4px'}}>Company</th>
                                    <th style={{textAlign:'right',padding:'6px 4px'}}>Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {touchpoints.map(tp => (
                                    <tr key={tp.id} style={{borderBottom:'1px solid var(--color-divider)',cursor:'pointer'}} onClick={() => navigate(`/touchpoints/${tp.id}`)}>
                                      <td style={{padding:'8px 4px'}}><span className="badge" style={{background:'color-mix(in oklch,var(--color-primary)14%,var(--color-surface))',color:'var(--color-primary)'}}>{tp.type}</span></td>
                                      <td style={{padding:'8px 4px',fontWeight:500}}>{tp.title}</td>
                                      <td style={{padding:'8px 4px',color:'var(--color-text-muted)'}}>{tp.company?.name||'—'}</td>
                                      <td style={{padding:'8px 4px',textAlign:'right',color:'var(--color-text-faint)'}}>{new Date(tp.created_at).toLocaleDateString()}</td>
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
              {/* Add Widget Tile — design01 pattern */}
              {editing && (
                <div className="add-widget-tile" onClick={() => setShowPicker(!showPicker)}>
                  <Plus size={24} />
                  <span>新增小工具</span>
                </div>
              )}
            </div>

            {/* Widget Picker */}
            {showPicker && (
              <div style={{display:'flex',gap:8,flexWrap:'wrap',padding:'12px 0'}}>
                {Object.entries(allWidgets).filter(([k]) => !order.includes(k)).map(([k, v]) => (
                  <button key={k} onClick={() => addWidget(k)}
                    style={{padding:'8px 14px',borderRadius:'var(--radius-md)',border:'1px solid var(--color-border)',background:'var(--color-surface-offset)',cursor:'pointer',fontSize:13,fontWeight:500,color:'var(--color-text)'}}>
                    + {v.label}
                  </button>
                ))}
                {Object.keys(allWidgets).length === order.length && (
                  <span style={{fontSize:12,color:'var(--color-text-faint)',padding:8}}>All widgets added</span>
                )}
              </div>
            )}

            {aiOn && (
              <div style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:'999px',background:'var(--color-purple-highlight)',color:'var(--color-purple)',fontSize:11.5,fontWeight:700,marginTop:10}}>
                <Sparkles size={12} /> AI 分析已啟用
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Chat FAB */}
      <button className="chat-fab" aria-label="Open AI assistant" onClick={() => {
        setChatOpen(!chatOpen)
        if (!chatOpen && !chatOpenedRef.current) {
          chatOpenedRef.current = true
          setTimeout(() => sendInitialReport(), 400)
        }
      }}>
        <Sparkles size={24} />
        <span className="chat-fab-dot" />
      </button>

      {/* Chat Panel */}
      <section className={`chat-panel${chatOpen ? ' show' : ''}`} aria-label="AI Assistant Chat">
        <div className="chat-head">
          <div className="chat-avatar"><Sparkles size={17} /></div>
          <div className="chat-title"><strong>AI 私人秘書</strong><span>在線</span></div>
          <div className="chat-head-actions">
            <button aria-label="Minimize" onClick={() => setChatOpen(false)}><Minus size={16} /></button>
            <button aria-label="Close" onClick={() => setChatOpen(false)}><X size={16} /></button>
          </div>
        </div>
        <div className="chat-body" ref={chatBodyRef}>
          <div className="msg ai">
            <div className="msg-avatar"><Sparkles size={13} /></div>
            <div className="msg-bubble">早晨! 今日有 {stats.tasks} 項任務和 {stats.deals} 個 Deal 需要跟進。有咩可以幫你？</div>
          </div>
        </div>
        {suggestions.length > 0 && (
          <div className="chat-suggest">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => userSend(s)}>{s}</button>
            ))}
          </div>
        )}
        <div className="chat-input-row">
          <textarea placeholder="問AI任何關於今日業務嘅問題..." value={chatMsg}
            onChange={e => setChatMsg(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); userSend(chatMsg) } }}
            rows={1} />
          <button className="chat-send" aria-label="Send" onClick={() => userSend(chatMsg)}>
            <Send size={16} />
          </button>
        </div>
      </section>
    </div>
  )
}
