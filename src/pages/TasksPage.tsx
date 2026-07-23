import { useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { useApi, useSearch, useCreateModal, TableSkeleton, ErrorBox } from '../lib/useApi';
import { apiClient } from '../lib/api';

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  contact?: { id: string; name: string } | null;
  company?: { id: string; name: string } | null;
  created_at: string;
}

interface TaskListResponse {
  items: Task[];
  total: number;
  page: number;
  page_size: number;
}

const priorityColors: Record<string, string> = {
  P0: 'badge-p0',
  P1: 'badge-p1',
  P2: 'badge-p2',
  P3: 'badge-p3',
};

const statusColors: Record<string, string> = {
  Pending: 'badge-cold',
  'In Progress': 'badge-warm',
  Completed: 'badge-active',
};

const defaultForm = { title: '', priority: 'P2', status: 'Pending', due_date: '' };

export default function TasksPage() {
  const { query, setQuery, searchParams } = useSearch();
  const { data, loading, error, refresh } = useApi<TaskListResponse>(`/api/v1/crm/tasks${searchParams || '?page=1&page_size=50'}`);
  const create = useCreateModal();
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await apiClient.post('/api/v1/crm/tasks', {
        title: form.title,
        priority: form.priority,
        status: form.status,
        due_date: form.due_date || null,
      });
      setForm(defaultForm);
      create.closeModal();
      refresh();
    } catch (e: any) {
      alert(e.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1>Tasks</h1>
          <p>{total} active tasks</p>
        </div>
        <div className="header-actions">
          <button onClick={create.openModal} className="btn-primary">
            <Plus className="w-4 h-4" /> New Task
          </button>
        </div>
      </div>

      {/* Panel with search + table */}
      <div className="panel animate-in">
        <div className="panel-head">
          <div className="search-box">
            <Search />
            <input
              type="text"
              placeholder="Search tasks..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : error ? (
          <ErrorBox message={error} onRetry={refresh} />
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No tasks found</div>
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Priority</th>
                  <th className="hidden md:table-cell">Status</th>
                  <th className="hidden md:table-cell">Due</th>
                  <th className="hidden lg:table-cell">Contact</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.title}</td>
                    <td>
                      <span className={`badge ${priorityColors[t.priority] || ''}`}>{t.priority}</span>
                    </td>
                    <td className="hidden md:table-cell">
                      <span className={`badge ${statusColors[t.status] || ''}`}>{t.status}</span>
                    </td>
                    <td className="hidden md:table-cell">{t.due_date ? t.due_date.slice(0, 10) : '—'}</td>
                    <td className="hidden lg:table-cell">{t.contact?.name || t.company?.name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {create.open && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <h2>New Task</h2>
              <button onClick={create.closeModal} className="modal-x"><X className="w-5 h-5" /></button>
            </div>
            <div className="modal-body space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-highlight focus:border-primary"
                  placeholder="Task title"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-highlight focus:border-primary"
                  >
                    <option value="P0">P0 - Critical</option>
                    <option value="P1">P1 - High</option>
                    <option value="P2">P2 - Normal</option>
                    <option value="P3">P3 - Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Due date</label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-highlight focus:border-primary"
                  />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={create.closeModal} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !form.title.trim()} className="btn-primary">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
