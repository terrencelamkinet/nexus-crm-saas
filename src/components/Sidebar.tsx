import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, TrendingUp,
  CheckSquare, Activity, ScanLine, Settings, BarChart3,
  Sparkles, UserCog, FolderKanban,
} from 'lucide-react';
import { apiClient } from '../lib/api';

export interface ModuleSetting {
  module_key: string;
  enabled: boolean;
}

const workspaceItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/projects', label: 'Projects', icon: FolderKanban, module: 'projects' },
  { to: '/deals', label: 'Deals', icon: TrendingUp, module: 'sales' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
];

const secondaryItems = [
  { to: '/touchpoints', label: 'Touchpoints', icon: Activity },
  { to: '/namecards', label: 'NameCards', icon: ScanLine },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const orgItems = [
  { to: '/team', label: 'Team', icon: UserCog },
  { to: '/ai-apps', label: 'AI Apps', icon: Sparkles },
];

export default function Sidebar() {
  const [modules, setModules] = useState<Record<string, boolean>>({});

  const fetchModules = useCallback(async () => {
    try {
      const list: ModuleSetting[] = await apiClient.get('/api/v1/crm/module-settings');
      const map: Record<string, boolean> = {};
      (list || []).forEach(m => { map[m.module_key] = m.enabled; });
      setModules(map);
    } catch {}
  }, []);

  useEffect(() => {
    fetchModules();
    const handler = () => fetchModules();
    window.addEventListener('modules-changed', handler);
    return () => window.removeEventListener('modules-changed', handler);
  }, [fetchModules]);

  const isVisible = (item: typeof workspaceItems[0]) => {
    if (!item.module) return true;
    return modules[item.module] === true;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M4 24V4l10 16V4l10 16"/>
          <path d="M24 20v4H4"/>
        </svg>
        <span>NEXUS CRM</span>
      </div>
      <nav className="sidebar-nav">
        <p className="nav-section-label">Workspace</p>
        {workspaceItems.map(item => isVisible(item) && (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <item.icon />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <p className="nav-section-label" style={{ marginTop: 'var(--space-4)' }}>Records</p>
        {secondaryItems.map(item => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <item.icon />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <p className="nav-section-label" style={{ marginTop: 'var(--space-4)' }}>Organization</p>
        {orgItems.map(item => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <item.icon />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          style={{ marginTop: 'var(--space-4)' }}>
          <Settings />
          <span>Settings</span>
        </NavLink>
      </nav>
    </aside>
  );
}
