import '../styles/dashboard.css'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import {
  LayoutDashboard, Users, Building2, TrendingUp, FolderKanban,
  CheckSquare, Truck, UsersRound, Moon, Sun, Bell,
  Search, Plus, Sparkles, X, Minus, Send,
  Activity, DollarSign, Layout, ScanLine, Calendar,
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
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getMonth() + 1}日${d.getDate()}日 · 星期${days[d.getDay()]}`
}

const stages: Record<string, { label: string; color: string }> = {
  qualification: { label: 'Qualification', color: 'var(--color-blue)' },
  proposal: { label: 'Proposal', color: 'var(--color-warning)' },
  negotiation: { label: 'Negotiation', color: 'var(--color-purple)' },
  closed_won: { label: 'Closed Won', color: 'var(--color-success)' },
  closed_lost: { label: 'Closed Lost', color: 'var(--color-text-faint)' },
}
const stageKeys = ['qualification', 'proposal', 'negotiation', 'closed_won']

// ── ALL 37 design01 WIDGETS + 10 legacy widgets ──
type WidgetKey = string
interface WidgetDef { label: string; span: number }
const allWidgets: Record<string, WidgetDef> = {
  // Legacy (real data) widgets — keep for backward compat
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
  // ── Contacts (icon: Users) ──
  c1: { label: '新增聯絡人', span: 4 },
  c2: { label: '待跟進聯絡人', span: 4 },
  c3: { label: '資料完整度', span: 3 },
  c4: { label: '最近互動', span: 4 },
  c5: { label: '來源分布', span: 3 },
  // ── Companies (icon: Building2) ──
  co1: { label: '公司總數', span: 3 },
  co2: { label: '客戶分級', span: 4 },
  co3: { label: '續約提醒', span: 4 },
  co4: { label: '健康分數', span: 4 },
  co5: { label: '行業分布', span: 3 },
  // ── Deals (icon: TrendingUp) ──
  d1: { label: 'Pipeline 總值', span: 3 },
  d2: { label: '階段分布', span: 6 },
  d3: { label: '停滯提醒', span: 4 },
  d4: { label: '預測達成率', span: 4 },
  d5: { label: '最近成交', span: 4 },
  // ── Projects (icon: FolderKanban) ──
  p1: { label: '進行中數量', span: 3 },
  p2: { label: '里程碑追蹤', span: 4 },
  p3: { label: '進度總覽', span: 6 },
  p4: { label: '資源分配', span: 4 },
  // ── Tasks (icon: CheckSquare) ──
  t1: { label: '今日待辦', span: 4 },
  t2: { label: '逾期任務', span: 4 },
  t3: { label: '優先清單', span: 4 },
  t4: { label: '完成率', span: 3 },
  // ── Calendar (icon: Calendar) ──
  cal1: { label: '未來會議', span: 4 },
  cal2: { label: '會議密度', span: 4 },
  cal3: { label: '拜訪安排', span: 4 },
  // ── Shipping (icon: Truck) ──
  s1: { label: '待處理訂單', span: 4 },
  s2: { label: '延誤警示', span: 4 },
  s3: { label: '狀態分布', span: 4 },
  s4: { label: '路線表現', span: 4 },
  s5: { label: '運費總覽', span: 4 },
  // ── Team (icon: UsersRound) ──
  te1: { label: '工作量分布', span: 4 },
  te2: { label: '在線狀態', span: 3 },
  te3: { label: '目標達成率', span: 4 },
  te4: { label: '排行榜', span: 4 },
  // ── Business (icon: Activity) ──
  b1: { label: '訂閱狀態', span: 4 },
  b2: { label: '系統用量', span: 4 },
}

const defaultOrder: WidgetKey[] = [
  'kpi_contacts', 'kpi_companies', 'kpi_deals', 'kpi_tasks',
  'd2', 't1', 'c2', 'co3', 's1', 'te2', 'cal1', 'activity_feed',
]
const ORDER_KEY = 'dash01-order'

interface ModuleWidget { key: string; name: string; desc: string }
interface ModuleData { id: string; name: string; widgets: ModuleWidget[] }
const modulesData: ModuleData[] = [
  { id: 'contacts', name: 'Contacts', widgets: [
    { key: 'c1', name: '新增聯絡人', desc: '本週新增數量趨勢' },
    { key: 'c2', name: '待跟進聯絡人', desc: '需要行動的清單' },
    { key: 'c3', name: '資料完整度', desc: '聯絡人資料缺漏比率' },
    { key: 'c4', name: '最近互動', desc: '最新5筆互動記錄' },
    { key: 'c5', name: '來源分布', desc: '聯絡人獲取渠道佔比' },
  ]},
  { id: 'companies', name: 'Companies', widgets: [
    { key: 'co1', name: '公司總數', desc: '累計客戶公司數量' },
    { key: 'co2', name: '客戶分級', desc: 'A/B/C級客戶分布' },
    { key: 'co3', name: '續約提醒', desc: '30日內到期合約' },
    { key: 'co4', name: '健康分數', desc: '客戶健康評分排名' },
    { key: 'co5', name: '行業分布', desc: '客戶所屬行業佔比' },
  ]},
  { id: 'deals', name: 'Deals', widgets: [
    { key: 'd1', name: 'Pipeline總值', desc: '進行中Deal總金額' },
    { key: 'd2', name: '階段分布', desc: '各銷售階段Deal數量' },
    { key: 'd3', name: '停滯提醒', desc: '超過14日無更新的Deal' },
    { key: 'd4', name: '預測達成率', desc: '本季目標完成進度' },
    { key: 'd5', name: '最近成交', desc: '本週已成交Deal清單' },
  ]},
  { id: 'projects', name: 'Projects', widgets: [
    { key: 'p1', name: '進行中數量', desc: '目前活躍項目總數' },
    { key: 'p2', name: '里程碑追蹤', desc: '即將到期的里程碑' },
    { key: 'p3', name: '進度總覽', desc: '各項目完成百分比' },
    { key: 'p4', name: '資源分配', desc: '各項目人力分配狀況' },
  ]},
  { id: 'tasks', name: 'Tasks', widgets: [
    { key: 't1', name: '今日待辦', desc: '今天需完成的任務' },
    { key: 't2', name: '逾期任務', desc: '已超過期限未完成' },
    { key: 't3', name: '優先清單', desc: '按重要性排序的任務' },
    { key: 't4', name: '完成率', desc: '本週任務完成百分比' },
  ]},
  { id: 'calendar', name: 'Calendar', widgets: [
    { key: 'cal1', name: '未來會議', desc: '今日及明日會議清單' },
    { key: 'cal2', name: '會議密度', desc: '本週會議時數分布' },
    { key: 'cal3', name: '拜訪安排', desc: '客戶拜訪行程' },
  ]},
  { id: 'shipping', name: 'Shipping', widgets: [
    { key: 's1', name: '待處理訂單', desc: '尚未派單的貨運單' },
    { key: 's2', name: '延誤警示', desc: '超過SLA時限的訂單' },
    { key: 's3', name: '狀態分布', desc: '各運輸狀態訂單佔比' },
    { key: 's4', name: '路線表現', desc: '各航線準時率排名' },
    { key: 's5', name: '運費總覽', desc: '本月運費支出趨勢' },
  ]},
  { id: 'team', name: 'Team', widgets: [
    { key: 'te1', name: '工作量分布', desc: '團隊成員任務負荷' },
    { key: 'te2', name: '在線狀態', desc: '即時團隊在線情況' },
    { key: 'te3', name: '目標達成率', desc: '個人與團隊KPI進度' },
    { key: 'te4', name: '排行榜', desc: '本月表現排名' },
  ]},
  { id: 'business', name: 'Business', widgets: [
    { key: 'b1', name: '訂閱狀態', desc: '帳戶方案與用量' },
    { key: 'b2', name: '系統用量', desc: 'API與儲存使用率' },
  ]},
  { id: 'legacy', name: 'Core Stats', widgets: [
    { key: 'kpi_contacts', name: 'Contacts Count', desc: '總聯絡人數' },
    { key: 'kpi_companies', name: 'Companies Count', desc: '總公司數' },
    { key: 'kpi_deals', name: 'Deal Count', desc: '進行中Deal數量' },
    { key: 'kpi_tasks', name: 'Task Count', desc: '任務總數' },
    { key: 'pipeline', name: 'Deal Pipeline', desc: '各階段Deal分布' },
    { key: 'tasks', name: "Today's Tasks", desc: '今日待辦任務' },
    { key: 'touchpoints', name: 'Recent Touchpoints', desc: '最新互動記錄' },
    { key: 'dealvalue', name: 'Total Deal Value', desc: 'Deal總金額' },
    { key: 'aiinsight', name: 'AI Insight', desc: '智能分析摘要' },
    { key: 'activity_feed', name: 'Activity Feed', desc: '完整活動日誌' },
  ]},
]

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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [widgetSearch, setWidgetSearch] = useState('')
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
    setDrawerOpen(false)
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

  // ── WIDGET BODIES MAP ──
  const widgetBodies: Record<string, () => React.ReactElement> = {
    // ── Legacy widgets (real data) ──
    kpi_contacts: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-blue)'}}>{stats.contacts}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_contacts.label}</span>
      </div>
    ),
    kpi_companies: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-purple)'}}>{stats.companies}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_companies.label}</span>
      </div>
    ),
    kpi_deals: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-primary)'}}>{stats.deals}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_deals.label}</span>
      </div>
    ),
    kpi_tasks: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-warning)'}}>{stats.tasks}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_tasks.label}</span>
      </div>
    ),
    tasks: () => (
      tasks.length === 0
        ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No tasks</div>
        : <>{tasks.slice(0,5).map(t => (
            <div key={t.id} className="list-row" onClick={() => navigate(`/tasks/${t.id}`)} style={{cursor:'pointer'}}>
              <CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} />
              <span className="name">{t.title}</span>
              <span className="badge" style={{
                background: t.priority==='P0'?'color-mix(in oklch,var(--color-notification)18%,var(--color-surface))':t.priority==='P1'?'color-mix(in oklch,var(--color-warning)18%,var(--color-surface))':'color-mix(in oklch,var(--color-success)18%,var(--color-surface))',
                color: t.priority==='P0'?'var(--color-notification)':t.priority==='P1'?'var(--color-warning)':'var(--color-success)'
              }}>{t.priority||'P3'}</span>
            </div>
          ))}</>
    ),
    touchpoints: () => (
      touchpoints.length === 0
        ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No recent activity</div>
        : <>{touchpoints.map(tp => (
            <div key={tp.id} className="list-row" onClick={() => navigate(`/touchpoints/${tp.id}`)} style={{cursor:'pointer'}}>
              <Activity size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} />
              <span className="name">{tp.title}</span>
              <span className="meta">{tp.company?.name||''}</span>
            </div>
          ))}</>
    ),
    pipeline: () => (
      <>{pipeline.map(p => (
        <div key={p.key} className="stage-row">
          <div className="stage-label">
            <span>{p.label}</span>
            <span>{p.count} deals · ${p.total.toLocaleString()}</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{width:`${(p.total/maxPipelineTotal)*100}%`,background:p.color}} />
          </div>
        </div>
      ))}</>
    ),
    dealvalue: () => (
      <><div className="kpi-val" style={{fontSize:26,color:'var(--color-primary)'}}>{stats.dealValue||'—'}</div>
      <div className="kpi-delta" style={{color:'var(--color-success)'}}>↑ {deals.filter(d=>d.stage_id==='closed_won').length} closed won</div></>
    ),
    aiinsight: () => (
      <div style={{fontSize:13,lineHeight:1.5,color:'var(--color-text-muted)'}}>
        <p>• {stats.contacts} contacts active</p>
        <p>• {stats.tasks} tasks pending</p>
        <p>• Pipeline velocity: {deals.length>0?Math.round(deals.filter(d=>d.stage_id==='closed_won').length/Math.max(1,deals.length)*100):0}%</p>
      </div>
    ),
    activity_feed: () => (
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
    ),
    // ── Contacts (demo data) ──
    c1: () => (
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div className="kpi-row">
          <span className="kpi-val" style={{color:'var(--color-blue)'}}>12</span>
          <span className="kpi-delta up" style={{marginLeft:8}}>↑ 23% vs 上週</span>
        </div>
        <div className="list-row"><span className="name">本週新增趨勢</span></div>
        <div className="bar-track" style={{marginTop:4}}><div className="bar-fill" style={{width:'65%',background:'var(--color-blue)'}} /></div>
      </div>
    ),
    c2: () => (
      <><div className="list-row"><CheckSquare size={14} style={{color:'var(--color-warning)',flexShrink:0}} /><span className="name">旭輝空運 — 跟進續約</span><span className="badge warn">重要</span></div>
      <div className="list-row"><CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">深圳華良物流 — 報價回覆</span></div>
      <div className="list-row"><CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">林海珊 — 會議跟進</span></div></>
    ),
    c3: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>完整度</span><span>78%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'78%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>缺漏比率</span><span>22%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'22%',background:'var(--color-warning)'}} /></div></div>
      </div>
    ),
    c4: () => (
      <><div className="list-row"><span className="name">10:30 Deal Review — 林海珊</span><span className="meta">30分前</span></div>
      <div className="list-row"><span className="name">旭輝空運續約會議</span><span className="meta">2小時前</span></div>
      <div className="list-row"><span className="name">物流報價審核</span><span className="meta">昨日</span></div></>
    ),
    c5: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>展會</span><span>42%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'42%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>網絡搜尋</span><span>28%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'28%',background:'var(--color-purple)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>轉介紹</span><span>18%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'18%',background:'var(--color-success)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>社交媒體</span><span>12%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'12%',background:'var(--color-warning)'}} /></div></div>
      </div>
    ),
    // ── Companies (demo data) ──
    co1: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{color:'var(--color-purple)'}}>48</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>累計客戶公司</span>
      </div>
    ),
    co2: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>A級</span><span>12</span></div><div className="bar-track"><div className="bar-fill" style={{width:'25%',background:'var(--color-success)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>B級</span><span>22</span></div><div className="bar-track"><div className="bar-fill" style={{width:'46%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>C級</span><span>14</span></div><div className="bar-track"><div className="bar-fill" style={{width:'29%',background:'var(--color-text-faint)'}} /></div></div>
      </div>
    ),
    co3: () => (
      <><div className="list-row"><span className="name">旭輝空運有限公司</span><span className="badge warn">7日後</span></div>
      <div className="list-row"><span className="name">深圳華良物流集團</span><span className="badge info">21日後</span></div>
      <div className="list-row"><span className="name">深圳一站物流</span><span className="badge info">28日後</span></div></>
    ),
    co4: () => (
      <><div className="list-row"><span className="name">旭輝空運</span><span className="meta">92分</span></div>
      <div className="list-row"><span className="name">深圳華良物流</span><span className="meta">85分</span></div>
      <div className="list-row"><span className="name">深圳絆強物流</span><span className="meta">76分</span></div>
      <div className="list-row"><span className="name">深圳弘安國際</span><span className="meta">63分</span></div></>
    ),
    co5: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>空運物流</span><span>38%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'38%',background:'var(--color-purple)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>海運</span><span>27%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'27%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>陸運</span><span>20%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'20%',background:'var(--color-success)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>倉儲</span><span>15%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'15%',background:'var(--color-warning)'}} /></div></div>
      </div>
    ),
    // ── Deals (demo data) ──
    d1: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{color:'var(--color-primary)'}}>$3.2M</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>進行中Deal總額</span>
      </div>
    ),
    d2: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>洽談中</span><span>$420k</span></div><div className="bar-track"><div className="bar-fill" style={{width:'70%'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>報價</span><span>$310k</span></div><div className="bar-track"><div className="bar-fill" style={{width:'52%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>Negotiation</span><span>$240k</span></div><div className="bar-track"><div className="bar-fill" style={{width:'40%',background:'var(--color-purple)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>成交</span><span>$186k</span></div><div className="bar-track"><div className="bar-fill" style={{width:'30%',background:'var(--color-success)'}} /></div></div>
      </div>
    ),
    d3: () => (
      <><div className="list-row"><span className="name">深圳快豹跨境物流</span><span className="meta">18日無更新</span></div>
      <div className="list-row"><span className="name">深圳一站物流</span><span className="meta">21日無更新</span></div>
      <div className="list-row"><span className="name">深圳華良物流集團</span><span className="meta">16日無更新</span></div></>
    ),
    d4: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="kpi-row" style={{justifyContent:'center',marginTop:8}}>
          <span className="kpi-val" style={{color:'var(--color-primary)'}}>68%</span>
        </div>
        <div className="bar-track" style={{height:12}}><div className="bar-fill" style={{width:'68%',background:'var(--color-primary)'}} /></div>
        <div className="kpi-delta down" style={{textAlign:'center'}}>目標 $4.7M · 已達成 $3.2M</div>
      </div>
    ),
    d5: () => (
      <><div className="list-row"><span className="name">深圳絆強物流 — 首年合約</span><span className="badge ok">$86k</span></div>
      <div className="list-row"><span className="name">旭輝空運 — 擴充服務</span><span className="badge ok">$52k</span></div>
      <div className="list-row"><span className="name">深圳弘安國際 — 續約</span><span className="badge ok">$38k</span></div></>
    ),
    // ── Projects (demo data) ──
    p1: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{color:'var(--color-primary)'}}>6</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>活躍項目</span>
      </div>
    ),
    p2: () => (
      <><div className="list-row"><span className="name">CRM 2.0 — UI Redesign</span><span className="badge warn">3天後</span></div>
      <div className="list-row"><span className="name">物流整合模組</span><span className="badge info">7天後</span></div>
      <div className="list-row"><span className="name">數據分析平台</span><span className="badge info">14天後</span></div></>
    ),
    p3: () => (
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div className="stage-row"><div className="stage-label"><span>CRM 2.0 UI Redesign</span><span>72%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'72%'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>物流整合模組</span><span>45%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'45%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>數據分析平台</span><span>28%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'28%',background:'var(--color-purple)'}} /></div></div>
      </div>
    ),
    p4: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="list-row"><span className="name">林海珊</span><span className="meta">3項目</span></div>
        <div className="list-row"><span className="name">陳偉明</span><span className="meta">2項目</span></div>
        <div className="list-row"><span className="name">張志強</span><span className="meta">2項目</span></div>
        <div className="list-row"><span className="name">李美玲</span><span className="meta">1項目</span></div>
      </div>
    ),
    // ── Tasks (demo data) ──
    t1: () => (
      <><div className="list-row"><CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">跟進旭輝空運續約</span><span className="badge warn">今日</span></div>
      <div className="list-row"><CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">準備客戶簡報</span><span className="badge info">今日</span></div>
      <div className="list-row"><CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">審核物流報價</span><span className="badge ok">已完成</span></div></>
    ),
    t2: () => (
      <><div className="list-row"><span className="name">深圳絆強物流報價</span><span className="badge warn">逾期3天</span></div>
      <div className="list-row"><span className="name">旭輝空運合約審閱</span><span className="badge warn">逾期1天</span></div>
      <div className="list-row"><span className="name">月度報告提交</span><span className="badge warn">逾期5天</span></div></>
    ),
    t3: () => (
      <><div className="list-row"><span className="name">回覆客戶詢價</span><span className="badge warn">高</span></div>
      <div className="list-row"><span className="name">更新CRM資料</span><span className="badge info">中</span></div>
      <div className="list-row"><span className="name">團隊會議記錄</span><span className="badge ok">低</span></div></>
    ),
    t4: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10,alignItems:'center',justifyContent:'center',height:'100%'}}>
        <span className="kpi-val" style={{color:'var(--color-success)'}}>78%</span>
        <div className="bar-track" style={{width:'100%'}}><div className="bar-fill" style={{width:'78%',background:'var(--color-success)'}} /></div>
        <span style={{fontSize:12,color:'var(--color-text-muted)'}}>目標 90% · 落後 12%</span>
      </div>
    ),
    // ── Calendar (demo data) ──
    cal1: () => (
      <><div className="list-row"><Calendar size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">10:30 Deal Review</span><span className="meta">30分</span></div>
      <div className="list-row"><Calendar size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">14:00 客戶續約會議</span><span className="meta">1時</span></div>
      <div className="list-row"><Calendar size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">16:00 團隊週會</span><span className="meta">45分</span></div></>
    ),
    cal2: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>週一</span><span>3h</span></div><div className="bar-track"><div className="bar-fill" style={{width:'60%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>週二</span><span>4.5h</span></div><div className="bar-track"><div className="bar-fill" style={{width:'90%',background:'var(--color-purple)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>週三</span><span>2h</span></div><div className="bar-track"><div className="bar-fill" style={{width:'40%',background:'var(--color-success)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>週四</span><span>1.5h</span></div><div className="bar-track"><div className="bar-fill" style={{width:'30%'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>週五</span><span>3h</span></div><div className="bar-track"><div className="bar-fill" style={{width:'60%',background:'var(--color-warning)'}} /></div></div>
      </div>
    ),
    cal3: () => (
      <><div className="list-row"><span className="name">09:00-12:00 旭輝空運拜訪</span><span className="meta">週四</span></div>
      <div className="list-row"><span className="name">14:00-16:00 深圳華良</span><span className="meta">週五</span></div>
      <div className="list-row"><span className="name">10:00-12:00 弘安國際</span><span className="meta">下週一</span></div></>
    ),
    // ── Shipping (demo data) ──
    s1: () => (
      <><div className="list-row"><Truck size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">深圳絆強物流</span><span className="meta">待派單</span></div>
      <div className="list-row"><Truck size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">深圳弘安國際</span><span className="badge warn">延誤</span></div>
      <div className="list-row"><Truck size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} /><span className="name">深圳兴安通达</span><span className="meta">待派單</span></div></>
    ),
    s2: () => (
      <><div className="list-row"><span className="name">深圳弘安國際 — HKG-SZX</span><span className="badge warn">超48h</span></div>
      <div className="list-row"><span className="name">深圳絆強物流 — HKG-NGB</span><span className="badge warn">超24h</span></div>
      <div className="list-row"><span className="name" style={{color:'var(--color-text-faint)'}}>其他訂單正常</span></div></>
    ),
    s3: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>運送中</span><span>62%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'62%'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>已完成</span><span>28%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'28%',background:'var(--color-success)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>待處理</span><span>10%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'10%',background:'var(--color-warning)'}} /></div></div>
      </div>
    ),
    s4: () => (
      <><div className="list-row"><span className="name">HKG-SZX</span><span className="badge ok">98%</span></div>
      <div className="list-row"><span className="name">HKG-NGB</span><span className="badge ok">92%</span></div>
      <div className="list-row"><span className="name">HKG-PVG</span><span className="badge info">85%</span></div>
      <div className="list-row"><span className="name">HKG-PEK</span><span className="badge warn">74%</span></div></>
    ),
    s5: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="kpi-row" style={{justifyContent:'center'}}>
          <span className="kpi-val" style={{color:'var(--color-primary)',fontSize:22}}>$124.5K</span>
        </div>
        <div className="stage-row"><div className="stage-label"><span>本月預算</span><span>$180K</span></div><div className="bar-track"><div className="bar-fill" style={{width:'69%',background:'var(--color-blue)'}} /></div></div>
        <div className="kpi-delta up">↑ 8% vs 上月</div>
      </div>
    ),
    // ── Team (demo data) ──
    te1: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>林海珊</span><span>120%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'100%',background:'var(--color-warning)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>陳偉明</span><span>85%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'85%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>張志強</span><span>70%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'70%'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>李美玲</span><span>55%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'55%',background:'var(--color-success)'}} /></div></div>
      </div>
    ),
    te2: () => (
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <div className="kpi-row"><span className="kpi-val" style={{fontSize:22}}>4/6</span><span className="kpi-delta up" style={{marginLeft:6}}>在線</span></div>
        <div className="list-row" style={{marginTop:4}}><span className="name">林海珊</span><span className="badge ok">在線</span></div>
        <div className="list-row"><span className="name">陳偉明</span><span className="badge ok">在線</span></div>
        <div className="list-row"><span className="name">張志強</span><span className="meta">離開</span></div>
        <div className="list-row"><span className="name">李美玲</span><span className="badge ok">在線</span></div>
      </div>
    ),
    te3: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>團隊平均</span><span>78%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'78%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>林海珊</span><span>92%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'92%',background:'var(--color-success)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>陳偉明</span><span>76%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'76%'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>張志強</span><span>65%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'65%',background:'var(--color-warning)'}} /></div></div>
      </div>
    ),
    te4: () => (
      <><div className="list-row"><span className="name">🥇 林海珊</span><span className="meta">$186K</span></div>
      <div className="list-row"><span className="name">🥈 陳偉明</span><span className="meta">$142K</span></div>
      <div className="list-row"><span className="name">🥉 張志強</span><span className="meta">$98K</span></div>
      <div className="list-row"><span className="name">李美玲</span><span className="meta">$67K</span></div></>
    ),
    // ── Business (demo data) ──
    b1: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="list-row"><span className="name">方案</span><span className="badge info">Professional</span></div>
        <div className="list-row"><span className="name">狀態</span><span className="badge ok">活躍中</span></div>
        <div className="list-row"><span className="name">到期日</span><span className="meta">2026-12-31</span></div>
        <div className="list-row"><span className="name">用量</span><span className="meta">67%</span></div>
      </div>
    ),
    b2: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="stage-row"><div className="stage-label"><span>API 使用率</span><span>45%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'45%',background:'var(--color-blue)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>儲存使用率</span><span>32%</span></div><div className="bar-track"><div className="bar-fill" style={{width:'32%',background:'var(--color-success)'}} /></div></div>
        <div className="stage-row"><div className="stage-label"><span>用戶數</span><span>12/20</span></div><div className="bar-track"><div className="bar-fill" style={{width:'60%'}} /></div></div>
      </div>
    ),
  }

  // Widget icon helper
  const widgetIcon = (k: string) => {
    if (k.startsWith('kpi_') || k === 'pipeline' || k.startsWith('d')) return TrendingUp
    if (k.startsWith('c')) return Users
    if (k.startsWith('co')) return Building2
    if (k.startsWith('p')) return FolderKanban
    if (k === 'tasks' || k.startsWith('t')) return CheckSquare
    if (k.startsWith('cal')) return Calendar
    if (k.startsWith('s')) return Truck
    if (k.startsWith('te')) return UsersRound
    if (k.startsWith('b')) return Activity
    if (k === 'touchpoints') return Activity
    if (k === 'dealvalue') return DollarSign
    if (k === 'aiinsight') return Sparkles
    if (k === 'activity_feed') return Activity
    return LayoutDashboard
  }

  const iconColor = (k: string) => {
    if (k.startsWith('c')) return 'var(--color-blue)'
    if (k.startsWith('co')) return 'var(--color-purple)'
    if (k.startsWith('d')) return 'var(--color-primary)'
    if (k.startsWith('p')) return 'var(--color-warning)'
    if (k === 'tasks' || k.startsWith('t')) return 'var(--color-success)'
    if (k.startsWith('cal')) return 'var(--color-blue)'
    if (k.startsWith('s')) return 'var(--color-primary)'
    if (k.startsWith('te')) return 'var(--color-purple)'
    if (k.startsWith('b')) return 'var(--color-warning)'
    return 'var(--color-text-muted)'
  }

  return (
    <div className={`dash01-shell${editing ? ' editing' : ''}`} data-theme={dark ? 'dark' : 'light'}>
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
                const IconComp = widgetIcon(k)
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
                        <IconComp size={15} style={{color: iconColor(k)}} />
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
                      {widgetBodies[k] ? widgetBodies[k]() : (
                        <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No content</div>
                      )}
                    </div>
                    {(k === 'c1' || k === 'co3' || k === 'd3' || k === 't2' || k === 's2' || k === 'te1') && aiOn && (
                      <button className="ai-tag" style={{display:'inline-flex',marginTop:8}}
                        onClick={() => {
                          setChatOpen(true)
                          if (!chatOpenedRef.current) {
                            chatOpenedRef.current = true
                            setTimeout(() => sendInitialReport(), 400)
                          }
                        }}>
                        <Sparkles size={12} />AI advise
                      </button>
                    )}
                  </div>
                )
              })}
              {/* Add Widget Tile — opens drawer */}
              {editing && (
                <div className="add-widget-tile" onClick={() => setDrawerOpen(true)}>
                  <Plus size={24} />
                  <span>新增小工具</span>
                </div>
              )}
            </div>

            {aiOn && (
              <div className="ai-tag" style={{display:'inline-flex',alignSelf:'flex-start',marginTop:10}}>
                <Sparkles size={12} /> AI 分析已啟用
              </div>
            )}
          </main>
        </div>
      </div>

      {/* ── DRAWER (Widget Picker) — outside .content to avoid overflow clip ── */}
      <div className={`drawer-overlay${drawerOpen ? ' show' : ''}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer${drawerOpen ? ' show' : ''}`}>
        <div className="drawer-head">
          <h3>新增小工具</h3>
          <button className="icon-btn" onClick={() => setDrawerOpen(false)}><X size={19} /></button>
        </div>
        <div className="drawer-search">
          <input type="text" placeholder="搜尋小工具..." value={widgetSearch}
            onChange={e => setWidgetSearch(e.target.value)} />
        </div>
        <div className="drawer-body">
          {modulesData.filter(mod => {
            if (!widgetSearch) return true
            const q = widgetSearch.toLowerCase()
            return mod.widgets.some(w => w.name.includes(q) || w.desc.includes(q))
          }).map(mod => {
            const visible = widgetSearch
              ? mod.widgets.filter(w => w.name.includes(widgetSearch.toLowerCase()) || w.desc.includes(widgetSearch.toLowerCase()))
              : mod.widgets
            if (widgetSearch && visible.length === 0) return null
            return (
              <div key={mod.id} className="module-group">
                <div className="module-group-head"><span>{mod.name}</span></div>
                {visible.filter(w => !order.includes(w.key)).map(w => {
                  const IconComp = widgetIcon(w.key)
                  return (
                    <div key={w.key} className="widget-option" onClick={() => {
                      addWidget(w.key)
                      setWidgetSearch('')
                    }}>
                      <div className="wo-icon"><IconComp size={15} /></div>
                      <div className="wo-text"><strong>{w.name}</strong><span>{w.desc}</span></div>
                      <div className="wo-add"><Plus size={14} /></div>
                    </div>
                  )
                })}
                {visible.filter(w => order.includes(w.key)).length > 0 && (
                  <div style={{padding:'4px 8px',fontSize:11.5,color:'var(--color-text-faint)'}}>
                    {visible.filter(w => order.includes(w.key)).map(w => w.name).join('、')} — 已新增
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>
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
