import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Menu, Search, Plus, Bell, Moon, Sun, ChevronDown, Sparkles,
  Users, CheckSquare, TrendingUp, LogOut, Settings, User as UserIcon,
} from 'lucide-react'
import CommandPalette from './CommandPalette'
import { apiClient } from '../../lib/api'
import { useAuth } from '../../lib/AuthContext'
import { useNavigate } from 'react-router-dom'

/* ═══════════════════════════════════════════════════════════
   HeaderV2 — Centralized Topbar
   - Search trigger AND the AI pill both open CommandPalette
     (⌘K) — the single entry point for search, navigation,
     quick-create actions, and natural-language AI queries.
   - New(+) dropdown includes a direct "Ask AI" shortcut.
   - Notifications + user menu are fully wired (click-outside
     to close, badge counts, real content).
   ═══════════════════════════════════════════════════════════ */

export default function HeaderV2({ onToggleSidebar }: { onToggleSidebar: () => void; sidebarCollapsed?: boolean }) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.getAttribute('data-theme') as any) || 'dark')
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const newRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    apiClient.get<{ items: any[]; total: number }>('/api/v1/notifications?page=1&page_size=8')
      .then(d => setNotifications(d.items || [])).catch(() => {})
    apiClient.get<{ unread_count: number }>('/api/v1/notifications/unread-count')
      .then(d => setUnreadCount(d.unread_count || 0)).catch(() => {})
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('nexus-theme', next)
  }

  const initials = (user?.displayName || 'U').split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()

  return (
    <>
      <header className="hdr2-bar">
        <div className="hdr2-left">
          <button className="hdr2-icon-btn hdr2-sidebar-toggle" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <Menu size={19} />
          </button>
          <button className="hdr2-search-trigger" onClick={() => setPaletteOpen(true)}>
            <Search size={15} />
            <span className="hdr2-search-placeholder">{t('search.triggerPlaceholder', { defaultValue: '搜尋或詢問 AI…' })}</span>
            <kbd className="hdr2-search-kbd">⌘K</kbd>
          </button>
        </div>

        <div className="hdr2-right">
          <button className="hdr2-ai-pill" title={t('header.aiActive', { defaultValue: '點擊詢問 AI 助手' })} onClick={() => setPaletteOpen(true)}>
            <Sparkles size={13} className="hdr2-ai-icon-on" />
            <span>AI</span>
            <span className="hdr2-ai-dot on" />
          </button>

          <div className="hdr2-new-wrap" ref={newRef}>
            <button className="hdr2-new-btn" onClick={() => setNewOpen(v => !v)} aria-label="Create new">
              <Plus size={18} />
            </button>
            <div className={`hdr2-new-dropdown ${newOpen ? 'open' : ''}`}>
              <button className="hdr2-new-dropdown-item" onClick={() => { setNewOpen(false); navigate('/contacts?new=1') }}><Users size={14} /> {t('quickAction.newContact', { defaultValue: '新增聯絡人' })}</button>
              <button className="hdr2-new-dropdown-item" onClick={() => { setNewOpen(false); navigate('/deals?new=1') }}><TrendingUp size={14} /> {t('quickAction.newDeal', { defaultValue: '新增商機' })}</button>
              <button className="hdr2-new-dropdown-item" onClick={() => { setNewOpen(false); navigate('/tasks?new=1') }}><CheckSquare size={14} /> {t('quickAction.newTask', { defaultValue: '新增任務' })}</button>
              <div className="hdr2-new-dropdown-divider" />
              <button className="hdr2-new-dropdown-item" onClick={() => { setNewOpen(false); setPaletteOpen(true) }}><Sparkles size={14} /> {t('quickAction.aiQuery', { defaultValue: '問 AI 一個問題' })}</button>
            </div>
          </div>

          <button className="hdr2-icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="hdr2-notif-wrap" ref={notifRef}>
            <button className="hdr2-icon-btn" onClick={() => setNotifOpen(v => !v)} aria-label="Notifications">
              <Bell size={18} />
              {unreadCount > 0 && <span className="hdr2-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            <div className={`hdr2-notif-panel ${notifOpen ? 'open' : ''}`}>
              <div className="hdr2-notif-header">
                <span>{t('header.notifications', { defaultValue: '通知' })}</span>
                {unreadCount > 0 && <span className="hdr2-notif-count">{unreadCount} {t('header.new', { defaultValue: '則新通知' })}</span>}
                <button className="hdr2-notif-viewall" onClick={() => { setNotifOpen(false); navigate('/notifications') }}>{t('header.viewAll', { defaultValue: '查看全部' })} →</button>
              </div>
              <div className="hdr2-notif-list">
                {notifications.length === 0 ? (
                  <div className="hdr2-notif-empty">{t('header.noNotifications', { defaultValue: '暫無通知' })}</div>
                ) : notifications.map((n) => (
                  <div key={n.id} className={`hdr2-notif-item ${n.status === 'UNREAD' ? 'unread' : ''}`}>
                    <div className="hdr2-notif-item-title">{n.title}</div>
                    <div className="hdr2-notif-item-body">{n.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="hdr2-user-wrap" ref={userRef}>
            <button className="hdr2-user-btn" onClick={() => setUserOpen(v => !v)}>
              <div className="hdr2-avatar">{initials}</div>
              <ChevronDown size={14} className="hdr2-chevron" />
            </button>
            <div className={`hdr2-user-dropdown ${userOpen ? 'open' : ''}`}>
              <div className="hdr2-user-info">
                <div className="hdr2-user-name">{user?.displayName}</div>
                <div className="hdr2-user-email">{user?.email}</div>
              </div>
              <button className="hdr2-user-dropdown-item" onClick={() => { setUserOpen(false); navigate('/settings') }}><UserIcon size={14} /> {t('header.profile', { defaultValue: '個人資料' })}</button>
              <button className="hdr2-user-dropdown-item" onClick={() => { setUserOpen(false); navigate('/settings') }}><Settings size={14} /> {t('header.settings', { defaultValue: '設定' })}</button>
              <button className="hdr2-user-dropdown-item danger" onClick={logout}><LogOut size={14} /> {t('header.logout', { defaultValue: '登出' })}</button>
            </div>
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}
