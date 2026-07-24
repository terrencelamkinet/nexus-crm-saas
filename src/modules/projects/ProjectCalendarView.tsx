import { useState, useEffect, useCallback } from 'react';
import CalendarViews from './CalendarViews/CalendarViews';
import { formatEvents } from './CalendarViews/types';
import type { CalendarEvent } from './CalendarViews/types';
import { apiClient } from '../../lib/api';

export default function ProjectCalendarView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiClient.get<any>('/api/v1/crm/projects?limit=500');
      const items: any[] = (resp as any)?.items || (resp as any) || [];
      const all: CalendarEvent[] = [];

      for (const proj of items) {
        try {
          const evs: CalendarEvent[] = await apiClient.get(`/api/v1/crm/projects/${proj.id}/calendar-events`);
          evs.forEach((ev) => all.push({ ...ev, project_id: proj.id, project_name: proj.name }));
        } catch { /* skip */ }

        if (proj.start_date) {
          all.push({
            id: `proj-start-${proj.id}`, project_id: proj.id,
            title: `${proj.name} starts`, description: null,
            event_type: 'milestone', start: proj.start_date, end: proj.start_date,
            is_all_day: true, color: '#00693E', location: null,
          });
        }
        if (proj.deadline) {
          all.push({
            id: `proj-deadline-${proj.id}`, project_id: proj.id,
            title: `${proj.name} due`, description: null,
            event_type: 'milestone', start: proj.deadline, end: proj.deadline,
            is_all_day: true, color: '#E76F51', location: null,
          });
        }
      }

      setEvents(all);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  return (
    <CalendarViews
      events={formatEvents(events)}
      loading={loading}
      onRefresh={fetchEvents}
    />
  );
}
