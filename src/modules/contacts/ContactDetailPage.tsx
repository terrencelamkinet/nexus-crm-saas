import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NexusDetailPageV2, useAIInsight, type DetailTab, type HighlightWidget } from '../shared/NexusDetailPageV2'
import contactConfig from './config'
import { TimelineTab, DealsTab, TouchpointsTab, NotesTab, ProjectsTab, TasksTab } from './ContactDetailTabs'
import { useEntity } from '../hooks/useEntity'
import { apiClient } from '../../lib/api'
import { useModuleSettings } from '../../lib/useModules'

function formatDate(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const modules = useModuleSettings()
  const salesOn = modules['sales'] !== false

  const { entity, loading, refresh } = useEntity('contact', id!)
  const { insight, loading: insightLoading, refresh: refreshInsight } = useAIInsight('contact', id!)

  // 保留原有 companies fetch（用喺 relation fields / related cards）
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/companies?page_size=100')
      .then(r => setCompanies(r.items || []))
      .catch(() => {})
  }, [])

  if (loading || !entity) {
    return <div className="nx-loading-shell">{t('common.loading', { defaultValue: 'Loading…' })}</div>
  }

  const subline = [
    entity.job_title,
    entity.department,
    (entity.company as any)?.name || (entity.company_id ? String(entity.company_id) : ''),
  ].filter(Boolean) as string[]

  const highlights: HighlightWidget[] = [
    { label: t('common.openTasks', { defaultValue: 'Open Tasks' }), value: entity.open_tasks_count ?? '—', trend: 'neutral' },
    { label: t('common.touchpoints', { defaultValue: 'Touchpoints' }), value: entity.touchpoints_count ?? '—', trend: 'neutral' },
    { label: t('common.deals', { defaultValue: 'Deals' }), value: salesOn ? (entity.deals_count ?? '—') : '—', trend: 'neutral' },
    { label: t('fields.status', { defaultValue: 'Status' }), value: entity.status || '—', trend: 'neutral' },
  ]

  const tabs: DetailTab[] = [
    { key: 'overview', label: t('common.overview', { defaultValue: 'Overview' }), render: () => <TimelineTab entity={entity} moduleConfig={contactConfig} refresh={refresh} /> },
    { key: 'timeline', label: t('common.timeline', { defaultValue: 'Timeline' }), render: () => <TimelineTab entity={entity} moduleConfig={contactConfig} refresh={refresh} /> },
    ...(salesOn ? [{ key: 'deals', label: t('common.deals', { defaultValue: 'Deals' }), render: () => <DealsTab entity={entity} moduleConfig={contactConfig} refresh={refresh} /> }] : []),
    { key: 'tasks', label: t('common.tasks', { defaultValue: 'Tasks' }), render: () => <TasksTab entity={entity} moduleConfig={contactConfig} refresh={refresh} /> },
    { key: 'touchpoints', label: t('common.touchpoints', { defaultValue: 'Touchpoints' }), render: () => <TouchpointsTab entity={entity} moduleConfig={contactConfig} refresh={refresh} /> },
    { key: 'notes', label: t('common.notes', { defaultValue: 'Notes' }), render: () => <NotesTab entity={entity} moduleConfig={contactConfig} refresh={refresh} /> },
    { key: 'projects', label: t('common.projects', { defaultValue: 'Projects' }), render: () => <ProjectsTab entity={entity} moduleConfig={contactConfig} refresh={refresh} /> },
  ]

  return (
    <NexusDetailPageV2
      entity={entity}
      moduleConfig={contactConfig}
      avatarLabel={String(entity.name || '?').slice(0, 2).toUpperCase()}
      subline={subline.slice(0, 3)}
      highlights={highlights}
      aiInsight={insight ?? undefined}
      aiInsightLoading={insightLoading}
      onRefreshInsight={refreshInsight}
      breadcrumbLabel={t('pages.contacts.title', { defaultValue: 'Contacts' })}
      breadcrumbHref="/contacts"
      onEdit={() => navigate(`/contacts/${id}/edit`)}
      onAskAI={() => window.dispatchEvent(new CustomEvent('nexus:open-ai-panel', { detail: { context: entity } }))}
      sidebarSections={[
        {
          title: t('common.generalInfo', { defaultValue: 'General Info' }),
          fields: [
            { label: t('fields.jobTitle', { defaultValue: 'Title' }), value: entity.job_title || '—' },
            { label: t('fields.department', { defaultValue: 'Department' }), value: entity.department || '—' },
            { label: t('fields.email', { defaultValue: 'Email' }), value: entity.email || '—' },
            { label: t('fields.phone', { defaultValue: 'Phone' }), value: entity.phone || '—' },
            { label: t('fields.linkedin', { defaultValue: 'LinkedIn' }), value: entity.linkedin_url || '—', aiEnriched: !!entity.linkedin_ai_filled },
            { label: t('fields.address', { defaultValue: 'Address' }), value: entity.address || '—' },
            { label: t('fields.company', { defaultValue: 'Company' }), value: (entity.company as any)?.name || '—' },
          ],
        },
        {
          title: t('common.ownership', { defaultValue: 'Ownership' }),
          fields: [
            { label: t('fields.contactType', { defaultValue: 'Contact Type' }), value: entity.contact_type || '—' },
            { label: t('fields.grade', { defaultValue: 'Grade' }), value: entity.grade || '—' },
            { label: t('fields.status', { defaultValue: 'Status' }), value: entity.status || '—' },
            { label: t('fields.created', { defaultValue: 'Created' }), value: formatDate(entity.created_at) },
          ],
        },
      ]}
      relatedCards={companies.length > 0 ? [{
        title: (entity.company as any)?.name || 'Company',
        meta: (entity.company as any)?.industry || '—',
        badge: 'Company',
      }] : []}
      tabs={tabs}
    />
  )
}
