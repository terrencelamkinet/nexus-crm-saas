import '../styles/dashboard.css'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import {
  LayoutDashboard, Users, Building2, TrendingUp, FolderKanban,
  CheckSquare, Truck, UsersRound,
  Plus, Sparkles, X, Minus, Send,
  Activity, DollarSign, Layout, Calendar,
} from 'lucide-react'
import SlideDrawer from '../components/SlideDrawer'

interface Task { id: string; title: string; priority: string; status: string; due_date: string | null; area?: string; custom_fields?: Record<string, any> }
interface Company { id: string; name: string; category?: string; industry?: string }
interface Touchpoint { id: string; type: string; title: string; description: string | null; company?: { name: string } | null; contact?: { name: string } | null; created_at: string }
interface Deal { id: string; name: string; amount: number | null; stage_id: string; probability: number; company?: { name: string } | null }
interface Contact { id: string; name: string; email: string | null; phone: string | null; position: string | null; company?: { name: string } | null }

// ── Demo data fallbacks ──
const demoContacts: Contact[] = [
  { id: 'demo-cont-1', name: 'David Chen', email: 'david@example.com', phone: '+852 9876 5432', position: 'CEO', company: { name: 'TechCorp' } },
  { id: 'demo-cont-2', name: 'Sarah Wong', email: 'sarah@example.com', phone: '+852 9123 4567', position: 'CTO', company: { name: 'Innovate Ltd' } },
  { id: 'demo-cont-3', name: 'Michael Lau', email: 'michael@example.com', phone: '+852 9000 1111', position: 'VP Sales', company: { name: 'Growth Inc' } },
]
const demoTasks: Task[] = [
  { id: 'demo-t-1', title: 'Follow up with TechCorp proposal', priority: 'P0', status: 'pending', due_date: new Date().toISOString(), area: '💼 Work' },
  { id: 'demo-t-2', title: 'Review Q3 pipeline report', priority: 'P1', status: 'in_progress', due_date: new Date().toISOString(), area: '💼 Work' },
  { id: 'demo-t-3', title: 'Prepare client presentation', priority: 'P1', status: 'pending', due_date: new Date(Date.now() + 86400000).toISOString(), area: '💼 Work' },
  { id: 'demo-t-4', title: 'Update CRM contact records', priority: 'P2', status: 'pending', due_date: null, area: '📚 Learning' },
  { id: 'demo-t-5', title: 'Schedule team sync meeting', priority: 'P2', status: 'done', due_date: new Date().toISOString(), area: '💼 Work' },
]
const demoDeals: Deal[] = [
  { id: 'demo-d-1', name: 'TechCorp Enterprise Plan', amount: 120000, stage_id: 'negotiation', probability: 70, company: { name: 'TechCorp' } },
  { id: 'demo-d-2', name: 'Innovate Ltd Platform', amount: 85000, stage_id: 'proposal', probability: 50, company: { name: 'Innovate Ltd' } },
  { id: 'demo-d-3', name: 'Growth Inc SaaS', amount: 45000, stage_id: 'qualification', probability: 30, company: { name: 'Growth Inc' } },
  { id: 'demo-d-4', name: 'DataSync Solutions', amount: 200000, stage_id: 'negotiation', probability: 60, company: { name: 'DataSync' } },
  { id: 'demo-d-5', name: 'CloudBase Migration', amount: 95000, stage_id: 'closed_won', probability: 100, company: { name: 'CloudBase' } },
]
const demoTPs: Touchpoint[] = [
  { id: 'demo-tp-1', type: 'meeting', title: 'Q3 Review with TechCorp', description: 'Discussed quarterly performance', company: { name: 'TechCorp' }, contact: { name: 'David Chen' }, created_at: new Date().toISOString() },
  { id: 'demo-tp-2', type: 'call', title: 'Discovery Call - Innovate Ltd', description: 'Initial product demo', company: { name: 'Innovate Ltd' }, contact: { name: 'Sarah Wong' }, created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'demo-tp-3', type: 'email', title: 'Proposal sent to Growth Inc', description: 'Sent enterprise proposal', company: { name: 'Growth Inc' }, contact: { name: 'Michael Lau' }, created_at: new Date(Date.now() - 172800000).toISOString() },
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
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const aiOn = modules['ai_assistant'] === true
  const [editing, setEditing] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsg, setChatMsg] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showCompanyDrawer, setShowCompanyDrawer] = useState(false)
  const [widgetSearch, setWidgetSearch] = useState('')
  const chatBodyRef = useRef<HTMLDivElement>(null)
  const chatOpenedRef = useRef(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  // Drag state
  const dragKey = useRef<string | null>(null)
  const dragPending = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
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
  const [companyList, setCompanyList] = useState<Company[]>([])
  const [projectsTotal, setProjectsTotal] = useState(0)
  const [projects, setProjects] = useState<any[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])

  // ── Drawer state ──
  const [detailDrawer, setDetailDrawer] = useState(false)
  const [drawerTitle, setDrawerTitle] = useState('')
  const [drawerContent, setDrawerContent] = useState<React.ReactNode>(null)
  const openDrawer = (title: string, content: React.ReactNode) => {
    setDrawerTitle(title)
    setDrawerContent(content)
    setDetailDrawer(true)
  }

  useEffect(() => {
    const h = (e: MouseEvent) => { if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const [cRes, coRes, dRes, tRes, tpRes, coListRes, pRes, contRes] = await Promise.all([
        apiClient.get<{ total: number }>('/api/v1/crm/contacts?page=1&page_size=1'),
        apiClient.get<{ total: number }>('/api/v1/crm/companies?page=1&page_size=1'),
        apiClient.get<{ items: Deal[]; total: number }>('/api/v1/crm/deals?page=1&page_size=100'),
        apiClient.get<{ items: Task[]; total: number }>('/api/v1/crm/tasks?limit=10'),
        apiClient.get<{ items: Touchpoint[]; total: number }>('/api/v1/crm/touchpoints?page=1&page_size=10'),
        apiClient.get<{ items: Company[]; total: number }>('/api/v1/crm/companies?limit=50'),
        apiClient.get<{ items: any[]; total: number }>('/api/v1/crm/projects?limit=50').catch(() => ({ items: [], total: 0 })),
        apiClient.get<{ items: Contact[]; total: number }>('/api/v1/crm/contacts?page=1&page_size=10').catch(() => ({ items: [], total: 0 })),
      ])
      const dealsList = dRes.items || demoDeals
      const totalVal = dealsList.reduce((s: number, d: Deal) => s + (d.amount || 0), 0)
      const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`
      setStats({
        contacts: cRes.total || demoContacts.length, deals: dealsList.length,
        dealValue: totalVal ? fmt(totalVal) : '$545K', tasks: tRes.total || demoTasks.length, companies: coRes.total || demoContacts.length,
      })
      setTasks(tRes.items?.length ? tRes.items : demoTasks)
      setTouchpoints((tpRes.items?.length ? tpRes.items : demoTPs).slice(0, 5))
      setDeals(dealsList)
      setCompanyList(coListRes.items || [])
      setProjectsTotal(pRes.total || 0)
      setProjects(pRes.items || [])
      setContacts(contRes.items?.length ? contRes.items : demoContacts)
    } catch {
      // Fallback to demo data
      setStats({ contacts: 3, deals: 5, dealValue: '$545K', tasks: 5, companies: 3 })
      setTasks(demoTasks)
      setTouchpoints(demoTPs.slice(0, 5))
      setDeals(demoDeals)
      setContacts(demoContacts)
    }
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  // Load modules — read ai_assistant setting
  const fetchModules = useCallback(async () => {
    try {
      const list: any[] = await apiClient.get('/api/v1/crm/module-settings')
      const map: Record<string, boolean> = {}
      ;(list || []).forEach((m: any) => { map[m.module_key] = m.enabled })
      setModules(map)
    } catch {}
  }, [])
  useEffect(() => {
    fetchModules()
    const handler = () => fetchModules()
    window.addEventListener('modules-changed', handler)
    return () => window.removeEventListener('modules-changed', handler)
  }, [fetchModules])

  // ── Build Detail Functions ──
  const buildTaskDetail = (task: Task) => (
    <div style={{padding:4,fontSize:13.5,lineHeight:1.6}}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>{task.title}</div>
      <div className="stage-row"><span style={{fontWeight:600}}>Priority</span><span className={`badge ${task.priority==='P0'?'warn':task.priority==='P1'?'':'ok'}`}>{task.priority||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Status</span><span>{task.status||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Due Date</span><span>{task.due_date ? new Date(task.due_date).toLocaleDateString() : '—'}</span></div>
      {task.area && <div className="stage-row"><span style={{fontWeight:600}}>Area</span><span>{task.area}</span></div>}
    </div>
  )
  const buildDealDetail = (deal: Deal) => (
    <div style={{padding:4,fontSize:13.5,lineHeight:1.6}}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>{deal.name}</div>
      <div className="stage-row"><span style={{fontWeight:600}}>Amount</span><span>${deal.amount?.toLocaleString()||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Stage</span><span style={{color:stages[deal.stage_id]?.color||'inherit'}}>{stages[deal.stage_id]?.label||deal.stage_id}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Probability</span><span>{deal.probability}%</span></div>
      {deal.company?.name && <div className="stage-row"><span style={{fontWeight:600}}>Company</span><span>{deal.company.name}</span></div>}
    </div>
  )
  const buildContactDetail = (contact: Contact) => (
    <div style={{padding:4,fontSize:13.5,lineHeight:1.6}}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>{contact.name}</div>
      <div className="stage-row"><span style={{fontWeight:600}}>Email</span><span>{contact.email||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Phone</span><span>{contact.phone||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Position</span><span>{contact.position||'—'}</span></div>
      {contact.company?.name && <div className="stage-row"><span style={{fontWeight:600}}>Company</span><span>{contact.company.name}</span></div>}
    </div>
  )
  const buildTouchpointDetail = (tp: Touchpoint) => (
    <div style={{padding:4,fontSize:13.5,lineHeight:1.6}}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>{tp.title}</div>
      <div className="stage-row"><span style={{fontWeight:600}}>Type</span><span className="badge" style={{background:'color-mix(in oklch,var(--color-primary)14%,var(--color-surface))',color:'var(--color-primary)'}}>{tp.type}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Contact</span><span>{tp.contact?.name||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Company</span><span>{tp.company?.name||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Description</span><span>{tp.description||'—'}</span></div>
      <div className="stage-row"><span style={{fontWeight:600}}>Date</span><span>{new Date(tp.created_at).toLocaleString()}</span></div>
    </div>
  )

  const pipeline = stageKeys.map(k => {
    const items = deals.filter(d => d.stage_id === k)
    return {
      key: k, label: stages[k]?.label || k, count: items.length,
      total: items.reduce((s, d) => s + (d.amount || 0), 0),
      color: stages[k]?.color || 'var(--color-primary)',
    }
  })
  const maxPipelineTotal = Math.max(1, ...pipeline.map(p => p.total))

  // Widget icon helper
  const addWidget = (k: string) => {
    if (order.includes(k)) return
    saveOrder([...order, k])
    setDrawerOpen(false)
  }
  const removeW = (k: string) => {
    saveOrder(order.filter(x => x !== k))
  }
  // RAF-throttled drag
  const handleDragStart = (k: string) => { dragKey.current = k; dragPending.current = false }
  const handleDragOver = (e: React.DragEvent, k: string) => {
    if (!editing || !dragKey.current || dragKey.current === k) return
    e.preventDefault()
    if (dragPending.current) return
    dragPending.current = true
    requestAnimationFrame(() => {
      dragPending.current = false
      const grid = gridRef.current
      if (!grid) return
      const dragged = grid.querySelector(`[data-key="${dragKey.current}"]`) as HTMLElement
      const target = e.currentTarget as HTMLElement
      if (!dragged || dragged === target) return
      const rect = target.getBoundingClientRect()
      const before = (e.clientX - rect.left) < rect.width / 2
      grid.insertBefore(dragged, before ? target : target.nextSibling)
    })
  }
  const handleDragEnd = () => {
    dragKey.current = null
    const grid = gridRef.current
    if (!grid) return
    const domKeys: string[] = []
    grid.querySelectorAll('[data-key]').forEach(el => {
      const key = el.getAttribute('data-key')
      if (key) domKeys.push(key)
    })
    if (domKeys.length > 0) saveOrder(domKeys)
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
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-blue)',cursor:'pointer'}} onClick={() => openDrawer('Contacts', <div>{contacts.map(c => <div key={c.id} className="list-row" style={{cursor:'pointer'}} onClick={() => openDrawer(c.name, buildContactDetail(c))}><Users size={14} style={{color:'var(--color-blue)',flexShrink:0}} /><span className="name">{c.name}</span><span className="meta">{c.company?.name||''}</span></div>)}</div>)}>{stats.contacts}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_contacts.label}</span>
      </div>
    ),
    kpi_companies: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%',cursor:'pointer'}} onClick={() => setShowCompanyDrawer(true)}>
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-purple)'}}>{stats.companies}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_companies.label}</span>
      </div>
    ),
    kpi_deals: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-primary)',cursor:'pointer'}} onClick={() => openDrawer('All Deals', <div>{deals.map(d => <div key={d.id} className="list-row" style={{cursor:'pointer'}} onClick={() => openDrawer(d.name, buildDealDetail(d))}><TrendingUp size={14} style={{color:'var(--color-primary)',flexShrink:0}} /><span className="name">{d.name}</span><span className="meta">${d.amount?.toLocaleString()||''}</span></div>)}</div>)}>{stats.deals}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_deals.label}</span>
      </div>
    ),
    kpi_tasks: () => (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4,height:'100%'}}>
        <span className="kpi-val" style={{fontSize:26,color:'var(--color-warning)',cursor:'pointer'}} onClick={() => openDrawer('All Tasks', <div>{tasks.map(t => <div key={t.id} className="list-row" style={{cursor:'pointer'}} onClick={() => openDrawer(t.title, buildTaskDetail(t))}><CheckSquare size={14} style={{color:'var(--color-warning)',flexShrink:0}} /><span className="name">{t.title}</span><span className="meta">{t.priority||''}</span></div>)}</div>)}>{stats.tasks}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>{allWidgets.kpi_tasks.label}</span>
      </div>
    ),
    tasks: () => {
      const areaSymbol = (area?: string) => {
        if (!area) return null
        const a = area.toLowerCase()
        if (a.includes('work') || a.includes('💼')) return <span style={{marginRight:4}}>💼</span>
        if (a.includes('personal') || a.includes('home') || a.includes('🏠')) return <span style={{marginRight:4}}>🏠</span>
        if (a.includes('jesus') || a.includes('church') || a.includes('✝️')) return <span style={{marginRight:4}}>✝️</span>
        if (a.includes('learning') || a.includes('study') || a.includes('📚')) return <span style={{marginRight:4}}>📚</span>
        return null
      }
      const isOverdue = (t: Task) => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done'
      return (
        tasks.length === 0
          ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No tasks</div>
          : <>{tasks.slice(0,5).map(t => (
              <div key={t.id} className="list-row" onClick={() => openDrawer(t.title, buildTaskDetail(t))} style={{cursor:'pointer'}}>
                <CheckSquare size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                {areaSymbol(t.area)}
                <span className="name">{t.title}</span>
                {isOverdue(t) && <span className="badge" style={{background:'color-mix(in oklch,var(--color-notification)18%,var(--color-surface))',color:'var(--color-notification)',marginLeft:4,flexShrink:0}}>逾期</span>}
                <span className="badge" style={{
                  background: t.priority==='P0'?'color-mix(in oklch,var(--color-notification)18%,var(--color-surface))':t.priority==='P1'?'color-mix(in oklch,var(--color-warning)18%,var(--color-surface))':'color-mix(in oklch,var(--color-success)18%,var(--color-surface))',
                  color: t.priority==='P0'?'var(--color-notification)':t.priority==='P1'?'var(--color-warning)':'var(--color-success)'
                }}>{t.custom_fields?.notion_priority || t.priority || 'P3'}</span>
              </div>
            ))}</>
      )
    },
    touchpoints: () => (
      touchpoints.length === 0
        ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No recent activity</div>
        : <>{touchpoints.map(tp => (
            <div key={tp.id} className="list-row" onClick={() => openDrawer(tp.title, buildTouchpointDetail(tp))} style={{cursor:'pointer'}}>
              <Activity size={14} style={{color:'var(--color-text-muted)',flexShrink:0}} />
              <span className="name">{tp.title}</span>
              <span className="meta">{tp.company?.name||''}</span>
            </div>
          ))}</>
    ),
    pipeline: () => (
      <>{pipeline.map(p => (
        <div key={p.key} className="stage-row" style={{cursor:'pointer'}} onClick={() => {
          const filtered = deals.filter(d => d.stage_id === p.key)
          openDrawer(p.label, <div>{filtered.map(d => <div key={d.id} className="list-row" style={{cursor:'pointer'}} onClick={() => openDrawer(d.name, buildDealDetail(d))}><TrendingUp size={14} style={{color:p.color,flexShrink:0}} /><span className="name">{d.name}</span><span className="meta">${d.amount?.toLocaleString()||''}</span></div>)}</div>)
        }}>
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
      <><div className="kpi-val" style={{fontSize:26,color:'var(--color-primary)',cursor:'pointer'}} onClick={() => {
        const closedWon = deals.filter(d => d.stage_id === 'closed_won')
        openDrawer('Closed Won Deals', <div>{closedWon.map(d => <div key={d.id} className="list-row" style={{cursor:'pointer'}} onClick={() => openDrawer(d.name, buildDealDetail(d))}><TrendingUp size={14} style={{color:'var(--color-success)',flexShrink:0}} /><span className="name">{d.name}</span><span className="meta">${d.amount?.toLocaleString()||''}</span></div>)}</div>)
      }}>{stats.dealValue||'—'}</div>
      <div className="kpi-delta" style={{color:'var(--color-success)'}}>↑ {deals.filter(d=>d.stage_id==='closed_won').length} closed won</div></>
    ),
    aiinsight: () => {
      const overdueCount = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done').length
      const p0Count = tasks.filter(t => t.priority === 'P0').length
      const todayDue = tasks.filter(t => {
        if (!t.due_date) return false
        const d = new Date(t.due_date)
        const today = new Date()
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
      }).length
      return (
        <div style={{fontSize:13,lineHeight:1.5,color:'var(--color-text-muted)'}}>
          <p>• {stats.contacts} contacts active</p>
          <p>• {stats.tasks} tasks pending</p>
          <p>• {overdueCount} overdue, {p0Count} P0 urgent</p>
          <p>• {todayDue} tasks due today</p>
          <p>• Pipeline velocity: {deals.length>0?Math.round(deals.filter(d=>d.stage_id==='closed_won').length/Math.max(1,deals.length)*100):0}%</p>
        </div>
      )
    },
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
        <span className="kpi-val" style={{color:'var(--color-purple)'}}>{stats.companies}</span>
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
        <span className="kpi-val" style={{color:'var(--color-primary)'}}>{stats.dealValue || '—'}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>進行中Deal總額</span>
      </div>
    ),
    d2: () => {
      const allStageKeys = ['qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost']
      const stageData = allStageKeys.map(k => {
        const items = deals.filter(d => d.stage_id === k)
        return {
          key: k, label: stages[k]?.label || k, count: items.length,
          total: items.reduce((s, d) => s + (d.amount || 0), 0),
          color: stages[k]?.color || 'var(--color-primary)',
        }
      })
      const maxTotal = Math.max(1, ...stageData.map(s => s.total))
      return (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {stageData.map(s => (
            <div key={s.key} className="stage-row">
              <div className="stage-label">
                <span>{s.label}</span>
                <span>${s.total.toLocaleString()}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{width:`${(s.total/maxTotal)*100}%`,background:s.color}} />
              </div>
            </div>
          ))}
        </div>
      )
    },
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
        <span className="kpi-val" style={{color:'var(--color-primary)'}}>{projectsTotal}</span>
        <span style={{fontSize:12,color:'var(--color-text-muted)',fontWeight:500}}>活躍項目</span>
      </div>
    ),
    p2: () => (
      <><div className="list-row"><span className="name">CRM 2.0 — UI Redesign</span><span className="badge warn">3天後</span></div>
      <div className="list-row"><span className="name">物流整合模組</span><span className="badge info">7天後</span></div>
      <div className="list-row"><span className="name">數據分析平台</span><span className="badge info">14天後</span></div></>
    ),
    p3: () => {
      const statusColor = (s: string) => {
        if (s === 'done' || s === 'completed') return 'var(--color-success)'
        if (s === 'in_progress' || s === 'active') return 'var(--color-blue)'
        if (s === 'planning' || s === 'new') return 'var(--color-text-faint)'
        return 'var(--color-warning)'
      }
      const statusLabel = (s: string) => {
        if (s === 'done' || s === 'completed') return '✅ 已完成'
        if (s === 'in_progress' || s === 'active') return '▶ 進行中'
        if (s === 'planning' || s === 'new') return '📋 規劃'
        if (s === 'on_hold') return '⏸ 暫停'
        return s || '—'
      }
      const items = (projects || []).slice(0, 5)
      return items.length === 0
        ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>暫無項目</div>
        : <div style={{display:'flex',flexDirection:'column',gap:10}}>{items.map((p: any) => (
            <div key={p.id} className="stage-row" style={{cursor:'pointer'}} onClick={() => navigate(`/projects/${p.id}`)}>
              <div className="stage-label">
                <span>{p.name}</span>
                <span style={{color:statusColor(p.status),fontSize:12}}>{statusLabel(p.status)}</span>
              </div>
            </div>
          ))}</div>
    },
    p4: () => (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="list-row"><span className="name">林海珊</span><span className="meta">3項目</span></div>
        <div className="list-row"><span className="name">陳偉明</span><span className="meta">2項目</span></div>
        <div className="list-row"><span className="name">張志強</span><span className="meta">2項目</span></div>
        <div className="list-row"><span className="name">李美玲</span><span className="meta">1項目</span></div>
      </div>
    ),
    // ── Tasks (demo data) ──
    t1: () => {
      const todayTasks = tasks.filter(t => {
        if (t.status === 'done') return false
        if (t.area?.includes('Work') || t.area?.includes('💼')) return true
        return t.priority === 'P0'
      }).slice(0, 5)
      return todayTasks.length === 0
        ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>暫無待辦事項</div>
        : <>{todayTasks.map(t => (
            <div key={t.id} className="list-row" style={{cursor:'pointer'}} onClick={() => navigate(`/tasks/${t.id}`)}>
              <CheckSquare size={14} style={{color:t.status==='done'?'var(--color-success)':'var(--color-text-muted)',flexShrink:0}} />
              <span className="name">{t.title}</span>
              <span className="badge" style={{
                background: t.priority==='P0'?'color-mix(in oklch,var(--color-notification)18%,var(--color-surface))':t.priority==='P1'?'color-mix(in oklch,var(--color-warning)18%,var(--color-surface))':'color-mix(in oklch,var(--color-success)18%,var(--color-surface))',
                color: t.priority==='P0'?'var(--color-notification)':t.priority==='P1'?'var(--color-warning)':'var(--color-success)'
              }}>{t.custom_fields?.notion_priority || t.priority || 'P3'}</span>
            </div>
          ))}</>
    },
    t2: () => {
      const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done').slice(0, 5)
      const daysOverdue = (due: string) => Math.floor((Date.now() - new Date(due).getTime()) / (86400000))
      return overdueTasks.length === 0
        ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>暫無逾期任務</div>
        : <>{overdueTasks.map(t => (
            <div key={t.id} className="list-row" style={{cursor:'pointer'}} onClick={() => navigate(`/tasks/${t.id}`)}>
              <span className="name">{t.title}</span>
              <span className="badge warn">逾期{daysOverdue(t.due_date!)}天</span>
            </div>
          ))}</>
    },
    t3: () => {
      const priorityOrder: Record<string, number> = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3, 'P4': 4 }
      const sortedTasks = [...tasks].sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 99
        const pb = priorityOrder[b.priority] ?? 99
        return pa - pb
      }).slice(0, 5)
      const priorityLabel = (p: string) => {
        if (p === 'P0') return '緊急'
        if (p === 'P1') return '高'
        if (p === 'P2') return '中'
        return '低'
      }
      const priorityBadgeClass = (p: string) => {
        if (p === 'P0' || p === 'P1') return 'warn'
        if (p === 'P2') return 'info'
        return 'ok'
      }
      return sortedTasks.length === 0
        ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>暫無任務</div>
        : <>{sortedTasks.map(t => (
            <div key={t.id} className="list-row" style={{cursor:'pointer'}} onClick={() => navigate(`/tasks/${t.id}`)}>
              <span className="name">{t.title}</span>
              <span className={`badge ${priorityBadgeClass(t.priority)}`}>{priorityLabel(t.priority)}</span>
            </div>
          ))}</>
    },
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
    <div className={`dash01-shell${editing ? ' editing' : ''}`}>
      {/* Toolbar — dashboard-specific controls */}
      <div className="dash-toolbar" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18,flexWrap:'wrap',gap:10}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700}}>早晨,Terrence 👋</h1>
          <p style={{fontSize:13,color:'var(--color-text-muted)',marginTop:2}}>{todayStr()}</p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div className="new-menu-wrap" ref={newRef} style={{position:'relative'}}>
            <button className="new-btn" aria-label="Create new" onClick={() => setNewOpen(!newOpen)}
              style={{width:38,height:38,borderRadius:'999px',background:'var(--color-primary)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',border:'none',cursor:'pointer'}}>
              <Plus size={20} />
            </button>
            {newOpen && (
              <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,width:200,background:'var(--color-surface-2)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-lg)',padding:6,zIndex:50}}>
                <button className="new-dropdown-item" onClick={() => { setNewOpen(false); navigate('/tasks/new') }}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:'var(--radius-sm)',fontSize:13.5,fontWeight:500,width:'100%',textAlign:'left',color:'var(--color-text)',background:'none',border:'none',cursor:'pointer'}}>
                  <CheckSquare size={16} style={{color:'var(--color-text-muted)'}} />New Task
                </button>
                <button className="new-dropdown-item" onClick={() => { setNewOpen(false); navigate('/contacts/new') }}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:'var(--radius-sm)',fontSize:13.5,fontWeight:500,width:'100%',textAlign:'left',color:'var(--color-text)',background:'none',border:'none',cursor:'pointer'}}>
                  <Users size={16} style={{color:'var(--color-text-muted)'}} />New Contact
                </button>
                <button className="new-dropdown-item" onClick={() => { setNewOpen(false); navigate('/companies/new') }}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:'var(--radius-sm)',fontSize:13.5,fontWeight:500,width:'100%',textAlign:'left',color:'var(--color-text)',background:'none',border:'none',cursor:'pointer'}}>
                  <Building2 size={16} style={{color:'var(--color-text-muted)'}} />New Company
                </button>
              </div>
            )}
          </div>
          <button className={`btn ${editing ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEditing(!editing)}
            style={{display:'inline-flex',alignItems:'center',gap:6,padding:'9px 16px',borderRadius:'var(--radius-md)',fontSize:13.5,fontWeight:600,cursor:'pointer',background: editing ? 'var(--color-primary)' : 'var(--color-surface-offset)',color: editing ? '#fff' : 'var(--color-text)'}}>
            <Layout size={15} />{editing ? '完成' : '自訂版面'}
          </button>
        </div>
      </div>

      {/* AI Daily Brief */}
      <section className={`ai-brief${aiOn ? ' show' : ''}`}
        style={{display:aiOn ? 'block' : 'none',background:'linear-gradient(135deg,color-mix(in oklch,var(--color-purple)10%,var(--color-surface)),var(--color-surface))',border:'1px solid color-mix(in oklch,var(--color-purple)25%,var(--color-border))',borderRadius:'var(--radius-xl)',padding:'20px 22px',marginBottom:20}}>
        <div className="ai-brief-head" style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
          <Sparkles size={20} style={{color:'var(--color-purple)'}} />
          <h2 style={{fontSize:15,fontWeight:700,margin:0}}>AI 每日簡報</h2>
          <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>基於即時數據 · 自動更新</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
          <div>
            <h4 style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em',color:'var(--color-text-muted)',marginBottom:8}}>今日重點</h4>
            <ul style={{listStyle:'none',display:'flex',flexDirection:'column',gap:6,padding:0,margin:0}}>
              <li style={{fontSize:13,display:'flex',gap:6,lineHeight:1.4}}><span style={{color:'var(--color-purple)'}}>•</span>{stats.deals} 個 Deal 進行中,總值 {stats.dealValue}</li>
              <li style={{fontSize:13,display:'flex',gap:6,lineHeight:1.4}}><span style={{color:'var(--color-purple)'}}>•</span>本日 {stats.tasks} 項待辦任務</li>
            </ul>
          </div>
          <div>
            <h4 style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em',color:'var(--color-text-muted)',marginBottom:8}}>會議準備</h4>
            <ul style={{listStyle:'none',display:'flex',flexDirection:'column',gap:6,padding:0,margin:0}}>
              {touchpoints.slice(0, 2).map(tp => (
                <li key={tp.id} style={{fontSize:13,display:'flex',gap:6,lineHeight:1.4}}><span style={{color:'var(--color-purple)'}}>•</span>{tp.title}</li>
              ))}
              {touchpoints.length === 0 && <li style={{fontSize:13,color:'var(--color-text-muted)'}}>暫無會議</li>}
            </ul>
          </div>
          <div>
            <h4 style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em',color:'var(--color-text-muted)',marginBottom:8}}>風險提示</h4>
            <ul style={{listStyle:'none',display:'flex',flexDirection:'column',gap:6,padding:0,margin:0}}>
              <li style={{fontSize:13,display:'flex',gap:6,lineHeight:1.4}}><span style={{color:'var(--color-purple)'}}>•</span>{tasks.filter(t => t.priority === 'P0').length} 件緊急任務需跟進</li>
              <li style={{fontSize:13,display:'flex',gap:6,lineHeight:1.4}}><span style={{color:'var(--color-purple)'}}>•</span>{stats.companies} 間公司活躍中</li>
            </ul>
          </div>
        </div>
      </section>

      {/* WIDGET GRID — CSS grid, 12-column, span classes */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(12,1fr)',gap:16,alignItems:'start'}}>
        {order.map((k) => {
          const def = allWidgets[k]
          if (!def) return null
          const IconComp = widgetIcon(k)
          return (
            <div key={k} className={`widget${editing && dragKey.current === k ? ' dragging' : ''}`}
              style={{gridColumn:`span ${def.span}`,background:'var(--color-surface-2)',border: editing ? '2px dashed var(--color-primary)' : '1px solid var(--color-border)',borderRadius:'var(--radius-lg)',padding:16,display:'flex',flexDirection:'column',position:'relative',minHeight:160,cursor: editing ? 'grab' : undefined}}
              data-key={k}
              draggable={editing}
              onDragStart={() => handleDragStart(k)}
              onDragOver={e => handleDragOver(e, k)}
              onDragEnd={handleDragEnd}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexShrink:0}}>
                <h3 style={{fontSize:13.5,fontWeight:700,margin:0,display:'flex',alignItems:'center',gap:6}}>
                  <IconComp size={15} style={{color: iconColor(k)}} />
                  {k.startsWith('kpi_') ? def.label :
                   k === 'tasks' ? <>Today's Tasks <span className="badge" style={{padding:'2px 8px',borderRadius:'999px',fontSize:11,fontWeight:700,background:'color-mix(in oklch,var(--color-primary)18%,var(--color-surface))',color:'var(--color-primary)'}}>{stats.tasks}</span></> :
                   k === 'touchpoints' ? 'Recent Touchpoints' :
                   k === 'pipeline' ? 'Deal Pipeline' :
                   k === 'dealvalue' ? <><DollarSign size={15} style={{color:'var(--color-text-muted)'}} /> Total Deal Value</> :
                   k === 'aiinsight' ? <><Sparkles size={15} style={{color:'var(--color-purple)'}} /> AI Insight</> :
                   k === 'activity_feed' ? <><Activity size={15} style={{color:'var(--color-text-muted)'}} /> Activity Feed</> :
                   def.label}
                </h3>
                {editing && (
                  <div style={{display:'flex',gap:2}}>
                    <button aria-label="拖曳排序" style={{width:24,height:24,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'var(--radius-sm)',color:'var(--color-text-faint)',background:'none',border:'none',cursor:'pointer'}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
                    </button>
                    <button aria-label="移除" onClick={(e) => { e.stopPropagation(); removeW(k) }} style={{width:24,height:24,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'var(--radius-sm)',color:'var(--color-text-faint)',background:'none',border:'none',cursor:'pointer'}}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
              <div className="widget-body" style={{flex:1,minHeight:0}}>
                {widgetBodies[k] ? widgetBodies[k]() : (
                  <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No content</div>
                )}
              </div>
              {(k === 'c1' || k === 'co3' || k === 'd3' || k === 't2' || k === 's2' || k === 'te1') && aiOn && (
                <button className="ai-tag" style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:'999px',background:'var(--color-purple-highlight)',color:'var(--color-purple)',fontSize:11.5,fontWeight:700,marginTop:8,border:'none',cursor:'pointer'}}
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
              {editing && (
                <div className="resize-grip" style={{position:'absolute',bottom:4,right:4,cursor:'nwse-resize',color:'var(--color-primary)',opacity:0.8,zIndex:5,userSelect:'none',background:'var(--color-surface-2)',borderRadius:'4px',padding:2,display:'flex',alignItems:'center',justifyContent:'center',width:20,height:20,boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}
                  draggable={false}
                  onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    const startX = e.clientX
                    const grid = gridRef.current
                    const widgetEl = (e.currentTarget as HTMLElement).closest('[data-key]') as HTMLElement
                    if (!grid || !widgetEl) return
                    const startSpan = parseInt(widgetEl.style.gridColumn.match(/span (\d+)/)?.[1] || String(def.span))
                    const gridRect = grid.getBoundingClientRect()
                    const gapVal = 16
                    const colW = (gridRect.width - (11 * gapVal)) / 12
                    let currentSpan = startSpan
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX
                      const newSpan = Math.max(1, Math.min(12, Math.round(startSpan + dx / (colW + gapVal))))
                      if (newSpan === currentSpan) return
                      currentSpan = newSpan
                      widgetEl.style.gridColumn = `span ${currentSpan}`
                    }
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12L12 22M22 2L2 22"/></svg>
                </div>
              )}
            </div>
          )
        })}
        {/* Add Widget Tile — opens drawer */}
        {editing && (
          <div className="add-widget-tile"
            style={{gridColumn:'span 4',border:'1.5px dashed var(--color-border)',borderRadius:'var(--radius-lg)',minHeight:160,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,color:'var(--color-text-muted)',cursor:'pointer'}}
            onClick={() => setDrawerOpen(true)}>
            <Plus size={24} />
            <span style={{fontSize:13,fontWeight:600}}>新增小工具</span>
          </div>
        )}
      </div>

      {aiOn && (
        <div className="ai-tag" style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:'999px',background:'var(--color-purple-highlight)',color:'var(--color-purple)',fontSize:11.5,fontWeight:700,marginTop:10,border:'none',cursor:'pointer'}}>
          <Sparkles size={12} /> AI 分析已啟用
        </div>
      )}


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
      {/* ── KPI Companies Drawer ── */}
      <div className={`drawer-overlay${showCompanyDrawer ? ' show' : ''}`} onClick={() => setShowCompanyDrawer(false)} />
      <aside className={`drawer${showCompanyDrawer ? ' show' : ''}`}>
        <div className="drawer-head">
          <h3>Companies ({companyList.length})</h3>
          <button className="icon-btn" onClick={() => setShowCompanyDrawer(false)}><X size={19} /></button>
        </div>
        <div className="drawer-body">
          {companyList.length === 0
            ? <div style={{padding:'16px 0',fontSize:12,color:'var(--color-text-faint)'}}>No companies loaded</div>
            : companyList.map(c => (
                <div key={c.id} className="list-row" style={{cursor:'pointer'}} onClick={() => { navigate(`/companies/${c.id}`); setShowCompanyDrawer(false) }}>
                  <Building2 size={14} style={{color:'var(--color-purple)',flexShrink:0}} />
                  <span className="name">{c.name}</span>
                  <span className="meta">{c.industry || c.category || '—'}</span>
                </div>
              ))
          }
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
      {/* ── Detail Drawer ── */}
      <SlideDrawer open={detailDrawer} onClose={() => setDetailDrawer(false)} title={drawerTitle} width="30vw">
        {drawerContent}
      </SlideDrawer>
    </div>
  )
}
