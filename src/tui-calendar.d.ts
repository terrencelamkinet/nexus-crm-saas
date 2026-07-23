declare module '@toast-ui/react-calendar' {
  import { Component } from 'react';
  export interface EventObject {
    id?: string;
    calendarId?: string;
    title?: string;
    body?: string;
    start?: string;
    end?: string;
    isAllday?: boolean;
    category?: string;
    location?: string;
    backgroundColor?: string;
    borderColor?: string;
    raw?: any;
  }
  export interface CalendarProps {
    view?: 'month' | 'week' | 'day';
    events?: EventObject[];
    calendars?: any[];
    usageStatistics?: boolean;
    timezone?: any;
    month?: any;
    week?: any;
    template?: any;
    onAfterRenderEvent?: (event: any) => void;
    ref?: any;
  }
  export default class Calendar extends Component<CalendarProps> {}
}
