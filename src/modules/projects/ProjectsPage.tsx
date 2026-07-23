import { lazy, useState } from 'react'
import { CalendarDays, Table2 } from 'lucide-react'
import GenericListPage from '../GenericListPage'
import projectConfig from './config'

const ProjectCalendarView = lazy(() => import('./ProjectCalendarView'))

export default function ProjectsPage() {
  const [showCalendar, setShowCalendar] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold hidden">Projects</h1>
        <div />
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setShowCalendar(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              !showCalendar ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            Table
          </button>
          <button
            onClick={() => setShowCalendar(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              showCalendar ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Calendar
          </button>
        </div>
      </div>

      {showCalendar ? (
        <ProjectCalendarView />
      ) : (
        <GenericListPage config={projectConfig} />
      )}
    </div>
  )
}
