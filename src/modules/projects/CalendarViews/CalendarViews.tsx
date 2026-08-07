import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  Presentation,
  Calendar,
  List,
  RefreshCw,
  CalendarDays,
  X,
} from 'lucide-react';
import type { CalendarViewType, CalendarEventFormatted } from './types';
import { formatMonthYear } from './calendar-utils';
import MonthView from './MonthView';
import WeekView from './WeekView';
import DayView from './DayView';
import DeadlineView from './DeadlineView';
import MobileAgendaView, { MobileAgendaList } from './MobileAgendaView';
import EventReviewModal from './EventReviewModal';
import { useEscapeKey } from '../../../lib/useEscapeKey';

/** Simple hook that tracks a CSS media query match state. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

interface CalendarViewsProps {
  events: CalendarEventFormatted[];
  loading: boolean;
  onRefresh: () => void;
}

const VIEW_TABS: { key: CalendarViewType; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { key: 'month', label: 'Month', Icon: LayoutGrid },
  { key: 'week', label: 'Week', Icon: Presentation },
  { key: 'day', label: 'Day', Icon: Calendar },
  { key: 'deadline', label: 'Deadline', Icon: List },
];

const SHOW_WEEKENDS_KEY = 'nexus_crm_show_weekends';

function navigateDate(date: Date, viewType: CalendarViewType, direction: -1 | 1): Date {
  const next = new Date(date);
  switch (viewType) {
    case 'month': next.setMonth(date.getMonth() + direction); break;
    case 'week': next.setDate(date.getDate() + direction * 7); break;
    case 'day': case 'deadline':
    default: next.setDate(date.getDate() + direction); break;
  }
  return next;
}

function getStoredShowWeekends(): boolean {
  try {
    return localStorage.getItem(SHOW_WEEKENDS_KEY) === 'true';
  } catch { return false; }
}

export default function CalendarViews({ events, loading, onRefresh }: CalendarViewsProps) {
  // Device-based default view: month on desktop, day on mobile.
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [viewType, setViewType] = useState<CalendarViewType>(() => (isMobile ? 'day' : 'month'));
  const [date, setDate] = useState<Date>(new Date());
  const [showWeekends, setShowWeekends] = useState<boolean>(getStoredShowWeekends);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventFormatted | null>(null);
  const [morePopup, setMorePopup] = useState<{ events: CalendarEventFormatted[]; date: Date } | null>(null);
  // Bumped on "Today"/"Now" so time-based views (day/week) re-scroll to the
  // real-time "now" line even when the date is already today. Real-time focus.
  const [focusSignal, setFocusSignal] = useState<number>(0);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  // Close view menu on outside click
  useEffect(() => {
    if (!viewMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setViewMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [viewMenuOpen]);

  // Persist weekend setting
  useEffect(() => {
    try { localStorage.setItem(SHOW_WEEKENDS_KEY, showWeekends ? 'true' : 'false'); }
    catch { /* ignore */ }
  }, [showWeekends]);

  const handleDateChange = useCallback((d: Date) => setDate(d), []);
  const handlePrev = useCallback(() => setDate((prev) => navigateDate(prev, viewType, -1)), [viewType]);
  const handleNext = useCallback(() => setDate((prev) => navigateDate(prev, viewType, 1)), [viewType]);
  const handleToday = useCallback(() => {
    setDate(new Date());
    // Real-time focus: re-scroll day/week to the current-time line.
    setFocusSignal((n) => n + 1);
  }, []);
  const handleViewChange = useCallback((newView: CalendarViewType) => {
    setViewType(newView);
    setViewMenuOpen(false);
  }, []);
  const toggleWeekends = useCallback(() => setShowWeekends((prev) => !prev), []);
  const handleEventClick = useCallback((ev: CalendarEventFormatted) => setSelectedEvent(ev), []);
  const handleReviewClose = useCallback(() => setSelectedEvent(null), []);
  const handleMoreClick = useCallback((evs: CalendarEventFormatted[], d: Date) => setMorePopup({ events: evs, date: d }), []);
  const handleMoreClose = useCallback(() => setMorePopup(null), []);

  // ESC closes the topmost overlay: day-events popup first, then the view menu.
  useEscapeKey(() => {
    if (morePopup) setMorePopup(null);
    else if (viewMenuOpen) setViewMenuOpen(false);
  }, !!(morePopup || viewMenuOpen));

  const currentView = VIEW_TABS.find((v) => v.key === viewType) || VIEW_TABS[0];

  const renderView = () => {
    switch (viewType) {
      case 'month':
        if (isMobile) return (
          <div>
            <MonthView events={events} date={date} onDateChange={handleDateChange} onEventClick={handleEventClick} onMoreClick={handleMoreClick} />
            <MobileAgendaList events={events} date={date} onEventClick={handleEventClick} />
          </div>
        );
        return <MonthView events={events} date={date} onDateChange={handleDateChange} onEventClick={handleEventClick} onMoreClick={handleMoreClick} />;
      case 'week': return <WeekView events={events} date={date} onDateChange={handleDateChange} viewType={viewType} onViewChange={handleViewChange} showWeekends={showWeekends} onEventClick={handleEventClick} focusSignal={focusSignal} />;
      case 'day': return <DayView events={events} date={date} onDateChange={handleDateChange} onEventClick={handleEventClick} focusSignal={focusSignal} />;
      case 'deadline': return <DeadlineView events={events} date={date} onDateChange={handleDateChange} onEventClick={handleEventClick} />;
      default:
        if (isMobile) return <MobileAgendaView events={events} date={date} onDateChange={handleDateChange} onEventClick={handleEventClick} />;
        return <MonthView events={events} date={date} onDateChange={handleDateChange} onEventClick={handleEventClick} onMoreClick={handleMoreClick} />;
    }
  };

  const navBar = (
    <div className="flex items-center max-sm:flex-col max-sm:items-start flex-wrap gap-2">
      <div className="flex items-center gap-1">
        <button onClick={handlePrev}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button onClick={handleToday}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-highlight)] transition-colors min-h-[36px]">
          Today
        </button>
        <button onClick={handleNext}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center">
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-[var(--color-text)] px-3 select-none font-[var(--font-display)]">
          {formatMonthYear(date)}
        </span>
      </div>

      <div className="flex items-center gap-2 max-sm:gap-1.5 flex-wrap max-sm:justify-end ml-auto">
        {/* Weekend toggle */}
        <button onClick={toggleWeekends}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[36px] tracking-wide ${
            showWeekends
              ? 'text-[var(--color-primary)] bg-[var(--color-primary-highlight)]'
              : 'text-[var(--color-text-muted)] bg-[var(--color-surface-offset)] hover:bg-[var(--color-surface-offset-2)]'
          }`}
          title={showWeekends ? 'Hide weekends' : 'Show weekends'}>
          Weekend
        </button>

        {/* View switcher — dropdown */}
        <div className="cv-view-dropdown" ref={viewMenuRef}>
          <button
            onClick={() => setViewMenuOpen((v) => !v)}
            className="cv-view-trigger"
            title="Switch view"
            aria-expanded={viewMenuOpen}
          >
            <currentView.Icon className="w-3.5 h-3.5" />
            <span>{currentView.label}</span>
            <ChevronDown className={`w-3.5 h-3.5 cv-view-chevron${viewMenuOpen ? ' open' : ''}`} />
          </button>

          {viewMenuOpen && (
            <div className="cv-view-menu" role="menu">
              {VIEW_TABS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  role="menuitem"
                  onClick={() => handleViewChange(key)}
                  className={`cv-view-item${viewType === key ? ' active' : ''}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                  {viewType === key && <span className="cv-view-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh */}
        <button onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const emptyState = (
    <div className="calendar-empty">
      <CalendarDays />
      <p>No events</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex items-center justify-center py-20 text-[var(--color-text-faint)] border border-[var(--color-divider)] rounded-xl bg-[var(--color-surface)]">
          <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
          <p className="text-sm font-medium">Loading calendar...</p>
        </div>
      )}

      {!loading && (
        <>
          {navBar}
          {events.length === 0 ? emptyState : <div>{renderView()}</div>}
        </>
      )}

      {morePopup && (
        <div className="month-more-overlay" onClick={handleMoreClose}>
          <div
            className="month-more-popup"
            role="dialog"
            aria-label="Day events"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="month-more-header">
              <span className="month-more-title">
                {morePopup.date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
              <button className="month-more-close" onClick={handleMoreClose} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="month-more-list">
              {morePopup.events.map((ev) => (
                <button
                  key={ev.id}
                  className="month-more-item"
                  onClick={() => { setSelectedEvent(ev); setMorePopup(null); }}
                >
                  <span className="month-more-dot" style={{ backgroundColor: ev.color || '#6B7280' }} />
                  <span className="month-more-time">
                    {ev.allDay ? 'All day' : ev.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="month-more-text">{ev.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (
        <EventReviewModal
          event={selectedEvent}
          onClose={handleReviewClose}
          onSaved={() => { onRefresh(); }}
        />
      )}
    </div>
  );
}
