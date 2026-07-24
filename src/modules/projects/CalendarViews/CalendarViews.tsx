import { useState, useCallback, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Presentation,
  GitBranch,
  Calendar,
  List,
  RefreshCw,
  CalendarDays,
} from 'lucide-react';
import type { CalendarViewType, CalendarEventFormatted } from './types';
import { formatMonthYear } from './calendar-utils';
import MonthView from './MonthView';
import WeekView from './WeekView';
import DayView from './DayView';
import DeadlineView from './DeadlineView';
import GanttView from './GanttView';

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
  { key: 'gantt', label: 'Gantt', Icon: GitBranch },
];

const SHOW_WEEKENDS_KEY = 'nexus_crm_show_weekends';

function navigateDate(date: Date, viewType: CalendarViewType, direction: -1 | 1): Date {
  const next = new Date(date);
  switch (viewType) {
    case 'month': next.setMonth(date.getMonth() + direction); break;
    case 'week': next.setDate(date.getDate() + direction * 7); break;
    case 'day': case 'deadline': case 'gantt':
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
  const [viewType, setViewType] = useState<CalendarViewType>('deadline');
  const [date, setDate] = useState<Date>(new Date());
  const [showWeekends, setShowWeekends] = useState<boolean>(getStoredShowWeekends);

  // Persist weekend setting
  useEffect(() => {
    try { localStorage.setItem(SHOW_WEEKENDS_KEY, showWeekends ? 'true' : 'false'); }
    catch { /* ignore */ }
  }, [showWeekends]);

  const handleDateChange = useCallback((d: Date) => setDate(d), []);
  const handlePrev = useCallback(() => setDate((prev) => navigateDate(prev, viewType, -1)), [viewType]);
  const handleNext = useCallback(() => setDate((prev) => navigateDate(prev, viewType, 1)), [viewType]);
  const handleToday = useCallback(() => setDate(new Date()), []);
  const handleViewChange = useCallback((newView: CalendarViewType) => setViewType(newView), []);
  const toggleWeekends = useCallback(() => setShowWeekends((prev) => !prev), []);

  const renderView = () => {
    switch (viewType) {
      case 'month': return <MonthView events={events} date={date} onDateChange={handleDateChange} />;
      case 'week': return <WeekView events={events} date={date} onDateChange={handleDateChange} viewType={viewType} onViewChange={handleViewChange} showWeekends={showWeekends} />;
      case 'day': return <DayView events={events} date={date} onDateChange={handleDateChange} />;
      case 'deadline': return <DeadlineView events={events} date={date} onDateChange={handleDateChange} />;
      case 'gantt': return <GanttView events={events} date={date} onDateChange={handleDateChange} />;
      default: return <MonthView events={events} date={date} onDateChange={handleDateChange} />;
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

        {/* View switcher */}
        <div className="flex items-center bg-[var(--color-surface-offset)] rounded-lg p-0.5 gap-0.5">
          {VIEW_TABS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => handleViewChange(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all min-h-[36px] whitespace-nowrap ${
                viewType === key
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
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
    </div>
  );
}
