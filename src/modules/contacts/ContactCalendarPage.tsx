import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import CalendarViews from '../projects/CalendarViews/CalendarViews'
import { formatEvents } from '../projects/CalendarViews/types'
import type { CalendarEvent } from '../projects/CalendarViews/types'
import { apiClient } from '../../lib/api'

export default function ContactCalendarPage() {
  const { t } = useTranslation()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const all: CalendarEvent[] = []

    try {
      // Fetch all touchpoints
      const tpResp = await apiClient.get<{ items: any[] }>('/api/v1/crm/touchpoints?page_size=500')
      const tps = tpResp?.items || []
      tps.forEach((tp: any) => {
        const evDate = tp.created_at ? tp.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
        all.push({
          id: `tp-${tp.id}`,
          project_id: tp.contact_id || tp.id,
          title: tp.title || tp.type || 'Touchpoint',
          description: tp.description || null,
          event_type: tp.type || 'meeting',
          start: evDate,
          end: evDate,
          is_all_day: true,
          color: tp.type === 'call' ? '#00B4D8'
            : tp.type === 'email' ? '#6B7280'
            : tp.type === 'meeting' ? '#F4A261'
            : '#00693E',
          location: null,
          project_name: tp.contact?.name || tp.company?.name || 'Contact',
        })
      })
    } catch { /* silent */ }

    try {
      // Fetch tasks with due dates
      const taskResp = await apiClient.get<{ items: any[] }>('/api/v1/crm/tasks?page_size=500')
      const tasks = taskResp?.items || []
      tasks.forEach((t: any) => {
        if (!t.due_date) return
        all.push({
          id: `task-${t.id}`,
          project_id: t.contact_id || t.id,
          title: t.title,
          description: t.description || null,
          event_type: 'task',
          start: t.due_date,
          end: t.due_date,
          is_all_day: true,
          color: '#E76F51',
          location: null,
          project_name: t.contact?.name || 'Task',
        })
      })
    } catch { /* silent */ }

    setEvents(all)
    setLoading(false)
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('pages.contacts.title', 'Contacts')} Calendar</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 3 }}>
            Touchpoints and tasks across all contacts
          </p>
        </div>
      </div>
      <CalendarViews
        events={formatEvents(events)}
        loading={loading}
        onRefresh={fetchEvents}
      />
    </div>
  )
}
