/**
 * Penguin CRM Auth Context
 * 
 * Provides login, logout, and user state across the app.
 * Token storage + refresh handled by api.ts.
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  login as apiLogin,
  sendMfa,
  verifyMfa as apiVerifyMfa,
  storeAuth,
  clearAuth,
  getStoredAuth,
  isAuthenticated,
} from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  email: string;
  displayName?: string;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<'mfa' | 'success'>;
  verifyMfa: (otp: string) => Promise<void>;
  logout: () => void;
  sendMfaCode: () => Promise<void>;
  mfaEmail: string;
}

const AuthContext = createContext<AuthState | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaEmail, setMfaEmail] = useState('');

  // Fetch real user profile (display_name) from backend — AuthContext only
  // stores email on login; /auth/me returns display_name + verified flags.
  const fetchMe = useCallback(async (): Promise<{ email: string; displayName?: string } | null> => {
    try {
      const auth = getStoredAuth();
      if (!auth?.access_token) return null;
      const res = await fetch('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${auth.access_token}` },
      });
      if (!res.ok) return null;
      const me = await res.json();
      return { email: me.email, displayName: me.display_name || undefined };
    } catch {
      return null;
    }
  }, []);

  const applyMe = useCallback((me: { email: string; displayName?: string } | null, fallbackEmail?: string) => {
    if (me) setUser(me);
    else if (fallbackEmail) setUser({ email: fallbackEmail });
  }, []);

  // Restore session from localStorage on mount — then refresh real identity
  useEffect(() => {
    const stored = getStoredAuth();
    if (stored && isAuthenticated()) {
      setUser({ email: stored.email });
      fetchMe().then((me) => applyMe(me, stored.email));
    }
    setLoading(false);
  }, [fetchMe, applyMe]);

  const login = useCallback(async (email: string, password: string): Promise<'mfa' | 'success'> => {
    const res = await apiLogin(email, password);

    if (res.mfa_required) {
      setMfaEmail(email);
      await sendMfa(email);
      return 'mfa';
    }

    // Trust device — store both access + refresh tokens
    storeAuth(res.access_token, email, res.refresh_token);
    setUser({ email });
    fetchMe().then((me) => applyMe(me, email));
    setMfaEmail('');
    return 'success';
  }, [fetchMe, applyMe]);

  const sendMfaCode = useCallback(async () => {
    if (mfaEmail) {
      await sendMfa(mfaEmail);
    }
  }, [mfaEmail]);

  const verifyMfa = useCallback(async (otp: string) => {
    if (!mfaEmail) throw new Error('No MFA session');
    const res = await apiVerifyMfa(mfaEmail, otp);
    storeAuth(res.access_token, mfaEmail, res.refresh_token);
    setUser({ email: mfaEmail });
    fetchMe().then((me) => applyMe(me, mfaEmail));
    setMfaEmail('');
  }, [mfaEmail, fetchMe, applyMe]);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
    setMfaEmail('');
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, logout, sendMfaCode, mfaEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
