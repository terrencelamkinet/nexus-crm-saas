import { Bell, ChevronDown, LogOut, Search, Moon, Sun } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api';

export default function Header() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Mobile sidebar toggle
  useEffect(() => {
    const shell = document.getElementById('appShell');
    if (shell) {
      shell.classList.toggle('mobile-open', mobileOpen);
    }
  }, [mobileOpen]);

  // Sync with scrim close from Layout
  useEffect(() => {
    const handler = () => setMobileOpen(false);
    window.addEventListener('close-mobile-menu', handler);
    return () => window.removeEventListener('close-mobile-menu', handler);
  }, []);

  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('nexus-theme');
    if (saved) return saved === 'dark';
    return document.documentElement.getAttribute('data-theme') === 'dark';
  });

  useEffect(() => {
    const theme = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nexus-theme', theme);
  }, [dark]);

  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifList, setNotifList] = useState<any[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchNotifs = async () => {
    try {
      const { unread_count } = await apiClient.get('/api/v1/notifications/unread-count');
      setUnreadCount(unread_count);
      if (notifOpen) {
        const { items } = await apiClient.get('/api/v1/notifications?page_size=5');
        setNotifList(items || []);
      }
    } catch {}
  };

  useEffect(() => { fetchNotifs(); const t = setInterval(fetchNotifs, 15000); return () => clearInterval(t); }, [notifOpen]);
  useEffect(() => { if (notifOpen) fetchNotifs(); }, [notifOpen]);

  const handleNotifClick = async (n: any) => {
    try { await apiClient.patch(`/api/v1/notifications/${n.id}/read`); } catch {}
    if (n.action_url) navigate(n.action_url);
    setNotifOpen(false);
  };

  const initials = user?.email
    ? user.email.split('@')[0].split('.').map(s => s[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  const displayName = user?.email?.split('@')[0].replace('.', ' ') || 'User';

  return (
    <header className="topbar">
      {/* Hamburger — mobile only */}
      <button className="topbar-hamburger icon-btn" onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar">
        <div className={`ham-icon${mobileOpen ? ' open' : ''}`}>
          <span></span><span></span><span></span>
        </div>
      </button>
      <div className="topbar-search">
        <Search />
        <input type="text" placeholder="Search contacts, companies, deals..." />
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" onClick={() => setDark(!dark)} title={dark ? 'Light mode' : 'Dark mode'}>
          {dark ? <Sun /> : <Moon />}
        </button>
        <div className="relative" ref={notifRef}>
          <button className="icon-btn" onClick={() => setNotifOpen(!notifOpen)}>
            <Bell />
            {unreadCount > 0 && <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          {notifOpen && (
            <div className="notif-dropdown">
              <div className="notif-head">
                <span>Notifications</span>
                <button className="text-xs" style={{color:'var(--color-primary)',fontWeight:600,background:'none',border:'none',cursor:'pointer'}}
                  onClick={async () => { try{await apiClient.post('/api/v1/notifications/read-all');setUnreadCount(0);setNotifList([])}catch{} }}>
                  Mark all read
                </button>
              </div>
              {notifList.length === 0 ? (
                <div className="notif-empty">No notifications</div>
              ) : notifList.map((n: any) => (
                <div key={n.id} className={`notif-item${n.status === 'UNREAD' ? ' unread' : ''}`}
                  onClick={() => handleNotifClick(n)}>
                  <div className="notif-title">{n.title}</div>
                  {n.body && <div className="notif-body">{n.body}</div>}
                  <div className="notif-meta">
                    <span className={`notif-priority ${n.priority?.toLowerCase()}`}>{n.priority}</span>
                    {n.source_module && <span>{n.source_module}</span>}
                    <span>{n.created_at ? new Date(n.created_at).toLocaleTimeString('zh-HK',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
                  </div>
                </div>
              ))}
              <div className="notif-foot" onClick={() => { navigate('/notifications'); setNotifOpen(false); }}>
                View all notifications →
              </div>
            </div>
          )}
        </div>
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-offset transition-colors">
            <div className="avatar-sm !w-8 !h-8 !text-sm">{initials}</div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium leading-tight capitalize" style={{color:'var(--color-text)'}}>{displayName}</p>
              <p className="text-xs leading-tight" style={{color:'var(--color-text-muted)'}}>{user?.email || ''}</p>
            </div>
            <ChevronDown className="w-4 h-4" style={{color:'var(--color-text-faint)'}} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg py-1 z-50" style={{boxShadow:'var(--shadow-lg)'}}>
              <div className="px-4 py-2 border-b border-divider">
                <p className="text-sm font-medium capitalize" style={{color:'var(--color-text)'}}>{displayName}</p>
                <p className="text-xs" style={{color:'var(--color-text-muted)'}}>{user?.email}</p>
              </div>
              <button onClick={() => { logout(); window.location.href = '/sign-in'; }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                style={{color:'var(--color-notification)'}}>
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
