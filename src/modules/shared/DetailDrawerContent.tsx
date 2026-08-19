import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { User, ExternalLink, Trash2, Pencil, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { FieldsRenderer } from './FieldsRenderer'
import { buildPayload, apiErrorToString } from './field-utils'
import { statusColors } from '../module-types'
import { localizeResourceLabel } from './labels'
import { useAIInsight, type HighlightWidget } from './NexusDetailPageV2'
import type { ModuleConfig, EntityRecord } from '../module-types'

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

function formatDateSafe(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

/** Map module name → entity-insight type (whitelist matches config.name) */
function insightType(config: ModuleConfig): string {
  return config.name || 'company'
}

export default function DetailDrawerContent({ config, id, onClose, extraData }: Props) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [entity, setEntity] = useState<EntityRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const { insight, loading: insightLoading, refresh: refreshInsight } = useAIInsight(insightType(config), id)

  const fetchEntity = async () => {
    setLoading(true)
    setError(null)
    try {
      const eRes = await apiClient.get<EntityRecord>(`${config.apiPath}/${id}`)
      setEntity(eRes)
      const f: Record<string, any> = {}
      for (const field of config.fields) {
        let val = (eRes as any)[field.key]
        if (field.type === 'multi_select' && typeof val === 'string') val = val ? [val] : []
        f[field.key] = val ?? (field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '')
      }
      setForm(f)
    } catch (e: any) {
      setError(e.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  // Initialise edit form when entity loads (or re-fetch after save)
  useEffect(() => {
    if (entity) {
      const f: Record<string, any> = {}
      for (const field of config.fields) {
        let val = (entity as any)[field.key]
        if (field.type === 'multi_select' && typeof val === 'string') val = val ? [val] : []
        f[field.key] = val ?? (field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '')
      }
      setForm(f)
    }
  }, [entity, config])

  useEffect(() => { fetchEntity() }, [config.apiPath, id])

  const handleChange = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

  const cancelEdit = () => {
    if (entity) {
      const f: Record<string, any> = {}
      for (const field of config.fields) {
        let val = (entity as any)[field.key]
        if (field.type === 'multi_select' && typeof val === 'string') val = val ? [val] : []
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
      refreshInsight()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setSaving(false) }
  }

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
      </div>
    )
  }

  if (error || !entity) {
    return (
      <div className="drawer-error">
        <p>{error || t('common.notFound', { label: localizeResourceLabel(config.name, false, config.label, t) })}</p>
        <button onClick={fetchEntity} className="btn-secondary">{t('common.retry')}</button>
      </div>
    )
  }

  const nameField = config.fields.find(f => f.type === 'title')?.key || config.titleField || 'name'
  const entityName = String(entity[nameField] || entity.id || '')
  const avatarLabel = String(entityName || '?').slice(0, 2).toUpperCase()

  // Subline per module
  const sublineParts: string[] = (() => {
    const e: any = entity
    if (config.name === 'company') return [e.industry, e.category, e.city || e.address].filter(Boolean)
    if (config.name === 'contact') return [e.job_title, e.department, e.company?.name || ''].filter(Boolean)
    if (config.name === 'project') return [e.status, e.priority, e.company?.name || ''].filter(Boolean)
    if (config.name === 'task') return [e.priority, e.status, e.company_id ? String(e.company_id) : ''].filter(Boolean)
    if (config.name === 'touchpoint') return [e.type, formatDateSafe(e.date)].filter(Boolean)
    return []
  })() as string[]

  // Highlights (3-4 KPIs per module, '—' fallback)
  const highlights: HighlightWidget[] = (() => {
    const e: any = entity
    if (config.name === 'company') return [
      { label: t('common.openDeals', { defaultValue: 'Open Deals' }), value: e.open_deals_count ?? '—', trend: 'neutral' },
      { label: t('common.contacts', { defaultValue: 'Contacts' }), value: e.contacts_count ?? '—', trend: 'neutral' },
      { label: t('fields.status', { defaultValue: 'Status' }), value: e.status || '—', trend: 'neutral' },
    ]
    if (config.name === 'contact') return [
      { label: t('common.openTasks', { defaultValue: 'Open Tasks' }), value: e.open_tasks_count ?? '—', trend: 'neutral' },
      { label: t('common.touchpoints', { defaultValue: 'Touchpoints' }), value: e.touchpoints_count ?? '—', trend: 'neutral' },
      { label: t('fields.status', { defaultValue: 'Status' }), value: e.status || '—', trend: 'neutral' },
    ]
    if (config.name === 'project') return [
      { label: t('fields.status', { defaultValue: 'Status' }), value: e.status || '—', trend: 'neutral' },
      { label: t('fields.priority', { defaultValue: 'Priority' }), value: e.priority || '—', trend: 'neutral' },
      { label: t('fields.deadline', { defaultValue: 'Deadline' }), value: formatDateSafe(e.deadline), trend: 'neutral' },
    ]
    if (config.name === 'task') return [
      { label: t('fields.priority', { defaultValue: 'Priority' }), value: e.priority || '—', trend: 'neutral' },
      { label: t('fields.status', { defaultValue: 'Status' }), value: e.status || '—', trend: 'neutral' },
      { label: t('fields.dueDate', { defaultValue: 'Due Date' }), value: formatDateSafe(e.due_date), trend: 'neutral' },
    ]
    if (config.name === 'touchpoint') return [
      { label: t('fields.type', { defaultValue: 'Type' }), value: e.type || '—', trend: 'neutral' },
      { label: t('fields.date', { defaultValue: 'Date' }), value: formatDateSafe(e.date), trend: 'neutral' },
      { label: t('fields.duration', { defaultValue: 'Duration' }), value: e.duration_minutes != null ? `${e.duration_minutes}m` : '—', trend: 'neutral' },
    ]
    return []
  })()

  // General Info + Ownership sidebar sections per module
  const generalInfo = (() => {
    const e: any = entity
    if (config.name === 'company') return [
      [t('fields.industry', { defaultValue: 'Industry' }), e.industry || '—'],
      [t('fields.category', { defaultValue: 'Category' }), e.category || '—'],
      [t('fields.ceo', { defaultValue: 'CEO' }), e.ceo_name || '—'],
      [t('fields.website', { defaultValue: 'Website' }), e.website || '—'],
      [t('fields.phone', { defaultValue: 'Phone' }), e.phone || '—'],
      [t('fields.address', { defaultValue: 'Address' }), e.address || '—'],
      [t('fields.status', { defaultValue: 'Status' }), e.status || '—'],
    ]
    if (config.name === 'contact') return [
      [t('fields.jobTitle', { defaultValue: 'Title' }), e.job_title || '—'],
      [t('fields.department', { defaultValue: 'Department' }), e.department || '—'],
      [t('fields.email', { defaultValue: 'Email' }), e.email || '—'],
      [t('fields.phone', { defaultValue: 'Phone' }), e.phone || '—'],
      [t('fields.company', { defaultValue: 'Company' }), e.company?.name || '—'],
      [t('fields.contactType', { defaultValue: 'Contact Type' }), e.contact_type || '—'],
    ]
    if (config.name === 'project') return [
      [t('fields.status', { defaultValue: 'Status' }), e.status || '—'],
      [t('fields.priority', { defaultValue: 'Priority' }), e.priority || '—'],
      [t('fields.startDate', { defaultValue: 'Start Date' }), formatDateSafe(e.start_date)],
      [t('fields.deadline', { defaultValue: 'Deadline' }), formatDateSafe(e.deadline)],
      [t('fields.budget', { defaultValue: 'Budget' }), e.budget_amount != null ? String(e.budget_amount) : '—'],
      [t('fields.company', { defaultValue: 'Company' }), e.company?.name || '—'],
      [t('fields.description', { defaultValue: 'Description' }), e.description || '—'],
    ]
    if (config.name === 'task') return [
      [t('fields.priority', { defaultValue: 'Priority' }), e.priority || '—'],
      [t('fields.status', { defaultValue: 'Status' }), e.status || '—'],
      [t('fields.dueDate', { defaultValue: 'Due Date' }), formatDateSafe(e.due_date)],
      [t('fields.description', { defaultValue: 'Description' }), e.description || '—'],
    ]
    if (config.name === 'touchpoint') return [
      [t('fields.type', { defaultValue: 'Type' }), e.type || '—'],
      [t('fields.date', { defaultValue: 'Date' }), formatDateSafe(e.date)],
      [t('fields.duration', { defaultValue: 'Duration' }), e.duration_minutes != null ? `${e.duration_minutes}m` : '—'],
      [t('fields.location', { defaultValue: 'Location' }), e.location || '—'],
      [t('fields.description', { defaultValue: 'Description' }), e.description || '—'],
    ]
    return [] as [string, string][]
  })()

  const ownership = (() => {
    const e: any = entity
    const rows: [string, string][] = []
    if (config.name === 'company') rows.push([t('fields.owner', { defaultValue: 'Owner' }), e.owner_name || String(e.owner_id || '') || '—'])
    if (config.name === 'task') rows.push([t('fields.contact', { defaultValue: 'Contact' }), e.contact_id ? String(e.contact_id) : '—'])
    rows.push([t('fields.created', { defaultValue: 'Created' }), formatDateSafe(e.created_at)])
    rows.push([t('fields.updated', { defaultValue: 'Updated' }), formatDateSafe(e.updated_at)])
    return rows
  })()

  const statusTagClass = statusColors[(entity as any).status] || 'tag-default'
  const relatedCompanyId = (entity as any).company?.id as string | undefined
  const relatedCompanyName = (entity as any).company?.name as string | undefined

  return (
    <div className="drawer-detail nx-drawer-v2">
      {/* ═══ V2 Header ═══ */}
      <div className="nx-drawer-head">
        <div className="nx-detail-avatar nx-drawer-avatar">{avatarLabel}</div>
        <div className="nx-drawer-titleblock">
          <h4>{entityName}</h4>
          {sublineParts.length > 0 && (
            <div className="nx-detail-subline">
              {sublineParts.slice(0, 3).map((s, i) => (
                <span key={i}>{i > 0 && <span style={{ marginRight: 6 }}>·</span>}{s}</span>
              ))}
            </div>
          )}
          <div className="nx-drawer-status">
            <span className={`select-tag ${statusTagClass}`}>{(entity as any).status || t('common.active')}</span>
          </div>
        </div>
      </div>

      {/* ═══ Actions ═══ */}
      <div className="nx-drawer-actions">
        {editOpen ? (
          <>
            <button onClick={cancelEdit} disabled={saving} className="nx-btn nx-btn-secondary btn-sm">{t('common.cancel')}</button>
            <button onClick={handleSave} disabled={saving} className="nx-btn nx-btn-primary btn-sm">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setDeleteModalOpen(true)} className="nx-btn nx-btn-secondary btn-sm">
              <Trash2 size={13} /> {t('common.delete')}
            </button>
            <button onClick={() => {
              const route = config.routePrefix || config.labelPlural.toLowerCase()
              onClose()
              navigate(`/${route}/${entity.id}`)
            }} className="nx-btn nx-btn-secondary btn-sm">
              <ExternalLink size={13} /> {t('common.openFull')}
            </button>
            <button onClick={() => setEditOpen(true)} className="nx-btn nx-btn-primary btn-sm">
              <Pencil size={13} /> {t('common.edit')}
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('nexus:open-ai-panel', { detail: { context: { id: entity.id, name: entityName, type: config.name } } }))}
              className="nx-btn nx-btn-ai btn-sm"
            >
              <Sparkles size={13} /> {t('common.askAI', { defaultValue: 'Ask AI' })}
            </button>
          </>
        )}
      </div>

      {/* ═══ Highlights row ═══ */}
      {highlights.length > 0 && (
        <div className="nx-highlight-row nx-drawer-highlights">
          {highlights.map((h, i) => (
            <div className="nx-highlight-widget" key={i}>
              <div className="nx-highlight-label">{h.label}</div>
              <div className="nx-highlight-value">{h.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ AI insight card (empty → not render — Bug #1) ═══ */}
      {(insightLoading || (insight && (insight.summary || insight.tags?.length > 0))) && (
        <div className="nx-ai-insight-card nx-drawer-ai">
          <div className="nx-ai-insight-head">
            <div className="nx-ai-insight-icon">✦</div>
            <div className="nx-ai-insight-title">{t('common.aiSummary', { defaultValue: 'AI 摘要' })}</div>
            {!insightLoading && (
              <div className="nx-ai-insight-refresh" onClick={refreshInsight}>↻</div>
            )}
          </div>
          {insightLoading ? (
            <div className="nx-ai-thinking">
              <span className="nx-ai-dot" /><span className="nx-ai-dot" /><span className="nx-ai-dot" />
            </div>
          ) : (
            <>
              <div className="nx-ai-insight-body">{insight!.summary}</div>
              {insight!.tags.length > 0 && (
                <div className="nx-ai-insight-tags">
                  {insight!.tags.map((tg, i) => (
                    <span className={`nx-ai-tag ${tg.kind}`} key={i}>{tg.label}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ Inline edit form ═══ */}
      {editOpen && (
        <div className="nx-inline-edit-panel nx-drawer-edit">
          <div className="nx-inline-edit-title">{t('common.editing', { defaultValue: '編輯' })}</div>
          <div className="nx-inline-edit-grid">
            {config.fields.filter(fld => fld.editable !== false && !['created_time', 'last_edited_time', 'created_by', 'last_edited_by'].includes(fld.type)).map(f => (
              <FieldsRenderer key={f.key} field={f} entity={entity} form={form}
                onChange={handleChange} editOpen={true}
                relationData={{ companies: extraData?.companies }} />
            ))}
          </div>
        </div>
      )}

      {/* ═══ Sidebar-style field groups ═══ */}
      <div className="nx-drawer-sections">
        {generalInfo.length > 0 && (
          <div className="nx-sidebar-section">
            <div className="nx-sidebar-section-head">{t('common.generalInfo', { defaultValue: 'General Info' })}</div>
            {generalInfo.map(([label, value], i) => {
              const isCompany = config.name === 'contact' && label === t('fields.company', { defaultValue: 'Company' })
              return (
                <div className="nx-sidebar-field" key={i}>
                  <span className="nx-sidebar-field-label">{label}</span>
                  {isCompany && relatedCompanyId ? (
                    <span
                      className="nx-sidebar-field-value nx-drawer-related-tag"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (relatedCompanyId) { onClose(); navigate(`/companies/${relatedCompanyId}`) }
                      }}
                      title={t('common.openrelated', { defaultValue: 'Open company' })}
                    >
                      <User size={12} /> {value}
                    </span>
                  ) : (
                    <span className="nx-sidebar-field-value">{value}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {ownership.length > 0 && (
          <div className="nx-sidebar-section">
            <div className="nx-sidebar-section-head">{t('common.ownership', { defaultValue: 'Ownership' })}</div>
            {ownership.map(([label, value], i) => (
              <div className="nx-sidebar-field" key={i}>
                <span className="nx-sidebar-field-label">{label}</span>
                <span className="nx-sidebar-field-value">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Related company navigation (preserve onNavigate behaviour) */}
        {relatedCompanyId && (
          <div className="nx-sidebar-section">
            <div className="nx-sidebar-section-head">{t('common.related', { defaultValue: 'Related' })}</div>
            <div
              className="nx-drawer-related"
              onClick={() => {
                if (relatedCompanyId) { onClose(); navigate(`/companies/${relatedCompanyId}`) }
              }}
            >
              <User size={13} />
              <span>{relatedCompanyName || String(relatedCompanyId)}</span>
            </div>
          </div>
        )}
      </div>

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
