import { useState, useEffect } from 'react';
import {
  Users, TrendingUp, CheckSquare, ArrowUpRight,
  Phone, Mail, Building2,
} from 'lucide-react';
import { apiClient } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Task { id: string; title: string; priority: string; status: string; due_date: string | null; }
interface Touchpoint {
  id: string; type: string; title: string; description: string | null;
  company?: { name: string } | null; contact?: { name: string } | null;
  created_at: string;
}
interface Deal {
  id: string; name: string; amount: number | null;
  stage_id: string; probability: number;
  company?: { name: string } | null;
}
interface Stage { id: string; name: string; order_index: number; }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardPreview() {
  const [stats, setStats] = useState([
    { label: 'Total Contacts', value: '—', change: '', positive: true, icon: Users, color: 'var(--color-blue)' },
    { label: 'Active Deals', value: '—', change: '', positive: true, icon: TrendingUp, color: 'var(--color-primary)' },
    { label: 'Open Tasks', value: '—', change: '', positive: true, icon: CheckSquare, color: 'var(--color-warning)' },
    { label: 'Companies', value: '—', change: '', positive: true, icon: Building2, color: 'var(--color-purple)' },
  ]);
  const [recentActivity, setRecentActivity] = useState<{ icon: any; style: string; title: string; desc: string; company: string; time: string }[]>([]);
  const [dealStages, setDealStages] = useState<{ name: string; items: { name: string; amount: string; prob: string }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const [contactsRes, dealsRes, tasksRes, companiesRes, touchpointsRes, pipeRes] = await Promise.all([
        apiClient.get<{ total: number }>('/api/v1/crm/contacts?page=1&page_size=1'),
        apiClient.get<{ items: Deal[]; total: number }>('/api/v1/crm/deals?page=1&page_size=100'),
        apiClient.get<{ items: Task[]; total: number }>('/api/v1/crm/tasks?page=1&page_size=1'),
        apiClient.get<{ total: number }>('/api/v1/crm/companies?page=1&page_size=1'),
        apiClient.get<{ items: Touchpoint[]; total: number }>('/api/v1/crm/touchpoints?page=1&page_size=10'),
        apiClient.get<{ items: Stage[]; total: number }>('/api/v1/crm/deal-stages?page=1&page_size=20'),
      ]);

      const contacts = contactsRes.total || 0;
      const deals = dealsRes.items || [];
      const tasks = tasksRes.total || 0;
      const companies = companiesRes.total || 0;
      const touchpoints = (touchpointsRes.items || []).slice(0, 5);
      const stages = (pipeRes.items || []).sort((a: Stage, b: Stage) => a.order_index - b.order_index).slice(0, 3);

      const totalDealValue = deals.reduce((s: number, d: Deal) => s + (d.amount || 0), 0);
      const formatCurrency = (n: number) => {
        if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
        return `$${n.toLocaleString()}`;
      };

      setStats([
        { label: 'Total Contacts', value: String(contacts), change: '', positive: true, icon: Users, color: 'var(--color-blue)' },
        { label: 'Active Deals', value: formatCurrency(totalDealValue), change: `${deals.length} deals`, positive: true, icon: TrendingUp, color: 'var(--color-primary)' },
        { label: 'Open Tasks', value: String(tasks), change: '', positive: true, icon: CheckSquare, color: 'var(--color-warning)' },
        { label: 'Companies', value: String(companies), change: '', positive: true, icon: Building2, color: 'var(--color-purple)' },
      ]);

      // Recent activity
      const typeConfig: Record<string, { icon: any; style: string }> = {
        call: { icon: Phone, style: 'var(--color-primary)' },
        meeting: { icon: Users, style: 'var(--color-gold)' },
        email: { icon: Mail, style: 'var(--color-purple)' },
        namecard: { icon: Building2, style: 'var(--color-warning)' },
      };
      const timeAgo = (d: string) => {
        const diff = Date.now() - new Date(d).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
      };

      setRecentActivity(
        touchpoints.map((tp: Touchpoint) => {
          const cfg = typeConfig[tp.type] || { icon: Mail, style: 'var(--color-text-muted)' };
          return {
            icon: cfg.icon,
            style: cfg.style,
            title: tp.title,
            desc: tp.description || '—',
            company: tp.company?.name || '',
            time: timeAgo(tp.created_at),
          };
        })
      );

      // Deal stages — group deals by stage
      const stageMap: Record<string, string> = {};
      stages.forEach((s: Stage) => { stageMap[s.id] = s.name; });
      const stageDeals: Record<string, { name: string; amount: string; prob: string }[]> = {};
      stages.forEach((s: Stage) => { stageDeals[s.id] = []; });
      deals.forEach((d: Deal) => {
        if (stageDeals[d.stage_id]) {
          stageDeals[d.stage_id].push({
            name: `${d.company?.name || ''} - ${d.name}`,
            amount: formatCurrency(d.amount || 0),
            prob: `${d.probability}%`,
          });
        }
      });
      setDealStages(
        stages.map((s: Stage) => ({
          name: s.name,
          items: (stageDeals[s.id] || []).slice(0, 3),
        }))
      );
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboard(); }, []);

  if (loading) {
    return (
      <div className="main-content" style={{ padding: '26px 30px' }}>
        <div className="page-header" style={{ marginBottom: '22px' }}>
          <div>
            <h1>Dashboard</h1>
            <p>Loading overview...</p>
          </div>
        </div>
        <div className="kpi-grid" style={{ marginBottom: '26px' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="kpi-card" style={{ height: '100px', background: 'var(--color-surface-offset)', animation: 'pulse 2s infinite' }} />
          ))}
        </div>
        <div className="panel" style={{ height: '180px', background: 'var(--color-surface-offset)', animation: 'pulse 2s infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="main-content" style={{ padding: '26px 30px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'var(--color-notification-highlight)', border: '1px solid var(--color-notification)', borderRadius: 'var(--radius-md)', color: 'var(--color-notification)', fontSize: '13px' }}>
          <span>{error}</span>
          <button onClick={fetchDashboard} style={{ fontWeight: 600, textDecoration: 'underline', marginLeft: '8px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back, here's your overview</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        {stats.map((s) => (
          <div key={s.label} className="kpi-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: 'var(--radius-md)',
                background: `color-mix(in oklch, ${s.color} 12%, transparent)`,
                color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <s.icon style={{ width: '18px', height: '18px' }} />
              </div>
              {s.change && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  color: 'var(--color-text-muted)', background: 'var(--color-surface-offset)'
                }}>
                  {s.change}
                  <ArrowUpRight style={{ width: '12px', height: '12px' }} />
                </span>
              )}
            </div>
            <div className="kpi-value">{s.value}</div>
            <div className="kpi-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Main panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '16px', marginBottom: '18px' }}>
        {/* Recent Activity */}
        <div className="panel">
          <div className="panel-head">
            <h3>Recent Activity</h3>
          </div>
          {recentActivity.length === 0 ? (
            <div style={{ padding: '16px 18px', fontSize: '12px', color: 'var(--color-text-faint)' }}>No recent activity</div>
          ) : (
            recentActivity.map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={i} className="list-row">
                  <div className="list-icon" style={{ color: a.style }}>
                    <Icon />
                  </div>
                  <div className="list-main">
                    <div className="list-title">{a.title}</div>
                    <div className="list-sub">{a.desc}</div>
                    {a.company && <div className="list-sub" style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{a.company}</div>}
                  </div>
                  <div className="list-meta">{a.time}</div>
                </div>
              );
            })
          )}
        </div>

        {/* Pipeline summary */}
        <div className="panel">
          <div className="panel-head">
            <h3>Deal Pipeline</h3>
          </div>
          {dealStages.length === 0 ? (
            <div style={{ padding: '16px 18px', fontSize: '12px', color: 'var(--color-text-faint)' }}>No pipeline data</div>
          ) : (
            <div className="mini-kanban">
              {dealStages.map((stage) => (
                <div key={stage.name}>
                  <div className="mini-col-head">
                    {stage.name}
                    <span className="count">{stage.items.length}</span>
                  </div>
                  {stage.items.length === 0 ? (
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', padding: '6px 0' }}>No deals</div>
                  ) : (
                    stage.items.map((item, i) => (
                      <div key={i} className="mini-card">
                        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '2px' }}>{item.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{item.amount} · {item.prob}</div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
