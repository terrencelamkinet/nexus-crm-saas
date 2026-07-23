/**
 * ProjectDetailCalendar — shows a single project's calendar events.
 * Receives { entity, refresh } from GenericDetailPage via TabConfig.render.
 * Uses @toast-ui/react-calendar with GA disabled.
 */
import { useState, useEffect, useCallback } from 'react';
import Calendar from '@toast-ui/react-calendar';
import '@toast-ui/calendar/dist/toastui-calendar.min.css';
import { apiClient } from '../../lib/api';
import type { ModuleConfig, EntityRecord } from '../module-types';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: string | null;
  start: string;
  end: string;
  is_all_day: boolean;
  color: string | null;
  location: string | null;
}

interface Props {
  entity: EntityRecord;
  moduleConfig: ModuleConfig;
  refresh: () => void;
}

const calendars = [
  { id: 'milestone', name: 'Milestones', backgroundColor: '#00693E', borderColor: '#005030' },
  { id: 'task', name: 'Tasks', backgroundColor: '#00B4D8', borderColor: '#0090B0' },
  { id: 'meeting', name: 'Meetings', backgroundColor: '#F4A261', borderColor: '#E07A30' },
  { id: 'reminder', name: 'Reminders', backgroundColor: '#E76F51', borderColor: '#CF5A3C' },
  { id: 'default', name: 'Other', backgroundColor: '#6B7280', borderColor: '#4B5563' },
];

function calId(type: string | null): string {
  const m: Record<string, string> = { milestone: 'milestone', task: 'task', meeting: 'meeting', reminder: 'reminder' };
  return m[type || ''] || 'default';
}

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

export default function ProjectDetailCalendar({ entity }: Props) {
  const projectId = entity?.id;
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');

  const fetchEvents = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list: CalendarEvent[] = await apiClient.get(`/api/v1/crm/projects/${projectId}/calendar-events`);
      setEvents(
        list.map((ev) => {
          const cal = calendars.find((c) => c.id === calId(ev.event_type))!;
          return {
            id: ev.id,
            calendarId: calId(ev.event_type),
            title: ev.title,
            category: ev.is_all_day ? 'allday' : 'time',
            start: ev.start,
            end: ev.end,
            isAllday: ev.is_all_day || false,
            body: ev.description || '',
            location: ev.location || '',
            backgroundColor: ev.color || cal.backgroundColor,
            borderColor: ev.color ? adjustColor(ev.color, -20) : cal.borderColor,
          } as any;
        })
      );
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Calendar</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {(['month', 'week', 'day'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {v === 'month' ? 'M' : v === 'week' ? 'W' : 'D'}
              </button>
            ))}
          </div>
          <button
            onClick={fetchEvents}
            className="px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-highlight rounded-lg"
          >
            Refresh
          </button>
        </div>
      </div>
      <div style={{ padding: '16px' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-slate-400">Loading calendar...</div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <Calendar
              view={view}
              events={events}
              calendars={calendars}
              usageStatistics={false}
              timezone={{
                zones: [{ timezoneName: 'Asia/Hong_Kong', displayLabel: 'HKT', tooltipContent: 'Hong Kong Time' }],
              }}
              month={{ startDayOfWeek: 1, narrowWeekend: false }}
              week={{ startDayOfWeek: 1, workweek: false }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
