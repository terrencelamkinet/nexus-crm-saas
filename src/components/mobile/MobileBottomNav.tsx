import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid, FileText, Sparkles, Plus, Building2,
  FolderKanban, Users, CheckSquare, Calendar,
  ScanLine, ChevronRight, Check, Search, X, LogOut, Moon,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { useToast } from '../v4/useToast';

/**
 * NEXUS CRM — Mobile Bottom Navigation v3 (AI 管家秘書 theme)
 * 5 tabs: Workspace / Record / ●AI&Search● / Add / Org — ≤768px only (CSS-gated).
 * Sheets are portal-rendered, design-consistent with nexus-mobile-nav.html.
 */

export interface Props {
  onOpenAiSearch: () => void;
  onScanCard: () => void;
  onQuickAdd: (recordType: string) => void;
}

const RECORD_TYPES = [
  { id: 'project',    label: 'Projects',  icon: FolderKanban, color: 'var(--color-primary)' },
  { id: 'contact',    label: 'Contacts',  icon: Users,        color: 'var(--color-blue)' },
  { id: 'company',    label: 'Companies', icon: Building2,    color: 'var(--color-warning)' },
  { id: 'task',       label: 'Tasks',     icon: CheckSquare,  color: 'var(--color-purple)' },
  { id: 'event',      label: 'Schedule / Events', icon: Calendar, color: 'var(--color-success)' },
] as const;

const RECORD_ROUTES: Record<string, string> = {
  project: '/projects', contact: '/contacts', company: '/companies',
  task: '/tasks', event: '/calendar',
};

const ADD_TILES = [
  { id: 'project', label: 'Project', icon: FolderKanban, color: 'var(--color-primary)' },
  { id: 'contact', label: 'Contact', icon: Users,        color: 'var(--color-blue)' },
  { id: 'company', label: 'Company', icon: Building2,    color: 'var(--color-warning)' },
  { id: 'task',    label: 'Task',    icon: CheckSquare,  color: 'var(--color-purple)' },
  { id: 'event',   label: 'Event',   icon: Calendar,     color: 'var(--color-success)' },
];

const AI_TOGGLE_KEYS = [
  { key: 'ai_crud',      label: 'AI 可自動新增/修改資料' },
  { key: 'ai_scan',      label: '鏡頭拍卡片自動識別' },
  { key: 'ai_calendar',  label: 'AI 主動行事曆提問' },
  { key: 'ai_delete_confirm', label: 'AI 刪除操作需二次確認' },
] as const;

const TOGGLE_STORAGE = 'nexus-ai-butler-toggles';
const THEME_STORAGE = 'nexus-theme';

