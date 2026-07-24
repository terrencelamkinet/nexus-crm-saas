import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, Building2, Edit3, Plus, X,
  Activity, Trash2, User, Clock
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { useModuleSettings } from '../lib/useModules';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContactDetail {
  id: string; name: string; email: string | null; phone: string | null;
  status: string; notes: string | null;
  company?: { id: string; name: string } | null;
  created_at: string; updated_at: string;
  chinese_name?: string | null;
  nick_name?: string | null;
  contact_type?: string | null;
  grade?: string | null;
  numbers?: string[] | null;
  office_phone?: string | null;
  namecard_path?: string | null;
  job_title?: string | null;
  department?: string | null;
  linkedin_url?: string | null;
  address?: string | null;
  tags?: string[] | null;
}

interface Touchpoint {
  id: string; type: string; title: string; description: string | null;
  company?: { name: string } | null; contact_id?: string; created_at: string;
}

interface Deal {
  id: string; name: string; amount: number | null;
  stage?: { id: string; name: string } | null;
  probability: number; status: string;
  contact_id?: string;
}

interface Note {
  id: string; title: string; content: string | null; pinned: boolean;
  created_at: string;
  contact_id?: string;
}

interface ActivityItem {
  id: string; action: string; entity_type: string; entity_id: string;
  changes: any; created_at: string;
}

interface ContactProject {
  id: string;
  project_id: string;
  project_name: string;
  project_amount: number | null;
  stage_name: string | null;
  probability: number | null;
  role: string | null;
}

interface DealOption {
  id: string; name: string; amount: number | null;
  stage?: { id: string; name: string } | null;
  probability: number; status: string;
}

const statusBadge: Record<string, string> = {
  Active: 'select-tag tag-active',
  Warm: 'select-tag tag-warm',
  Cold: 'select-tag tag-cold',
  Inactive: 'select-tag tag-default',
};

