import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, X, Trash2, Edit3, ChevronRight, MoreHorizontal, Download, ArrowUpDown, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { CellRenderer, FieldsRenderer } from './shared/FieldsRenderer'
import { buildPayload, defaultForm, apiErrorToString } from './shared/field-utils'
import { statusColors } from './module-types'
import type { ModuleConfig, EntityRecord, ListResponse } from './module-types'
import { isModuleEnabled } from './enabled-modules'
import SlideDrawer from '../components/SlideDrawer'
import DetailDrawerContent from './shared/DetailDrawerContent'

interface Props {
  config: ModuleConfig
  extraData?: Record<string, any>
}

const FILTERABLE_TYPES = ['select', 'status', 'text', 'title', 'number', 'date', 'relation']

export default function GenericListPage({ config, extraData }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const [tableAtEnd, setTableAtEnd] = useState(false)

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

  type FilterOp = 'is' | 'is_not'
interface FilterEntry { op: FilterOp; value: string }
const [filters, setFilters] = useState<Record<string, FilterEntry>>(() => ({ ...((config as any).defaultFilters || {}) }))
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState('')
  const [filterOp, setFilterOp] = useState<FilterOp>('is')
  const [filterValue, setFilterValue] = useState('')
  const [filterChecked, setFilterChecked] = useState<string[]>([])
  const [filterValueOpen, setFilterValueOpen] = useState(false)
  const filterBtnRef = useRef<HTMLButtonElement>(null)
  const [filterPos, setFilterPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const [sortOpen, setSortOpen] = useState(false)
  const [sortField, setSortField] = useState('')

  const [view, setView] = useState<'table' | 'gallery' | 'board' | 'kanban'>('table')
  const [viewOpen, setViewOpen] = useState(false)

  const [propsOpen, setPropsOpen] = useState(false)
  const [visibleCols, setVisibleCols] = useState<string[]>(config.listColumns)
  const filteredCols = useMemo(() =>
    visibleCols.filter(col => {
      const f = config.fields.find(x => x.key === col)
      return !f?.dependsOnModule || isModuleEnabled(f.dependsOnModule)
    }), [visibleCols, config.fields])

  const [settingsOpen, setSettingsOpen] = useState(false)

  const [groupBy, setGroupBy] = useState('')
  const [condColor, setCondColor] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const quickComplete = async (item: EntityRecord) => {
    if (config.name !== 'task') return
    const newStatus = item['status'] === 'done' ? 'pending' : 'done'
    try {
      await apiClient.patch(`/api/v1/crm/tasks/${item.id}`, { status: newStatus })
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map(i =>
            i.id === item.id ? { ...i, status: newStatus } : i
          ),
        }
      })
    } catch {}
  }

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
      if (v.value) {
        if (v.op === 'is_not') params.set(k + '_not', v.value)
        else params.set(k, v.value)
      }
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

  // ─── Server-side filter preset (tenant-level, not device) ───
  const PLURAL_MAP: Record<string, string> = { company: 'companies', contact: 'contacts', touchpoint: 'touchpoints' }
  const filterModuleKey = PLURAL_MAP[config.name] || (config.name === 'task' ? 'tasks' : config.name + 's')
  
  const loadFilterPreset = useCallback(async () => {
    try {
      const settings = await apiClient.get<{ module_key: string; settings?: any }[]>('/api/v1/crm/module-settings')
      const ms = settings?.find(s => s.module_key === filterModuleKey)
      if (ms?.settings?.filterPreset) {
        const p = ms.settings.filterPreset
        // Defensive: preset comes from the tenant DB and may be stale/malformed (older app
        // versions, manual edits). A non-array visibleCols used to crash GenericListPage at
        // render (visibleCols.filter) and blank the whole app (no error boundary) — which
        // surfaced as the toolbar/menu bar losing its buttons. Validate types before applying.
        const VALID_VIEWS = ['table', 'gallery', 'board', 'kanban'] as const
        if (p.filters && typeof p.filters === 'object' && !Array.isArray(p.filters))
          setFilters({ ...((config as any).defaultFilters || {}), ...p.filters })
        if (typeof p.query === 'string') setQuery(p.query)
        if (typeof p.sortBy === 'string' && p.sortBy) { setSortBy(p.sortBy); setSortOrder(p.sortOrder === 'asc' ? 'asc' : 'desc') }
        if (Array.isArray(p.visibleCols) && p.visibleCols.length > 0) {
          const known = new Set(config.fields.map(f => f.key))
          const cols = p.visibleCols.filter((c: any) => typeof c === 'string' && known.has(c))
          if (cols.length > 0) setVisibleCols(cols)
        }
        if (p.view && (VALID_VIEWS as readonly string[]).includes(p.view)) setView(p.view)
      }
    } catch { /* no-op — use defaults */ }
  }, [filterModuleKey])

  useEffect(() => { loadFilterPreset() }, [loadFilterPreset])

  const saveFilterPreset = useRef<() => void>(() => {})
  saveFilterPreset.current = () => {
    const payload = {
      module_key: filterModuleKey,
      enabled: true,
      settings: {
        filterPreset: {
          filters,
          query,
          sortBy,
          sortOrder,
          visibleCols,
          view,
        },
      },
    }
    apiClient.put(`/api/v1/crm/module-settings/${filterModuleKey}`, payload)
      .catch(() => {})
  }

  useEffect(() => {
    const t = setTimeout(() => saveFilterPreset.current?.(), 1500)
    return () => clearTimeout(t)
  }, [filters, query, sortBy, sortOrder, visibleCols, view])

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.meta?.totalPages || (total ? Math.ceil(total / pageSize) : 1)

  useEffect(() => {
    const el = tableScrollRef.current
    if (el) setTableAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
  }, [data])

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
    if (!filterField || !filterValue) return
    setFilters(f => ({ ...f, [filterField]: { op: filterOp, value: filterValue } } as Record<string, FilterEntry>))
    setFilterField('')
    setFilterOp('is')
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

  const RELATION_ROUTES: Record<string, string> = {
    contacts: '/contacts',
    companies: '/companies',
    projects: '/projects',
    tasks: '/tasks',
    touchpoints: '/touchpoints',
    users: '',
  }

  const renderCell = (item: EntityRecord, fieldKey: string) => {
    if (fieldKey === 'name' || fieldKey === config.titleField || (!config.titleField && fieldKey === config.fields[0]?.key)) {
      const val = item[fieldKey] || item['name'] || ''
      return (
        <button onClick={() => setSelectedId(item.id)}
          className="row-name row-name-btn">
          <div className="avatar-sm">
            {String(val).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span className="row-name-text">{val}</span>
        </button>
      )
    }
    const field = config.fields.find(f => f.key === fieldKey)
    if (field) {
      // Relation fields → clickable link to related detail page
      if (field.type === 'relation' && typeof item[fieldKey] === 'object' && item[fieldKey]?.id) {
        const resource = field.relation?.resource || ''
        const route = RELATION_ROUTES[resource]
        const href = route ? `${route}/${item[fieldKey].id}` : ''
        if (href) {
          return (
            <a href={href} onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(href) }}
              className="badge badge-p3 glp-rel-link">
              {item[fieldKey].name || item[fieldKey].title || item[fieldKey].id}
            </a>
          )
        }
      }
      return <CellRenderer value={item[fieldKey]} field={field} />
    }
    return <span>{item[fieldKey] ?? '—'}</span>
  }

  const nameField = config.fields.find(f => f.type === 'title')

  const filterCount = Object.values(filters).filter(v => v.value).length
  const countFieldsHidden = config.fields.filter(f => f.type !== 'title' && f.type !== 'created_time' && f.type !== 'last_edited_time' && !visibleCols.includes(f.key)).length

  return (
    <div>
      <div className="breadcrumb">
        <span>{t('common.home')}</span>
        <ChevronRight />
        <span className="breadcrumb-current">{t('pages.' + filterModuleKey + '.title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1>{t('pages.' + filterModuleKey + '.title')}</h1>
          <p>{total} {t('pages.' + filterModuleKey + '.title').toLowerCase()}</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary glp-icon-btn" title={t('common.export')}>
            <Download className="w-4 h-4" />
          </button>
          <button className="btn-secondary glp-icon-btn" title="Upload">
            <Upload className="w-4 h-4" />
          </button>
          <button onClick={openCreate} className="btn-primary glp-icon-btn" title={t('pages.' + filterModuleKey + '.new')}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="data-table">
        <div className="db-toolbar">
          <div className="db-search">
            <Search className="w-4 h-4" />
            <input type="text" placeholder={t('pages.' + filterModuleKey + '.searchPlaceholder') || (t('common.search') + ' ' + t('pages.' + filterModuleKey + '.title').toLowerCase() + '...')}
              value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="toolbar-actions">
            <button className={`toolbar-btn ${filterCount > 0 ? 'active' : ''}`} title={t('common.filter')}
              onClick={() => setFilterOpen(!filterOpen)}>
              <Search className="w-4 h-4" />{filterCount > 0 ? ` (${filterCount})` : ''}
            </button>
            <button className={`toolbar-btn ${sortBy ? 'active' : ''}`} title={t('filter.sortBy')} onClick={() => {
              setSortField(sortBy)
              setSortOpen(!sortOpen)
            }}>
              <ArrowUpDown className="w-4 h-4" />{sortBy ? ` ${sortOrder === 'asc' ? '↑' : '↓'}` : ''}
            </button>
            <div className="toolbar-sep" />
            <div className="pos-relative">
              <button className={`toolbar-btn ${view !== 'table' ? 'active' : ''}`} title={t('common.seeMore')}
                onClick={() => setViewOpen(!viewOpen)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
              </button>
            </div>
            <div className="toolbar-sep" />
            <div className="pos-relative">
              <button className={`toolbar-btn ${propsOpen ? 'active' : ''}`} title={t('filter.title')} onClick={() => setPropsOpen(!propsOpen)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>
              </button>
            </div>
            <div className="toolbar-sep" />
            <div className="pos-relative">
              <button className={`toolbar-btn ${settingsOpen ? 'active' : ''}`} title={t('nav.settings')}
                onClick={() => setSettingsOpen(!settingsOpen)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </div>
          </div>
          <div className="toolbar-popover-layer">
            {sortOpen && (
              <div className="sort-panel">
                <div className="glp-sort-body">
                  <select value={sortField} onChange={e => setSortField(e.target.value)} className="input-field glp-sort-select">
                    <option value="">{t('filter.sortBy')}</option>
                    {config.fields.filter(f => f.sortable !== false).map(f => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                  <div className="glp-sort-op-row">
                    <button className={`${sortOrder === 'asc' ? 'btn-primary' : 'btn-ghost'} glp-sort-op-btn`}
                      onClick={() => setSortOrder('asc')}>{t('filter.ascending')}</button>
                    <button className={`${sortOrder === 'desc' ? 'btn-primary' : 'btn-ghost'} glp-sort-op-btn`}
                      onClick={() => setSortOrder('desc')}>{t('filter.descending')}</button>
                  </div>
                  <div className="glp-sort-footer">
                    <button className="btn-ghost glp-sort-btn"
                      onClick={() => { setSortBy(''); setSortOrder('desc'); setSortField(''); setSortOpen(false); setPage(1) }}>
                      {t('common.clear')}
                    </button>
                    <button className="btn-primary glp-sort-btn"
                      disabled={!sortField}
                      onClick={() => { setSortBy(sortField); setSortOrder(sortOrder); setSortOpen(false); setPage(1) }}>
                      {t('common.apply')}
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
                    {v === 'table' ? t('pages.' + filterModuleKey + '.title') : v === 'gallery' ? 'Gallery' : v === 'board' ? 'Board' : 'Kanban'}
                  </button>
                ))}
              </div>
            )}
            {propsOpen && (
              <div className="view-dropdown glp-props-dropdown">
                {config.fields.filter(f => f.type !== 'created_time' && f.type !== 'last_edited_time').map(f => {
                  const locked = f.type === 'title'
                  const checked = visibleCols.includes(f.key)
                  return (
                    <label key={f.key} className={"view-option" + (locked ? ' glp-view-option-locked' : '')}>
                      <input type="checkbox" checked={checked} disabled={locked}
                        onChange={() => {
                          if (locked) return
                          setVisibleCols(prev => prev.includes(f.key) ? prev.filter(k => k !== f.key) : [...prev, f.key])
                        }}
                        className="glp-view-checkbox" />
                      <span className="glp-view-option-label">{f.label}</span>
                      {locked && <span className="glp-view-option-always">Always</span>}
                    </label>
                  )
                })}
              </div>
            )}
            {settingsOpen && (
              <div className="settings-panel">
                <div className="settings-section">
                  <div className="settings-section-title">{t('common.seeMore')}</div>

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
                    <span className="settings-label">{t('filter.title')}</span>
                    <button className="settings-action-btn" onClick={() => { setPropsOpen(true); setSettingsOpen(false) }}>
                      {visibleCols.length} fields visible <span className="settings-chevron">→</span>
                    </button>
                  </div>

                  <div className="settings-row">
                    <span className="settings-label">{t('common.filter')}</span>
                    <button className="settings-action-btn" onClick={() => { setFilterOpen(!filterOpen); setSettingsOpen(false) }}>
                      {filterCount > 0 ? `${filterCount} active` : 'None'} <span className="settings-chevron">→</span>
                    </button>
                  </div>

                  <div className="settings-row">
                    <span className="settings-label">{t('filter.sortBy')}</span>
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
              <select value={filterField} onChange={e => { setFilterField(e.target.value); setFilterValue(''); setFilterOp('is'); setFilterChecked([]); }} className="input-field filter-field-select">
                <option value="">— {t('filter.title')} —</option>
                {filterableFields.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              {filterField && (() => {
                const selectedField = filterableFields.find(x => x.key === filterField)
                if (selectedField?.type === 'select' || selectedField?.type === 'status') {
                  return (
                    <select value={filterOp} onChange={e => setFilterOp(e.target.value as FilterOp)} className="input-field filter-op-select glp-filter-op-select">
                      <option value="is">is</option>
                      <option value="is_not">is not</option>
                    </select>
                  )
                }
                return null
              })()}
              {(() => {
                const f = filterField ? filterableFields.find(x => x.key === filterField) : null
                const opts = f?.options
                if (f && opts && opts.length > 0) {
                  return (
                    <div className="pos-relative glp-filter-value-wrap">
                      <button ref={filterBtnRef} onClick={() => {
                        setFilterValueOpen(o => {
                          if (!o && filterBtnRef.current) {
                            const r = filterBtnRef.current.getBoundingClientRect()
                            setFilterPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 220) })
                          }
                          return !o
                        })
                      }}
                        className="input-field filter-value-input glp-filter-value-btn">
                        <span className={"glp-filter-value-text" + (filterChecked.length ? ' has-value' : '')}>
                          {filterChecked.length > 0 ? `${filterChecked.length} selected` : 'Select values'}
                        </span>
                        <span className="glp-filter-value-caret">{filterValueOpen ? '▲' : '▼'}</span>
                      </button>
                      {filterValueOpen && <div className="popover-backdrop" onClick={() => setFilterValueOpen(false)} />}
                    </div>
                  )
                }
                return (
                  <input type="text" value={filterValue} onChange={e => setFilterValue(e.target.value)}
                    placeholder="Value" className="input-field filter-value-input" disabled={!filterField}
                    onKeyDown={e => e.key === 'Enter' && addFilter()} />
                )
              })()}
              <button onClick={() => {
                const val = filterChecked.length > 0 ? filterChecked.join(',') : filterValue
                if (!filterField || !val) return
                setFilters(f => ({ ...f, [filterField]: { op: filterOp, value: val } }))
                setFilterField('')
                setFilterOp('is')
                setFilterValue('')
                setFilterChecked([])
                setFilterOpen(false)
                setPage(1)
              }} disabled={!filterField || (filterChecked.length === 0 && !filterValue)} className="btn-primary filter-apply">Apply ({filterChecked.length > 0 ? filterChecked.length : '✓'})</button>
              <button onClick={() => setFilterOpen(false)} className="btn-ghost filter-cancel">{t('common.cancel')}</button>
            </div>
          </div>
        )}

        {filterCount > 0 && (
          <div className="active-filters">
            {Object.entries(filters).filter(([,v]) => v.value).map(([k, v]) => {
              const field = config.fields.find(f => f.key === k)
              const vals = v.value.split(',').filter(Boolean)
              const label = v.op === 'is_not'
                ? `${vals.map(v => v.trim()).join(' + ')} ⊘`
                : vals.map(v => v.trim()).join(' + ')
              return (
                <span key={k} className="filter-tag glp-filter-tag"
                  onClick={() => {
                    setFilterField(k)
                    setFilterOp(v.op)
                    setFilterChecked(vals.map(x => x.trim()))
                    setFilterValue(v.value)
                    setFilterOpen(true)
                  }}>
                  {field?.label || k}: {label}
                  <button onClick={() => removeFilter(k)} className="filter-tag-x"><X className="icon-12" /></button>
                </span>
              )
            })}
            <button onClick={() => { setFilters({ ...((config as any).defaultFilters || {}) }); setPage(1) }} className="btn-ghost filter-clear">{t('filter.clear')}</button>
          </div>
        )}

        {loading ? (
          <div className="glp-loading">{t('common.loading')}</div>
        ) : error ? (
          <div className="error-box p-20">
            <span className="error-text">{error}</span>
            <button onClick={() => fetchDataRef.current()} className="error-retry-btn">{t('common.retry')}</button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">{t('pages.' + filterModuleKey + '.empty') || ('No ' + t('pages.' + filterModuleKey + '.title').toLowerCase() + ' found')}</div>
        ) : view === 'gallery' ? (
          <div className="contact-grid">
            {items.map(item => {
              const initials = (item['name'] || '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
              const statusClass = statusColors[item['status']] || 'tag-default'
              const tags = Array.isArray(item['tags']) ? item['tags'] : []
              const company = item['company']?.name || item['company'] || ''
              return (
                <div key={item.id} className="contact-card" onClick={() => setSelectedId(item.id)}>
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
                <BoardView items={items} onSelect={setSelectedId} groupBy={view === 'board' ? 'status' : 'contact_type'} />
        ) : (
          <>
            <div className={`table-scroll${tableAtEnd ? ' at-end' : ''}`} ref={tableScrollRef}
              onScroll={() => {
                const el = tableScrollRef.current
                if (el) setTableAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
              }}>
              <table>
              <thead>
                <tr>
                  {config.name === 'task' && <th className="th-complete"></th>}
                  <th className="th-checkbox">
                    <input type="checkbox" className="row-checkbox"
                      checked={items.length > 0 && selectedIds.size === items.length}
                      onChange={toggleSelectAll} />
                  </th>
                  {filteredCols.map(col => {
                    const field = config.fields.find(f => f.key === col)
                    const canSort = field?.sortable !== false
                    return (
                      <th key={col}
                        className={(canSort ? 'th-sortable' : '') + (field?.type === 'title' || col === config.titleField ? ' glp-th-title' : '')}
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
                    {config.name === 'task' && (
                      <td className="td-complete" onClick={e => { e.stopPropagation(); quickComplete(item); }}>
                        <button className={`t-check${item['status'] === 'done' ? ' checked' : ''}`}
                          title={item['status'] === 'done' ? 'Mark pending' : 'Mark done'}>
                          {item['status'] === 'done' && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                        </button>
                      </td>
                    )}
                    <td className="th-checkbox" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="row-checkbox"
                        checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
                    </td>
                    {visibleCols.map(col => (
                      <td key={col}>{renderCell(item, col)}</td>
                    ))}
                    <td className="col-menu" onClick={e => e.stopPropagation()}>
                      <div className="menu-wrap">
                        <button className="menu-dots" title={t('common.seeMore')}>
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        <div className="menu-dropdown">
                          <button className="menu-item" onClick={() => openEdit(item)}>
                            <Edit3 /> {t('common.edit')}
                          </button>
                          <button className="menu-item text-notification" onClick={() => setDeleteTarget(item)}>
                            <Trash2 /> {t('common.delete')}
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
                <button className="btn-secondary" onClick={openBulkUpdate}>{t('common.bulkUpdate')}</button>
                <button className="btn-secondary">{t('common.addTag')}</button>
                <button className="btn-secondary">{t('common.export')}</button>
                <button className="btn-notification" onClick={() => {
                  const first = items.find(i => selectedIds.has(i.id))
                  if (first) setDeleteTarget(first)
                }}>
                  <Trash2 className="w-4 h-4" /> {t('common.delete')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="glp-pager">
          <span className="text-faint glp-pager-count">{total} {t('pages.' + filterModuleKey + '.title').toLowerCase()}</span>
          <div className="glp-pager-actions">
            <button className="toolbar-btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              {t('common.previous')}
            </button>
            <span className="glp-pager-info">
              Page {page} of {totalPages}
            </span>
            <button className="toolbar-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              {t('common.next')}
            </button>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setCreateOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>{t('pages.' + filterModuleKey + '.new')}</h2>
              <button onClick={() => setCreateOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="grid-2col">
                {config.fields.filter(f => f.editable !== false && !['rollup', 'formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(f.type) && f.key !== 'created_at' && f.key !== 'updated_at').map(f => (
                  <FieldsRenderer key={f.key} field={f} form={form} onChange={handleChange}
                    editOpen={true} relationData={{ companies: extraData?.companies }} />
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setCreateOpen(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button onClick={handleCreate} disabled={saving || (nameField ? !form[nameField.key]?.toString().trim() : false)}
                className="btn-primary">{saving ? t('common.processing') : t('common.create')}</button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditTarget(null) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>{t('common.edit')} {t('pages.' + filterModuleKey + '.title')}</h2>
              <button onClick={() => setEditTarget(null)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="grid-2col">
                {config.fields.filter(f => f.editable !== false && !['rollup', 'formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by'].includes(f.type)).map(f => (
                  <FieldsRenderer key={f.key} field={f} form={form} onChange={handleChange}
                    editOpen={true} relationData={{ companies: extraData?.companies }} />
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditTarget(null)} className="btn-secondary">{t('common.cancel')}</button>
              <button onClick={handleEdit} disabled={saving || (nameField ? !form[nameField.key]?.toString().trim() : false)}
                className="btn-primary">{saving ? t('common.processing') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
          <div className="modal modal-sm">
            <div className="delete-body">
              <div className="delete-icon-wrap"><Trash2 /></div>
              <h2 className="delete-heading">{t('common.delete')} {t('pages.' + filterModuleKey + '.title')}</h2>
              <p className="delete-text">
                Are you sure you want to delete <strong>{deleteTarget['name'] || deleteTarget.id}</strong>?
              </p>
            </div>
            <div className="modal-foot">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary">{t('common.cancel')}</button>
              <button onClick={handleDelete} disabled={deleting}
                className="btn-notification">{deleting ? t('common.processing') : t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setBulkOpen(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h2>{t('common.bulkUpdate')} {t('pages.' + filterModuleKey + '.title')}</h2>
              <button onClick={() => setBulkOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <p className="glp-bulk-note">
                Updating <strong>{selectedIds.size}</strong> {config.labelPlural.toLowerCase()}. Only fields with <strong>bulk editable</strong> permission are shown. Empty fields = unchanged.
              </p>
              <div className="grid-2col-16">
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
              <button onClick={() => setBulkOpen(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button onClick={handleBulkUpdate} disabled={bulkSaving}
                className="btn-primary">{bulkSaving ? t('common.processing') : `${t('common.bulkUpdate')} ${selectedIds.size} records`}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Right-side Detail Drawer ─── */}
      <SlideDrawer open={!!selectedId} onClose={() => setSelectedId(null)} title={`${t('pages.' + filterModuleKey + '.title')} Details`}>
        {selectedId && (
          <DetailDrawerContent
            config={config}
            id={selectedId}
            onClose={() => setSelectedId(null)}
            extraData={extraData}
          />
        )}
      </SlideDrawer>

      {/* Filter value dropdown — rendered at root level to avoid any clipping */}
      {filterValueOpen && filterPos && (() => {
        const f = filterableFields.find(x => x.key === filterField)
        const opts = f?.options || []
        const toggleVal = (val: string) => {
          setFilterChecked(prev =>
            prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
          )
        }
        return (
          <div className="glp-filter-popover" style={{ top: filterPos.top, left: filterPos.left, width: filterPos.width }}>
            {opts.map(o => {
              const checked = filterChecked.includes(o.value)
              return (
                <label key={o.value}
                  className={"glp-filter-option" + (checked ? ' checked' : '')}>
                  <input type="checkbox" checked={checked}
                    onChange={() => toggleVal(o.value)}
                    className="glp-filter-option-checkbox" />
                  {o.label}
                </label>
              )
            })}
            {filterChecked.length > 0 && (
              <button onClick={() => setFilterChecked([])}
                className="btn-ghost glp-filter-clear-all">Clear all</button>
            )}
          </div>
        )
      })()}
    </div>
  )
}

/* ═══════════════════════════════════════════
   Board / Kanban View Component
   ═══════════════════════════════════════════ */
function BoardView({ items, onSelect, groupBy }: {
  items: any[]; onSelect: (id: string) => void; groupBy: string
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
                <div key={item.id} className="board-card" onClick={() => onSelect(item.id)}>
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
