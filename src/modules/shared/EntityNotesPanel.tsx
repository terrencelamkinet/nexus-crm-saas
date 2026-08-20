import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '../../lib/api'
import NexusEditor from '../../components/editor/NexusEditor'

/* 共用 Notes 面板 — link 到任意 entity（project / task / contact / company）
   用法: <EntityNotesPanel entityType="project" entityId={id} /> */

interface NoteItem {
  id: string
  title: string | null
  content: string | null
  pinned: boolean
  created_at: string
  contact_id?: string | null
  company_id?: string | null
}

interface Props {
  entityType: 'project' | 'task' | 'contact' | 'company'
  entityId: string
  filterKey: 'project_id' | 'task_id' | 'contact_id' | 'company_id'
  compact?: boolean
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return '剛剛'
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`
  return d.toLocaleDateString()
}

export default function EntityNotesPanel({ entityType, entityId, filterKey, compact }: Props) {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ items: NoteItem[] }>(
        `/api/v1/crm/notes?page_size=50&${filterKey}=${entityId}`
      )
      setNotes(res.items || [])
    } catch { setNotes([]) }
    finally { setLoading(false) }
  }, [entityId, filterKey])

  useEffect(() => { load() }, [load])

  const addNote = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      await apiClient.post('/api/v1/crm/notes', {
        title: title.trim(),
        content: content || null,
        [filterKey]: entityId,
      })
      setTitle(''); setContent(''); setOpen(false)
      load()
    } catch (e: any) { alert(e.detail || e.message) }
    finally { setSaving(false) }
  }

  const removeNote = async (id: string) => {
    try {
      await apiClient.delete(`/api/v1/crm/notes/${id}`)
      setNotes(prev => prev.filter(n => n.id !== id))
    } catch (e: any) { alert(e.detail || e.message) }
  }

  return (
    <div className={`nx-notes-panel${compact ? ' compact' : ''}`}>
      <div className="nx-notes-head">
        <span className="f-label">{t('pages.contacts.detail.notes', { defaultValue: 'Notes' })}</span>
        <button className="btn-ghost" onClick={() => setOpen(true)}>+ {t('pages.contacts.detail.addNote', { defaultValue: 'Add Note' })}</button>
      </div>

      {loading ? (
        <div className="nx-empty-state">{t('common.loading', { defaultValue: 'Loading…' })}</div>
      ) : notes.length === 0 ? (
        <div className="nx-empty-state">{t('pages.contacts.detail.noNotes', { defaultValue: 'No notes yet' })}</div>
      ) : (
        <div className="flex-col" style={{ gap: 8 }}>
          {notes.map(n => (
            <div key={n.id} className="nx-note-card">
              <div className="nx-note-title-row">
                <span className="list-title">{n.title}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {n.pinned && <span className="badge badge-p1">📌</span>}
                  <button className="icon-btn-small" title={t('common.delete')} onClick={() => removeNote(n.id)} style={{ color: 'var(--color-notification)' }}>✕</button>
                </div>
              </div>
              {n.content && (
                <div className="nxe-rendered-content" dangerouslySetInnerHTML={{ __html: n.content }} />
              )}
              <div className="nx-note-meta">{timeAgo(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="share-overlay" onClick={() => setOpen(false)}>
          <div className="share-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>{t('pages.contacts.detail.addNote', { defaultValue: 'Add Note' })}</h3>
            <div className="dt-field" style={{ marginTop: 10 }}>
              <span className="f-label">{t('pages.contacts.detail.titleRequired', { defaultValue: 'Title' })}</span>
              <input type="text" className="input-field" value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('pages.contacts.detail.noteTitlePlaceholder', { defaultValue: 'Note title…' })} />
            </div>
            <div className="dt-field" style={{ marginTop: 8 }}>
              <span className="f-label">{t('common.content', { defaultValue: 'Content' })}</span>
              <NexusEditor
                content={content}
                onChange={html => setContent(html)}
                minHeight={160}
                entityContext={{ type: entityType, id: entityId }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-secondary" onClick={() => setOpen(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</button>
              <button className="btn-primary" disabled={saving || !title.trim()} onClick={addNote}>
                {saving ? t('common.saving', { defaultValue: 'Saving…' }) : t('common.save', { defaultValue: 'Save' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
