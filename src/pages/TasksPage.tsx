import { Plus, Search } from 'lucide-react';

const tasks = [
  { title: 'Follow up proposal - Kinetix HKMA', priority: 'P0', status: 'In Progress', due: '2026-07-23', deal: 'HKMA AppScan' },
  { title: 'Send quotation to HCL Firewall', priority: 'P1', status: 'Pending', due: '2026-07-25', deal: 'Firewall Renewal' },
  { title: 'Schedule demo for Kaspersky EDR', priority: 'P1', status: 'Pending', due: '2026-07-28', deal: 'EDR Solution' },
  { title: 'Prepare Q4 pipeline report', priority: 'P2', status: 'In Progress', due: '2026-08-01', deal: '—' },
  { title: 'Review Wymax network proposal', priority: 'P2', status: 'Pending', due: '2026-08-05', deal: 'Network Upgrade' },
];

const priorityColors: Record<string, string> = {
  'P0': 'bg-red-100 text-red-700',
  'P1': 'bg-amber-100 text-amber-700',
  'P2': 'bg-blue-100 text-blue-700',
  'P3': 'bg-slate-100 text-slate-600',
};

export default function TasksPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
          <p className="text-sm text-slate-500 mt-1">13 active tasks</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> New Task
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-1 max-w-sm px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
            <Search className="w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search tasks..." className="bg-transparent border-none outline-none text-sm w-full" />
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-500 uppercase bg-slate-50">
              <th className="text-left px-4 py-3 font-medium">Task</th>
              <th className="text-left px-4 py-3 font-medium">Priority</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Status</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Due</th>
              <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Deal</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">{t.title}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${priorityColors[t.priority]}`}>{t.priority}</span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden md:table-cell">{t.status}</td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden md:table-cell">{t.due}</td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden lg:table-cell">{t.deal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
