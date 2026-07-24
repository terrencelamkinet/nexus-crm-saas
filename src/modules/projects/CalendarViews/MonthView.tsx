import { useMemo } from 'react';
import {
  getMonthGrid,
  DAY_NAMES,
  formatDateKey,
  isSameDay,
} from './calendar-utils';
import type { CalendarEventFormatted } from './types';
import { TYPE_COLORS } from './types';

interface MonthViewProps {
  events: CalendarEventFormatted[];
  date: Date;
  onDateChange: (d: Date) => void;
}

const MAX_EVENTS_PER_CELL = 3;

export default function MonthView({ events, date, onDateChange }: MonthViewProps) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const grid = useMemo(() => getMonthGrid(year, month), [year, month]);

  const todayRef = useMemo(() => new Date(), []);

  // Group events by date key
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventFormatted[]>();
    for (const ev of events) {
      const key = formatDateKey(ev.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  return (
    <div>
      {/* ── Calendar Grid ── */}
      <div className="month-calendar">
        {/* Day names header */}
        <div className="month-header">
          {DAY_NAMES.map((name) => (
            <div key={name} className="month-day-name">
              {name}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="month-grid">
          {grid.map((week, weekIdx) =>
            week.map((day, dayIdx) => {
              if (day === null) {
                return (
                  <div
                    key={`empty-${weekIdx}-${dayIdx}`}
                    className="month-cell empty"
                  />
                );
              }

              const cellDate = new Date(year, month, day);
              const dateKey = formatDateKey(cellDate);
              const dayEvents = eventsByDay.get(dateKey) || [];
              const isCellToday = isSameDay(cellDate, todayRef);

              return (
                <div
                  key={`day-${day}`}
                  className={`month-cell${isCellToday ? ' today' : ''}`}
                  onClick={() => onDateChange(cellDate)}
                >
                  <div className="month-date">{day}</div>

                  {/* Event blocks */}
                  {dayEvents.slice(0, MAX_EVENTS_PER_CELL).map((ev) => (
                    <div
                      key={ev.id}
                      className="month-event"
                      style={{ background: `${ev.color}22`, color: ev.color, borderLeft: `2.5px solid ${ev.color}` }}
                      title={ev.title}
                    >
                      {ev.allDay ? '' : `${ev.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} `}{ev.title}
                    </div>
                  ))}
                  {dayEvents.length > MAX_EVENTS_PER_CELL && (
                    <div className="month-more">+{dayEvents.length - MAX_EVENTS_PER_CELL} more</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="month-legend">
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
