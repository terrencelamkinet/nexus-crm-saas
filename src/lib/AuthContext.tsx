/**
 * NEXUS CRM Auth Context
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

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = getStoredAuth();
    if (stored && isAuthenticated()) {
      setUser({ email: stored.email });
    }
    setLoading(false);
  }, []);

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
    setMfaEmail('');
    return 'success';
  }, []);

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
    setMfaEmail('');
  }, [mfaEmail]);

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
