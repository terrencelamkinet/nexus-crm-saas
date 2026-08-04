import { useState, useEffect } from 'react';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';

interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  priority: string;
  source_module?: string;
  source_record_type?: string;
  is_ai_generated: boolean;
  ai_rationale?: string;
  status: string;
  created_at?: string;
  action_url?: string;
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string>('');
  const pageSize = 20;

  const fetchData = async (p: number, f: string) => {
    setLoading(true);
    try {
      let url = `/api/v1/notifications?page=${p}&page_size=${pageSize}`;
      if (f) url += `&status=${f}`;
      const res = await apiClient.get<{ items: NotificationItem[]; total: number }>(url);
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchData(page, filter); }, [page, filter]);

  const handleMarkRead = async (id: string) => {
    try { await apiClient.patch(`/api/v1/notifications/${id}/read`, {}); setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'READ' } : i)); } catch {}
  };

  const handleMarkAllRead = async () => {
    try { await apiClient.post('/api/v1/notifications/read-all'); setItems(prev => prev.map(i => ({ ...i, status: 'READ' }))); } catch {}
  };

  const totalPages = Math.ceil(total / pageSize);
  const unreadCount = items.filter(i => i.status === 'UNREAD').length;

  const timeAgo = (d?: string) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('time.justNow');
    if (mins < 60) return t('time.minutesAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('time.hoursAgo', { count: hrs });
    return t('time.daysAgo', { count: Math.floor(hrs / 24) });
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <span>{t('nav.workspace')}</span>
            <span className="bc-sep">/</span>
            <span className="breadcrumb-current">{t('nav.notifications')}</span>
          </div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bell /> {t('pages.notifications.title')}
            {unreadCount > 0 && <span className="notif-badge" style={{ position: 'static', border: 'none' }}>{unreadCount}</span>}
          </h1>
          <p>{t('pages.notifications.summary', { total, unread: unreadCount })}</p>
        </div>
        <div className="header-actions">
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="btn-secondary">
              <CheckCheck className="w-4 h-4" /> {t('pages.notifications.markAllRead')}
            </button>
          )}
          <button onClick={() => fetchData(page, filter)} className="btn-secondary">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        {['', 'UNREAD', 'READ'].map(f => (
          <div key={f} className={`tab ${filter === f ? 'active' : ''}`}
            onClick={() => { setFilter(f); setPage(1); }}>
            {f === '' ? t('pages.notifications.all') : f === 'UNREAD' ? t('pages.notifications.unread') : t('pages.notifications.read')}
          </div>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-faint)' }}>{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="panel" style={{ padding: 48, textAlign: 'center' }}>
          <Bell className="w-8 h-8" style={{ color: 'var(--color-text-faint)', margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{t('pages.notifications.empty')}</p>
        </div>
      ) : (
        <div className="panel">
          {items.map((n, i) => (
            <div key={n.id} className={`notif-item${n.status === 'UNREAD' ? ' unread' : ''}`}
              style={{ borderBottom: i < items.length - 1 ? '1px solid var(--color-divider)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="notif-title">{n.title}</div>
                  {n.body && <div className="notif-body" style={{ WebkitLineClamp: 3 }}>{n.body}</div>}
                  {n.is_ai_generated && n.ai_rationale && (
                    <div style={{ fontSize: 11, color: 'var(--color-purple)', marginTop: 4 }}>
                      🤖 {n.ai_rationale}
                    </div>
                  )}
                  <div className="notif-meta" style={{ marginTop: 6 }}>
                    <span className={`notif-priority ${n.priority?.toLowerCase()}`}>{n.priority}</span>
                    {n.source_module && <span>{n.source_module}</span>}
                    <span>{timeAgo(n.created_at)}</span>
                    {n.is_ai_generated && <span style={{ color: 'var(--color-purple)', fontWeight: 600 }}>AI</span>}
                  </div>
                </div>
                {n.status === 'UNREAD' && (
                  <button onClick={() => handleMarkRead(n.id)} className="btn-ghost" style={{ flexShrink: 0, height: 28, padding: '0 8px', fontSize: 11 }}>
                    {t('pages.notifications.markRead')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination" style={{ marginTop: 16 }}>
          <span>{t('pages.notifications.total', { count: total })}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary" style={{ height: 32, fontSize: 12 }}>← {t('common.previous')}</button>
            <span style={{ display: 'flex', alignItems: 'center', fontSize: 13, color: 'var(--color-text-muted)', padding: '0 8px' }}>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn-secondary" style={{ height: 32, fontSize: 12 }}>{t('common.next')} →</button>
          </div>
        </div>
      )}
    </div>
  );
}
