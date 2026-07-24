import { useState, useEffect } from 'react';
import { Plus, Search, X, Trash2, Edit3, Filter, ArrowUpDown, LayoutGrid, SlidersHorizontal, Download, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApi, useSearch, useCreateModal, TableSkeleton, ErrorBox } from '../lib/useApi';
import { apiClient } from '../lib/api';
import EntitySearch from '../modules/shared/EntitySearch';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  company?: { id: string; name: string } | null;
  created_at: string;
  last_touch?: string | null;
  chinese_name?: string | null;
  nick_name?: string | null;
  contact_type?: string | null;
  grade?: string | null;
  numbers?: string[];
  office_phone?: string | null;
  namecard_path?: string | null;
  job_title?: string | null;
  department?: string | null;
  linkedin_url?: string | null;
  address?: string | null;
  notes?: string | null;
  tags?: string[];
}

interface ContactListResponse {
  items: Contact[];
  total: number;
}

const statusColors: Record<string, string> = {
  Active: 'tag-active',
  Warm: 'tag-warm',
  Cold: 'tag-cold',
  VIP: 'tag-vip',
  Inactive: 'tag-default',
};

const defaultForm = {
  name: '', email: '', phone: '', status: 'Active', company_id: '',
  chinese_name: '', nick_name: '', contact_type: '', grade: '',
  numbers: [] as string[], office_phone: '', job_title: '',
  department: '', linkedin_url: '', address: '', notes: '',
  tags: [] as string[],
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

// ---- Shared form fields (stable component — defined outside to avoid remount on every keystroke) ----
interface FormFieldsProps {
  form: typeof defaultForm;
  setForm: React.Dispatch<React.SetStateAction<typeof defaultForm>>;
  inputCls: string;
}

const inputCls = "input-field";

// ---- Shared helper for multi-select checkboxes ----
const CheckboxGroup = ({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) => (
  <div>
    <label className="field-label">{label}</label>
    <div className="checkbox-group">
      {options.map(opt => (
        <label key={opt} className="checkbox-label">
          <input type="checkbox" checked={selected.includes(opt)}
            onChange={e => {
              if (e.target.checked) onChange([...selected, opt]);
              else onChange(selected.filter(t => t !== opt));
            }}
            className="checkbox-input" />
          {opt}
        </label>
      ))}
    </div>
  </div>
);

function ContactFormFields({ form, setForm, inputCls }: FormFieldsProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
      {/* Name, Chinese Name */}
      <div className="form-field">
        <label className="field-label">Name *</label>
        <input type="text" value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className={inputCls} placeholder="Contact name" />
      </div>
      <div className="form-field">
        <label className="field-label">Chinese Name</label>
        <input type="text" value={form.chinese_name}
          onChange={e => setForm(f => ({ ...f, chinese_name: e.target.value }))}
          className={inputCls} placeholder="Chinese name" />
      </div>

      {/* Nick Name, Job Title */}
      <div className="form-field">
        <label className="field-label">Nick Name</label>
        <input type="text" value={form.nick_name}
          onChange={e => setForm(f => ({ ...f, nick_name: e.target.value }))}
          className={inputCls} placeholder="Nick name" />
      </div>
      <div className="form-field">
        <label className="field-label">Job Title</label>
        <input type="text" value={form.job_title}
          onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))}
          className={inputCls} placeholder="Job title" />
      </div>

      {/* Department, Contact Type */}
      <div className="form-field">
        <label className="field-label">Department</label>
        <input type="text" value={form.department}
          onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
          className={inputCls} placeholder="Department" />
      </div>
      <div className="form-field">
        <label className="field-label">Contact Type</label>
        <select value={form.contact_type}
          onChange={e => setForm(f => ({ ...f, contact_type: e.target.value }))}
          className={inputCls}>
          <option value="">— Select —</option>
          <option value="Distributor">Distributor</option>
          <option value="Vendor">Vendor</option>
          <option value="Client">Client</option>
        </select>
      </div>

      {/* Grade, Tags */}
      <div className="form-field">
        <label className="field-label">Grade</label>
        <select value={form.grade}
          onChange={e => setForm(f => ({ ...f, grade: e.target.value }))}
          className={inputCls}>
          <option value="">— Select —</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
      </div>
      <div className="form-field">
        <CheckboxGroup label="Tag" options={['Sales','Client','Technical','Head','Internal Sales']}
          selected={form.tags} onChange={v => setForm(f => ({ ...f, tags: v }))} />
      </div>

      {/* No. (full width) */}
      <div className="form-field" style={{ gridColumn: '1 / -1' }}>
        <CheckboxGroup label="No." options={['1','2','3','4','5','6','7','8']}
          selected={form.numbers} onChange={v => setForm(f => ({ ...f, numbers: v }))} />
      </div>

      {/* Email, Phone */}
      <div className="form-field">
        <label className="field-label">Email</label>
        <input type="email" value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          className={inputCls} placeholder="email@example.com" />
      </div>
      <div className="form-field">
        <label className="field-label">Phone</label>
        <input type="text" value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          className={inputCls} placeholder="+852 9123 4567" />
      </div>

      {/* Office Phone, LinkedIn URL */}
      <div className="form-field">
        <label className="field-label">Office Phone</label>
        <input type="text" value={form.office_phone}
          onChange={e => setForm(f => ({ ...f, office_phone: e.target.value }))}
          className={inputCls} placeholder="Office phone" />
      </div>
      <div className="form-field">
        <label className="field-label">LinkedIn URL</label>
        <input type="text" value={form.linkedin_url}
          onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))}
          className={inputCls} placeholder="https://linkedin.com/in/..." />
      </div>

      {/* Address, Company */}
      <div className="form-field">
        <label className="field-label">Address</label>
        <input type="text" value={form.address}
          onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          className={inputCls} placeholder="Address" />
      </div>
      {/* Company search */}
      <div className="form-field">
        <EntitySearch
          searchUrl="/api/v1/crm/companies"
          value={form.company_id}
          onChange={(id) => setForm(f => ({ ...f, company_id: id }))}
          placeholder="Search companies..."
          label="Company"
          createLabel="Company"
          createTitleField="name"
        />
      </div>

      {/* Notes (full width) */}
      <div className="form-field" style={{ gridColumn: '1 / -1' }}>
        <label className="field-label">Notes</label>
        <textarea value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          className={inputCls} placeholder="Notes..." rows={3} />
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const navigate = useNavigate();
  const { query, setQuery, debounced } = useSearch();
  const searchQs = debounced ? `?search=${encodeURIComponent(debounced)}&page_size=50` : '?page_size=50';
  const { data, loading, error, refresh } = useApi<ContactListResponse>(`/api/v1/crm/contacts${searchQs}`);

  const create = useCreateModal();
  const [editTarget, setEditTarget] = useState<Contact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // ── Multi-select state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const buildPayload = () => ({
    name: form.name,
    email: form.email || null,
    phone: form.phone || null,
    status: form.status.toLowerCase(),
    company_id: form.company_id || null,
    chinese_name: form.chinese_name || null,
    nick_name: form.nick_name || null,
    contact_type: form.contact_type || null,
    grade: form.grade || null,
    numbers: form.numbers.length > 0 ? form.numbers : [],
    office_phone: form.office_phone || null,
    job_title: form.job_title || null,
    department: form.department || null,
    linkedin_url: form.linkedin_url || null,
    address: form.address || null,
    notes: form.notes || null,
    tags: form.tags.length > 0 ? form.tags : [],
  });

  // ---- Create ----
  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await apiClient.post('/api/v1/crm/contacts', buildPayload());
      setForm(defaultForm);
      create.closeModal();
      refresh();
    } catch (e: any) {
      alert(e.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  // ---- Edit ----
  const handleEdit = async () => {
    if (!editTarget || !form.name.trim()) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/crm/contacts/${editTarget.id}`, buildPayload());
      setEditTarget(null);
      refresh();
    } catch (e: any) {
      alert(e.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (c: Contact) => {
    setForm({
      name: c.name,
      email: c.email || '',
      phone: c.phone || '',
      status: c.status || 'Active',
      company_id: c.company?.id || '',
      chinese_name: c.chinese_name || '',
      nick_name: c.nick_name || '',
      contact_type: c.contact_type || '',
      grade: c.grade || '',
      numbers: c.numbers || [],
      office_phone: c.office_phone || '',
      job_title: c.job_title || '',
      department: c.department || '',
      linkedin_url: c.linkedin_url || '',
      address: c.address || '',
      notes: c.notes || '',
      tags: c.tags || [],
    });
    setEditTarget(c);
  };

  // ---- Delete ----
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/api/v1/crm/contacts/${deleteTarget.id}`);
      setDeleteTarget(null);
      refresh();
    } catch (e: any) {
      alert(e.detail || e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span>Home</span>
        <ChevronRight />
        <span className="breadcrumb-current">Contacts</span>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Contacts</h1>
          <p>{total} contacts</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={create.openModal} className="btn-primary">
            <Plus className="w-4 h-4" /> New Contact
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="data-table">
        {/* DB Toolbar */}
        <div className="db-toolbar">
          <div className="db-search">
            <Search className="w-4 h-4" />
            <input type="text" placeholder="Search contacts..." value={query}
              onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="toolbar-actions">
            <button className="toolbar-btn"><Filter className="w-4 h-4" /> Filter</button>
            <button className="toolbar-btn"><ArrowUpDown className="w-4 h-4" /> Sort</button>
            <button className="toolbar-btn"><LayoutGrid className="w-4 h-4" /> Group</button>
            <span className="toolbar-sep" />
            <button className="toolbar-btn"><SlidersHorizontal className="w-4 h-4" /> Properties</button>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : error ? (
          <ErrorBox message={error} onRetry={refresh} />
        ) : items.length === 0 ? (
          <div className="empty-state">No contacts found</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th className="th-checkbox">
                    <input type="checkbox" className="row-checkbox"
                      checked={items.length > 0 && selectedIds.size === items.length}
                      onChange={toggleSelectAll} />
                  </th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Last Touch</th>
                  <th className="col-menu"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={selectedIds.has(c.id) ? 'row-selected' : ''}>
                    <td className="th-checkbox" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="row-checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelect(c.id)} />
                    </td>
                    <td>
                      <button onClick={() => navigate(`/contacts/${c.id}`)}
                        className="row-name row-name-btn">
                        <div className="avatar-sm">
                          {c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="row-name-text">{c.name}</span>
                      </button>
                    </td>
                    <td>
                      <span>{c.company?.name || '—'}</span>
                    </td>
                    <td>
                      <span className="row-email">{c.email || '—'}</span>
                    </td>
                    <td>
                      <span className={`select-tag ${statusColors[c.status] || 'tag-default'}`}>
                        {c.status || 'Active'}
                      </span>
                    </td>
                    <td>
                      <span className="last-touch">{formatDate(c.last_touch || c.created_at)}</span>
                    </td>
                    <td className="col-menu" onClick={e => e.stopPropagation()}>
                      <div className="menu-wrap">
                        <button className="menu-dots" title="More actions">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        <div className="menu-dropdown">
                          <button className="menu-item" onClick={() => openEdit(c)}>
                            <Edit3 /> Edit
                          </button>
                          <button className="menu-item text-notification" onClick={() => setDeleteTarget(c)}>
                            <Trash2 /> Delete
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="bulk-bar">
                <span className="count">{selectedIds.size} selected</span>
                <button className="btn-secondary">Add Tag</button>
                <button className="btn-secondary">Export</button>
                <button className="btn-notification"
                  onClick={() => {
                    const first = items.find(i => selectedIds.has(i.id));
                    if (first) setDeleteTarget(first);
                  }}>
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Create Modal ─── */}
      {create.open && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) create.closeModal(); }}>
          <div className="modal">
            <div className="modal-head">
              <h2>New Contact</h2>
              <button onClick={create.closeModal} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body" style={{ paddingBottom: 100 }}>
              <ContactFormFields form={form} setForm={setForm} inputCls={inputCls} />
            </div>
            <div className="modal-foot">
              <button onClick={create.closeModal} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !form.name.trim()}
                className="btn-primary">
                {saving ? 'Saving...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit Modal ─── */}
      {editTarget && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Edit Contact</h2>
              <button onClick={() => setEditTarget(null)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body" style={{ paddingBottom: 100 }}>
              <ContactFormFields form={form} setForm={setForm} inputCls={inputCls} />
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleEdit} disabled={saving || !form.name.trim()}
                className="btn-primary">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation ─── */}
      {deleteTarget && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="modal modal-sm">
            <div className="delete-body">
              <div className="delete-icon-wrap">
                <Trash2 />
              </div>
              <h2 className="delete-heading">Delete Contact</h2>
              <p className="delete-text">
                Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="btn-notification">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
