import { useState, useEffect, useCallback, Suspense } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { ArrowLeft, Phone, Mail, Building2, Edit3, Trash2, User, Clock } from 'lucide-react'
import { apiClient } from '../lib/api'
import { FieldsRenderer } from './shared/FieldsRenderer'
import { buildPayload, formatDate, apiErrorToString } from './shared/field-utils'
import { statusColors } from './module-types'
import MobileSection from './shared/MobileSection'
import { useMobile } from './shared/useMobile'
import type { ModuleConfig, EntityRecord } from './module-types'

interface Props {
  config: ModuleConfig
  tabRenderers?: Record<string, React.ComponentType<{
    entity: EntityRecord
    moduleConfig: ModuleConfig
    refresh: () => void
  }>>
  extraData?: Record<string, any>
}

export default function GenericDetailPage({ config, tabRenderers, extraData }: Props) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const pathParts = location.pathname.split('/').filter(Boolean)
  const { isMobile, showFullTab, setShowFullTab } = useMobile()

  const [entity, setEntity] = useState<EntityRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState(config.detailTabs?.[0]?.id || 'details')

  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const fetchEntity = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const eRes = await apiClient.get<EntityRecord>(`${config.apiPath}/${id}`)
      setEntity(eRes)
      const f: Record<string, any> = {}
      for (const field of config.fields) {
        let val = (eRes as any)[field.key]
        if (field.type === 'multi_select' && typeof val === 'string') {
          val = val ? [val] : []
        }
        f[field.key] = val ?? (field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '')
      }
      setForm(f)
    } catch (e: any) {
      setError(e.detail || e.message)
    } finally {
      setLoading(false)
    }
  }, [config.apiPath, id])

  useEffect(() => { fetchEntity() }, [fetchEntity])

  const handleChange = (key: string, value: any) => {
    setForm(f => ({ ...f, [key]: value }))
  }

  const openEdit = () => setEditOpen(true)

  const cancelEdit = () => {
    if (entity) {
      const f: Record<string, any> = {}
      for (const field of config.fields) {
        let val = entity[field.key]
        if (field.type === 'multi_select' && typeof val === 'string') {
          val = val ? [val] : []
        }
        f[field.key] = val ?? (field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '')
      }
      setForm(f)
    }
    setEditOpen(false)
  }

  const handleSave = async () => {
    if (!entity) return
    setSaving(true)
    try {
      await apiClient.patch(`${config.apiPath}/${entity.id}`, buildPayload(form, config.fields))
      setEditOpen(false)
      fetchEntity()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setSaving(false) }
  }

  const handleDeleteClick = () => setDeleteModalOpen(true)

  const handleDeleteConfirm = async () => {
    if (!entity) return
    setDeleteLoading(true)
    try {
      await apiClient.delete(`${config.apiPath}/${entity.id}`)
      navigate(`/${config.routePrefix || config.name + 's'}`)
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setDeleteLoading(false) }
  }

  if (loading) {
    return (
      <div className="contact-detail-page loading">
        <div className="h-8 bg-slate-200 rounded w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 h-64 bg-slate-100 rounded-xl" />
          <div className="lg:col-span-2 h-96 bg-slate-100 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error || !entity) {
    return (
      <div className="contact-detail-page">
        <button onClick={() => navigate(`/${config.routePrefix || config.name + 's'}`)}
          className="flex items-center gap-1 text-sm hover:underline mb-4 back-link">
          <ArrowLeft className="w-4 h-4" /> Back to {config.labelPlural}
        </button>
        <div className="error-box">
          <span className="error-text">{error || `${config.label} not found`}</span>
          <button onClick={fetchEntity} className="error-retry-btn">Retry</button>
        </div>
      </div>
    )
  }

  const initials = (entity['name'] || '').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  const lastTouchDate = entity['updated_at'] ? formatDate(entity['updated_at']) : entity['created_at'] ? formatDate(entity['created_at']) : '—'

  const visibleTabs = config.detailTabs?.filter(t => !t.condition || t.condition(entity)) || []

  const detailsTab = config.detailTabs?.find(t => t.id === 'details')
  const detailFields = detailsTab?.fields
    ? config.fields.filter(f => detailsTab.fields!.includes(f.key))
    : config.fields

  return (
    <div className="contact-detail-page">
      <nav className="breadcrumb">
        {pathParts.map((part, i) => {
          const isLast = i === pathParts.length - 1
          const label = part === 'dashboard' ? 'Home' : part.charAt(0).toUpperCase() + part.slice(1)
          const to = '/' + pathParts.slice(0, i + 1).join('/')
          return isLast ? (
            <span key={part} className="cur">{entity?.['name'] || part}</span>
          ) : (
            <span key={part}><Link to={to}>{label}</Link><span className="bc-sep">/</span></span>
          )
        })}
      </nav>

      <div className="page-header">
        <div className="title-row">
          <button onClick={() => navigate(`/${config.routePrefix || config.name + 's'}`)} className="back-btn">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1>{entity['name'] || entity.id}</h1>
        </div>
        <div className="header-actions">
          {editOpen ? (
            <>
              <button onClick={cancelEdit} disabled={saving} className="btn-ghost">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </>
          ) : (
            <>
              <button onClick={handleDeleteClick} className="btn-danger">
                <Trash2 className="icon-16" /> Delete
              </button>
              <button onClick={openEdit} className="btn-primary">
                <Edit3 className="icon-16" /> Edit
              </button>
            </>
          )}
        </div>
      </div>

      {editOpen && (
        <div className="edit-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Editing mode active. Make changes to the fields below and click Save.
        </div>
      )}

      <div className="detail-grid">
        <div className="profile-card">
          <div className="profile-avatar">{initials}</div>
          <h3>{entity['name']}</h3>
          <div className="role">{entity['company']?.name || entity['job_title'] || '—'}</div>

          <div style={{ textAlign: 'left' }}>
            {entity['email'] && (
              <div className="profile-field">
                <Mail className="w-3.5 h-3.5" />
                <span>{entity['email']}</span>
              </div>
            )}
            {entity['phone'] && (
              <div className="profile-field">
                <Phone className="w-3.5 h-3.5" />
                <span>{entity['phone']}</span>
              </div>
            )}
            <div className="profile-field">
              <User className="w-3.5 h-3.5" /> Owner: {entity['contact_type'] || 'Unassigned'}
            </div>
            <div className="profile-field">
              <Clock className="w-3.5 h-3.5" /> Last touch: {lastTouchDate}
            </div>
            {entity['company'] && (
              <div className="profile-field">
                <Building2 className="w-3.5 h-3.5" />
                <span>{(entity['company'] as any).name}</span>
              </div>
            )}
          </div>

          <div className="tag-row">
            <span className={`select-tag ${statusColors[entity['status']] || 'tag-default'}`}>{entity['status'] || 'Active'}</span>
            {Array.isArray(entity['tags']) && entity['tags'].map((t: string) => <span key={t} className="tag">{t}</span>)}
            {entity['contact_type'] && entity['contact_type'] !== 'Unassigned' && <span className="tag">{entity['contact_type']}</span>}
          </div>
        </div>

        <div className={isMobile ? 'mobile-stacked-sections' : ''}>
          {/* Mobile: single full tab view */}
          {isMobile && showFullTab ? (
            <>
              <button onClick={() => setShowFullTab(null)} className="btn-ghost" style={{ marginBottom: '10px', fontSize: '12px' }}>
                ← Back to all sections
              </button>
              {visibleTabs.filter(t => t.id === showFullTab).map(t => {
                if (t.id === 'details') {
                  return (
                    <div className="panel" key="details">
                      <div className="panel-head"><h3>{config.label} Information</h3></div>
                      <div className="detail-form-grid" style={{ padding: '16px' }}>
                        {detailFields.map(f => (
                          <FieldsRenderer key={f.key} field={f} entity={entity} form={form}
                            onChange={handleChange} editOpen={editOpen} relationData={{ companies: extraData?.companies }} />
                        ))}
                      </div>
                    </div>
                  )
                }
                const CustomRenderer = t.render || tabRenderers?.[t.id]
                if (CustomRenderer) {
                  return (
                    <Suspense key={t.id} fallback={<div className="panel"><div className="panel-head"><h3>{t.label}</h3></div><div className="empty-state">Loading {t.label.toLowerCase()}...</div></div>}>
                      <CustomRenderer entity={entity} moduleConfig={config} refresh={fetchEntity} />
                    </Suspense>
                  )
                }
                return (
                  <div className="panel" key={t.id}>
                    <div className="panel-head"><h3>{t.label}</h3></div>
                    <div className="empty-state">No {t.label.toLowerCase()} yet</div>
                  </div>
                )
              })}
            </>
          /* Desktop: tabs + content */
          ) : !isMobile && (
            <>
              <div className="tabs">
                {visibleTabs.map(t => (
                  <div key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`}
                    onClick={() => setTab(t.id)}>
                    {t.label}
                  </div>
                ))}
              </div>

              {tab === 'details' && (
                <div className="panel">
                  <div className="panel-head">
                    <h3>{config.label} Information</h3>
                  </div>
                  <div className="detail-form-grid" style={{ padding: '16px' }}>
                    {detailFields.map(f => (
                      <FieldsRenderer key={f.key} field={f} entity={entity} form={form}
                        onChange={handleChange} editOpen={editOpen} relationData={{ companies: extraData?.companies }} />
                    ))}
                  </div>
                </div>
              )}

              {visibleTabs.filter(t => t.id !== 'details').map(t => {
                if (tab === t.id) {
                  const CustomRenderer = t.render || tabRenderers?.[t.id]
                  if (CustomRenderer) {
                    return (
                      <Suspense key={t.id} fallback={<div className="panel"><div className="panel-head"><h3>{t.label}</h3></div><div className="empty-state">Loading {t.label.toLowerCase()}...</div></div>}>
                        <CustomRenderer entity={entity} moduleConfig={config} refresh={fetchEntity} />
                      </Suspense>
                    )
                  }
                  return (
                    <div className="panel" key={t.id}>
                      <div className="panel-head">
                        <h3>{t.label}</h3>
                      </div>
                      <div className="empty-state">No {t.label.toLowerCase()} yet</div>
                    </div>
                  )
                }
                return null
              })}
            </>
          )}

          {/* Mobile stacked sections */}
          {isMobile && !showFullTab && visibleTabs.map(t => {
            if (t.id === 'details') {
              const fieldCount = detailFields.length
              return (
                <MobileSection key="details" label="fields" total={fieldCount}
                  onViewAll={() => setShowFullTab('details')}>
                  <div className="panel">
                    <div className="panel-head"><h3>{config.label} Information</h3></div>
                    <div className="detail-form-grid" style={{ padding: '16px' }}>
                      {detailFields.map(f => (
                        <FieldsRenderer key={f.key} field={f} entity={entity} form={form}
                          onChange={handleChange} editOpen={editOpen} relationData={{ companies: extraData?.companies }} />
                      ))}
                    </div>
                  </div>
                </MobileSection>
              )
            }
            const CustomRenderer = tabRenderers?.[t.id]
            if (CustomRenderer) {
              return (
                <MobileSection key={t.id} label={t.label.toLowerCase()} total={0}
                  onViewAll={() => setShowFullTab(t.id)}>
                  <Suspense fallback={<div className="empty-state">Loading {t.label.toLowerCase()}...</div>}>
                    <CustomRenderer entity={entity} moduleConfig={config} refresh={fetchEntity} />
                  </Suspense>
                </MobileSection>
              )
            }
            return (
              <div className="panel" key={t.id}>
                <div className="panel-head"><h3>{t.label}</h3></div>
                <div className="empty-state">No {t.label.toLowerCase()} yet</div>
              </div>
            )
          })}
        </div>
      </div>

      {deleteModalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setDeleteModalOpen(false) }}>
          <div className="modal modal-sm">
            <div className="delete-body">
              <div className="delete-icon-wrap"><Trash2 /></div>
              <h3 className="delete-heading">Delete {entity['name']}?</h3>
              <p className="delete-text">This action cannot be undone.</p>
            </div>
            <div className="modal-foot">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleDeleteConfirm} disabled={deleteLoading}
                className="btn-notification">{deleteLoading ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
