import { useState, useEffect } from 'react'
import { Activity, Trash2, X } from 'lucide-react'
import { apiClient } from '../../lib/api'
import type { EntityRecord, ModuleConfig } from '../module-types'

interface Touchpoint {
  id: string; type: string; title: string; description: string | null
  company?: { name: string } | null; created_at: string
}
interface Deal {
  id: string; name: string; amount: number | null
  stage?: { id: string; name: string } | null
  probability: number; status: string
}
interface Note {
  id: string; title: string; content: string | null; pinned: boolean; created_at: string; contact_id: string
}
interface ActivityItem {
  id: string; action: string; entity_type: string; entity_id: string; created_at: string
}
interface ProjectLink {
  id: string; project_id: string; project_name: string
  project_amount: number | null; stage_name: string | null
  probability: number | null; role: string | null
}

function timeAgo(d: string): string {
  if (!d) return ''
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
function formatAmount(v: number | null): string {
  if (v == null) return '$0'
  return `$${v.toLocaleString()}`
}

export function TimelineTab({ entity, refresh }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ action: '', description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      apiClient.get<{ items: ActivityItem[] }>('/api/v1/crm/activities?page_size=100').catch(() => ({ items: [] })),
      apiClient.get<{ items: Touchpoint[] }>(`/api/v1/crm/touchpoints?contact_id=${entity.id}&page_size=100`).catch(() => ({ items: [] })),
    ]).then(([aRes, tpRes]) => {
      setActivities((aRes.items || []).filter((a: ActivityItem) => a.entity_id === entity.id))
      setTouchpoints(tpRes.items || [])
    })
  }, [entity.id])

  const timelineItems = [
    ...activities.map(a => ({ id: a.id, emoji: '📝', title: a.action, date: timeAgo(a.created_at), meta: a.entity_type?.replace(/_/g, ' '), sortKey: a.created_at })),
    ...touchpoints.map(tp => ({ id: tp.id, emoji: tp.type === 'call' ? '📞' : tp.type === 'email' ? '✉️' : tp.type === 'meeting' ? '🤝' : '📌', title: tp.title, date: timeAgo(tp.created_at), meta: tp.description || tp.type, sortKey: tp.created_at })),
  ].sort((a, b) => new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime())

  const handleLog = async () => {
    if (!form.action.trim()) return
    setSaving(true)
    try {
      await apiClient.post('/api/v1/crm/activities', {
        action: form.action, description: form.description,
        entity_type: 'contact', entity_id: entity.id,
      })
      setForm({ action: '', description: '' })
      setOpen(false)
      refresh()
    } catch (e: any) { alert(e.detail || e.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>Activity</h3>
          <button onClick={() => setOpen(true)} className="btn-ghost">+ Log activity</button>
        </div>
        {timelineItems.length === 0 ? (
          <div className="empty-state">No activity recorded yet</div>
        ) : (
          <div className="timeline" style={{ padding: '16px' }}>
            {timelineItems.map(item => (
              <div key={item.id} className="tl-item">
                <div className="tl-dot">{item.emoji}</div>
                <div className="tl-card">
                  <div className="tl-head">
                    <span className="t">{item.title}</span>
                    <span className="d">{item.date}</span>
                  </div>
                  <div className="tl-meta">{item.meta}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Log Activity</h2>
              <button onClick={() => setOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <div>
                  <label className="field-label">Action *</label>
                  <input type="text" value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                    placeholder="e.g. Called, Emailed, Meeting" className="input-field" />
                </div>
              </div>
              <div className="form-row-1">
                <div>
                  <label className="field-label">Description</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={3} placeholder="Brief description..." className="input-field" />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleLog} disabled={saving || !form.action.trim()}
                className="btn-primary">{saving ? 'Saving...' : 'Log'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function DealsTab(_props: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [deals, setDeals] = useState<Deal[]>([])
  useEffect(() => {
    apiClient.get<{ items: Deal[] }>('/api/v1/crm/deals?page_size=200')
      .then(r => setDeals((r.items || []).filter((d: Deal) => d.status === 'active')))
      .catch(() => {})
  }, [])

  return (
    <div className="panel">
      <div className="panel-head"><h3>Deals</h3></div>
      {deals.length === 0 ? (
        <div className="empty-state">No deals linked</div>
      ) : (
        <div className="flex-col">
          {deals.map(d => (
            <div key={d.id} className="list-row">
              <div className="list-main">
                <div className="list-title">{d.name}</div>
                <div className="list-sub">{d.stage?.name || '—'}</div>
              </div>
              <div className="text-right">
                <div className="list-title">{formatAmount(d.amount)}</div>
                <div className="list-sub">{d.probability ?? 0}%</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TouchpointsTab({ entity, refresh }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', type: 'meeting', description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient.get<{ items: Touchpoint[] }>(`/api/v1/crm/touchpoints?contact_id=${entity.id}&page_size=100`)
      .then(r => setTouchpoints(r.items || []))
      .catch(() => {})
  }, [entity.id])

  const handleAdd = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await apiClient.post(`/api/v1/crm/touchpoints`, {
        title: form.title, type: form.type, description: form.description || null, contact_id: entity.id,
      })
      setForm({ title: '', type: 'meeting', description: '' })
      setOpen(false)
      refresh()
    } catch (e: any) { alert(e.detail || e.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>Touchpoints</h3>
          <button onClick={() => setOpen(true)} className="btn-ghost">+ Add Touchpoint</button>
        </div>
        {touchpoints.length === 0 ? (
          <div className="empty-state">No touchpoints yet</div>
        ) : (
          <div className="flex-col">
            {touchpoints.map(tp => (
              <div key={tp.id} className="list-row">
                <div className="list-icon"><Activity /></div>
                <div className="list-main">
                  <div className="list-title">{tp.title}</div>
                  <div className="list-sub">{tp.description || '—'}</div>
                  <div className="list-sub mt-1 flex items-center gap-2">
                    <span className="badge badge-p3">{tp.type}</span>
                    {tp.company && <span>· {tp.company.name}</span>}
                    <span className="ml-auto text-faint text-xs">{timeAgo(tp.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Add Touchpoint</h2>
              <button onClick={() => setOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <label className="field-label">Title *</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Discovery call" className="input-field" />
              </div>
              <div className="form-row-1">
                <label className="field-label">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input-field">
                  <option value="meeting">Meeting</option>
                  <option value="call">Call</option>
                  <option value="email">Email</option>
                  <option value="namecard">NameCard</option>
                </select>
              </div>
              <div className="form-row-1">
                <label className="field-label">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2} placeholder="Brief description" className="input-field" />
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleAdd} disabled={saving || !form.title.trim()}
                className="btn-primary">{saving ? 'Saving...' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function NotesTab({ entity, refresh }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', content: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient.get<{ items: Note[] }>('/api/v1/crm/notes?page_size=100')
      .then(r => setNotes((r.items || []).filter((n: Note) => n.contact_id === entity.id)))
      .catch(() => {})
  }, [entity.id])

  const handleAdd = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await apiClient.post('/api/v1/crm/notes', {
        title: form.title, content: form.content || null, contact_id: entity.id,
      })
      setForm({ title: '', content: '' })
      setOpen(false)
      refresh()
    } catch (e: any) { alert(e.detail || e.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>Notes</h3>
          <button onClick={() => setOpen(true)} className="btn-ghost">+ Add Note</button>
        </div>
        {notes.length === 0 ? (
          <div className="empty-state">No notes yet</div>
        ) : (
          <div className="flex-col">
            {notes.map(n => (
              <div key={n.id} className="list-row flex-col items-stretch px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="list-title">{n.title}</div>
                  {n.pinned && <span className="badge badge-p1">Pinned</span>}
                </div>
                {n.content && <p className="list-sub mt-1 whitespace-pre-wrap">{n.content}</p>}
                <p className="list-sub mt-1 text-xs">{timeAgo(n.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Add Note</h2>
              <button onClick={() => setOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <label className="field-label">Title *</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Note title" className="input-field" />
              </div>
              <div className="form-row-1">
                <label className="field-label">Content</label>
                <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  rows={4} placeholder="Write your notes here..." className="input-field" />
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleAdd} disabled={saving || !form.title.trim()}
                className="btn-primary">{saving ? 'Saving...' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function ProjectsTab({ entity, refresh }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [projects, setProjects] = useState<ProjectLink[]>([])
  const [dealOptions, setDealOptions] = useState<{ id: string; name: string; amount: number | null }[]>([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient.get<{ items: ProjectLink[] }>(`/api/v1/crm/contacts/${entity.id}/projects?page_size=100`)
      .then(r => setProjects(r.items || []))
      .catch(() => {})
  }, [entity.id])

  const handleLink = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await apiClient.post(`/api/v1/crm/contacts/${entity.id}/projects`, { project_id: selected })
      setOpen(false)
      setSelected('')
      refresh()
    } catch (e: any) { alert(e.detail || e.message) }
    finally { setSaving(false) }
  }

  const handleRemove = async (linkId: string) => {
    if (!confirm('Remove this project from contact?')) return
    try {
      await apiClient.delete(`/api/v1/crm/contacts/${entity.id}/projects/${linkId}`)
      refresh()
    } catch (e: any) { alert(e.detail || e.message) }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>Projects</h3>
          <button onClick={async () => {
            try {
              const res = await apiClient.get<{ items: { id: string; name: string; amount: number | null }[] }>('/api/v1/crm/deals?page_size=200')
              setDealOptions(res.items || [])
              setOpen(true)
            } catch (e: any) { alert(e.detail || e.message) }
          }} className="btn-ghost">+ Link Project</button>
        </div>
        {projects.length === 0 ? (
          <div className="empty-state">No projects linked</div>
        ) : (
          <div className="flex-col">
            {projects.map(p => (
              <div key={p.id} className="list-row">
                <div className="list-main">
                  <div className="list-title">{p.project_name}</div>
                  <div className="list-sub">{p.stage_name || '—'}</div>
                </div>
                <div className="text-right flex items-center gap-3">
                  <div>
                    <div className="list-title">{p.project_amount ? formatAmount(p.project_amount) : '$0'}</div>
                    <div className="list-sub">{p.probability ?? 0}%</div>
                  </div>
                  <button onClick={() => handleRemove(p.id)} className="icon-btn text-notification" title="Remove">
                    <Trash2 className="icon-16" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Link Project</h2>
              <button onClick={() => setOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <label className="field-label">Select Project</label>
                <select value={selected} onChange={e => setSelected(e.target.value)} className="input-field">
                  <option value="">-- Choose a project --</option>
                  {dealOptions.map(d => (
                    <option key={d.id} value={d.id}>{d.name} {d.amount ? `($${d.amount})` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleLink} disabled={saving || !selected}
                className="btn-primary">{saving ? 'Linking...' : 'Link'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
