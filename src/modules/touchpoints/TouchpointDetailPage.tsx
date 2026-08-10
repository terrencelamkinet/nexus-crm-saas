import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NexusDetailPageV2, useAIInsight, type DetailTab, type HighlightWidget } from '../shared/NexusDetailPageV2'
import touchpointConfig from './config'
import { useEntity } from '../hooks/useEntity'
import { FieldsRenderer } from '../shared/FieldsRenderer'
import { buildPayload, apiErrorToString } from '../shared/field-utils'
import { isModuleEnabled } from '../enabled-modules'
import { apiClient } from '../../lib/api'

function formatDate(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

export default function TouchpointDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const { entity, loading, refresh } = useEntity('touchpoint', id!)
  const { insight, loading: insightLoading, refresh: refreshInsight } = useAIInsight('touchpoint', id!)

  // 保留原有 contacts/companies fetch
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/contacts?page_size=100').then(r => setContacts(r.items || [])).catch(() => {}),
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/companies?page_size=100').then(r => setCompanies(r.items || [])).catch(() => {}),
    ])
  }, [])

  // Edit state — initialised once entity is loaded
  useEffect(() => {
    if (entity) {
      const f: Record<string, any> = {}
      for (const field of touchpointConfig.fields) {
        let val = (entity as any)[field.key]
        if (field.type === 'multi_select' && typeof val === 'string') val = val ? [val] : []
        f[field.key] = val ?? (field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '')
      }
      setForm(f)
    }
  }, [entity])

  if (loading || !entity) {
    return <div className="nx-loading-shell">{t('common.loading', { defaultValue: 'Loading…' })}</div>
  }

  const openEdit = () => setEditOpen(true)

  const cancelEdit = () => {
    if (entity) {
      const f: Record<string, any> = {}
      for (const field of touchpointConfig.fields) {
        let val = (entity as any)[field.key]
        if (field.type === 'multi_select' && typeof val === 'string') val = val ? [val] : []
        f[field.key] = val ?? (field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '')
      }
      setForm(f)
    }
    setEditOpen(false)
  }

  const handleChange = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

  const handleSave = async () => {
    if (!entity) return
    setSaving(true)
    try {
      await apiClient.patch(`/api/v1/crm/touchpoints/${entity.id}`, buildPayload(form, touchpointConfig.fields))
      setEditOpen(false)
      refresh()
    } catch (e: any) { alert(apiErrorToString(e)) }
    finally { setSaving(false) }
  }

  const detailFields = (touchpointConfig.detailTabs?.find(tb => tb.id === 'details')?.fields
    ? touchpointConfig.fields.filter(f => touchpointConfig.detailTabs!.find(tb => tb.id === 'details')!.fields!.includes(f.key))
    : touchpointConfig.fields
  ).filter(f => !f.dependsOnModule || isModuleEnabled(f.dependsOnModule))

  const subline = [
    entity.type,
    formatDate(entity.date),
    contacts.find(c => c.id === entity.contact_id)?.name,
  ].filter(Boolean) as string[]

  const highlights: HighlightWidget[] = [
    { label: t('fields.type', { defaultValue: 'Type' }), value: entity.type || '—', trend: 'neutral' },
    { label: t('fields.date', { defaultValue: 'Date' }), value: formatDate(entity.date), trend: 'neutral' },
    { label: t('fields.duration', { defaultValue: 'Duration' }), value: entity.duration_minutes != null ? `${entity.duration_minutes}m` : '—', trend: 'neutral' },
    { label: t('fields.location', { defaultValue: 'Location' }), value: entity.location || '—', trend: 'neutral' },
  ]

  const tabs: DetailTab[] = (touchpointConfig.detailTabs || [])
    .filter(tb => tb.id !== 'details')
    .map(tb => ({
      key: tb.id,
      label: t(`common.${tb.id}`, { defaultValue: tb.label }),
      render: () => <div className="nx-empty-state">{t('common.noDataTab', { defaultValue: 'No data' })}</div>,
    }))

  return (
    <>
      <NexusDetailPageV2
        entity={entity}
        moduleConfig={touchpointConfig}
        avatarLabel={String(entity.title || '?').slice(0, 2).toUpperCase()}
        subline={subline.slice(0, 3)}
        highlights={highlights}
        aiInsight={insight ?? undefined}
        aiInsightLoading={insightLoading}
        onRefreshInsight={refreshInsight}
        breadcrumbLabel={t('pages.touchpoints.title', { defaultValue: 'Touchpoints' })}
        breadcrumbHref="/touchpoints"
        onEdit={openEdit}
        editMode={editOpen}
        editSaving={saving}
        onSaveEdit={handleSave}
        onCancelEdit={cancelEdit}
        onAskAI={() => window.dispatchEvent(new CustomEvent('nexus:open-ai-panel', { detail: { context: entity } }))}
        sidebarSections={[
          {
            title: t('common.generalInfo', { defaultValue: 'General Info' }),
            fields: [
              { label: t('fields.type', { defaultValue: 'Type' }), value: entity.type || '—' },
              { label: t('fields.description', { defaultValue: 'Description' }), value: entity.description || '—' },
              { label: t('fields.date', { defaultValue: 'Date' }), value: formatDate(entity.date) },
              { label: t('fields.duration', { defaultValue: 'Duration' }), value: entity.duration_minutes != null ? `${entity.duration_minutes}m` : '—' },
              { label: t('fields.location', { defaultValue: 'Location' }), value: entity.location || '—' },
              { label: t('fields.contact', { defaultValue: 'Contact' }), value: contacts.find(c => c.id === entity.contact_id)?.name || '—' },
              { label: t('fields.company', { defaultValue: 'Company' }), value: companies.find(c => c.id === (entity.company_id || (entity.company as any)?.id))?.name || '—' },
            ],
          },
          {
            title: t('common.ownership', { defaultValue: 'Ownership' }),
            fields: [
              { label: t('fields.created', { defaultValue: 'Created' }), value: formatDate(entity.created_at) },
            ],
          },
        ]}
        tabs={tabs}
      />
      {editOpen && (
        <div className="nx-inline-edit-panel">
          <div className="nx-inline-edit-title">{t('common.editing', { defaultValue: '編輯' })}</div>
          <div className="nx-inline-edit-grid">
            {detailFields.map(f => (
              <FieldsRenderer key={f.key} field={f} entity={entity} form={form}
                onChange={handleChange} editOpen={true}
                relationData={{ contacts, companies }} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
