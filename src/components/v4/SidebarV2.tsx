import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import SvcIcon from '../../components/SvcIcon'

/* ═══════════════════════════════════════════════════════════
   SidebarV2 — Collapsible navigation rail (PenguinCRM brand icons v7.08).
   Clicking the logo toggles collapse on desktop (persisted).
   On mobile it's rendered as a slide-in drawer by LayoutV2.
   Includes: Team (nav.team) module explicitly, per audit.
   ═══════════════════════════════════════════════════════════ */

interface NavItem { to: string; label: string; icon: string; module?: string }
interface NavSection { label: string; items: NavItem[] }

export default function SidebarV2({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse: () => void }) {
  const { t } = useTranslation()

  const sections: NavSection[] = [
    { label: t('nav.workspace', { defaultValue: '工作區' }), items: [
      { to: '/dashboard', label: t('nav.dashboard', { defaultValue: 'Dashboard' }), icon: 'dashboard' },
      { to: '/contacts', label: t('nav.contacts', { defaultValue: '聯絡人' }), icon: 'contacts' },
      { to: '/calendar', label: t('nav.calendar', { defaultValue: '日曆' }), icon: 'calendar' },
      { to: '/companies', label: t('nav.companies', { defaultValue: '公司' }), icon: 'companies' },
      { to: '/projects', label: t('nav.projects', { defaultValue: '項目' }), icon: 'projects' },
      { to: '/tasks', label: t('nav.tasks', { defaultValue: '任務' }), icon: 'tasks' },
    ]},
    { label: t('nav.records', { defaultValue: '記錄' }), items: [
      { to: '/touchpoints', label: t('nav.touchpoints', { defaultValue: '聯繫記錄' }), icon: 'touchpoints' },
      { to: '/namecards', label: t('nav.namecards', { defaultValue: '名片庫' }), icon: 'name-cards' },
      { to: '/reports', label: t('nav.reports', { defaultValue: '報表' }), icon: 'reports' },
    ]},
    { label: t('nav.organization', { defaultValue: '組織' }), items: [
      { to: '/team', label: t('nav.team', { defaultValue: '團隊' }), icon: 'team' },
      { to: '/ai-apps', label: t('nav.aiApps', { defaultValue: 'AI Apps' }), icon: 'ai-apps' },
      { to: '/notifications', label: t('nav.notifications', { defaultValue: '通知' }), icon: 'notifications' },
      { to: '/marketplace', label: t('nav.marketplace', { defaultValue: 'Marketplace' }), icon: 'marketplace' },
      { to: '/settings', label: t('nav.settings', { defaultValue: '設定' }), icon: 'settings' },
    ]},
  ]

  return (
    <aside className={`sbv2-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button className="sbv2-logo-btn" onClick={onToggleCollapse} title={collapsed ? t('sidebar.expand', { defaultValue: '展開側邊欄' }) : t('sidebar.collapse', { defaultValue: '收合側邊欄' })}>
        <img src="/assets/logo/logo_square.png" alt="PenguinCRM" className="sbv2-logo-icon" />
        {!collapsed && <span className="sbv2-logo-text">Penguin CRM</span>}
        {!collapsed && <SvcIcon name="chevron-left" size={15} className="sbv2-collapse-caret" />}
      </button>

      <nav className="sbv2-nav">
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && <div className="sbv2-section-label">{section.label}</div>}
            {section.items.map((item) => {
              return (
                <NavLink key={item.to} to={item.to} data-tooltip={item.label}
                  className={({ isActive }) => `sbv2-nav-item ${isActive ? 'active' : ''}`}>
                  <SvcIcon name={item.icon} size={18} />
                  {!collapsed && <span className="sbv2-nav-label">{item.label}</span>}
                  {item.module && !collapsed && <span className="sbv2-nav-module">{item.module}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
