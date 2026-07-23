/**
 * ProjectCalendarView — list-level calendar showing all projects' milestones & events
 * Uses @toast-ui/react-calendar with GA disabled and XSS protection via DOMPurify.
 *
 * Safety: tui.calendar uses isomorphpic-dompurify (DOMPurify) to sanitize all
 * rendered HTML content, preventing XSS. GA is disabled via usageStatistics={false}.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Calendar from '@toast-ui/react-calendar';
import '@toast-ui/calendar/dist/toastui-calendar.min.css';
import { apiClient } from '../../lib/api';

interface CalendarEvent {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  event_type: string | null;
  start: string;
  end: string;
  is_all_day: boolean;
  color: string | null;
  location: string | null;
  project_name?: string;
}

const calendars = [
  { id: 'milestone', name: 'Milestones', backgroundColor: '#00693E', borderColor: '#005030' },
  { id: 'task', name: 'Tasks', backgroundColor: '#00B4D8', borderColor: '#0090B0' },
  { id: 'meeting', name: 'Meetings', backgroundColor: '#F4A261', borderColor: '#E07A30' },
  { id: 'reminder', name: 'Reminders', backgroundColor: '#E76F51', borderColor: '#CF5A3C' },
  { id: 'default', name: 'Other', backgroundColor: '#6B7280', borderColor: '#4B5563' },
];

function calendarIdForType(type: string | null): string {
  const map: Record<string, string> = {
    milestone: 'milestone',
    task: 'task',
    meeting: 'meeting',
    reminder: 'reminder',
  };
  return map[type || ''] || 'default';
}

function eventToCalendarEvent(ev: CalendarEvent, projectName?: string): any {
  const calId = calendarIdForType(ev.event_type);
  const cal = calendars.find((c) => c.id === calId)!;
  return {
    id: ev.id,
    calendarId: calId,
    title: projectName ? `${projectName} — ${ev.title}` : ev.title,
    category: ev.is_all_day ? 'allday' : 'time',
    start: ev.start,
    end: ev.end,
    isAllday: ev.is_all_day || false,
    body: ev.description || '',
    location: ev.location || '',
    backgroundColor: ev.color || cal.backgroundColor,
    borderColor: ev.color ? adjustColor(ev.color, -20) : cal.borderColor,
    raw: { projectId: ev.project_id },
  };
}

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

export default function ProjectCalendarView() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const calendarRef = useRef<any>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiClient.get<any>('/api/v1/crm/projects?limit=500');
      const items: any[] = (resp as any)?.items || (resp as any) || [];

      const allEvents: CalendarEvent[] = [];
      for (const proj of items) {
        // Fetch calendar events for each project
        try {
          const evs: CalendarEvent[] = await apiClient.get(`/api/v1/crm/projects/${proj.id}/calendar-events`);
          evs.forEach((ev) => {
            allEvents.push({ ...ev, project_name: proj.name });
          });
        } catch {
          // Skip projects that fail
        }

        // Also add project start_date and deadline as events
        if (proj.start_date) {
          allEvents.push({
            id: `proj-start-${proj.id}`,
            project_id: proj.id,
            title: `${proj.name} starts`,
            description: null,
            event_type: 'milestone',
            start: proj.start_date,
            end: proj.start_date,
            is_all_day: true,
            color: '#00693E',
            location: null,
            project_name: proj.name,
          });
        }
        if (proj.deadline) {
          allEvents.push({
            id: `proj-deadline-${proj.id}`,
            project_id: proj.id,
            title: `${proj.name} due`,
            description: null,
            event_type: 'milestone',
            start: proj.deadline,
            end: proj.deadline,
            is_all_day: true,
            color: '#E76F51',
            location: null,
            project_name: proj.name,
          });
        }
      }

      setEvents(allEvents.map((ev) => eventToCalendarEvent(ev, ev.project_name)));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const handler = () => fetchEvents();
    window.addEventListener('modules-changed', handler);
    return () => window.removeEventListener('modules-changed', handler);
  }, [fetchEvents]);

  // Refresh when project events change
  const handleAfterRenderEvent = useCallback(() => {
    // no-op, calendar handles rendering
  }, []);

  return (
    <div className="project-calendar">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          {(['month', 'week', 'day'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Day'}
            </button>
          ))}
        </div>
        <button
          onClick={fetchEvents}
          className="px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-highlight rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Calendar */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-400">Loading calendar...</div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <Calendar
            ref={calendarRef}
            view={view}
            events={events}
            calendars={calendars}
            usageStatistics={false}
            timezone={{
              zones: [
                {
                  timezoneName: 'Asia/Hong_Kong',
                  displayLabel: 'HKT',
                  tooltipContent: 'Hong Kong Time',
                },
              ],
            }}
            month={{
              startDayOfWeek: 1,
              visibleWeeksCount: 0,
              narrowWeekend: false,
            }}
            week={{
              startDayOfWeek: 1,
              workweek: false,
            }}
            template={{
              milestone(event: any) {
                return `<span class="font-medium">${event.title}</span>`;
              },
              milestoneTitle() {
                return '<span class="font-semibold text-xs">Milestones</span>';
              },
              allday(event: any) {
                return `<span>${event.title}</span>`;
              },
              alldayTitle() {
                return '<span class="font-semibold text-xs">All Day</span>';
              },
              time(event: any) {
                return `<span>${event.title}</span>`;
              },
            }}
            onAfterRenderEvent={handleAfterRenderEvent}
          />
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
        {calendars.map((cal) => (
          <div key={cal.id} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: cal.backgroundColor }}
            />
            <span>{cal.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
