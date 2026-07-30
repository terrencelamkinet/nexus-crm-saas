import { useState, useEffect, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Phone, Mail, Building2, User, Clock, Edit3, Trash2, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { FieldsRenderer } from './FieldsRenderer'
import { buildPayload, formatDate, apiErrorToString } from './field-utils'
import { statusColors } from '../module-types'
import type { ModuleConfig, EntityRecord } from '../module-types'
import { isModuleEnabled } from '../enabled-modules'

interface Props {
  config: ModuleConfig
  id: string
  onClose: () => void
  tabRenderers?: Record<string, React.ComponentType<{
    entity: EntityRecord
    moduleConfig: ModuleConfig
    refresh: () => void
  }>>
  extraData?: Record<string, any>
}

export default function DetailDrawerContent({ config, id, onClose, tabRenderers, extraData }: Props) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [entity, setEntity] = useState<EntityRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<string>('details')
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fetchEntity = async () => {
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
  }

  useEffect(() => { fetchEntity() }, [config.apiPath, id])

  const handleChange = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

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
      onClose()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setDeleteLoading(false) }
  }

  if (loading) {
    return (
      <div className="drawer-loading">
        <div className="drawer-skeleton h-24" />
        <div className="drawer-skeleton" />
        <div className="drawer-skeleton" />
        <div className="drawer-skeleton" />
      </div>
    )
  }

  if (error || !entity) {
    return (
      <div className="drawer-error">
        <p>{error || t('common.notFound', { label: config.label })}</p>
        <button onClick={fetchEntity} className="btn-secondary">{t('common.retry')}</button>
      </div>
    )
  }

  const initials = (entity['name'] || '').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  const lastTouchDate = entity['updated_at'] ? formatDate(entity['updated_at']) : entity['created_at'] ? formatDate(entity['created_at']) : '—'
  const nameField = config.fields.find(f => f.type === 'title')?.key || config.titleField || 'name'
  const entityName = String(entity[nameField] || entity.id || '')

  const detailsTabDef = config.detailTabs?.find(t => t.id === 'details')
  const detailFields = (detailsTabDef?.fields
    ? config.fields.filter(f => detailsTabDef.fields!.includes(f.key))
    : config.fields
  ).filter(f => !f.dependsOnModule || isModuleEnabled(f.dependsOnModule))

  const visibleTabs = config.detailTabs?.filter(t => t.id !== 'details' && (!t.condition || t.condition(entity))) || []

  return (
    <div className="drawer-detail">
      {/* Breadcrumb */}
      <nav className="breadcrumb drawer-bc">
        <span className="breadcrumb-link" onClick={() => { onClose(); navigate('/dashboard') }}>{t('common.home')}</span>
        <span className="bc-sep">/</span>
        <span className="breadcrumb-link" onClick={onClose}>{config.labelPlural}</span>
        <span className="bc-sep">/</span>
        <span className="cur">{entityName}</span>
      </nav>

      {/* Profile card */}
      <div className="drawer-profile">
        <div className="drawer-profile-avatar">{initials}</div>
        <div className="drawer-profile-info">
          <h4>{entityName}</h4>
          <span className="drawer-profile-role">{entity['company']?.name || entity['job_title'] || '—'}</span>
        </div>
      </div>

      {/* Quick info */}
      <div className="drawer-quick-info">
        {entity['email'] && (
          <div className="drawer-info-row">
            <Mail className="icon-14" />
            <span>{entity['email']}</span>
          </div>
        )}
        {entity['phone'] && (
          <div className="drawer-info-row">
            <Phone className="icon-14" />
            <span>{entity['phone']}</span>
          </div>
        )}
        {entity['company'] && (
          <div className="drawer-info-row" style={{ cursor: 'pointer' }}
            onClick={() => {
              const companyId = (entity['company'] as any).id
              if (companyId) navigate(`/companies/${companyId}`)
            }}>
            <Building2 className="icon-14" />
            <span className="badge badge-p3" style={{ color: 'var(--color-primary)' }}>{(entity['company'] as any).name || (entity['company'] as any).id || ''}</span>
          </div>
        )}
        <div className="drawer-info-row">
          <User className="icon-14" />
          <span>{t('common.owner')}: {entity['contact_type'] || t('common.unassigned')}</span>
        </div>
        <div className="drawer-info-row">
          <Clock className="icon-14" />
          <span>{t('common.lastTouch')}: {lastTouchDate}</span>
        </div>
      </div>

      {/* Tags */}
      <div className="drawer-tags">
        <span className={`select-tag ${statusColors[entity['status']] || 'tag-default'}`}>
          {entity['status'] || t('common.active')}
        </span>
        {Array.isArray(entity['tags']) && entity['tags'].map((t: string) => (
          <span key={t} className="tag">{t}</span>
        ))}
      </div>

      {/* Edit banner */}
      {editOpen && (
        <div className="edit-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          {t('common.editingModeActive')}
        </div>
      )}

      {/* Actions */}
      <div className="drawer-actions">
        {editOpen ? (
          <>
            <button onClick={cancelEdit} disabled={saving} className="btn-ghost btn-sm">{t('common.cancel')}</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        ) : (
          <>
            <button onClick={handleDeleteClick} className="btn-danger btn-sm">
              <Trash2 className="icon-14" /> {t('common.delete')}
            </button>
            <button onClick={() => {
              const route = config.routePrefix || config.labelPlural.toLowerCase()
              onClose()
              navigate(`/${route}/${entity.id}`)
            }} className="btn-primary btn-sm">
              <ExternalLink className="icon-14" /> {t('common.openFull')}
            </button>
            <button onClick={openEdit} className="btn-primary btn-sm">
              <Edit3 className="icon-14" /> {t('common.edit')}
            </button>
          </>
        )}
      </div>

      {/* Mobile: all sections stacked */}
      {isMobile ? (
        <>
          {/* Details fields — grid, top 10 with show more */}
          <DetailFieldsSection
            detailFields={detailFields}
            config={config}
            entity={entity}
            form={form}
            handleChange={handleChange}
            editOpen={editOpen}
            extraData={extraData}
          />

          {/* All tabs as stacked sections */}
          {visibleTabs.map(tabItem => {
            const CustomRenderer = tabItem.render || tabRenderers?.[tabItem.id]
            return (
              <div className="drawer-section" key={tabItem.id}>
                {CustomRenderer ? (
                  <Suspense fallback={<div className="empty-state">{t('common.loadingLabel', { label: tabItem.label.toLowerCase() })}</div>}>
                    <CustomRenderer entity={entity} moduleConfig={config} refresh={fetchEntity} />
                  </Suspense>
                ) : (
                  <div className="panel">
                    <div className="panel-head"><h3>{tabItem.label}</h3></div>
                    <div className="empty-state">{t('common.noLabelYet', { label: tabItem.label.toLowerCase() })}</div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      ) : (
        <>
          {/* Desktop: tab bar */}
          {visibleTabs.length > 0 && (
            <div className="drawer-tab-bar">
              {visibleTabs.map(tabItem => (
                <div key={tabItem.id}
                  className={`drawer-tab ${tab === tabItem.id ? 'active' : ''}`}
                  onClick={() => setTab(tabItem.id)}
                >
                  {tabItem.label}
                </div>
              ))}
            </div>
          )}

          {/* Details fields */}
          {tab === 'details' && (
            <div className="drawer-section">
              <div className="drawer-section-title">{config.label} {t('common.information')}</div>
              <div className="drawer-fields-grid">
                {detailFields.map(f => (
                  <FieldsRenderer key={f.key} field={f} entity={entity} form={form}
                    onChange={handleChange} editOpen={editOpen}
                    relationData={{ companies: extraData?.companies }}
                    onNavigate={(url) => navigate(url)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Tab content */}
          {visibleTabs.map(tabItem => {
            if (tab !== tabItem.id) return null
            const CustomRenderer = tabItem.render || tabRenderers?.[tabItem.id]
            if (CustomRenderer) {
              return (
                <Suspense key={tabItem.id}
                  fallback={<div className="drawer-section"><div className="empty-state">{t('common.loadingLabel', { label: tabItem.label.toLowerCase() })}</div></div>}
                >
                  <CustomRenderer entity={entity} moduleConfig={config} refresh={fetchEntity} />
                </Suspense>
              )
            }
            return (
              <div className="drawer-section" key={tabItem.id}>
                <div className="empty-state">{t('common.noLabelYet', { label: tabItem.label.toLowerCase() })}</div>
              </div>
            )
          })}
        </>
      )}

      {/* Delete modal */}
      {deleteModalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setDeleteModalOpen(false) }}>
          <div className="modal modal-sm">
            <div className="delete-body">
              <div className="delete-icon-wrap"><Trash2 /></div>
              <h3 className="delete-heading">{t('common.deleteConfirm', { name: entityName })}</h3>
              <p className="delete-text">{t('common.cannotUndo')}</p>
            </div>
            <div className="modal-foot">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button onClick={handleDeleteConfirm} disabled={deleteLoading}
                className="btn-notification">{deleteLoading ? t('common.deleting') : t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Mobile detail fields: grid, top 10 with show more ── */
function DetailFieldsSection({ detailFields, config, entity, form, handleChange, editOpen, extraData, onNavigate }: {
  detailFields: any[]
  config: any
  entity: any
  form: any
  handleChange: (k: string, v: any) => void
  editOpen: boolean
  extraData?: any
  onNavigate?: (url: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const { t } = useTranslation()
  const visible = showAll ? detailFields : detailFields.slice(0, 10)
  return (
    <div className="drawer-section">
      <div className="drawer-section-title">{config.label} {t('common.information')}</div>
      <div className="drawer-fields-grid grid-2col">
        {visible.map(f => (
          <FieldsRenderer key={f.key} field={f} entity={entity} form={form}
            onChange={handleChange} editOpen={editOpen}
            relationData={{ companies: extraData?.companies }}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      {detailFields.length > 10 && (
        <button className="btn-ghost drawer-more-btn" onClick={() => setShowAll(!showAll)}>
          {showAll ? t('common.showLess') : t('common.showAllFields', { count: detailFields.length })}
        </button>
      )}
    </div>
  )
}
