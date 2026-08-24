import { useState, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UsersRound, Store, Activity, BarChart3, Building2, Calendar, CheckSquare, FileText, FolderKanban, LayoutDashboard, ScanLine, Settings, Sparkles, Users } from 'lucide-react'
import SvcIcon from '../../components/SvcIcon';
import { useAuth } from '../../lib/AuthContext';
import { apiClient } from '../../lib/api';
import { useSecretarySettings } from '../../hooks/useSecretarySettings';

/**
 * NEXUS CRM — Mobile Bottom Navigation v3 (AI 管家秘書 theme) — v6.70
 * Mobile view 吸收 sidebar + top bar：
 *   工作區 tab ← sidebar 工作區選項
 *   紀錄   tab ← sidebar 記錄選項
 *   設定   tab ← sidebar 組織選項 + top bar（黑白轉 / 個人頁面 / 通知）
 * ≤768px 時 sidebar + top bar 完全 hidden（CSS），bottom nav 係唯一導航。
 */

export interface Props {
  onOpenAiSearch: () => void;
  onScanCard: () => void;
  onQuickAdd: (recordType: string) => void;
}

const THEME_STORAGE = 'nexus-theme';

export default function MobileBottomNav({ onOpenAiSearch, onScanCard, onQuickAdd }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const addTiles = ADD_TILES_BASE;
  const [sheet, setSheet] = useState<'workspace' | 'record' | 'add' | 'settings' | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');
  const [notifications, setNotifications] = useState<{ id: string; title: string; body?: string; status?: string }[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  /* ── v6.94: AI 管家設定 4 開關（backend ai_secretary_settings）── */
  const secretary = useSecretarySettings();
  const secSettings = secretary.settings;
  const BRIEFING_MODULES = ['weather', 'today_tasks', 'meetings'];
  const briefingOn = !!secSettings?.modules && BRIEFING_MODULES.some(m => (secSettings.modules as Record<string, unknown>)[m]);
  const toggleBriefing = async () => {
    const cur: Record<string, unknown> = { ...(secSettings?.modules || {}) };
    if (briefingOn) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cur)) if (!BRIEFING_MODULES.includes(k)) next[k] = v;
      await secretary.update({ modules: next as any });
    } else {
      const next: Record<string, unknown> = { ...cur };
      for (const m of BRIEFING_MODULES) if (!next[m]) next[m] = {};
      await secretary.update({ modules: next as any });
    }
  };
  const toggleCalAwareness = async () => { await secretary.update({ calendar_awareness: !secSettings?.calendar_awareness }); };
  const toggleWeekendMute = async () => { await secretary.update({ weekend_mute: !secSettings?.weekend_mute }); };
  const toggleStrictSilence = async () => { await secretary.update({ strict_silence: !secSettings?.strict_silence }); };

  /* ── Sidebar mirror（同 SidebarV2 一致）── */
  /* v6.93: project-centric — Deals 完全移除（設計文件：Deal/Pipeline 唔再顯示） */
  const workspaceItems = [
    { to: '/dashboard',  label: t('nav.dashboard', { defaultValue: 'Dashboard' }), icon: LayoutDashboard },
    { to: '/contacts',   label: t('nav.contacts', { defaultValue: '聯絡人' }), icon: Users },
    { to: '/calendar',   label: t('nav.calendar', { defaultValue: '日曆' }), icon: Calendar },
    { to: '/companies',  label: t('nav.companies', { defaultValue: '公司' }), icon: Building2 },
    { to: '/projects',   label: t('nav.projects', { defaultValue: '項目' }), icon: FolderKanban },
    { to: '/tasks',      label: t('nav.tasks', { defaultValue: '任務' }), icon: CheckSquare },
  ];
  const recordItems = [
    { to: '/touchpoints', label: t('nav.touchpoints', { defaultValue: '聯繫記錄' }), icon: Activity },
    { to: '/namecards',   label: t('nav.namecards', { defaultValue: '名片庫' }), icon: ScanLine },
    { to: '/reports',     label: t('nav.reports', { defaultValue: '報表' }), icon: BarChart3 },
  ];
  const settingsItems = [
    { to: '/team',         label: t('nav.team', { defaultValue: '團隊' }), icon: UsersRound },
    { to: '/ai-apps',      label: t('nav.aiApps', { defaultValue: 'AI Apps' }), icon: Sparkles },
    { to: '/marketplace',  label: t('nav.marketplace', { defaultValue: 'Marketplace' }), icon: Store },
    { to: '/settings',     label: t('nav.settings', { defaultValue: '設定' }), icon: Settings },
  ];

  /* ── Notifications（吸收 top bar bell）── */
  const fetchNotifs = () => {
    apiClient.get<{ items: { id: string; title: string; body?: string; status?: string }[] }>('/api/v1/notifications?page=1&page_size=5')
      .then(d => setNotifications(d?.items || [])).catch(() => {});
    apiClient.get<{ unread_count: number }>('/api/v1/notifications/unread-count')
      .then(d => setUnreadCount(d?.unread_count || 0)).catch(() => {});
  };
  useEffect(() => { fetchNotifs(); }, []);
  useEffect(() => { if (sheet === 'settings') fetchNotifs(); }, [sheet]);

  const path = location.pathname;
  const activeTab: 'workspace' | 'records' | 'settings' | 'none' =
    path.startsWith('/settings') || path.startsWith('/team') || path.startsWith('/ai-apps') || path.startsWith('/marketplace') || path.startsWith('/notifications') ? 'settings'
    : ['/touchpoints', '/namecards', '/reports'].some(p => path.startsWith(p)) ? 'records'
    : ['/dashboard', '/contacts', '/calendar', '/companies', '/projects', '/tasks'].some(p => path.startsWith(p)) ? 'workspace'
    : 'none';

  const toggleTheme = () => {
    const el = document.documentElement;
    const next = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    el.setAttribute('data-theme', next);
    setDark(next === 'dark');
    try { localStorage.setItem(THEME_STORAGE, next); } catch { /* ignore */ }
  };

  const go = (route: string) => { setSheet(null); navigate(route); };
  const isActive = (to: string) => path.startsWith(to);

  return (
    <>
      <nav className="mnav-bar" role="navigation" aria-label="Primary">
        <button type="button" className={`mnav-item ${activeTab === 'workspace' ? 'active' : ''}`} onClick={() => setSheet('workspace')}>
          <SvcIcon name="layout-dashboard" /><span>工作區</span>
        </button>
        <button type="button" className={`mnav-item ${activeTab === 'records' ? 'active' : ''}`} onClick={() => setSheet('record')}>
          <SvcIcon name="file-text" /><span>紀錄</span>
        </button>
        <div className="mnav-center-wrap">
          <button type="button" className="mnav-center-btn" onClick={onOpenAiSearch} aria-label="AI assistant and search">
            <SvcIcon name="sparkles" />
          </button>
          <span>AI &amp; 搜尋</span>
        </div>
        <button type="button" className="mnav-item" onClick={() => setSheet('add')}>
          <SvcIcon name="plus" /><span>新增</span>
        </button>
        <button type="button" className={`mnav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setSheet('settings')}>
          <SvcIcon name="settings" />
          <span>設定</span>
          {unreadCount > 0 && <span className="mnav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
      </nav>

      {/* ── 工作區 sheet（= sidebar 工作區選項）── */}
      {sheet === 'workspace' && (
        <Sheet title="工作區" onClose={() => setSheet(null)}>
          <div className="mnav-section-label">Workspace</div>
          {workspaceItems.map(item => (
            <button key={item.to} type="button" className={`mnav-row ${isActive(item.to) ? 'active' : ''}`} onClick={() => go(item.to)}>
              <span className="mnav-row-icon mnav-row-icon-neutral"><item.icon /></span>
              <span className="txt"><strong>{item.label}</strong></span>
              <SvcIcon name="chevron-right" className="mnav-row-chev" />
            </button>
          ))}
        </Sheet>
      )}

      {/* ── 紀錄 sheet（= sidebar 記錄選項）── */}
      {sheet === 'record' && (
        <Sheet title="紀錄" onClose={() => setSheet(null)}>
          <div className="mnav-section-label">Records</div>
          {recordItems.map(item => (
            <button key={item.to} type="button" className={`mnav-row ${isActive(item.to) ? 'active' : ''}`} onClick={() => go(item.to)}>
              <span className="mnav-row-icon mnav-row-icon-neutral"><item.icon /></span>
              <span className="txt"><strong>{item.label}</strong></span>
              <SvcIcon name="chevron-right" className="mnav-row-chev" />
            </button>
          ))}
        </Sheet>
      )}

      {/* ── 新增 sheet ── */}
      {sheet === 'add' && (
        <Sheet title="Add New" onClose={() => setSheet(null)}>
          <button type="button" className="mnav-scan-banner" onClick={() => { setSheet(null); onScanCard(); }}>
            <span className="mnav-scan-banner-icon"><SvcIcon name="scan-line" /></span>
            <span className="txt"><strong>拍卡片自動入庫</strong><span>用鏡頭掃描名片，AI 自動識別並存為聯絡人</span></span>
            <SvcIcon name="chevron-right" className="chev" />
          </button>
          <div className="mnav-section-label">Quick Create</div>
          <div className="mnav-add-grid">
            {addTiles.map(tile => (
              <button key={tile.id} type="button" className="mnav-add-tile" onClick={() => { setSheet(null); onQuickAdd(tile.id); }}>
                <span className="mnav-add-tile-icon" style={{ background: tile.color }}><tile.icon /></span>
                <span>{tile.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {/* ── 設定 sheet（= sidebar 組織 + top bar：黑白轉/個人/通知）── */}
      {sheet === 'settings' && (
        <Sheet title="設定" onClose={() => setSheet(null)} tall>
          {/* 個人頁面（top bar user menu → profile） */}
          <button type="button" className="mnav-org-profile" onClick={() => go('/settings')} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span className="mnav-org-avatar">{(user?.displayName || user?.email || 'U')[0].toUpperCase()}</span>
            <span style={{ flex: 1 }}>
              <strong>{user?.displayName || user?.email || ''}</strong>
              <span style={{ display: 'block' }}>{user?.email || ''}</span>
            </span>
            <SvcIcon name="chevron-right" className="mnav-row-chev" />
          </button>

          {/* 通知（top bar bell） */}
          <div className="mnav-section-label">通知</div>
          <button type="button" className="mnav-org-row" onClick={() => go('/notifications')}>
            <SvcIcon name="bell" /><span>通知</span>
            {unreadCount > 0 && <span className="mnav-notif-count">{unreadCount} 則新</span>}
            <SvcIcon name="chevron-right" className="chev" />
          </button>
          {notifications.length > 0 && (
            <div className="mnav-notif-list">
              {notifications.slice(0, 3).map(n => (
                <div key={n.id} className={`mnav-notif-item ${n.status === 'UNREAD' ? 'unread' : ''}`}>
                  <div className="mnav-notif-item-title">{n.title}</div>
                  {n.body && <div className="mnav-notif-item-body">{n.body}</div>}
                </div>
              ))}
            </div>
          )}

          {/* 組織（sidebar organization） */}
          <div className="mnav-section-label">Organization</div>
          {settingsItems.map(item => (
            <button key={item.to} type="button" className="mnav-org-row" onClick={() => go(item.to)}>
              <item.icon /><span>{item.label}</span><SvcIcon name="chevron-right" className="chev" />
            </button>
          ))}

          {/* v6.94: AI 管家設定 4 開關 */}
          <div className="mnav-section-label">AI 管家</div>
          <button type="button" className="mnav-org-row" onClick={toggleBriefing}>
            <SvcIcon name="sparkles" /><span>每日 Briefing</span>
            <span className={`mnav-switch ${briefingOn ? 'on' : ''}`} onClick={e => { e.stopPropagation(); toggleBriefing(); }} />
          </button>
          <button type="button" className="mnav-org-row" onClick={toggleCalAwareness}>
            <SvcIcon name="calendar" /><span>行事曆主動提問</span>
            <span className={`mnav-switch ${secSettings?.calendar_awareness ? 'on' : ''}`} onClick={e => { e.stopPropagation(); toggleCalAwareness(); }} />
          </button>
          <button type="button" className="mnav-org-row" onClick={toggleWeekendMute}>
            <SvcIcon name="moon" /><span>週末靜音</span>
            <span className={`mnav-switch ${secSettings?.weekend_mute ? 'on' : ''}`} onClick={e => { e.stopPropagation(); toggleWeekendMute(); }} />
          </button>
          <button type="button" className="mnav-org-row" onClick={toggleStrictSilence}>
            <SvcIcon name="bell" /><span>嚴格靜音</span>
            <span className={`mnav-switch ${secSettings?.strict_silence ? 'on' : ''}`} onClick={e => { e.stopPropagation(); toggleStrictSilence(); }} />
          </button>

          {/* 外觀（top bar 黑白轉） */}
          <div className="mnav-section-label">外觀</div>
          <button type="button" className="mnav-org-row" onClick={toggleTheme}>
            <SvcIcon name="moon" /><span>Dark Mode</span>
            <span className={`mnav-switch ${dark ? 'on' : ''}`} onClick={e => e.stopPropagation()} />
          </button>

          {/* 帳戶 */}
          <div className="mnav-section-label">帳戶</div>
          <button type="button" className="mnav-org-row" onClick={() => { setSheet(null); logout(); }}>
            <SvcIcon name="log-out" /><span style={{ color: 'var(--color-error)' }}>登出</span>
          </button>
        </Sheet>
      )}
    </>
  );
}

const ADD_TILES_BASE = [
  { id: 'project', label: 'Project', icon: FolderKanban, color: 'var(--color-primary)' },
  { id: 'contact', label: 'Contact', icon: Users,        color: 'var(--color-blue)' },
  { id: 'company', label: 'Company', icon: Building2,    color: 'var(--color-warning)' },
  { id: 'task',    label: 'Task',    icon: CheckSquare,  color: 'var(--color-purple)' },
  { id: 'event',   label: 'Event',   icon: Calendar,     color: 'var(--color-success)' },
  { id: 'note',    label: 'Note',    icon: FileText,     color: 'var(--color-gold, #b8901a)' },
];

function Sheet({ title, onClose, children, tall = false }: { title: string; onClose: () => void; children: ReactNode; tall?: boolean }) {
  const [closing, setClosing] = useState(false);

  /* v6.82: lock background scroll while sheet is open (same pattern as
     BottomSheet/ActionPreviewModal — prevents touch scrolling the page
     behind the sheet) */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 200);
  };

  return createPortal(
    <div className={`mnav-sheet-overlay ${closing ? 'closing' : ''}`} onClick={handleClose}>
      <div className={`mnav-sheet ${tall ? 'tall' : ''} ${closing ? 'closing' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="mnav-sheet-handle" />
        <div className="mnav-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="mnav-sheet-close" onClick={handleClose} aria-label="Close"><SvcIcon name="x" /></button>
        </div>
        <div className="mnav-sheet-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
