import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Activity, X, ChevronRight } from 'lucide-react'
import { apiClient } from '../../lib/api'
import type { EntityRecord, ModuleConfig } from '../module-types'

// ---------- Types ----------

interface Touchpoint {
  id: string; type: string; title: string; description: string | null
  contact_id?: string; company_id?: string; created_at: string
}
interface Note {
  id: string; title: string; content: string | null; pinned: boolean
  created_at: string; company_id?: string
}
interface ActivityItem {
  id: string; action: string; entity_type: string; entity_id: string; created_at: string
}
interface LinkRow { id: string; name: string; [k: string]: any }

// ---------- Helpers ----------

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

const typeEmoji: Record<string, string> = {
  call: '📞', email: '✉️', meeting: '🤝', namecard: '📇', default: '📌',
}

// ═══════════════════════════════════════════
//  Tabs
// ═══════════════════════════════════════════

/** Contacts tab — list all contacts belonging to this company */
export function ContactsTab({ entity: company }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [contacts, setContacts] = useState<LinkRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiClient.get<{ items: LinkRow[] }>('/api/v1/crm/contacts?page_size=500')
      .then(r => setContacts((r.items || []).filter(c => c.company_id === company.id)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [company.id])

  if (loading) return <div className="panel"><div className="panel-head"><h3>Contacts</h3></div><div className="empty-state">Loading...</div></div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Contacts ({contacts.length})</h3>
      </div>
      {contacts.length === 0 ? (
        <div className="empty-state">No contacts linked to this company</div>
      ) : (
        <div className="flex-col">
          {contacts.map(c => (
            <Link key={c.id} to={`/contacts/${c.id}`} className="list-row hover:bg-slate-50 no-underline">
              <div className="list-avatar">{c.name?.charAt(0)?.toUpperCase() || '?'}</div>
              <div className="list-main">
                <div className="list-title">{c.name}</div>
                <div className="list-sub">{c.job_title || c.email || '—'}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** Deals tab — list deals under this company */
export function DealsTab({ entity: company }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [deals, setDeals] = useState<LinkRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiClient.get<{ items: LinkRow[] }>(`/api/v1/crm/deals?company_id=${company.id}&page_size=200`)
      .then(r => setDeals(r.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [company.id])

  const fmt = (n: number | null) => n ? `$${n.toLocaleString()}` : '$0'

  if (loading) return <div className="panel"><div className="panel-head"><h3>Deals</h3></div><div className="empty-state">Loading...</div></div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Deals ({deals.length})</h3>
      </div>
      {deals.length === 0 ? (
        <div className="empty-state">No deals for this company</div>
      ) : (
        <div className="flex-col">
          {deals.map(d => (
            <div key={d.id} className="list-row">
              <div className="list-main">
                <div className="list-title">{d.name}</div>
                <div className="list-sub">
                  <span className={`badge badge-p3`}>{d.status}</span>
                  {d.probability != null && <span className="ml-2">{d.probability}%</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="list-title">{fmt(d.amount)}</div>
                <div className="list-sub">{d.currency || 'HKD'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Projects tab — deals as projects (since deals = projects in this system) */
export function ProjectsTab({ entity: company }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [projects, setProjects] = useState<LinkRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiClient.get<{ items: LinkRow[] }>(`/api/v1/crm/deals?company_id=${company.id}&page_size=200`)
      .then(r => setProjects(r.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [company.id])

  const fmt = (n: number | null) => n ? `$${n.toLocaleString()}` : '$0'

  if (loading) return <div className="panel"><div className="panel-head"><h3>Projects</h3></div><div className="empty-state">Loading...</div></div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Projects ({projects.length})</h3>
      </div>
      {projects.length === 0 ? (
        <div className="empty-state">No projects yet</div>
      ) : (
        <div className="flex-col">
          {projects.map(p => (
            <div key={p.id} className="list-row">
              <div className="list-main">
                <div className="list-title">{p.name}</div>
                <div className="list-sub">
                  Stage: {p.stage?.name || p.stage_name || '—'}
                </div>
              </div>
              <div className="text-right">
                <div className="list-title">{fmt(p.amount)}</div>
                <div className="list-sub">{p.status}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Products tab — products in use & proposed products */
export function ProductsTab({ entity: company }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [inUse, setInUse] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<Record<string, string>>({})

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiClient.get<any[]>(`/api/v1/crm/companies/${company.id}/products-in-use`).catch(() => []),
      apiClient.get<any[]>('/api/v1/crm/products?page_size=200').catch(() => ({ items: [] })),
    ]).then(([inUseRes, prodRes]) => {
      setInUse(inUseRes || [])
      const pmap: Record<string, string> = {}
      ;((prodRes as any).items || []).forEach((p: any) => { pmap[p.id] = p.name })
      setProducts(pmap)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [company.id])

  if (loading) return <div className="panel"><div className="panel-head"><h3>Products</h3></div><div className="empty-state">Loading...</div></div>

  return (
    <div className="panel">
      <div className="panel-head"><h3>Products In Use ({inUse.length})</h3></div>
      {inUse.length === 0 ? (
        <div className="empty-state">No products in use</div>
      ) : (
        <div className="flex-col">
          {inUse.map((p: any, i: number) => (
            <div key={p.product_id || i} className="list-row">
              <div className="list-main">
                <div className="list-title">{products[p.product_id] || p.product_id.slice(0, 8)}</div>
                {p.since_date && <div className="list-sub">Since {new Date(p.since_date).toLocaleDateString()}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Partners tab — distributor partners */
export function PartnersTab({ entity: company }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [partners, setPartners] = useState<any[]>([])
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiClient.get<any[]>(`/api/v1/crm/companies/${company.id}/partners`).catch(() => []),
      apiClient.get<{ items: LinkRow[] }>('/api/v1/crm/companies?page_size=500').catch(() => ({ items: [] })),
    ]).then(([pRes, cRes]) => {
      setPartners(pRes || [])
      const nmap: Record<string, string> = {}
      ;(cRes.items || []).forEach((c: any) => { nmap[c.id] = c.name })
      setCompanyNames(nmap)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [company.id])

  if (loading) return <div className="panel"><div className="panel-head"><h3>Partners</h3></div><div className="empty-state">Loading...</div></div>

  return (
    <div className="panel">
      <div className="panel-head"><h3>Partners ({partners.length})</h3></div>
      {partners.length === 0 ? (
        <div className="empty-state">No distributor partners</div>
      ) : (
        <div className="flex-col">
          {partners.map((p: any, i: number) => (
            <div key={`${p.partner_company_id}-${i}`} className="list-row">
              <div className="list-main">
                <div className="list-title">{companyNames[p.partner_company_id] || p.partner_company_id.slice(0, 8)}</div>
                <div className="list-sub">Relation: {p.relation_type || 'Partner'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Touchpoints tab */
export function TouchpointsTab({ entity: company, refresh }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', type: 'meeting', description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient.get<{ items: Touchpoint[] }>('/api/v1/crm/touchpoints?page_size=200')
      .then(r => setTouchpoints((r.items || []).filter(tp => tp.company_id === company.id)))
      .catch(() => {})
  }, [company.id])

  const handleAdd = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await apiClient.post('/api/v1/crm/touchpoints', {
        title: form.title, type: form.type, description: form.description || null,
        company_id: company.id,
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
          <h3>Touchpoints ({touchpoints.length})</h3>
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
                  placeholder="e.g. Quarterly review" className="input-field" />
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

/** Notes tab */
export function NotesTab({ entity: company, refresh }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', content: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient.get<{ items: Note[] }>('/api/v1/crm/notes?page_size=200')
      .then(r => setNotes((r.items || []).filter(n => n.company_id === company.id)))
      .catch(() => {})
  }, [company.id])

  const handleAdd = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await apiClient.post('/api/v1/crm/notes', {
        title: form.title, content: form.content || null, company_id: company.id,
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
          <h3>Notes ({notes.length})</h3>
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

/** Timeline tab — activity + touchpoints for this company */
export function TimelineTab({ entity: company, refresh }: { entity: EntityRecord; moduleConfig: ModuleConfig; refresh: () => void }) {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ action: '', description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      apiClient.get<{ items: ActivityItem[] }>('/api/v1/crm/activities?page_size=100').catch(() => ({ items: [] })),
      apiClient.get<{ items: Touchpoint[] }>('/api/v1/crm/touchpoints?page_size=100').catch(() => ({ items: [] })),
    ]).then(([aRes, tpRes]) => {
      setActivities((aRes.items || []).filter(a => a.entity_id === company.id))
      setTouchpoints((tpRes.items || []).filter(tp => tp.company_id === company.id))
    })
  }, [company.id])

  const timelineItems = [
    ...activities.map(a => ({ id: a.id, emoji: '📝', title: a.action, date: timeAgo(a.created_at), meta: a.entity_type?.replace(/_/g, ' '), sortKey: a.created_at })),
    ...touchpoints.map(tp => ({ id: tp.id, emoji: typeEmoji[tp.type] || typeEmoji.default, title: tp.title, date: timeAgo(tp.created_at), meta: tp.description || tp.type, sortKey: tp.created_at })),
  ].sort((a, b) => new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime())

  const handleLog = async () => {
    if (!form.action.trim()) return
    setSaving(true)
    try {
      await apiClient.post('/api/v1/crm/activities', {
        action: form.action, description: form.description,
        entity_type: 'company', entity_id: company.id,
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
                <label className="field-label">Action *</label>
                <input type="text" value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                  placeholder="e.g. Called, Emailed, Meeting" className="input-field" />
              </div>
              <div className="form-row-1">
                <label className="field-label">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Brief description..." className="input-field" />
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
