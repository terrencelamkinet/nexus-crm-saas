import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { isSameDay } from './calendar-utils';
import type { CalendarEventFormatted } from './types';
import { TYPE_COLORS } from './types';

interface DeadlineViewProps {
  events: CalendarEventFormatted[];
  date: Date;
  onDateChange: (d: Date) => void;
}

type DeadlineGroup = 'overdue' | 'today' | 'thisWeek' | 'thisMonth' | 'future';

interface GroupInfo {
  label: string;
  comparator: (d: Date, today: Date) => boolean;
}

const GROUP_CONFIG: Record<DeadlineGroup, GroupInfo> = {
  overdue: {
    label: 'Overdue',
    comparator: (d: Date, today: Date) => d < new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  },
  today: {
    label: 'Today',
    comparator: (d: Date, today: Date) => isSameDay(d, today),
  },
  thisWeek: {
    label: 'This Week',
    comparator: (d: Date, today: Date) => {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
      endOfWeek.setHours(23, 59, 59, 999);
      return d > new Date(today.getFullYear(), today.getMonth(), today.getDate()) && d <= endOfWeek;
    },
  },
  thisMonth: {
    label: 'This Month',
    comparator: (d: Date, today: Date) => {
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      const startOfNextWeek = new Date(today);
      startOfNextWeek.setDate(today.getDate() + (6 - today.getDay()) + 1);
      startOfNextWeek.setHours(0, 0, 0, 0);
      return d >= startOfNextWeek && d <= endOfMonth;
    },
  },
  future: {
    label: 'Future',
    comparator: (d: Date, today: Date) => {
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      return d > endOfMonth;
    },
  },
};

const GROUP_ORDER: DeadlineGroup[] = ['overdue', 'today', 'thisWeek', 'thisMonth', 'future'];

/** Get event type display color — falls back to a muted gray */
function getEventBadgeColor(eventType: string | null): string {
  if (eventType && TYPE_COLORS[eventType]) return TYPE_COLORS[eventType];
  return '#6B7280';
}

export default function DeadlineView({ events }: DeadlineViewProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Group and sort events
  const grouped = useMemo(() => {
    const groups = new Map<DeadlineGroup, CalendarEventFormatted[]>();
    for (const key of GROUP_ORDER) {
      groups.set(key, []);
    }

    // Assign each event to its group based on start date
    for (const ev of events) {
      const start = new Date(ev.start);
      start.setHours(0, 0, 0, 0);
      for (const key of GROUP_ORDER) {
        if (GROUP_CONFIG[key].comparator(start, today)) {
          groups.get(key)!.push(ev);
          break;
        }
      }
    }

    // Sort each group by start date ascending
    for (const [, evs] of groups) {
      evs.sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    return groups;
  }, [events, today]);

  const hasAnyEvents = events.length > 0;

  if (!hasAnyEvents) {
    return (
      <div>
        {/* Empty state */}
        <div className="calendar-empty">
          <CalendarDays />
          <p>No deadlines</p>
        </div>
      </div>
    );
  }

  return (
    <div className="deadline-panel">
      <div className="deadline-group">
        {GROUP_ORDER.map((key) => {
          const evs = grouped.get(key)!;
          if (evs.length === 0) return null;

          const config = GROUP_CONFIG[key];
          const isOverdue = key === 'overdue';

          return (
            <div key={key}>
              {/* Group header */}
              <div className={`deadline-header${isOverdue ? ' overdue' : ''}`}>
                <h3>{config.label}</h3>
                <span className="count-chip">{evs.length}</span>
              </div>

              {/* Event rows */}
              {evs.map((ev) => (
                <div key={ev.id} className="deadline-row">
                  {/* Date badge */}
                  <div className="deadline-date">
                    <div className="day-num">{ev.start.getDate()}</div>
                    <div className="day-mon">
                      {ev.start.toLocaleDateString('en-US', { month: 'short' })}
                    </div>
                  </div>

                  {/* Event type dot */}
                  <div
                    className="deadline-dot"
                    style={{ backgroundColor: getEventBadgeColor(ev.eventType) }}
                    title={ev.eventType || 'event'}
                  />

                  {/* Event details */}
                  <div className="deadline-info">
                    <div className="dl-title truncate">{ev.title}</div>
                    {ev.projectName && (
                      <div className="dl-sub truncate">{ev.projectName}</div>
                    )}
                  </div>

                  {/* Time */}
                  {!ev.allDay && (
                    <div className="deadline-time">
                      {ev.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}

                  {/* Event type tag */}
                  {ev.eventType && (
                    <span
                      className="deadline-tag"
                      style={{ backgroundColor: getEventBadgeColor(ev.eventType) }}
                    >
                      {ev.eventType}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="deadline-legend">
        {Object.entries(TYPE_COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="capitalize">{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
