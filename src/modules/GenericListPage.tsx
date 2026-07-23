import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, X, Trash2, Edit3, ChevronRight, MoreHorizontal, Download, ArrowUpDown } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { CellRenderer, FieldsRenderer } from './shared/FieldsRenderer'
import { buildPayload, defaultForm, apiErrorToString } from './shared/field-utils'
import { statusColors } from './module-types'
import type { ModuleConfig, EntityRecord, ListResponse } from './module-types'

interface Props {
  config: ModuleConfig
  extraData?: Record<string, any>
}

const FILTERABLE_TYPES = ['select', 'status', 'text', 'title', 'number', 'date']

export default function GenericListPage({ config, extraData }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EntityRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EntityRecord | null>(null)
  const [form, setForm] = useState<Record<string, any>>(() => defaultForm(config.fields))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState<Record<string, any>>({})
  const [bulkSaving, setBulkSaving] = useState(false)

  const [page, setPage] = useState(1)
  const pageSize = 50

  const [sortBy, setSortBy] = useState('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const [filters, setFilters] = useState<Record<string, string>>({})
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState('')
  const [filterValue, setFilterValue] = useState('')

  const [sortOpen, setSortOpen] = useState(false)
  const [sortField, setSortField] = useState('')

  const [view, setView] = useState<'table' | 'gallery' | 'board' | 'kanban'>('table')
  const [viewOpen, setViewOpen] = useState(false)

  const [propsOpen, setPropsOpen] = useState(false)
  const [visibleCols, setVisibleCols] = useState<string[]>(config.listColumns)

  const [settingsOpen, setSettingsOpen] = useState(false)

  const [groupBy, setGroupBy] = useState('')
  const [condColor, setCondColor] = useState(true)

  const fetchRef = useRef(0)
  const fetchQueued = useRef(false)

  const buildQs = () => {
    const params = new URLSearchParams()
    params.set('offset', String((page - 1) * pageSize))
    params.set('limit', String(pageSize))
    if (query) params.set('search', query)
    if (sortBy) {
      params.set('sort_by', sortBy)
      params.set('sort_order', sortOrder)
    }
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v)
    }
    return '?' + params.toString()
  }

  const doFetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.get<ListResponse>(`${config.apiPath}${buildQs()}`)
      setData(res)
    } catch (e: any) {
      setError(e.detail || e.message)
    } finally {
      setLoading(false)
    }
  }, [config.apiPath, sortBy, sortOrder, query, page, filters])

  const fetchDataRef = useRef(doFetch)
  fetchDataRef.current = doFetch

  useEffect(() => {
    if (fetchQueued.current) return
    fetchQueued.current = true
    const id = ++fetchRef.current
    const t = setTimeout(() => {
      if (id === fetchRef.current) {
        fetchDataRef.current()
        fetchQueued.current = false
      }
    }, 300)
    return () => { clearTimeout(t); if (id === fetchRef.current) fetchQueued.current = false }
  }, [query, page, sortBy, sortOrder, filters])

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.meta?.totalPages || (total ? Math.ceil(total / pageSize) : 1)

  const filterableFields = config.fields.filter(f =>
    FILTERABLE_TYPES.includes(f.type) && f.key !== 'created_at' && f.key !== 'updated_at'
  )

  const toggleSort = (fieldKey: string) => {
    if (sortBy === fieldKey) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(fieldKey)
      setSortOrder('asc')
    }
    setPage(1)
  }

  const addFilter = () => {
    if (!filterField) return
    setFilters(f => ({ ...f, [filterField]: filterValue }))
    setFilterField('')
    setFilterValue('')
    setFilterOpen(false)
    setPage(1)
  }

  const removeFilter = (key: string) => {
    setFilters(f => {
      const next = { ...f }
      delete next[key]
      return next
    })
    setPage(1)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map(i => i.id)))
    }
  }

  const handleChange = (key: string, value: any) => {
    setForm(f => ({ ...f, [key]: value }))
  }

  const resetForm = () => setForm(defaultForm(config.fields))

  const openCreate = () => { resetForm(); setCreateOpen(true) }
  const openEdit = (item: EntityRecord) => {
    const f: Record<string, any> = {}
    for (const field of config.fields) {
      let val = item[field.key]
      if (field.type === 'multi_select' && typeof val === 'string') {
        val = val ? [val] : []
      }
      f[field.key] = val ?? (field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '')
    }
    setForm(f)
    setEditTarget(item)
  }

  const handleCreate = async () => {
    const nameField = config.fields.find(f => f.type === 'title')
    if (nameField && !form[nameField.key]?.toString().trim()) return
    setSaving(true)
    try {
      await apiClient.post(config.apiPath, buildPayload(form, config.fields))
      resetForm()
      setCreateOpen(false)
      fetchDataRef.current()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editTarget) return
    const nameField = config.fields.find(f => f.type === 'title')
    if (nameField && !form[nameField.key]?.toString().trim()) return
    setSaving(true)
    try {
      await apiClient.patch(`${config.apiPath}/${editTarget.id}`, buildPayload(form, config.fields))
      setEditTarget(null)
      fetchDataRef.current()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiClient.delete(`${config.apiPath}/${deleteTarget.id}`)
      setDeleteTarget(null)
      fetchDataRef.current()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setDeleting(false) }
  }

  const openBulkUpdate = () => {
    setBulkForm({})
    setBulkOpen(true)
  }

  const handleBulkUpdate = async () => {
    const changes = Object.fromEntries(
      Object.entries(bulkForm).filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && v.length === 0))
    )
    if (Object.keys(changes).length === 0) { alert('No changes to apply'); return }
    setBulkSaving(true)
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          apiClient.patch(`${config.apiPath}/${id}`, changes).catch(e => {
            console.error(`Failed to update ${id}:`, e)
            return null
          })
        )
      )
      setBulkOpen(false)
      setSelectedIds(new Set())
      fetchDataRef.current()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setBulkSaving(false) }
  }

  const renderCell = (item: EntityRecord, fieldKey: string) => {
    if (fieldKey === 'name' || fieldKey === config.titleField || (!config.titleField && fieldKey === config.fields[0]?.key)) {
      const val = item[fieldKey] || item['name'] || ''
      return (
        <button onClick={() => navigate(`/${config.routePrefix || config.name + 's'}/${item.id}`)}
          className="row-name row-name-btn">
          <div className="avatar-sm">
            {String(val).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span className="row-name-text">{val}</span>
        </button>
      )
    }
    const field = config.fields.find(f => f.key === fieldKey)
    if (field) return <CellRenderer value={item[fieldKey]} field={field} />
    return <span>{item[fieldKey] ?? '—'}</span>
  }

  const nameField = config.fields.find(f => f.type === 'title')

  const filterCount = Object.values(filters).filter(Boolean).length
  const countFieldsHidden = config.fields.filter(f => f.type !== 'title' && f.type !== 'created_time' && f.type !== 'last_edited_time' && !visibleCols.includes(f.key)).length

  return (
    <div>
      <div className="breadcrumb">
        <span>Home</span>
        <ChevronRight />
        <span className="breadcrumb-current">{config.labelPlural}</span>
      </div>

      <div className="page-header">
        <div>
          <h1>{config.labelPlural}</h1>
          <p>{total} {config.labelPlural.toLowerCase()}</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" /> New {config.label}
          </button>
        </div>
      </div>

      <div className="data-table">
        <div className="db-toolbar">
          <div className="db-search">
            <Search className="w-4 h-4" />
            <input type="text" placeholder={`Search ${config.labelPlural.toLowerCase()}...`}
              value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="toolbar-actions">
            <button className={`toolbar-btn ${filterCount > 0 ? 'active' : ''}`} title="Filter"
              onClick={() => setFilterOpen(!filterOpen)}>
              <Search className="w-4 h-4" />{filterCount > 0 ? ` (${filterCount})` : ''}
            </button>
            <button className={`toolbar-btn ${sortBy ? 'active' : ''}`} title="Sort" onClick={() => {
              setSortField(sortBy)
              setSortOpen(!sortOpen)
            }}>
              <ArrowUpDown className="w-4 h-4" />{sortBy ? ` ${sortOrder === 'asc' ? '↑' : '↓'}` : ''}
            </button>
            <div className="toolbar-sep" />
            <div style={{ position: 'relative' }}>
              <button className={`toolbar-btn ${view !== 'table' ? 'active' : ''}`} title="View"
                onClick={() => setViewOpen(!viewOpen)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
              </button>
            </div>
            <div className="toolbar-sep" />
            <div style={{ position: 'relative' }}>
              <button className={`toolbar-btn ${propsOpen ? 'active' : ''}`} title="Properties" onClick={() => setPropsOpen(!propsOpen)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>
              </button>
            </div>
            <div className="toolbar-sep" />
            <div style={{ position: 'relative' }}>
              <button className={`toolbar-btn ${settingsOpen ? 'active' : ''}`} title="Settings"
                onClick={() => setSettingsOpen(!settingsOpen)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </div>
          </div>
          <div className="toolbar-popover-layer">
            {sortOpen && (
              <div className="sort-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <select value={sortField} onChange={e => setSortField(e.target.value)} className="input-field"
                    style={{ fontSize: '12px', padding: '6px 8px' }}>
                    <option value="">— Select a field —</option>
                    {config.fields.filter(f => f.sortable !== false).map(f => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className={`${sortOrder === 'asc' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSortOrder('asc')} style={{ flex: 1, height: '30px', fontSize: '12px', padding: '0 8px' }}>↑ Ascending</button>
                    <button className={`${sortOrder === 'desc' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSortOrder('desc')} style={{ flex: 1, height: '30px', fontSize: '12px', padding: '0 8px' }}>↓ Descending</button>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', borderTop: '1px solid var(--color-divider)', paddingTop: '8px' }}>
                    <button className="btn-ghost" style={{ fontSize: '12px', padding: '4px 10px' }}
                      onClick={() => { setSortBy(''); setSortOrder('desc'); setSortField(''); setSortOpen(false); setPage(1) }}>
                      Clear
                    </button>
                    <button className="btn-primary" style={{ fontSize: '12px', padding: '4px 10px' }}
                      disabled={!sortField}
                      onClick={() => { setSortBy(sortField); setSortOrder(sortOrder); setSortOpen(false); setPage(1) }}>
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
            {viewOpen && (
              <div className="view-dropdown">
                {(['table', 'gallery', 'board', 'kanban'] as const).map(v => (
                  <button key={v} className={`view-option${view === v ? ' active' : ''}`}
                    onClick={() => { setView(v); setViewOpen(false) }}>
                    <span className="view-icon">{
                      v === 'table' ? '▦' : v === 'gallery' ? '⊞' : v === 'board' ? '📋' : '📌'
                    }</span>
                    {v === 'table' ? 'Table' : v === 'gallery' ? 'Gallery' : v === 'board' ? 'Board' : 'Kanban'}
                  </button>
                ))}
              </div>
            )}
            {propsOpen && (
              <div className="view-dropdown" style={{ width: '200px' }}>
                {config.fields.filter(f => f.type !== 'created_time' && f.type !== 'last_edited_time').map(f => {
                  const locked = f.type === 'title'
                  const checked = visibleCols.includes(f.key)
                  return (
                    <label key={f.key} className="view-option" style={{ opacity: locked ? 0.55 : 1, cursor: locked ? 'default' : 'pointer' }}>
                      <input type="checkbox" checked={checked} disabled={locked}
                        onChange={() => {
                          if (locked) return
                          setVisibleCols(prev => prev.includes(f.key) ? prev.filter(k => k !== f.key) : [...prev, f.key])
                        }}
                        style={{ width: '15px', height: '15px', accentColor: 'var(--color-primary)' }} />
                      <span style={{ flex: 1 }}>{f.label}</span>
                      {locked && <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>Always</span>}
                    </label>
                  )
                })}
              </div>
            )}
            {settingsOpen && (
              <div className="settings-panel">
                <div className="settings-section">
                  <div className="settings-section-title">View</div>

                  <div className="settings-row">
                    <span className="settings-label">Layout</span>
                    <div className="settings-chip-group">
                      {(['table', 'gallery', 'board', 'kanban'] as const).map(v => (
                        <button key={v}
                          className={`settings-chip${view === v ? ' active' : ''}`}
                          onClick={() => setView(v)}>
                          {v === 'table' ? '▦ Table' : v === 'gallery' ? '⊞ Gallery' : v === 'board' ? '📋 Board' : '📌 Kanban'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-row">
                    <span className="settings-label">Properties</span>
                    <button className="settings-action-btn" onClick={() => { setPropsOpen(true); setSettingsOpen(false) }}>
                      {visibleCols.length} fields visible <span className="settings-chevron">→</span>
                    </button>
                  </div>

                  <div className="settings-row">
                    <span className="settings-label">Filter</span>
                    <button className="settings-action-btn" onClick={() => { setFilterOpen(!filterOpen); setSettingsOpen(false) }}>
                      {filterCount > 0 ? `${filterCount} active` : 'None'} <span className="settings-chevron">→</span>
                    </button>
                  </div>

                  <div className="settings-row">
                    <span className="settings-label">Sort</span>
                    <button className="settings-action-btn" onClick={() => { setSortOpen(!sortOpen); setSettingsOpen(false) }}>
                      {sortBy ? `${sortBy} ${sortOrder === 'asc' ? '↑' : '↓'}` : 'None'} <span className="settings-chevron">→</span>
                    </button>
                  </div>

                  <div className="settings-row">
                    <span className="settings-label">Group</span>
                    <select className="settings-select" value={groupBy}
                      onChange={e => { setGroupBy(e.target.value); setPage(1) }}>
                      <option value="">No grouping</option>
                      {config.fields.filter(f => f.type === 'status' || f.type === 'select').map(f => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">Database</div>

                  <div className="settings-row">
                    <span className="settings-label">Source</span>
                    <span className="settings-value">{config.label}</span>
                  </div>

                  <div className="settings-row">
                    <span className="settings-label">Conditional color</span>
                    <label className="settings-toggle">
                      <input type="checkbox" checked={condColor}
                        onChange={e => setCondColor(e.target.checked)} />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <button className="settings-coming-btn" onClick={() => { navigator.clipboard?.writeText?.(window.location.href) }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    Copy link to view
                  </button>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">Advanced</div>

                  <button className="settings-coming-btn disabled" disabled title="Coming soon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    Edit properties {countFieldsHidden > 0 ? <>({countFieldsHidden} hidden)</> : ''}
                    <span className="coming-soon-badge">Soon</span>
                  </button>

                  <button className="settings-coming-btn disabled" disabled title="Coming soon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    Automations
                    <span className="coming-soon-badge">Soon</span>
                  </button>

                  <button className="settings-coming-btn disabled" disabled title="Coming soon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.37 4.06a2.5 2.5 0 0 1 3.53 3.53L9 18l-4 1 1-4Z"/></svg>
                    AI Autofill
                    <span className="coming-soon-badge">Soon</span>
                  </button>

                  <button className="settings-coming-btn disabled" disabled title="Coming soon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    View archived
                    <span className="coming-soon-badge">Soon</span>
                  </button>

                  <button className="settings-coming-btn disabled" disabled title="Coming soon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Lock database
                    <span className="coming-soon-badge">Soon</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {filterOpen && (
          <div className="filter-panel">
            <div className="filter-row">
              <select value={filterField} onChange={e => setFilterField(e.target.value)} className="input-field filter-field-select">
                <option value="">— Field —</option>
                {filterableFields.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              {filterField && filterableFields.find(f => f.key === filterField)?.options ? (
                <select value={filterValue} onChange={e => setFilterValue(e.target.value)} className="input-field filter-value-input">
                  <option value="">— All —</option>
                  {filterableFields.find(f => f.key === filterField)?.options?.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input type="text" value={filterValue} onChange={e => setFilterValue(e.target.value)}
                  placeholder="Value" className="input-field filter-value-input" disabled={!filterField}
                  onKeyDown={e => e.key === 'Enter' && addFilter()} />
              )}
              <button onClick={addFilter} disabled={!filterField || !filterValue} className="btn-primary filter-apply">Apply</button>
              <button onClick={() => setFilterOpen(false)} className="btn-ghost filter-cancel">Cancel</button>
            </div>
          </div>
        )}

        {filterCount > 0 && (
          <div className="active-filters">
            {Object.entries(filters).filter(([,v]) => v).map(([k, v]) => {
              const field = config.fields.find(f => f.key === k)
              return (
                <span key={k} className="filter-tag">
                  {field?.label || k}: {v}
                  <button onClick={() => removeFilter(k)} className="filter-tag-x"><X className="icon-12" /></button>
                </span>
              )
            })}
            <button onClick={() => { setFilters({}); setPage(1) }} className="btn-ghost filter-clear">Clear all</button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-faint)' }}>Loading...</div>
        ) : error ? (
          <div className="error-box" style={{ padding: '20px' }}>
            <span className="error-text">{error}</span>
            <button onClick={() => fetchDataRef.current()} className="error-retry-btn">Retry</button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">No {config.labelPlural.toLowerCase()} found</div>
        ) : view === 'gallery' ? (
          <div className="contact-grid">
            {items.map(item => {
              const initials = (item['name'] || '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
              const statusClass = statusColors[item['status']] || 'tag-default'
              const tags = Array.isArray(item['tags']) ? item['tags'] : []
              const company = item['company']?.name || item['company'] || ''
              return (
                <div key={item.id} className="contact-card" onClick={() => navigate(`/${config.name}s/${item.id}`)}>
                  <div className="contact-card-avatar">{initials}</div>
                  <div className="contact-card-name">{item['name'] || '—'}</div>
                  {company && <div className="contact-card-company">{company}</div>}
                  {item['job_title'] && <div className="contact-card-title">{item['job_title']}</div>}
                  {item['email'] && <div className="contact-card-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> {item['email']}</div>}
                  {item['phone'] && <div className="contact-card-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> {item['phone']}</div>}
                  <div className="contact-card-footer">
                    <span className={`select-tag ${statusClass}`}>{item['status'] || 'Active'}</span>
                    {tags.slice(0, 2).map((t: string) => <span key={t} className="tag">{t}</span>)}
                    {tags.length > 2 && <span className="tag">+{tags.length - 2}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : view === 'board' || view === 'kanban' ? (
          <BoardView items={items} config={config} navigate={navigate} groupBy={view === 'board' ? 'status' : 'contact_type'} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
              <thead>
                <tr>
                  <th className="th-checkbox">
                    <input type="checkbox" className="row-checkbox"
                      checked={items.length > 0 && selectedIds.size === items.length}
                      onChange={toggleSelectAll} />
                  </th>
                  {visibleCols.map(col => {
                    const field = config.fields.find(f => f.key === col)
                    const canSort = field?.sortable !== false
                    return (
                      <th key={col}
                        className={canSort ? 'th-sortable' : ''}
                        onClick={() => canSort && toggleSort(col)}>
                        {field?.label || col}
                        {sortBy === col && (
                          <span className="sort-indicator">{sortOrder === 'asc' ? ' ↑' : ' ↓'}</span>
                        )}
                      </th>
                    )
                  })}
                  <th className="col-menu"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className={selectedIds.has(item.id) ? 'row-selected' : ''}>
                    <td className="th-checkbox" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="row-checkbox"
                        checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
                    </td>
                    {visibleCols.map(col => (
                      <td key={col}>{renderCell(item, col)}</td>
                    ))}
                    <td className="col-menu" onClick={e => e.stopPropagation()}>
                      <div className="menu-wrap">
                        <button className="menu-dots" title="More actions">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        <div className="menu-dropdown">
                          <button className="menu-item" onClick={() => openEdit(item)}>
                            <Edit3 /> Edit
                          </button>
                          <button className="menu-item text-notification" onClick={() => setDeleteTarget(item)}>
                            <Trash2 /> Delete
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {selectedIds.size > 0 && (
              <div className="bulk-bar">
                <span className="count">{selectedIds.size} selected</span>
                <button className="btn-secondary" onClick={openBulkUpdate}>Bulk Update</button>
                <button className="btn-secondary">Add Tag</button>
                <button className="btn-secondary">Export</button>
                <button className="btn-notification" onClick={() => {
                  const first = items.find(i => selectedIds.has(i.id))
                  if (first) setDeleteTarget(first)
                }}>
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, padding: '10px 0' }}>
          <span className="text-faint" style={{ fontSize: 12 }}>{total} {config.labelPlural.toLowerCase()}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="toolbar-btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              ← Prev
            </button>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 8px' }}>
              Page {page} of {totalPages}
            </span>
            <button className="toolbar-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setCreateOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>New {config.label}</h2>
              <button onClick={() => setCreateOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {config.fields.filter(f => f.editable !== false && !['rollup', 'formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(f.type) && f.key !== 'created_at' && f.key !== 'updated_at').map(f => (
                  <FieldsRenderer key={f.key} field={f} form={form} onChange={handleChange}
                    editOpen={true} relationData={{ companies: extraData?.companies }} />
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setCreateOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={saving || (nameField ? !form[nameField.key]?.toString().trim() : false)}
                className="btn-primary">{saving ? 'Saving...' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditTarget(null) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Edit {config.label}</h2>
              <button onClick={() => setEditTarget(null)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {config.fields.filter(f => f.editable !== false && !['rollup', 'formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by'].includes(f.type)).map(f => (
                  <FieldsRenderer key={f.key} field={f} form={form} onChange={handleChange}
                    editOpen={true} relationData={{ companies: extraData?.companies }} />
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleEdit} disabled={saving || (nameField ? !form[nameField.key]?.toString().trim() : false)}
                className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
          <div className="modal modal-sm">
            <div className="delete-body">
              <div className="delete-icon-wrap"><Trash2 /></div>
              <h2 className="delete-heading">Delete {config.label}</h2>
              <p className="delete-text">
                Are you sure you want to delete <strong>{deleteTarget['name'] || deleteTarget.id}</strong>?
              </p>
            </div>
            <div className="modal-foot">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="btn-notification">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setBulkOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Bulk Update {config.labelPlural}</h2>
              <button onClick={() => setBulkOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                Updating <strong>{selectedIds.size}</strong> {config.labelPlural.toLowerCase()}. Only fields with <strong>bulk editable</strong> permission are shown. Empty fields = unchanged.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {config.fields.filter(f => f.editable !== false && f.bulkEditable && !['rollup', 'formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(f.type)).map(f => (
                  <FieldsRenderer key={f.key} field={f} form={bulkForm} onChange={(k, v) => setBulkForm(f => ({ ...f, [k]: v }))}
                    editOpen={true} relationData={{ companies: extraData?.companies }} />
                ))}
              </div>
              {config.fields.filter(f => f.editable !== false && f.bulkEditable).length === 0 && (
                <div className="empty-state">No fields available for bulk update</div>
              )}
            </div>
            <div className="modal-foot">
              <button onClick={() => setBulkOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleBulkUpdate} disabled={bulkSaving}
                className="btn-primary">{bulkSaving ? 'Updating...' : `Update ${selectedIds.size} records`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════
   Board / Kanban View Component
   ═══════════════════════════════════════════ */
function BoardView({ items, config, navigate, groupBy }: {
  items: any[]; config: ModuleConfig; navigate: (path: string) => void; groupBy: string
}) {
  const groups: Record<string, any[]> = {}
  for (const item of items) {
    const val = item[groupBy] || 'Unassigned'
    if (!groups[val]) groups[val] = []
    groups[val].push(item)
  }
  const groupKeys = Object.keys(groups)

  return (
    <div className="kanban-scroll">
      <div className="board-view">
        {groupKeys.map(key => (
          <div key={key} className="kanban-col">
            <div className="kanban-col-head">
              <span className="board-col-title">{key}</span>
              <span className="board-col-count">{groups[key].length}</span>
            </div>
            {groups[key].map(item => {
              const initials = (item['name'] || '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
              return (
                <div key={item.id} className="board-card" onClick={() => navigate(`/${config.name}s/${item.id}`)}>
                  <div className="board-card-avatar">{initials}</div>
                  <div className="board-card-body">
                    <div className="board-card-name">{item['name'] || '—'}</div>
                    <div className="board-card-sub">{(item['company']?.name || item['company'] || '')}</div>
                    {item['email'] && <div className="board-card-field">✉️ {item['email']}</div>}
                    {item['phone'] && <div className="board-card-field">📞 {item['phone']}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