type TabId = 'details' | 'timeline' | 'deals' | 'tasks' | 'touchpoints' | 'notes' | 'projects';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [projects, setProjects] = useState<ContactProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('details');

  // Inline edit state
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', status: 'Active', notes: '',
    chinese_name: '', nick_name: '', job_title: '', department: '',
    contact_type: '', grade: '', tags: [] as string[], numbers: [] as string[],
    office_phone: '', linkedin_url: '', address: '',
  });
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Add Touchpoint modal
  const [tpOpen, setTpOpen] = useState(false);
  const [tpForm, setTpForm] = useState({ title: '', type: 'meeting', description: '' });
  const [tpSaving, setTpSaving] = useState(false);

  // Add Note modal
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteForm, setNoteForm] = useState({ title: '', content: '' });
  const [noteSaving, setNoteSaving] = useState(false);

  // Link Project modal
  const [projectOpen, setProjectOpen] = useState(false);
  const [dealOptions, setDealOptions] = useState<DealOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectSaving, setProjectSaving] = useState(false);

  // Log Activity modal
  const [logActivityOpen, setLogActivityOpen] = useState(false);
  const [logActivityForm, setLogActivityForm] = useState({ action: '', description: '' });
  const [logActivitySaving, setLogActivitySaving] = useState(false);
 
  const modules = useModuleSettings();
  const salesOn = modules['sales'] === true;

  // ── Fetch contact data ──
  const fetchContact = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const promises: any[] = [
        apiClient.get<ContactDetail>(`/api/v1/crm/contacts/${id}`),
        apiClient.get<{ items: Touchpoint[] }>(`/api/v1/crm/touchpoints?page_size=50&contact_id=${id}`).catch(() =>
          apiClient.get<{ items: Touchpoint[] }>(`/api/v1/crm/touchpoints?page_size=50`)),
        salesOn ? apiClient.get<{ items: Deal[] }>(`/api/v1/crm/deals?page_size=50&contact_id=${id}`).catch(() =>
          apiClient.get<{ items: Deal[] }>('/api/v1/crm/deals?page_size=50')) : Promise.resolve({ items: [] }),
        apiClient.get<{ items: Note[] }>('/api/v1/crm/notes?page_size=50').catch(() => ({ items: [], total: 0 })),
        apiClient.get<{ items: ActivityItem[] }>('/api/v1/crm/activity-log?page_size=50').catch(() => ({ items: [], total: 0 })),
        apiClient.get<{ items: ContactProject[] }>(`/api/v1/crm/contacts/${id}/projects`).catch(() => ({ items: [], total: 0 })),
      ];
      const      [c, tpRes, dRes, nRes, aRes, pRes] = await Promise.all(promises);
      setContact(c);
      const tpItems = tpRes.items || [];
      setTouchpoints(tpItems.length > 0 && 'contact_id' in tpItems[0]
        ? tpItems.filter((tp: any) => tp.contact_id === id)
        : tpItems);
      const dItems = dRes.items || [];
      setDeals(dItems.length > 0 && 'contact_id' in dItems[0]
        ? dItems.filter((d: any) => d.contact_id === id)
        : dItems);
      setNotes((nRes.items || []));
      setActivities((aRes.items || []).filter((a: { entity_id: string }) => a.entity_id === id));
      setProjects(pRes.items || []);
    } catch (e: any) {
      console.error('ContactDetailPage fetchContact error:', e);
      setError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchContact(); }, [id]);

  // ---- Inline Edit ----
  const openEdit = () => {
    if (!contact) return;
    setForm({
      name: contact.name, email: contact.email || '', phone: contact.phone || '',
      status: contact.status || 'Active', notes: contact.notes || '',
      chinese_name: contact.chinese_name || '', nick_name: contact.nick_name || '',
      job_title: contact.job_title || '', department: contact.department || '',
      contact_type: contact.contact_type || '', grade: contact.grade || '',
      tags: contact.tags || [], numbers: contact.numbers || [],
      office_phone: contact.office_phone || '', linkedin_url: contact.linkedin_url || '',
      address: contact.address || '',
    });
    setEditOpen(true);
  };

  const cancelEdit = () => {
    setEditOpen(false);
  };

  const handleSave = async () => {
    if (!contact || !form.name.trim()) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/crm/contacts/${contact.id}`, {
        name: form.name, email: form.email || null, phone: form.phone || null,
        status: form.status.toLowerCase(), notes: form.notes || null,
        chinese_name: form.chinese_name || null, nick_name: form.nick_name || null,
        job_title: form.job_title || null, department: form.department || null,
        contact_type: form.contact_type || null, grade: form.grade || null,
        tags: form.tags.length > 0 ? form.tags : null,
        numbers: form.numbers.length > 0 ? form.numbers : null,
        office_phone: form.office_phone || null, linkedin_url: form.linkedin_url || null,
        address: form.address || null,
      });
      setEditOpen(false);
      fetchContact();
    } catch (e: any) { alert(e.detail || e.message); }
    finally { setSaving(false); }
  };

  // ---- Delete ----
  const handleDeleteClick = () => {
    setDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!contact) return;
    setDeleteLoading(true);
    try {
      await apiClient.delete(`/api/v1/crm/contacts/${contact.id}`);
      navigate('/contacts');
    } catch (e: any) {
      alert(e.detail || e.message);
    } finally {
      setDeleteLoading(false);
      setDeleteModalOpen(false);
    }
  };

  // ---- Add Touchpoint ----
  const handleAddTouchpoint = async () => {
    if (!contact || !tpForm.title.trim()) return;
    setTpSaving(true);
    try {
      await apiClient.post('/api/v1/crm/touchpoints', {
        title: tpForm.title, type: tpForm.type,
        description: tpForm.description || null,
        contact_id: contact.id,
        company_id: contact.company?.id || null,
      });
      setTpForm({ title: '', type: 'meeting', description: '' });
      setTpOpen(false);
      fetchContact();
    } catch (e: any) { alert(e.detail || e.message); }
    finally { setTpSaving(false); }
  };

  // ---- Add Note ----
  const handleAddNote = async () => {
    if (!contact || !noteForm.title.trim()) return;
    setNoteSaving(true);
    try {
      await apiClient.post('/api/v1/crm/notes', {
        title: noteForm.title, content: noteForm.content || null,
        contact_id: contact.id,
      });
      setNoteForm({ title: '', content: '' });
      setNoteOpen(false);
      fetchContact();
    } catch (e: any) { alert(e.detail || e.message); }
    finally { setNoteSaving(false); }
  };

  // ---- Log Activity ----
  const handleLogActivity = async () => {
    if (!contact || !logActivityForm.action.trim()) return;
    setLogActivitySaving(true);
    try {
      await apiClient.post('/api/v1/crm/activity-log', {
        action: logActivityForm.action,
        entity_type: 'contact',
        entity_id: contact.id,
        description: logActivityForm.description || null,
      });
      setLogActivityForm({ action: '', description: '' });
      setLogActivityOpen(false);
      fetchContact();
    } catch (e: any) { alert(e.detail || e.message); }
    finally { setLogActivitySaving(false); }
  };

  const formatAmount = (n: number | null) => {
    if (!n) return '$0';
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  // ---- Loading ----
  if (loading) {
    return (
      <div className="contact-detail-page loading">
        <div className="h-8 bg-slate-200 rounded w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 h-64 bg-slate-100 rounded-xl" />
          <div className="lg:col-span-2 h-96 bg-slate-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="contact-detail-page">
        <button onClick={() => navigate('/contacts')}
          className="flex items-center gap-1 text-sm hover:underline mb-4 back-link">
          <ArrowLeft className="w-4 h-4" /> Back to Contacts
        </button>
        <div className="error-box">
          <span className="error-text">{error || 'Contact not found'}</span>
          <button onClick={fetchContact}
            className="error-retry-btn">Retry</button>
        </div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'details', label: 'Details', count: 0 },
    { id: 'timeline', label: 'Timeline', count: 0 },
    ...(salesOn ? [{ id: 'deals' as TabId, label: 'Deals', count: deals.length }] : []),
    { id: 'tasks', label: 'Tasks', count: 0 },
    { id: 'touchpoints', label: 'Touchpoints', count: touchpoints.length },
    { id: 'notes', label: 'Notes', count: notes.length },
    { id: 'projects', label: 'Projects', count: projects.length },
  ];
  // If sales module off and current tab is deals, switch to details
  if (!salesOn && tab === 'deals') setTab('details');

  const initials = contact.name.split(' ').map(n => n[0]).join('').toUpperCase();
  const lastTouchDate = contact.updated_at
    ? formatDate(contact.updated_at)
    : contact.created_at
      ? formatDate(contact.created_at)
      : '—';

  // Render timeline items from activities + touchpoints
  const timelineItems = [
    ...activities.map(a => ({
      id: a.id,
      type: 'activity',
      emoji: '📝',
      title: a.action,
      date: timeAgo(a.created_at),
      meta: a.entity_type?.replace(/_/g, ' '),
      sortKey: a.created_at,
    })),
    ...touchpoints.map(tp => ({
      id: tp.id,
      type: 'touchpoint',
      emoji: tp.type === 'call' ? '📞' : tp.type === 'email' ? '✉️' : tp.type === 'meeting' ? '🤝' : '📌',
      title: tp.title,
      date: timeAgo(tp.created_at),
      meta: tp.description || tp.type,
      sortKey: tp.created_at,
    })),
  ].sort((a, b) => new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime());

  return (
    <div className="contact-detail-page">
      {/* ═══ Breadcrumb ═══ */}
      <nav className="breadcrumb">
        <Link to="/dashboard">Home</Link>
        <span>/</span>
        <Link to="/contacts">Contacts</Link>
        <span>/</span>
        <span className="cur">{contact.name}</span>
      </nav>

      {/* ═══ Page Header: back arrow + name + actions ═══ */}
      <div className="page-header">
        <div className="title-row">
          <button onClick={() => navigate('/contacts')} className="back-btn" aria-label="Back to contacts">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1>{contact.name}</h1>
        </div>
        <div className="header-actions">
          {editOpen ? (
            <>
              <button onClick={cancelEdit} disabled={saving} className="btn-ghost">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="btn-primary">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => {
                setLogActivityForm({ action: '', description: '' });
                setLogActivityOpen(true);
              }} className="btn-secondary">
                <Plus className="icon-16" /> Log Activity
              </button>
              <button onClick={handleDeleteClick} className="btn-danger">
                <Trash2 className="icon-16" /> Delete
              </button>
              <button onClick={openEdit} className="btn-primary">
                <Edit3 className="icon-16" /> Edit
              </button>
            </>
          )}
        </div>
      </div>

      {/* ═══ Edit Mode Banner ═══ */}
      {editOpen && (
        <div className="edit-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Editing mode active. Make changes to the fields below and click Save.
        </div>
      )}

      {/* ═══ Detail Grid: 280px Profile Card (Left) + Content (Right) ═══ */}
      <div className="detail-grid">
        {/* ─── Left: Profile Card ─── */}
        <div className="profile-card">
          <div className="profile-avatar">{initials}</div>

          <h3>{contact.name}</h3>

          <div className="role">{contact.company?.name || contact.job_title || '—'}</div>

          <div style={{ textAlign: 'left' }}>
            {/* Email */}
            <div className="profile-field">
              <Mail className="w-3.5 h-3.5" />
              <span>{contact.email || '—'}</span>
            </div>

            {/* Phone */}
            <div className="profile-field">
              <Phone className="w-3.5 h-3.5" />
              <span>{contact.phone || '—'}</span>
            </div>

            {/* Owner / Assignee */}
            <div className="profile-field">
              <User className="w-3.5 h-3.5" /> Owner: {contact.contact_type || 'Unassigned'}
            </div>

            {/* Last Touch Date */}
            <div className="profile-field">
              <Clock className="w-3.5 h-3.5" /> Last touch: {lastTouchDate}
            </div>

            {/* Company */}
            {contact.company && (
              <div className="profile-field">
                <Building2 className="w-3.5 h-3.5" />
                <span>{contact.company.name}</span>
              </div>
            )}
          </div>

          {/* Status Tag + Custom Tags */}
          <div className="tag-row">
            <span className={statusBadge[contact.status] || 'badge badge-p3'}>{contact.status}</span>
            {contact.tags?.map(tag => (
              <span key={tag} className="tag">{tag}</span>
            ))}
            {contact.contact_type && contact.contact_type !== 'Unassigned' && (
              <span className="tag">{contact.contact_type}</span>
            )}
          </div>
        </div>

        {/* ─── Right: Tabs + Content ─── */}
        <div>
          {/* ── Tabs ── */}
          <div className="tabs">
            {tabs.map(t => (
              <div
                key={t.id}
                className={`tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}{t.count > 0 ? ` (${t.count})` : ''}
              </div>
            ))}
          </div>

          {/* ── Tab Content ── */}

          {/* ═══ Details Tab ═══ */}
          {tab === 'details' && (
            <div className={editOpen ? 'edit-mode' : ''}>
              <div className="detail-inner-grid">
                {/* Left: Contact Information Form */}
                <div className="panel panel-detail">  {/* was: style={{ padding: '24px' }} */}
                  <h3 style={{ fontSize: '16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <User className="w-4 h-4" /> Contact Information
                  </h3>
                  <div className="detail-form-grid">
                    {/* 1. Client Name */}
                    <div className="form-field">
                      <div className="field-label">Client Name</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, name: t.textContent || '' })); }}
                      >{contact.name}</div>
                    </div>
                    {/* 2. Chinese Name */}
                    <div className="form-field">
                      <div className="field-label">Chinese Name</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, chinese_name: t.textContent || '' })); }}
                      >{contact.chinese_name || '—'}</div>
                    </div>
                    {/* 3. Nick Name */}
                    <div className="form-field">
                      <div className="field-label">Nick Name</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, nick_name: t.textContent || '' })); }}
                      >{contact.nick_name || '—'}</div>
                    </div>
                    {/* 4. Title */}
                    <div className="form-field">
                      <div className="field-label">Title</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, job_title: t.textContent || '' })); }}
                      >{contact.job_title || '—'}</div>
                    </div>
                    {/* 5. Department */}
                    <div className="form-field">
                      <div className="field-label">Department</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, department: t.textContent || '' })); }}
                      >{contact.department || '—'}</div>
                    </div>
                    {/* 6. Type */}
                    <div className="form-field">
                      <div className="field-label">Type</div>
                      {editOpen ? (
                        <select value={form.contact_type} onChange={e => setForm(f => ({ ...f, contact_type: e.target.value }))} className="input-field">
                          <option value="">— Select —</option>
                          <option value="Distributor">Distributor</option>
                          <option value="Vendor">Vendor</option>
                          <option value="Client">Client</option>
                        </select>
                      ) : (
                        <div className="field-value">{contact.contact_type ? <span className="badge badge-tag">{contact.contact_type}</span> : '—'}</div>
                      )}
                    </div>
                    {/* 7. Grade */}
                    <div className="form-field">
                      <div className="field-label">Grade</div>
                      {editOpen ? (
                        <select value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value }))} className="input-field">
                          <option value="">— Select —</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
                        </select>
                      ) : (
                        <div className="field-value">{contact.grade ? <span className="badge badge-tag">Grade {contact.grade}</span> : '—'}</div>
                      )}
                    </div>
                    {/* 8. Tag */}
                    <div className="form-field">
                      <div className="field-label">Tag</div>
                      {editOpen ? (
                        <select value={form.tags[0] || ''} onChange={e => setForm(f => ({ ...f, tags: e.target.value ? [e.target.value] : [] }))} className="input-field">
                          <option value="">— Select —</option>
                          <option value="Sales">Sales</option><option value="Client">Client</option>
                          <option value="Technical">Technical</option><option value="Head">Head</option>
                          <option value="Internal Sales">Internal Sales</option>
                        </select>
                      ) : (
                        <div className="field-value" style={{ gap: '6px', display: 'flex', flexWrap: 'wrap' }}>
                          {contact.tags?.length ? contact.tags.map(t => <span key={t} className="badge badge-tag">{t}</span>) : '—'}
                        </div>
                      )}
                    </div>
                    {/* 9. No. */}
                    <div className="form-field">
                      <div className="field-label">No.</div>
                      {editOpen ? (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {['1','2','3','4','5','6','7','8'].map(n => (
                            <label key={n} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '12px', cursor: 'pointer' }}>
                              <input type="checkbox" checked={form.numbers.includes(n)}
                                onChange={e => { if (e.target.checked) setForm(f => ({ ...f, numbers: [...f.numbers, n] })); else setForm(f => ({ ...f, numbers: f.numbers.filter(x => x !== n) })); }} /> {n}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="field-value" style={{ gap: '6px', display: 'flex', flexWrap: 'wrap' }}>
                          {contact.numbers?.length ? contact.numbers.map(n => <span key={n} className="badge badge-tag">No. {n}</span>) : '—'}
                        </div>
                      )}
                    </div>
                    {/* 10. Email */}
                    <div className="form-field">
                      <div className="field-label">Email</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, email: t.textContent || '' })); }}
                      >{contact.email || '—'}</div>
                    </div>
                    {/* 11. Phone */}
                    <div className="form-field">
                      <div className="field-label">Phone</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, phone: t.textContent || '' })); }}
                      >{contact.phone || '—'}</div>
                    </div>
                    {/* 12. Office */}
                    <div className="form-field">
                      <div className="field-label">Office</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, office_phone: t.textContent || '' })); }}
                      >{contact.office_phone || '—'}</div>
                    </div>
                    {/* 13. LinkedIn */}
                    <div className="form-field">
                      <div className="field-label">LinkedIn</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, linkedin_url: t.textContent || '' })); }}
                      >{contact.linkedin_url || '—'}</div>
                    </div>
                    {/* 14. Address */}
                    <div className="form-field">
                      <div className="field-label">Address</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, address: t.textContent || '' })); }}
                      >{contact.address || '—'}</div>
                    </div>
                    {/* 15. Notes (full width) */}
                    <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                      <div className="field-label">Notes</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, notes: t.textContent || '' })); }}
                        style={editOpen ? {} : { alignItems: 'flex-start', lineHeight: 1.6 }}
                      >{contact.notes || '—'}</div>
                    </div>
                    {/* 16. Name Card */}
                    <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                      <div className="field-label">Name Card</div>
                      <div className={"field-value" + (editOpen ? ' editable' : '')}
                        contentEditable={editOpen || undefined}
                        suppressContentEditableWarning
                        onInput={e => { const t = e.currentTarget; setForm(f => ({ ...f, namecard_path: t.textContent || '' })); }}
                      >{contact.namecard_path || '—'}</div>
                    </div>
                    {/* 17. Company (full width) */}
                    <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                      <div className="field-label">Companies</div>
                      <div className="field-value">{contact.company?.name || '—'}</div>
                    </div>
                    {/* 18. Projects count */}
                    <div className="form-field">
                      <div className="field-label">Projects</div>
                      <div className="field-value">{projects.length} linked</div>
                    </div>
                    {/* 19. Touchpoints count */}
                    <div className="form-field">
                      <div className="field-label">Touch Points</div>
                      <div className="field-value">{touchpoints.length} recorded</div>
                    </div>
                    {/* 20. Created Time */}
                    <div className="form-field">
                      <div className="field-label">Created Time</div>
                      <div className="field-value">{formatDate(contact.created_at)}</div>
                    </div>
                  </div>
                </div>

                {/* Right: Sales Summary */}
                {salesOn && (
                <div>
                  <div className="panel panel-detail" style={{ background: 'var(--color-surface-offset)' }}>
                    <h3 style={{ fontSize: '16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Sales Summary
                    </h3>
                    <div className="summary-item" style={{ padding: '10px 0', borderBottom: '1px solid var(--color-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="lbl" style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Pipeline Value</span>
                      <span className="val" style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: '16px' }}>
                        {deals.length > 0 ? `$${deals.reduce((s, d) => s + (d.amount || 0), 0).toLocaleString()}` : '$0'}
                      </span>
                    </div>
                    <div className="summary-item" style={{ padding: '10px 0', borderBottom: '1px solid var(--color-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="lbl" style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Open Deals</span>
                      <span className="val" style={{ fontWeight: 600 }}>{deals.length} active</span>
                    </div>
                    <div className="summary-item" style={{ padding: '10px 0', borderBottom: '1px solid var(--color-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="lbl" style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Last Touch</span>
                      <span className="val" style={{ fontWeight: 600 }}>{lastTouchDate}</span>
                    </div>
                    <div className="summary-item" style={{ padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="lbl" style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Owner</span>
                      <span className="val" style={{ fontWeight: 600 }}>{contact.contact_type || 'Unassigned'}</span>
                    </div>
                    {deals.length > 0 && (
                      <div className="next-action" style={{ background: 'var(--color-primary-highlight)', padding: '12px', borderRadius: '8px', marginTop: '16px', border: '1px solid rgba(15,111,111,0.2)' }}>
                        <div className="lbl" style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-primary)', fontWeight: 700, marginBottom: '4px' }}>Next Action</div>
                        <div className="val" style={{ fontWeight: 600, color: 'var(--color-primary-active)', fontSize: '13px' }}>{deals[0].name}</div>
                        <div className="lbl" style={{ marginTop: '4px', fontWeight: 500, fontSize: '12px', color: 'var(--color-text)' }}>Stage: {deals[0].stage?.name || '—'}</div>
                      </div>
                    )}
                  </div>
                </div>)}
              </div>
            </div>
          )}

          {/* ═══ Timeline Tab ═══ */}
          {tab === 'timeline' && (
            <div className="panel">
              <div className="panel-head">
                <h3>Activity</h3>
                <button onClick={() => {
                  setLogActivityForm({ action: '', description: '' });
                  setLogActivityOpen(true);
                }} className="btn-ghost">
                  + Log activity
                </button>
              </div>
              {timelineItems.length === 0 ? (
                <div className="empty-state">No activity recorded yet</div>
              ) : (
                <div className="timeline timeline-panel">
                  {timelineItems.map(item => (
                    <div key={item.id} className="tl-item">
                      <div className="tl-dot">{item.emoji}</div>
                      <div className="tl-card">
                        <div className="tl-head">
                          <span className="t">{item.title}</span>
                          <span className="d">{item.date}</span>
                        </div>
                        <div className="tl-meta">{item.meta}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Deals Tab ═══ */}
          {tab === 'deals' && (
            <div className="panel">
              <div className="panel-head">
                <h3>Deals</h3>
              </div>
              {deals.length === 0 ? (
                <div className="empty-state">No deals linked</div>
              ) : (
                <div className="flex-col">
                  {deals.map(d => (
                    <div key={d.id} className="list-row">
                      <div className="list-main">
                        <div className="list-title">{d.name}</div>
                        <div className="list-sub">{d.stage?.name || '—'}</div>
                      </div>
                      <div className="text-right">
                        <div className="list-title">{formatAmount(d.amount)}</div>
                        <div className="list-sub">{d.probability ?? 0}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Tasks Tab ═══ */}
          {tab === 'tasks' && (
            <div className="panel">
              <div className="panel-head">
                <h3>Tasks</h3>
              </div>
              <div className="empty-state">No tasks yet</div>
            </div>
          )}

          {/* ═══ Touchpoints Tab ═══ */}
          {tab === 'touchpoints' && (
            <div className="panel">
              <div className="panel-head">
                <h3>Touchpoints</h3>
                <button onClick={() => setTpOpen(true)} className="btn-ghost">
                  + Add Touchpoint
                </button>
              </div>
              {touchpoints.length === 0 ? (
                <div className="empty-state">No touchpoints yet</div>
              ) : (
                <div className="flex-col">
                  {touchpoints.map(tp => (
                    <div key={tp.id} className="list-row">
                      <div className="list-icon">
                        <Activity />
                      </div>
                      <div className="list-main">
                        <div className="list-title">{tp.title}</div>
                        <div className="list-sub">{tp.description || '—'}</div>
                        <div className="list-sub mt-1 flex items-center gap-2">
                          <span className="badge badge-p3">{tp.type}</span>
                          {tp.company && <span>· {tp.company.name}</span>}
                          <span className="ml-auto text-faint text-xs">{timeAgo(tp.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Notes Tab ═══ */}
          {tab === 'notes' && (
            <div className="panel">
              <div className="panel-head">
                <h3>Notes</h3>
                <button onClick={() => setNoteOpen(true)} className="btn-ghost">
                  + Add Note
                </button>
              </div>
              {notes.length === 0 ? (
                <div className="empty-state">No notes yet</div>
              ) : (
                <div className="flex-col">
                  {notes.filter(n => n.contact_id === id || !n.contact_id).map(n => (
                    <div key={n.id} className="list-row flex-col items-stretch px-5 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="list-title">{n.title}</div>
                        {n.pinned && <span className="badge badge-p1">Pinned</span>}
                      </div>
                      {n.content && <p className="list-sub mt-1 whitespace-pre-wrap">{n.content}</p>}
                      <p className="list-sub mt-1 text-xs">{timeAgo(n.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Projects Tab ═══ */}
          {tab === 'projects' && (
            <div className="panel">
              <div className="panel-head">
                <h3>Projects</h3>
                <button onClick={async () => {
                  try {
                    const res = await apiClient.get<{ items: DealOption[] }>('/api/v1/crm/deals?page_size=200');
                    setDealOptions(res.items || []);
                    setSelectedProjectId('');
                    setProjectOpen(true);
                  } catch (e: any) { alert(e.detail || e.message); }
                }} className="btn-ghost">
                  + Link Project
                </button>
              </div>
              {projects.length === 0 ? (
                <div className="empty-state">No projects linked</div>
              ) : (
                <div className="flex-col">
                  {projects.map(p => (
                    <div key={p.id} className="list-row">
                      <div className="list-main">
                        <div className="list-title">{p.project_name}</div>
                        <div className="list-sub">{p.stage_name || '—'}</div>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        <div>
                          <div className="list-title">{p.project_amount ? formatAmount(p.project_amount) : '$0'}</div>
                          <div className="list-sub">{p.probability ?? 0}%</div>
                        </div>
                        <button onClick={async () => {
                          if (!confirm('Remove this project from contact?')) return;
                          try {
                            await apiClient.delete(`/api/v1/crm/contacts/${id}/projects/${p.id}`);
                            fetchContact();
                          } catch (e: any) { alert(e.detail || e.message); }
                        }} className="icon-btn text-notification" title="Remove">
                          <Trash2 className="icon-16" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Delete Confirmation Modal ─── */}
      {deleteModalOpen && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteModalOpen(false); }}>
          <div className="modal modal-sm">
            <div className="delete-body">
              <div className="delete-icon-wrap">
                <Trash2 />
              </div>
              <h3 className="delete-heading">Delete {contact.name}?</h3>
              <p className="delete-text">
                This action removes the contact from your CRM. It cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} disabled={deleteLoading}
                className="btn-notification">
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Log Activity Modal ─── */}
      {logActivityOpen && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setLogActivityOpen(false); }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Log Activity</h2>
              <button onClick={() => setLogActivityOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <div>
                  <label className="field-label">Action *</label>
                  <input type="text" value={logActivityForm.action}
                    onChange={e => setLogActivityForm(f => ({ ...f, action: e.target.value }))}
                    placeholder="e.g. Called, Emailed, Meeting"
                    className="input-field" />
                </div>
              </div>
              <div className="form-row-1">
                <div>
                  <label className="field-label">Description</label>
                  <textarea value={logActivityForm.description}
                    onChange={e => setLogActivityForm(f => ({ ...f, description: e.target.value }))}
                    rows={3}
                    placeholder="Brief description..."
                    className="input-field" />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setLogActivityOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleLogActivity} disabled={logActivitySaving || !logActivityForm.action.trim()}
                className="btn-primary">
                {logActivitySaving ? 'Saving...' : 'Log'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Touchpoint Modal ─── */}
      {tpOpen && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setTpOpen(false); }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Add Touchpoint</h2>
              <button onClick={() => setTpOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <div>
                  <label className="field-label">Title *</label>
                  <input type="text" value={tpForm.title}
                    onChange={e => setTpForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Discovery call with Peter"
                    className="input-field" />
                </div>
              </div>
              <div className="form-row-1">
                <div>
                  <label className="field-label">Type</label>
                  <select value={tpForm.type}
                    onChange={e => setTpForm(f => ({ ...f, type: e.target.value }))}
                    className="input-field">
                    <option value="meeting">Meeting</option>
                    <option value="call">Call</option>
                    <option value="email">Email</option>
                    <option value="namecard">NameCard</option>
                  </select>
                </div>
              </div>
              <div className="form-row-1">
                <div>
                  <label className="field-label">Description</label>
                  <textarea value={tpForm.description}
                    onChange={e => setTpForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    placeholder="Brief description of the interaction"
                    className="input-field" />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setTpOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleAddTouchpoint} disabled={tpSaving || !tpForm.title.trim()}
                className="btn-primary">
                {tpSaving ? 'Saving...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Note Modal ─── */}
      {noteOpen && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setNoteOpen(false); }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Add Note</h2>
              <button onClick={() => setNoteOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <div>
                  <label className="field-label">Title *</label>
                  <input type="text" value={noteForm.title}
                    onChange={e => setNoteForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Note title"
                    className="input-field" />
                </div>
              </div>
              <div className="form-row-1">
                <div>
                  <label className="field-label">Content</label>
                  <textarea value={noteForm.content}
                    onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
                    rows={4}
                    placeholder="Write your notes here..."
                    className="input-field" />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setNoteOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleAddNote} disabled={noteSaving || !noteForm.title.trim()}
                className="btn-primary">
                {noteSaving ? 'Saving...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Link Project Modal ─── */}
      {projectOpen && (
        <div className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setProjectOpen(false); }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Link Project</h2>
              <button onClick={() => setProjectOpen(false)} className="modal-x"><X className="icon-16" /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-row-1">
                <div>
                  <label className="field-label">Select Project</label>
                  <select value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                    className="input-field">
                    <option value="">-- Choose a project --</option>
                    {dealOptions.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.amount ? `($${d.amount})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setProjectOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={async () => {
                if (!selectedProjectId) { alert('Please select a project'); return; }
                setProjectSaving(true);
                try {
                  await apiClient.post(`/api/v1/crm/contacts/${id}/projects`, { project_id: selectedProjectId });
                  setProjectOpen(false);
                  fetchContact();
                } catch (e: any) { alert(e.detail || e.message); }
                finally { setProjectSaving(false); }
              }} disabled={projectSaving || !selectedProjectId}
                className="btn-primary">
                {projectSaving ? 'Linking...' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
