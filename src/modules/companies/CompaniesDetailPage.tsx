import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NexusDetailPageV2, useAIInsight, type DetailTab, type HighlightWidget } from '../shared/NexusDetailPageV2'
import companyConfig from './config'
import {
  ContactsTab, DealsTab, ProjectsTab, ProductsTab,
  PartnersTab, TouchpointsTab, NotesTab, TimelineTab, TasksTab,
} from './CompanyDetailTabs'
import { useEntity } from '../hooks/useEntity'
import { apiClient } from '../../lib/api'

function formatDate(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

export default function CompaniesDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { entity, loading, refresh } = useEntity('company', id!)
  const { insight, loading: insightLoading, refresh: refreshInsight } = useAIInsight('company', id!)

  // Order of hooks is fixed — all useEntity/useState hooks before early return
  const [taskCount, setTaskCount] = useState<number | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    apiClient.get<{ items: unknown[]; total?: number }>(`/api/v1/crm/tasks?company_id=${id}&page_size=1`)
      .then(r => { if (alive) setTaskCount(r.total ?? null) })
      .catch(() => { if (alive) setTaskCount(null) })
    return () => { alive = false }
  }, [id])

  if (loading || !entity) {
    return <div className="nx-loading-shell">{t('common.loading', { defaultValue: 'Loading…' })}</div>
  }

  const subline = [entity.industry, entity.category, entity.city || entity.address].filter(Boolean) as string[]

  const highlights: HighlightWidget[] = [
    { label: t('common.openDeals', { defaultValue: 'Open Deals' }), value: entity.open_deals_count ?? '—', trend: 'neutral' },
    { label: t('common.contacts', { defaultValue: 'Contacts' }), value: entity.contacts_count ?? '—', trend: 'neutral' },
    { label: t('common.overdueTasks', { defaultValue: 'Overdue Tasks' }), value: taskCount ?? entity.overdue_tasks_count ?? '—', trend: ((taskCount ?? 0) > 0 ? 'down' : 'neutral') },
    { label: t('common.healthScore', { defaultValue: 'Health Score' }), value: entity.health_score ?? '—', trend: 'neutral' },
  ]

  const tabs: DetailTab[] = [
    { key: 'overview', label: t('common.overview', { defaultValue: 'Overview' }), render: () => <TimelineTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'timeline', label: t('common.timeline', { defaultValue: 'Timeline' }), render: () => <TimelineTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'contacts', label: t('common.contacts', { defaultValue: 'Contacts' }), render: () => <ContactsTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'deals', label: t('common.deals', { defaultValue: 'Deals' }), render: () => <DealsTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'projects', label: t('common.projects', { defaultValue: 'Projects' }), render: () => <ProjectsTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'products', label: t('common.products', { defaultValue: 'Products' }), render: () => <ProductsTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'partners', label: t('common.partners', { defaultValue: 'Partners' }), render: () => <PartnersTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'tasks', label: t('common.tasks', { defaultValue: 'Tasks' }), render: () => <TasksTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'touchpoints', label: t('common.touchpoints', { defaultValue: 'Touchpoints' }), render: () => <TouchpointsTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
    { key: 'notes', label: t('common.notes', { defaultValue: 'Notes' }), render: () => <NotesTab entity={entity} moduleConfig={companyConfig} refresh={refresh} /> },
  ]

  return (
    <NexusDetailPageV2
      entity={entity}
      moduleConfig={companyConfig}
      avatarLabel={String(entity.name || '?').slice(0, 2).toUpperCase()}
      subline={subline.slice(0, 3)}
      highlights={highlights}
      aiInsight={insight ?? undefined}
      aiInsightLoading={insightLoading}
      onRefreshInsight={refreshInsight}
      breadcrumbLabel={t('pages.companies.title', { defaultValue: 'Companies' })}
      breadcrumbHref="/companies"
      onEdit={() => navigate(`/companies/${id}/edit`)}
      onAskAI={() => window.dispatchEvent(new CustomEvent('nexus:open-ai-panel', { detail: { context: entity } }))}
      sidebarSections={[
        {
          title: t('common.generalInfo', { defaultValue: 'General Info' }),
          fields: [
            { label: t('fields.industry', { defaultValue: 'Industry' }), value: entity.industry || '—' },
            { label: t('fields.category', { defaultValue: 'Category' }), value: entity.category || '—' },
            { label: t('fields.ceo', { defaultValue: 'CEO' }), value: entity.ceo_name || '—' },
            { label: t('fields.website', { defaultValue: 'Website' }), value: entity.website || '—', aiEnriched: !!entity.website_ai_filled },
            { label: t('fields.phone', { defaultValue: 'Phone' }), value: entity.phone || '—' },
            { label: t('fields.address', { defaultValue: 'Address' }), value: entity.address || '—' },
            { label: t('fields.domain', { defaultValue: 'Domain' }), value: entity.domain || '—' },
          ],
        },
        {
          title: t('common.ownership', { defaultValue: 'Ownership' }),
          fields: [
            { label: t('fields.owner', { defaultValue: 'Owner' }), value: entity.owner_name || String(entity.owner_id || '') || '—' },
            { label: t('fields.created', { defaultValue: 'Created' }), value: formatDate(entity.created_at) },
            { label: t('fields.status', { defaultValue: 'Status' }), value: entity.status || '—' },
          ],
        },
      ]}
      tabs={tabs}
    />
  )
}
