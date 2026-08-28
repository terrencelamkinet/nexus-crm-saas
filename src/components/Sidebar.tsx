import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import SvcIcon from '../components/SvcIcon';
import { Activity, BarChart3, Building2, Calendar, CheckSquare, FolderKanban, LayoutDashboard, ScanLine, Sparkles, TrendingUp, UserCog, Users } from 'lucide-react'
import { apiClient } from '../lib/api';

export interface ModuleSetting {
  module_key: string;
  enabled: boolean;
}

const closeMobileMenu = () => {
  const shell = document.getElementById('appShell');
  if (shell) shell.classList.remove('mobile-open');
  window.dispatchEvent(new CustomEvent('close-mobile-menu'));
};

export default function Sidebar() {
  const { t } = useTranslation();

  const workspaceItems = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/contacts', label: t('nav.contacts'), icon: Users },
    { to: '/calendar', label: t('nav.calendar'), icon: Calendar },
    { to: '/companies', label: t('nav.companies'), icon: Building2 },
    { to: '/projects', label: t('nav.projects'), icon: FolderKanban, module: 'projects' },
    { to: '/deals', label: t('nav.deals'), icon: TrendingUp, module: 'sales' },
    { to: '/tasks', label: t('nav.tasks'), icon: CheckSquare },
  ];

  const secondaryItems = [
    { to: '/touchpoints', label: t('nav.touchpoints'), icon: Activity },
    { to: '/namecards', label: t('nav.nameCards'), icon: ScanLine },
    { to: '/reports', label: t('nav.reports'), icon: BarChart3 },
  ];

  const orgItems = [
    { to: '/team', label: t('nav.team'), icon: UserCog },
    { to: '/ai-apps', label: t('nav.aiApps'), icon: Sparkles },
  ];

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

  // Default to visible when module settings not loaded yet
  const hasSettings = Object.keys(modules).length > 0
  const isVisible = (item: typeof workspaceItems[0]) => {
    if (!item.module) return true;
    if (!hasSettings) return true;
    // Default to visible when no explicit setting exists (mirrors enabled-modules.ts)
    return modules[item.module] !== false;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="12.5" stroke="currentColor" stroke-width="1.8"/><ellipse cx="14" cy="15.5" rx="6.2" ry="8" fill="currentColor"/><ellipse cx="14" cy="16.5" rx="3.6" ry="5.6" fill="var(--color-surface)"/><circle cx="14" cy="8.2" r="3.8" fill="currentColor"/><ellipse cx="14" cy="9" rx="2.1" ry="1.8" fill="var(--color-surface)"/><circle cx="12.7" cy="8" r="0.5" fill="var(--color-bg)"/><circle cx="15.3" cy="8" r="0.5" fill="var(--color-bg)"/><path d="M12.9 9.8 L15.1 9.8 L14 10.9 Z" fill="#F27F63"/><path d="M14 4.6 C15.4 3.4 17.2 3.2 18.4 3.6 C17.6 4.6 16.2 5.2 14.8 5.2 Z" fill="#5694A7"/><path d="M11.2 12.6 L14 13.9 L16.8 12.6 L16.8 14.8 L14 13.9 L11.2 14.8 Z" fill="#F27F63"/></svg>
        <span>{t('app.name')}</span>
      </div>
      <nav className="sidebar-nav">
        <p className="nav-section-label">{t('nav.workspace')}</p>
        {workspaceItems.map(item => isVisible(item) && (
          <NavLink key={item.to} to={item.to} onClick={closeMobileMenu} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            {item.icon && <item.icon size={18} />}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <p className="nav-section-label mt-space-4">{t('nav.records')}</p>
        {secondaryItems.map(item => (
          <NavLink key={item.to} to={item.to} onClick={closeMobileMenu} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <item.icon />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <p className="nav-section-label mt-space-4">{t('nav.organization')}</p>
        {orgItems.map(item => (
          <NavLink key={item.to} to={item.to} onClick={closeMobileMenu} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <item.icon />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <NavLink to="/notifications" onClick={closeMobileMenu} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <SvcIcon name="bell" />
          <span>{t('nav.notifications')}</span>
        </NavLink>
        <NavLink to="/marketplace" onClick={closeMobileMenu} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <SvcIcon name="puzzle" />
          <span>{t('nav.marketplace')}</span>
        </NavLink>
        <NavLink to="/settings" onClick={closeMobileMenu} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          style={{ marginTop: 'var(--space-4)' }}>
          <SvcIcon name="settings" />
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>
    </aside>
  );
}
