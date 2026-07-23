import { Bell, ChevronDown, LogOut, Search, Menu, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useState, useRef, useEffect } from 'react';

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

  const initials = user?.email
    ? user.email.split('@')[0].split('.').map(s => s[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  const displayName = user?.email?.split('@')[0].replace('.', ' ') || 'User';

  return (
    <header className="topbar">
      {/* Hamburger — mobile only */}
      <button className="topbar-hamburger icon-btn" onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar">
        {mobileOpen ? <X /> : <Menu />}
      </button>
      <div className="topbar-search">
        <Search />
        <input type="text" placeholder="Search contacts, companies, deals..." />
      </div>
      <div className="topbar-actions">
        <button className="icon-btn">
          <Bell />
          <span className="dot"></span>
        </button>
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
