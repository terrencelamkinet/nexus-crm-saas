import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { UsersRound, Store, Activity, BarChart3, Bell, Building2, Calendar, CheckSquare, FolderKanban, LayoutDashboard, ScanLine, Settings, Sparkles, Users } from 'lucide-react'
import SvcIcon from '../../components/SvcIcon'

/* ═══════════════════════════════════════════════════════════
   SidebarV2 — Collapsible navigation rail.
   Clicking the logo toggles collapse on desktop (persisted).
   On mobile it's rendered as a slide-in drawer by LayoutV2.
   Includes: Team (nav.team) module explicitly, per audit.
   ═══════════════════════════════════════════════════════════ */

interface NavItem { to: string; label: string; icon: any; module?: string }
interface NavSection { label: string; items: NavItem[] }

export default function SidebarV2({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse: () => void }) {
  const { t } = useTranslation()

  const sections: NavSection[] = [
    { label: t('nav.workspace', { defaultValue: '工作區' }), items: [
      { to: '/dashboard', label: t('nav.dashboard', { defaultValue: 'Dashboard' }), icon: LayoutDashboard },
      { to: '/contacts', label: t('nav.contacts', { defaultValue: '聯絡人' }), icon: Users },
      { to: '/calendar', label: t('nav.calendar', { defaultValue: '日曆' }), icon: Calendar },
      { to: '/companies', label: t('nav.companies', { defaultValue: '公司' }), icon: Building2 },
      { to: '/projects', label: t('nav.projects', { defaultValue: '項目' }), icon: FolderKanban },
      { to: '/tasks', label: t('nav.tasks', { defaultValue: '任務' }), icon: CheckSquare },
    ]},
    { label: t('nav.records', { defaultValue: '記錄' }), items: [
      { to: '/touchpoints', label: t('nav.touchpoints', { defaultValue: '聯繫記錄' }), icon: Activity },
      { to: '/namecards', label: t('nav.namecards', { defaultValue: '名片庫' }), icon: ScanLine },
      { to: '/reports', label: t('nav.reports', { defaultValue: '報表' }), icon: BarChart3 },
    ]},
    { label: t('nav.organization', { defaultValue: '組織' }), items: [
      { to: '/team', label: t('nav.team', { defaultValue: '團隊' }), icon: UsersRound },
      { to: '/ai-apps', label: t('nav.aiApps', { defaultValue: 'AI Apps' }), icon: Sparkles },
      { to: '/notifications', label: t('nav.notifications', { defaultValue: '通知' }), icon: Bell },
      { to: '/marketplace', label: t('nav.marketplace', { defaultValue: 'Marketplace' }), icon: Store },
      { to: '/settings', label: t('nav.settings', { defaultValue: '設定' }), icon: Settings },
    ]},
  ]

  return (
    <aside className={`sbv2-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button className="sbv2-logo-btn" onClick={onToggleCollapse} title={collapsed ? t('sidebar.expand', { defaultValue: '展開側邊欄' }) : t('sidebar.collapse', { defaultValue: '收合側邊欄' })}>
        <svg viewBox="0 0 28 28" className="sbv2-logo-icon" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="12.5" stroke="currentColor" stroke-width="1.8"/><ellipse cx="14" cy="15.5" rx="6.2" ry="8" fill="currentColor"/><ellipse cx="14" cy="16.5" rx="3.6" ry="5.6" fill="var(--color-surface)"/><circle cx="14" cy="8.2" r="3.8" fill="currentColor"/><ellipse cx="14" cy="9" rx="2.1" ry="1.8" fill="var(--color-surface)"/><circle cx="12.7" cy="8" r="0.5" fill="var(--color-bg)"/><circle cx="15.3" cy="8" r="0.5" fill="var(--color-bg)"/><path d="M12.9 9.8 L15.1 9.8 L14 10.9 Z" fill="#F27F63"/><path d="M14 4.6 C15.4 3.4 17.2 3.2 18.4 3.6 C17.6 4.6 16.2 5.2 14.8 5.2 Z" fill="#5694A7"/><path d="M11.2 12.6 L14 13.9 L16.8 12.6 L16.8 14.8 L14 13.9 L11.2 14.8 Z" fill="#F27F63"/></svg>
        {!collapsed && <span className="sbv2-logo-text">Penguin CRM</span>}
        {!collapsed && <SvcIcon name="chevron-left" size={15} className="sbv2-collapse-caret" />}
      </button>

      <nav className="sbv2-nav">
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && <div className="sbv2-section-label">{section.label}</div>}
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink key={item.to} to={item.to} data-tooltip={item.label}
                  className={({ isActive }) => `sbv2-nav-item ${isActive ? 'active' : ''}`}>
                  <Icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
