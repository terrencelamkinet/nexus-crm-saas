import { lazy, useState, Suspense } from 'react'
import { CalendarDays, Table2 } from 'lucide-react'
import GenericListPage from '../GenericListPage'
import projectConfig from './config'

const ProjectCalendarView = lazy(() => import('./ProjectCalendarView'))

export default function ProjectsPage() {
  const [showCalendar, setShowCalendar] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ display: 'none' }}>Projects</h2>
        <div />
        <div className="range-toggle">
          <button
            onClick={() => setShowCalendar(false)}
            className={!showCalendar ? 'active' : ''}
          >
            <Table2 className="w-3.5 h-3.5" />
            Table
          </button>
          <button
            onClick={() => setShowCalendar(true)}
            className={showCalendar ? 'active' : ''}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Calendar
          </button>
        </div>
      </div>

      {showCalendar ? (
        <Suspense fallback={<div className="flex items-center justify-center py-20 text-sm text-slate-400">Loading calendar...</div>}>
          <ProjectCalendarView />
        </Suspense>
      ) : (
        <GenericListPage config={projectConfig} />
      )}
    </div>
  )
}
