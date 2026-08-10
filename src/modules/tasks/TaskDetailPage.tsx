import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NexusDetailPageV2, useAIInsight, type DetailTab, type HighlightWidget } from '../shared/NexusDetailPageV2'
import taskConfig from './config'
import { useEntity } from '../hooks/useEntity'
import { apiClient } from '../../lib/api'

function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDate(d?: string): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const { entity, loading, refresh } = useEntity('task', id!)
  const { insight, loading: insightLoading, refresh: refreshInsight } = useAIInsight('task', id!)

  // 保留原有 contacts/companies fetch（relation fields）
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState<'done' | 'snooze' | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    Promise.all([
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/contacts?page_size=100').then(r => setContacts(r.items || [])).catch(() => {}),
      apiClient.get<{ items: { id: string; name: string }[] }>('/api/v1/crm/companies?page_size=100').then(r => setCompanies(r.items || [])).catch(() => {}),
    ])
  }, [])

  const act = async (kind: 'done' | 'snooze') => {
    if (!id) return
    setBusy(kind)
    setFlash(null)
    try {
      const body = kind === 'done' ? { status: 'completed' } : { due_date: tomorrowISO() }
      await apiClient.patch(`/api/v1/crm/tasks/${id}`, body)
      setFlash({ kind: 'ok', text: kind === 'done' ? '✅ Task 已標記完成' : '⏰ 已推遲至聽日' })
      refresh() // refetch entity
    } catch (e: any) {
      setFlash({ kind: 'err', text: e.detail || e.message || '操作失敗' })
    } finally {
      setBusy(null)
    }
  }

  // Hooks 已經全部喺 early return 之前 — safe
  if (loading || !entity) {
    return <div className="nx-loading-shell">{t('common.loading', { defaultValue: 'Loading…' })}</div>
  }

  const overdue = entity.due_date ? (new Date(entity.due_date) < new Date() && entity.status !== 'done') : false
  const subline = [entity.priority, entity.status, (entity.company_id ? String(entity.company_id) : '')].filter(Boolean) as string[]

  const highlights: HighlightWidget[] = [
    { label: t('fields.status', { defaultValue: 'Status' }), value: entity.status || '—', trend: 'neutral' },
    { label: t('fields.priority', { defaultValue: 'Priority' }), value: entity.priority || '—', trend: 'neutral' },
    { label: t('fields.dueDate', { defaultValue: 'Due Date' }), value: formatDate(entity.due_date), trend: (overdue ? 'down' : 'neutral') },
  ]

  const QuickActions = () => (
    <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
      <button className="btn-primary" disabled={busy !== null} onClick={() => act('done')}>
        {busy === 'done' ? '⋯' : '✅ 完成'}
      </button>
      <button className="btn-ghost" disabled={busy !== null} onClick={() => act('snooze')}>
        {busy === 'snooze' ? '⋯' : '⏰ 推遲至聽日'}
      </button>
    </div>
  )

  const tabs: DetailTab[] = [
    {
      key: 'overview',
      label: t('common.overview', { defaultValue: 'Overview' }),
      render: () => (
        <>
          <QuickActions />
          {flash && (
            <div className={`rounded-lg px-4 py-2 text-sm ${flash.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`} style={{ marginBottom: 12 }}>
              {flash.text}
            </div>
          )}
          <div className="nx-empty-state">{t('common.noActivity', { defaultValue: '暫無活動記錄' })}</div>
        </>
      ),
    },
  ]

  return (
    <>
      <NexusDetailPageV2
        entity={entity}
        moduleConfig={taskConfig}
        avatarLabel={String(entity.title || '?').slice(0, 2).toUpperCase()}
        subline={subline.slice(0, 3)}
        highlights={highlights}
        aiInsight={insight ?? undefined}
        aiInsightLoading={insightLoading}
        onRefreshInsight={refreshInsight}
        breadcrumbLabel={t('pages.tasks.title', { defaultValue: 'Tasks' })}
        breadcrumbHref="/tasks"
        onAskAI={() => window.dispatchEvent(new CustomEvent('nexus:open-ai-panel', { detail: { context: entity } }))}
        sidebarSections={[
          {
            title: t('common.generalInfo', { defaultValue: 'General Info' }),
            fields: [
              { label: t('fields.description', { defaultValue: 'Description' }), value: entity.description || '—' },
              { label: t('fields.priority', { defaultValue: 'Priority' }), value: entity.priority || '—' },
              { label: t('fields.dueDate', { defaultValue: 'Due Date' }), value: formatDate(entity.due_date) },
              { label: t('fields.status', { defaultValue: 'Status' }), value: entity.status || '—' },
            ],
          },
          {
            title: t('common.ownership', { defaultValue: 'Ownership' }),
            fields: [
              { label: t('fields.contact', { defaultValue: 'Contact' }), value: contacts.find(c => c.id === entity.contact_id)?.name || '—' },
              { label: t('fields.company', { defaultValue: 'Company' }), value: companies.find(c => c.id === entity.company_id)?.name || '—' },
              { label: t('fields.created', { defaultValue: 'Created' }), value: formatDate(entity.created_at) },
            ],
          },
        ]}
        tabs={tabs}
      />
    </>
  )
}
