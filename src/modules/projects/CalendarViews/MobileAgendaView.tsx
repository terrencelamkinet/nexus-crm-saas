import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  formatMonthYear,
  formatDayHeader,
  formatDateKey,
  isSameDay,
  isToday,
} from './calendar-utils';
import type { CalendarEventFormatted } from './types';
import { TYPE_COLORS } from './types';

interface MobileAgendaViewProps {
  events: CalendarEventFormatted[];
  date: Date;
  onDateChange: (d: Date) => void;
}

export default function MobileAgendaView({ events, date, onDateChange }: MobileAgendaViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(date);
  const stripRef = useRef<HTMLDivElement>(null);

  // Generate a 7-day window centered on the current date
  const weekDates = useMemo(() => {
    const today = new Date();
    // Build a range of 7 days: 3 before + today + 3 after
    const days: Date[] = [];
    for (let i = -3; i <= 3; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll today's date into view on mount
  useEffect(() => {
    if (stripRef.current) {
      const activeEl = stripRef.current.querySelector('.mobile-agenda-date.active') as HTMLElement | null;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, []);

  // Filter events by selected date
  const dayEvents = useMemo(() => {
    return events.filter((ev) => isSameDay(ev.start, selectedDate));
  }, [events, selectedDate]);

  const handleDateSelect = useCallback(
    (d: Date) => {
      setSelectedDate(d);
      onDateChange(d);
    },
    [onDateChange],
  );

  // Format time range for an event
  const formatTime = (ev: CalendarEventFormatted): string => {
    if (ev.allDay) return 'All day';
    const startStr = ev.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endStr = ev.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${startStr} – ${endStr}`;
  };

  // Determine color for event dot
  const eventColor = (ev: CalendarEventFormatted): string => {
    if (ev.color) return ev.color;
    return ev.eventType && TYPE_COLORS[ev.eventType] ? TYPE_COLORS[ev.eventType] : '#6B7280';
  };

  return (
    <div className="mobile-agenda">
      {/* ── Top: Month + Year header ── */}
      <div className="mobile-agenda-strip">
        <div className="mobile-agenda-header">{formatMonthYear(selectedDate)}</div>

        {/* ── Horizontal date strip ── */}
        <div className="mobile-agenda-dates" ref={stripRef}>
          {weekDates.map((d) => {
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
            const dayNum = d.getDate();
            const active = isSameDay(d, selectedDate);
            const today = isToday(d);

            return (
              <button
                key={formatDateKey(d)}
                className={`mobile-agenda-date${active ? ' active' : ''}${today && !active ? ' today' : ''}`}
                onClick={() => handleDateSelect(d)}
              >
                <span className="m-date-day">{dayName}</span>
                <span className="m-date-num">{dayNum}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Agenda list ── */}
      <div className="mobile-agenda-list">
        <div className="mobile-agenda-date-header">{formatDayHeader(selectedDate)}</div>

        {dayEvents.length === 0 ? (
          <div className="mobile-agenda-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p>No events</p>
          </div>
        ) : (
          dayEvents.map((ev) => (
            <div key={ev.id} className="mobile-agenda-card">
              <div
                className="mobile-agenda-dot"
                style={{ backgroundColor: eventColor(ev) }}
              />
              <div className="mobile-agenda-info">
                <div className="mobile-agenda-title">{ev.title}</div>
                <div className="mobile-agenda-time">{formatTime(ev)}</div>
                {ev.location && (
                  <div className="mobile-agenda-location">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {ev.location}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