export default function MobileBottomNav({ onOpenAiSearch, onScanCard, onQuickAdd }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const toast = useToast();
  const [sheet, setSheet] = useState<'workspace' | 'record' | 'add' | 'org' | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(TOGGLE_STORAGE) || '{}');
    } catch { return {}; }
  });

  const path = location.pathname;
  const activeTab: 'records' | 'org' | 'none' =
    path.startsWith('/settings') ? 'org'
    : ['/contacts', '/companies', '/projects', '/tasks', '/calendar', '/deals', '/touchpoints', '/namecards'].some(p => path.startsWith(p)) ? 'records'
    : 'none';

  const setToggle = (key: string, val: boolean) => {
    const next = { ...toggles, [key]: val };
    setToggles(next);
    try { localStorage.setItem(TOGGLE_STORAGE, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const toggleTheme = () => {
    const el = document.documentElement;
    const next = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    el.setAttribute('data-theme', next);
    setDark(next === 'dark');
    try { localStorage.setItem(THEME_STORAGE, next); } catch { /* ignore */ }
  };

  const go = (route: string) => { setSheet(null); navigate(route); };

  return (
    <>
      <nav className="mnav-bar" role="navigation" aria-label="Primary">
        <button type="button" className="mnav-item" onClick={() => setSheet('workspace')}>
          <LayoutGrid /><span>工作區</span>
        </button>
        <button type="button" className={`mnav-item ${activeTab === 'records' ? 'active' : ''}`} onClick={() => setSheet('record')}>
          <FileText /><span>紀錄</span>
        </button>
        <div className="mnav-center-wrap">
          <button type="button" className="mnav-center-btn" onClick={onOpenAiSearch} aria-label="AI assistant and search">
            <Sparkles />
          </button>
          <span>AI &amp; 搜尋</span>
        </div>
        <button type="button" className="mnav-item" onClick={() => setSheet('add')}>
          <Plus /><span>新增</span>
        </button>
        <button type="button" className={`mnav-item ${activeTab === 'org' ? 'active' : ''}`} onClick={() => setSheet('org')}>
          <Building2 /><span>組織</span>
        </button>
      </nav>

      {/* ── Workspace sheet ── */}
      {sheet === 'workspace' && (
        <Sheet title="切換 Workspace" onClose={() => setSheet(null)}>
          <div className="mnav-sheet-search"><Search /><input placeholder="搜尋 workspace…" /></div>
          <div className="mnav-section-label">Active</div>
          <button type="button" className="mnav-row">
            <span className="mnav-row-icon" style={{ background: 'var(--color-primary)' }}>TC</span>
            <span className="txt">
              <strong>我的 CRM</strong>
              <span>{user?.email ?? ''}</span>
            </span>
            <Check className="mnav-row-check" />
          </button>
          <div className="mnav-section-label">All Workspaces</div>
          <button
            type="button"
            className="mnav-row"
            onClick={() => toast.showToast('多 Workspace 支援即將推出 — 而家每個 tenant 一個 CRM')}
          >
            <span className="mnav-row-icon" style={{ background: 'var(--color-success)' }}><Plus /></span>
            <span className="txt"><strong>Create workspace</strong><span>New tenant / team</span></span>
          </button>
        </Sheet>
      )}

      {/* ── Record sheet ── */}
      {sheet === 'record' && (
        <Sheet title="Records" onClose={() => setSheet(null)}>
          <div className="mnav-sheet-search"><Search /><input placeholder="搜尋紀錄…" /></div>
          <div className="mnav-section-label">Modules</div>
          {RECORD_TYPES.map(r => (
            <button key={r.id} type="button" className="mnav-row" onClick={() => go(RECORD_ROUTES[r.id])}>
              <span className="mnav-row-icon" style={{ background: r.color }}><r.icon /></span>
              <span className="txt"><strong>{r.label}</strong></span>
              <ChevronRight className="mnav-row-chev" />
            </button>
          ))}
        </Sheet>
      )}

      {/* ── Add sheet ── */}
      {sheet === 'add' && (
        <Sheet title="Add New" onClose={() => setSheet(null)}>
          <button type="button" className="mnav-scan-banner" onClick={() => { setSheet(null); onScanCard(); }}>
            <span className="mnav-scan-banner-icon"><ScanLine /></span>
            <span className="txt"><strong>拍卡片自動入庫</strong><span>用鏡頭掃描名片，AI 自動識別並存為聯絡人</span></span>
            <ChevronRight className="chev" />
          </button>
          <div className="mnav-section-label">Quick Create</div>
          <div className="mnav-add-grid">
            {ADD_TILES.map(tile => (
              <button key={tile.id} type="button" className="mnav-add-tile" onClick={() => { setSheet(null); onQuickAdd(tile.id); }}>
                <span className="mnav-add-tile-icon" style={{ background: tile.color }}><tile.icon /></span>
                <span>{tile.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {/* ── Org sheet ── */}
      {sheet === 'org' && (
        <Sheet title="Organization" onClose={() => setSheet(null)} tall>
          <div className="mnav-org-profile">
            <span className="mnav-org-avatar">{(user?.email?.[0] ?? 'U').toUpperCase()}</span>
            <div>
              <strong>{user?.email ?? ''}</strong>
              <span>NEXUS CRM · 目前 Workspace</span>
            </div>
          </div>
          <div className="mnav-section-label">Organization</div>
          <button type="button" className="mnav-org-row" onClick={() => go('/settings')}>
            <Users /><span>Members &amp; Roles</span><ChevronRight className="chev" />
          </button>
          <button type="button" className="mnav-org-row" onClick={() => go('/settings')}>
            <LayoutGrid /><span>Module Settings</span><ChevronRight className="chev" />
          </button>
          <div className="mnav-section-label">AI 管家設定</div>
          {AI_TOGGLE_KEYS.map(k => (
            <button key={k.key} type="button" className="mnav-org-row" onClick={() => setToggle(k.key, !(toggles[k.key] ?? true))}>
              <Sparkles /><span>{k.label}</span>
              <span className={`mnav-switch ${toggles[k.key] ?? true ? 'on' : ''}`} onClick={e => e.stopPropagation()} />
            </button>
          ))}
          <div className="mnav-section-label">外觀</div>
          <button type="button" className="mnav-org-row" onClick={toggleTheme}>
            <Moon /><span>Dark Mode</span>
            <span className={`mnav-switch ${dark ? 'on' : ''}`} onClick={e => e.stopPropagation()} />
          </button>
          <div className="mnav-section-label">帳戶</div>
          <button type="button" className="mnav-org-row" onClick={() => { setSheet(null); logout(); }}>
            <LogOut /><span style={{ color: 'var(--color-error)' }}>Sign Out</span>
          </button>
        </Sheet>
      )}
    </>
  );
}

function Sheet({ title, onClose, children, tall = false }: { title: string; onClose: () => void; children: ReactNode; tall?: boolean }) {
  const [closing, setClosing] = useState(false);

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
          <button type="button" className="mnav-sheet-close" onClick={handleClose} aria-label="Close"><X /></button>
        </div>
        <div className="mnav-sheet-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
