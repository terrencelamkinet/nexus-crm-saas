import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NexusDetailPageV2, useAIInsight, type DetailTab, type HighlightWidget } from '../shared/NexusDetailPageV2'
import projectConfig from './config'
import { useEntity } from '../hooks/useEntity'

function formatDate(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

export default function ProjectsDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { entity, loading, refresh } = useEntity('project', id!)
  const { insight, loading: insightLoading, refresh: refreshInsight } = useAIInsight('project', id!)

  if (loading || !entity) {
    return <div className="nx-loading-shell">{t('common.loading', { defaultValue: 'Loading…' })}</div>
  }

  const overdue = entity.deadline ? (new Date(entity.deadline) < new Date() && entity.status !== 'completed') : false
  const subline = [
    entity.status,
    entity.priority,
    (entity.company as any)?.name || '—',
  ].filter(Boolean).filter(v => v !== '—') as string[]

  const highlights: HighlightWidget[] = [
    { label: t('common.tasks', { defaultValue: 'Tasks' }), value: entity.tasks_count ?? '—', trend: 'neutral' },
    { label: t('fields.status', { defaultValue: 'Status' }), value: entity.status || '—', trend: 'neutral' },
    { label: t('fields.priority', { defaultValue: 'Priority' }), value: entity.priority || '—', trend: 'neutral' },
    { label: t('common.deadline', { defaultValue: 'Deadline' }), value: formatDate(entity.deadline), trend: (overdue ? 'down' : 'neutral') },
  ]

  // 沿用 config detailTabs 嘅 renderers（e.g. timeline → ProjectDetailCalendar）
  const tabs: DetailTab[] = (projectConfig.detailTabs || [])
    .filter(tb => tb.id !== 'details') // details 欄位已由 sidebar 展示
    .map(tb => ({
      key: tb.id,
      label: t(`common.${tb.id}`, { defaultValue: tb.label }),
      render: () => {
        const R = tb.render
        if (R) return <R entity={entity} moduleConfig={projectConfig} refresh={refresh} />
        return <div className="nx-empty-state">{t('common.noDataTab', { defaultValue: 'No data' })}</div>
      },
    }))

  return (
    <NexusDetailPageV2
      entity={entity}
      moduleConfig={projectConfig}
      avatarLabel={String(entity.name || '?').slice(0, 2).toUpperCase()}
      subline={subline.slice(0, 3)}
      highlights={highlights}
      aiInsight={insight ?? undefined}
      aiInsightLoading={insightLoading}
      onRefreshInsight={refreshInsight}
      breadcrumbLabel={t('pages.projects.title', { defaultValue: 'Projects' })}
      breadcrumbHref="/projects"
      onEdit={() => navigate(`/projects/${id}/edit`)}
      onAskAI={() => window.dispatchEvent(new CustomEvent('nexus:open-ai-panel', { detail: { context: entity } }))}
      sidebarSections={[
        {
          title: t('common.generalInfo', { defaultValue: 'General Info' }),
          fields: [
            { label: t('fields.status', { defaultValue: 'Status' }), value: entity.status || '—' },
            { label: t('fields.priority', { defaultValue: 'Priority' }), value: entity.priority || '—' },
            { label: t('fields.startDate', { defaultValue: 'Start Date' }), value: formatDate(entity.start_date) },
            { label: t('fields.deadline', { defaultValue: 'Deadline' }), value: formatDate(entity.deadline) },
            { label: t('fields.budget', { defaultValue: 'Budget' }), value: entity.budget_amount != null ? String(entity.budget_amount) : '—' },
            { label: t('fields.company', { defaultValue: 'Company' }), value: (entity.company as any)?.name || '—' },
            { label: t('fields.description', { defaultValue: 'Description' }), value: entity.description || '—' },
          ],
        },
        {
          title: t('common.ownership', { defaultValue: 'Ownership' }),
          fields: [
            { label: t('fields.salesOwner', { defaultValue: 'Sales Owner' }), value: String(entity.sales_owner_id || '') || '—' },
            { label: t('fields.created', { defaultValue: 'Created' }), value: formatDate(entity.created_at) },
          ],
        },
      ]}
      tabs={tabs}
    />
  )
}
