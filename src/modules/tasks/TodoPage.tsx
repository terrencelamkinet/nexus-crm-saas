import '../../styles/todo.css'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import {
  Plus, X, Check, Sun, Calendar, Bell, Repeat, FileText,
  Share2, ChevronRight, Trash2, List,
} from 'lucide-react'

/* ── Types ── */
interface TaskList {
  id: string; name: string; color: string; icon?: string; sort_order: number; is_smart: boolean
}
interface Task {
  id: string; title: string; status: string; priority: string
  due_date?: string | null; is_important: boolean; my_day_date?: string | null
  reminder_at?: string | null; recurrence_rule?: string | null; notes_html?: string | null
  list_id?: string | null; contact_id?: string | null; company_id?: string | null
  deal_id?: string | null; assignee_id?: string | null; completed_at?: string | null
  steps?: TaskStep[]; categories?: TaskCategory[]; attachments?: TaskAttachment[]
  step_count?: number; step_done?: number
}
interface TaskStep { id: string; title: string; is_completed: boolean; sort_order: number }
interface TaskCategory { id: string; name: string; color: string }
interface TaskAttachment { id: string; filename: string; file_size?: number; content_type?: string }

export default function TodoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [lists, setLists] = useState<TaskList[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [showShare, setShowShare] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [showNewList, setShowNewList] = useState(false)
  const [showLeft, setShowLeft] = useState(false)
  const [showCatPicker, setShowCatPicker] = useState(false)
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  // Pre-select list from URL param
  const contactFilter = searchParams.get('contact_id')
  const companyFilter = searchParams.get('company_id')

  // ── Fetch lists ──
  const fetchLists = useCallback(async () => {
    try {
      const data = await apiClient.get<any>('/api/v1/crm/todo/lists')
      const items = data?.items || data || []
      setLists(items)
      return items
    } catch { return [] }
  }, [])

  // ── Fetch tasks ──
  const fetchTasks = useCallback(async (listId?: string | null, smart?: string) => {
    setLoading(true)
    try {
      let url = '/api/v1/crm/todo/tasks?limit=100'
      if (contactFilter) url += `&contact_id=${contactFilter}`
      else if (companyFilter) url += `&company_id=${companyFilter}`
      else if (smart) url += `&smart=${smart}`
      else if (listId) url += `&list_id=${listId}`
      const data = await apiClient.get<any>(url)
      const items = data?.items || data || []
      setTasks(items)
    } catch { setTasks([]) }
    finally { setLoading(false) }
  }, [contactFilter, companyFilter])

  // ── Init ──
  useEffect(() => {
    fetchLists().then(allLists => {
      const smart = searchParams.get('smart') || 'all'
      const smartList = allLists?.find((l: TaskList) => l.is_smart && l.name.toLowerCase().includes(smart))
      if (smartList) setActiveListId(smartList.id)
      else if (allLists?.length) setActiveListId(allLists[0].id)
      fetchTasks(smartList?.id, smart)
    })
  }, [])

  // ── Select list ──
  const selectList = (list: TaskList) => {
    setActiveListId(list.id)
    setSelectedTask(null)
    setShowLeft(false)
    if (list.is_smart) {
      const t = list.name.toLowerCase().includes('my day') ? 'myday'
        : list.name.toLowerCase().includes('important') ? 'important'
        : list.name.toLowerCase().includes('planned') ? 'planned'
        : list.name.toLowerCase().includes('completed') ? 'completed'
        : list.name.toLowerCase().includes('assigned') ? 'assigned'
        : list.name.toLowerCase().includes('due today') ? 'due_today'
        : 'all'
      fetchTasks(null, t)
    } else {
      fetchTasks(list.id)
    }
  }

  // ── Create task ──
  const createTask = async () => {
    if (!newTitle.trim()) return
    try {
      const task = await apiClient.post('/api/v1/crm/todo/tasks', {
        title: newTitle.trim(),
        list_id: activeListId,
        contact_id: contactFilter || undefined,
        company_id: companyFilter || undefined,
      })
      setTasks(prev => [task, ...prev])
      setNewTitle('')
      inputRef.current?.focus()
    } catch {}
  }

  // ── Toggle complete ──
  const toggleComplete = async (task: Task) => {
    const done = task.status === 'done' ? 'pending' : 'done'
    try {
      await apiClient.patch(`/api/v1/crm/todo/tasks/${task.id}`, { status: done })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: done, completed_at: done === 'done' ? new Date().toISOString() : null } : t))
      if (selectedTask?.id === task.id) setSelectedTask(prev => prev ? { ...prev, status: done } : null)
    } catch {}
  }

  // ── Toggle important ──
  const toggleImportant = async (task: Task) => {
    const v = !task.is_important
    try {
      await apiClient.patch(`/api/v1/crm/todo/tasks/${task.id}`, { is_important: v })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_important: v } : t))
      if (selectedTask?.id === task.id) setSelectedTask(prev => prev ? { ...prev, is_important: v } : null)
    } catch {}
  }

  // ── Delete task ──
  const deleteTask = async (id: string) => {
    try {
      await apiClient.delete(`/api/v1/crm/todo/tasks/${id}`)
      setTasks(prev => prev.filter(t => t.id !== id))
      if (selectedTask?.id === id) setSelectedTask(null)
    } catch {}
  }

  // ── Update task field ──
  const updateTask = async (id: string, updates: Partial<Task>) => {
    try {
      await apiClient.patch(`/api/v1/crm/todo/tasks/${id}`, updates)
      setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
      setSelectedTask(prev => prev?.id === id ? { ...prev, ...updates } : prev)
    } catch {}
  }

  // ── Steps ──
  const addStep = async (taskId: string, title: string) => {
    try {
      const step = await apiClient.post(`/api/v1/crm/todo/tasks/${taskId}/steps`, { title })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, steps: [...(t.steps || []), step], step_count: (t.step_count || 0) + 1 } : t))
      setSelectedTask(prev => prev?.id === taskId ? { ...prev, steps: [...(prev.steps || []), step] } : prev)
    } catch {}
  }
  const toggleStep = async (taskId: string, step: TaskStep) => {
    try {
      await apiClient.patch(`/api/v1/crm/todo/tasks/${taskId}/steps/${step.id}`, { is_completed: !step.is_completed })
      const upd = (s: TaskStep) => s.id === step.id ? { ...s, is_completed: !s.is_completed } : s
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, steps: t.steps?.map(upd) } : t))
      setSelectedTask(prev => prev?.id === taskId ? { ...prev, steps: prev.steps?.map(upd) } : prev)
    } catch {}
  }
  const deleteStep = async (taskId: string, stepId: string) => {
    try {
      await apiClient.delete(`/api/v1/crm/todo/tasks/${taskId}/steps/${stepId}`)
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, steps: t.steps?.filter(s => s.id !== stepId), step_count: Math.max(0, (t.step_count || 0) - 1) } : t))
      setSelectedTask(prev => prev?.id === taskId ? { ...prev, steps: prev.steps?.filter(s => s.id !== stepId) } : prev)
    } catch {}
  }

  // ── Categories ──
  const fetchCategories = async () => {
    try {
      const data = await apiClient.get<any>('/api/v1/crm/todo/categories')
      setCategories(data?.items || data || [])
    } catch {}
  }
  useEffect(() => { fetchCategories() }, [])
  const addCategory = async (taskId: string, catId: string) => {
    try {
      await apiClient.post(`/api/v1/crm/todo/tasks/${taskId}/categories`, { category_id: catId })
      const cat = categories.find(c => c.id === catId)
      if (cat) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, categories: [...(t.categories || []), cat] } : t))
        setSelectedTask(prev => prev?.id === taskId ? { ...prev, categories: [...(prev.categories || []), cat] } : prev)
      }
    } catch {}
  }
  const removeCategory = async (taskId: string, catId: string) => {
    try {
      await apiClient.delete(`/api/v1/crm/todo/tasks/${taskId}/categories/${catId}`)
      const filt = (c: TaskCategory) => c.id !== catId
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, categories: t.categories?.filter(filt) } : t))
      setSelectedTask(prev => prev?.id === taskId ? { ...prev, categories: prev.categories?.filter(filt) } : prev)
    } catch {}
  }

  // ── Toggle My Day ──
  const toggleMyDay = async (task: Task) => {
    try {
      await apiClient.get(`/api/v1/crm/todo/my-day/toggle/${task.id}`)
      const hasMyDay = !task.my_day_date
      const today = hasMyDay ? new Date().toISOString().split('T')[0] : null
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, my_day_date: today } : t))
      setSelectedTask(prev => prev?.id === task.id ? { ...prev, my_day_date: today } : prev)
    } catch {}
  }

  // ── Smart list icon ──
  const smartIcon = (name: string) => {
    if (name.includes('My Day')) return '☀️'
    if (name.includes('Important')) return '⭐'
    if (name.includes('Planned')) return '📅'
    if (name.includes('All')) return '📋'
    if (name.includes('Completed')) return '✅'
    if (name.includes('Assigned')) return '👤'
    if (name.includes('Due Today')) return '🔔'
    return '📋'
  }

  // ── Due date display ──
  const dueLabel = (d?: string | null) => {
    if (!d) return null
    const dt = new Date(d)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tom = new Date(today); tom.setDate(tom.getDate() + 1)
    const diff = Math.ceil((dt.getTime() - today.getTime()) / 86400000)
    const cls = diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'future'
    const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff < 0 ? `${Math.abs(diff)}d overdue` : dt.toLocaleDateString('zh-HK', { month: 'short', day: 'numeric' })
    return <span className={`t-due ${cls}`}>{label}</span>
  }

  // ── Build detail ──
  const activeList = lists.find(l => l.id === activeListId) || null

  return (
    <>
      {/* Mobile scrim for left panel */}
      {showLeft && <div className="share-overlay" onClick={() => setShowLeft(false)} style={{zIndex:55}} />}

      <div className={`todo-page${selectedTask ? ' detail-open' : ''}`}>
        {/* ── LEFT PANEL ── */}
        <aside className={`todo-left${showLeft ? ' show' : ''}`}>
          <div className="todo-left-head">Lists</div>
          <div className="todo-list-group">
            {lists.filter(l => l.is_smart).map(l => (
              <div key={l.id} className={`todo-list-item${activeListId === l.id ? ' active' : ''}`} onClick={() => selectList(l)}>
                <span className="l-icon">{smartIcon(l.name)}</span>
                <span className="l-name">{l.name.replace(/^[^\s]+\s/, '')}</span>
                <span className="l-count">{l.name === '📋 All' ? tasks.length : ''}</span>
              </div>
            ))}
          </div>
          <div className="todo-list-sep" />
          <div className="todo-left-head">My Lists</div>
          <div className="todo-list-group">
            {lists.filter(l => !l.is_smart).map(l => (
              <div key={l.id} className={`todo-list-item${activeListId === l.id ? ' active' : ''}`} onClick={() => selectList(l)}>
                <span className="l-color" style={{background:l.color}} />
                <span className="l-name">{l.name}</span>
                <span className="l-count">{tasks.length}</span>
              </div>
            ))}
          </div>
          <button className="todo-add-list" onClick={() => setShowNewList(!showNewList)}>
            <Plus size={14} /> New List
          </button>
          {showNewList && (
            <div style={{display:'flex',gap:6,padding:'4px 10px'}}>
              <input type="text" placeholder="List name" value={newListName}
                onChange={e => setNewListName(e.target.value)}
                style={{flex:1,border:'1px solid var(--color-border)',borderRadius:'var(--radius-sm)',padding:'4px 8px',fontSize:12,outline:'none',background:'var(--color-surface)'}}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newListName.trim()) {
                    try {
                      await apiClient.post('/api/v1/crm/todo/lists', { name: newListName.trim() })
                      setNewListName(''); setShowNewList(false)
                      fetchLists()
                    } catch {}
                  }
                }} />
            </div>
          )}
        </aside>

        {/* ── CENTER PANEL ── */}
        <div className="todo-center">
          <div className="todo-list-header">
            <button className="icon-btn-small" onClick={() => setShowLeft(true)} style={{display:'none'}}><List size={18} /></button>
            <h2>
              {activeList?.is_smart && <span>{smartIcon(activeList?.name || '')}</span>}
              {!activeList?.is_smart && <span className="lh-color" style={{background:activeList?.color}} />}
              {activeList?.name?.replace(/^[^\s]+\s/, '') || 'Tasks'}
            </h2>
            <span className="lh-count">{tasks.filter(t => t.status !== 'done').length} remaining</span>
            <div className="lh-actions">
              {!activeList?.is_smart && activeList && (
                <button className="icon-btn-small" onClick={() => setShowShare(true)} title="Share list"><Share2 size={15} /></button>
              )}
            </div>
          </div>

          <div className="todo-tasks">
            {loading ? (
              <div style={{padding:40,textAlign:'center',color:'var(--color-text-faint)',fontSize:13}}>Loading...</div>
            ) : tasks.length === 0 ? (
              <div style={{padding:40,textAlign:'center',color:'var(--color-text-faint)',fontSize:13}}>
                {contactFilter ? 'No tasks for this contact' : 'Add a task to get started'}
              </div>
            ) : tasks.map(task => (
              <div key={task.id}
                className={`todo-task-row${task.status === 'done' ? ' done' : ''}${selectedTask?.id === task.id ? ' selected' : ''}`}
                onClick={() => setSelectedTask(task)}>
                <button className={`t-check${task.status === 'done' ? ' checked' : ''}`} onClick={e => { e.stopPropagation(); toggleComplete(task) }}>
                  {task.status === 'done' && <Check size={11} strokeWidth={3} />}
                </button>
                <span className="t-title">{task.title}</span>
                {task.my_day_date && <span className="t-myday">My Day</span>}
                {task.step_count ? <span className="t-step-count">{task.step_done || 0}/{task.step_count}</span> : null}
                {dueLabel(task.due_date)}
                <button className={`t-imp${task.is_important ? ' important' : ''}`} onClick={e => { e.stopPropagation(); toggleImportant(task) }}>
                  {task.is_important ? '★' : '☆'}
                </button>
              </div>
            ))}
          </div>

          <div className="todo-add-task">
            <input ref={inputRef} className="at-input" type="text" placeholder="Add a task..." value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createTask() }} />
            <button className="at-btn" onClick={createTask}><Plus size={16} /></button>
          </div>
        </div>

        {/* ── RIGHT DETAIL PANEL ── */}
        <aside className={`todo-right${selectedTask ? ' open' : ''}`}>
          {selectedTask && (
            <div className="todo-detail" ref={detailRef}>
              {/* Title */}
              <textarea className={`dt-title${selectedTask.status === 'done' ? ' dt-done' : ''}`}
                value={selectedTask.title}
                onChange={e => setSelectedTask({ ...selectedTask, title: e.target.value })}
                onBlur={e => updateTask(selectedTask.id, { title: e.target.value })}
                rows={1} />

              {/* Steps */}
              <div className="dt-section">
                <h4>Steps</h4>
                {selectedTask.steps?.map(s => (
                  <div key={s.id} className={`dt-step${s.is_completed ? ' done' : ''}`}>
                    <button className={`s-check${s.is_completed ? ' checked' : ''}`} onClick={() => toggleStep(selectedTask.id, s)}>
                      {s.is_completed && <Check size={10} strokeWidth={3} />}
                    </button>
                    <input className="s-text" value={s.title}
                      onChange={e => setSelectedTask(prev => prev ? { ...prev, steps: prev.steps?.map(st => st.id === s.id ? { ...st, title: e.target.value } : st) } : prev)}
                      onBlur={e => apiClient.patch(`/api/v1/crm/todo/tasks/${selectedTask.id}/steps/${s.id}`, { title: e.target.value }).catch(() => {})} />
                    <button className="s-del" onClick={() => deleteStep(selectedTask.id, s.id)}><X size={12} /></button>
                  </div>
                ))}
                <button className="dt-add-step" onClick={() => {
                  const title = prompt('Step name:')
                  if (title?.trim()) addStep(selectedTask.id, title.trim())
                }}><Plus size={13} /> Add step</button>
              </div>

              {/* Fields */}
              <div className="dt-section">
                <h4>Details</h4>

                {/* My Day */}
                <div className="dt-field">
                  <Sun size={15} className="f-label-icon" style={{color:'var(--color-text-muted)',flexShrink:0}} />
                  <span className="f-label">My Day</span>
                  <div className={`f-toggle${selectedTask.my_day_date ? ' on' : ''}`} onClick={() => toggleMyDay(selectedTask)}>
                    <div className="f-knob" />
                  </div>
                </div>

                {/* Due Date */}
                <div className="dt-field">
                  <Calendar size={15} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                  <span className="f-label">Due</span>
                  <div className="f-value">
                    <input type="date" value={selectedTask.due_date?.split('T')[0] || ''}
                      onChange={e => updateTask(selectedTask.id, { due_date: e.target.value || null })} />
                  </div>
                </div>

                {/* Reminder */}
                <div className="dt-field">
                  <Bell size={15} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                  <span className="f-label">Remind</span>
                  <div className="f-value">
                    <input type="datetime-local" value={selectedTask.reminder_at?.slice(0, 16) || ''}
                      onChange={e => updateTask(selectedTask.id, { reminder_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                  </div>
                </div>

                {/* Repeat */}
                <div className="dt-field">
                  <Repeat size={15} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                  <span className="f-label">Repeat</span>
                  <div className="f-value">
                    <select value={selectedTask.recurrence_rule || ''}
                      onChange={e => updateTask(selectedTask.id, { recurrence_rule: e.target.value || null })}>
                      <option value="">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekdays">Weekdays</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every 2 weeks</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                </div>

                {/* Categories */}
                <div className="dt-field">
                  <FileText size={15} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                  <span className="f-label">Category</span>
                  <div className="f-value cat-pos-rel">
                    <div className="f-tag-row">
                      {selectedTask.categories?.map(c => (
                        <span key={c.id} className="f-tag" style={{background:c.color+'22',color:c.color}}
                          onClick={() => removeCategory(selectedTask.id, c.id)}>
                          {c.name} <X size={10} />
                        </span>
                      ))}
                      <button className="f-add-tag" onClick={() => setShowCatPicker(!showCatPicker)}>+</button>
                    </div>
                    {showCatPicker && (
                      <div className="cat-picker">
                        {categories.map(c => (
                          <div key={c.id} className={`cp-item${selectedTask.categories?.some(c2 => c2.id === c.id) ? ' active' : ''}`}
                            style={{background:c.color}}
                            onClick={() => {
                              if (selectedTask.categories?.some(c2 => c2.id === c.id)) {
                                removeCategory(selectedTask.id, c.id)
                              } else {
                                addCategory(selectedTask.id, c.id)
                              }
                              setShowCatPicker(false)
                            }} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div className="dt-field" style={{flexDirection:'column',alignItems:'stretch',gap:6,borderBottom:'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <FileText size={15} style={{color:'var(--color-text-muted)',flexShrink:0}} />
                    <span className="f-label">Notes</span>
                  </div>
                  <textarea value={selectedTask.notes_html || ''}
                    onChange={e => setSelectedTask({ ...selectedTask, notes_html: e.target.value })}
                    onBlur={e => updateTask(selectedTask.id, { notes_html: e.target.value || null })}
                    placeholder="Add notes..."
                    style={{width:'100%',minHeight:60,border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',padding:'8px 10px',fontSize:13,resize:'vertical',background:'var(--color-surface-offset)',color:'var(--color-text)',fontFamily:'inherit',outline:'none'}} />
                </div>
              </div>

              {/* Actions */}
              <div style={{borderTop:'1px solid var(--color-divider)',paddingTop:12,marginTop:4,display:'flex',gap:8}}>
                <button className="icon-btn-small" onClick={() => deleteTask(selectedTask.id)} title="Delete task" style={{color:'var(--color-notification)'}}>
                  <Trash2 size={15} />
                </button>
                <button className="icon-btn-small" onClick={() => navigate(`/tasks/${selectedTask.id}`)} title="Open standalone" style={{marginLeft:'auto'}}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Share Dialog ── */}
      {showShare && activeList && (
        <ShareDialog listId={activeList.id} onClose={() => setShowShare(false)} />
      )}
    </>
  )
}

/* ── Share Dialog Component ── */
function ShareDialog({ listId, onClose }: { listId: string; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState('read')
  const [shares, setShares] = useState<{ user_email: string; permission: string }[]>([])

  useEffect(() => {
    apiClient.get<any[]>(`/api/v1/crm/todo/lists/${listId}/shares`).then(d => setShares(d || [])).catch(() => {})
  }, [listId])

  const addShare = async () => {
    if (!email.trim()) return
    try {
      await apiClient.post(`/api/v1/crm/todo/lists/${listId}/share`, { email: email.trim(), permission })
      setShares(prev => [...prev, { user_email: email.trim(), permission }])
      setEmail('')
    } catch {}
  }

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={e => e.stopPropagation()}>
        <h3>Share List</h3>
        <div className="sd-field">
          <input type="text" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
          <select value={permission} onChange={e => setPermission(e.target.value)}>
            <option value="read">Read</option>
            <option value="write">Write</option>
          </select>
          <button className="btn-primary" style={{height:36,fontSize:12}} onClick={addShare}>Add</button>
        </div>
        {shares.length > 0 && (
          <div className="sd-shared">
            {shares.map((s, i) => (
              <div key={i} className="sd-row">
                <span className="sd-email">{s.user_email}</span>
                <span className="sd-perm">{s.permission}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{textAlign:'right'}}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
