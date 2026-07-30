# CalendarViews Module Reference

Last updated: 2026-07-31

---

## Architecture

```
CalendarViews (shared component)
   ├── MonthView       — 7×N grid, fixed cell height
   ├── WeekView        — 7-column time grid, 24h slots
   ├── DayView         — single-column time grid, 24h slots
   ├── DeadlineView    — flat list sorted by date
   └── GanttView       — horizontal bar chart by month
```

**Rule:** CalendarViews is the **only** entry point. All views are internal. Consumers pass `events` prop — same component, different data source.

---

## Props

### CalendarViews (parent)

| Prop       | Type                        | Description              |
|------------|-----------------------------|--------------------------|
| `events`   | `CalendarEventFormatted[]`  | Events to display        |
| `loading`  | `boolean`                   | Loading overlay          |
| `onRefresh`| `() => void`                | Refresh callback         |

---

## Data Types

### CalendarEvent (raw input — what each page must produce)

```typescript
interface CalendarEvent {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  event_type: string | null;       // 'meeting' | 'task' | 'milestone' | 'reminder' | ...
  start: string;                    // ISO date "2026-07-31" or "2026-07-31T14:00:00"
  end: string;                      // same format
  is_all_day: boolean;
  color: string | null;             // hex "#00B4D8" or null (auto from TYPE_COLORS)
  location: string | null;
  project_name?: string;            // appended as prefix in month events
}
```

### CalendarEventFormatted (internal — after formatEvents())

```typescript
interface CalendarEventFormatted {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  description: string | null;
  location: string | null;
  eventType: string | null;
  projectId: string;
  projectName?: string;
}
```

### formatEvents() — type converter

```typescript
function formatEvents(events: CalendarEvent[]): CalendarEventFormatted[]
```

- Parses ISO strings → Date objects
- Falls back `color` to `TYPE_COLORS[event_type]` or `#6B7280` (grey)
- Prepends `project_name` to title (e.g. "Kinetix — Q2 Review")

### TYPE_COLORS (legend)

| event_type | Color   | Usage    |
|------------|---------|----------|
| `milestone`| `#00693E` | Dark green |
| `task`     | `#00B4D8` | Cyan       |
| `meeting`  | `#F4A261` | Orange     |
| `reminder` | `#E76F51` | Red        |

---

## View Type Options

```typescript
type CalendarViewType = 'month' | 'week' | 'day' | 'deadline' | 'gantt';
```

Default: `'deadline'`

---

## Reuse Pattern

Every calendar page follows the same steps:

1. Fetch data (touchpoints, tasks, project events, etc.)
2. Map to `CalendarEvent[]`
3. Call `formatEvents(events)` → `CalendarEventFormatted[]`
4. Pass to `<CalendarViews events={...} loading={...} onRefresh={...} />`

**Current consumers:**

| Page | Data source |
|------|-------------|
| `ProjectCalendarView.tsx` | Project events API (`/api/v1/crm/projects/:id/events`) |
| `ProjectDetailCalendar.tsx` | Same (re-export) |
| `ContactCalendarPage.tsx` | Touchpoints (`/api/v1/crm/touchpoints`) + tasks with due dates |

---

## CSS Structure

All in `src/index.css` under `.month-*`, `.day-*`, `.week-*`, `.gantt-*`, `.deadline-*` classes.

### Month View Layout

```css
.month-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.month-cell { height: 110px; overflow: hidden; ... }
```

Key rule: **Fixed height** (`110px` desktop, `80px` mobile) + `overflow: hidden`.
Events beyond cell capacity are clipped; "+N more" still shows at bottom.
Do NOT change back to `min-height` — that causes grid cells to stretch unevenly.

### Mobile Breakpoint

`@media (max-width: 768px)` — cell height drops to 80px, font sizes shrink.

---

## Known Fixes (2026-07-31)

- **Month cell stretch bug:** Changed `min-height: 100px` → `height: 110px` + `overflow: hidden`.
  Events no longer pull grid cells out of alignment.
