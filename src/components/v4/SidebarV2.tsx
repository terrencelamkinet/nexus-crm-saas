import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard, Users, Calendar, Building2, TrendingUp, CheckSquare,
  Activity, ScanLine, BarChart3, UsersRound, Sparkles, Bell,
  Store, Settings, ChevronLeft, FolderKanban,
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════
   SidebarV2 — Collapsible navigation rail.
   Clicking the logo toggles collapse on desktop (persisted).
   On mobile it's rendered as a slide-in drawer by LayoutV2.
   Includes: Team (nav.team) module explicitly, per audit.
   ═══════════════════════════════════════════════════════════ */

interface NavItem { to: string; label: string; icon: any }
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
      { to: '/deals', label: t('nav.deals', { defaultValue: '商機' }), icon: TrendingUp },
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
        <svg viewBox="0 0 32 32" className="sbv2-logo-icon" fill="none"><path d="M4 26L16 4L28 26H21L16 16L11 26H4Z" fill="currentColor" /></svg>
        {!collapsed && <span className="sbv2-logo-text">NEXUS CRM</span>}
        {!collapsed && <ChevronLeft size={15} className="sbv2-collapse-caret" />}
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
