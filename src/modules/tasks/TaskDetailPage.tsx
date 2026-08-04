import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import GenericDetailPage from '../GenericDetailPage'
import taskConfig from './config'
import { apiClient } from '../../lib/api'

function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  // local date → YYYY-MM-DD (avoid UTC shift)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState<'done' | 'snooze' | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

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
      setRefreshKey(k => k + 1) // remount GenericDetailPage → refetch
    } catch (e: any) {
      setFlash({ kind: 'err', text: e.detail || e.message || '操作失敗' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <GenericDetailPage
        key={refreshKey}
        config={taskConfig}
        extraData={{ contacts, companies }}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => act('done')}
            >
              {busy === 'done' ? '⋯' : '✅ 完成'}
            </button>
            <button
              className="btn-ghost"
              disabled={busy !== null}
              onClick={() => act('snooze')}
            >
              {busy === 'snooze' ? '⋯' : '⏰ 推遲至聽日'}
            </button>
          </div>
        }
      />
      {flash && (
        <div
          className={`mx-6 mt-3 rounded-lg px-4 py-2 text-sm ${
            flash.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
          }`}
        >
          {flash.text}
        </div>
      )}
    </>
  )
}
