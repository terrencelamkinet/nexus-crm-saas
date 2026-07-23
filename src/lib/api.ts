/**
 * NEXUS CRM API Client
 * 
 * Fetch wrapper with JWT auto-attach, token refresh on 401,
 * and typed response helpers.
 */

const API_BASE = ''; // Same-origin via Vite proxy (/api/* → :8001)

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export interface StoredAuth {
  access_token: string;
  refresh_token: string;
  email: string;
  expires: number;        // access_token expiry (epoch ms)
  refresh_expires: number; // refresh_token expiry (epoch ms)
}

const AUTH_KEY = 'nexus_crm_auth';

export function getStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function storeAuth(
  token: string,
  email: string,
  refreshToken: string = '',
): void {
  const expires = Date.now() + 1439 * 60 * 1000; // ~24h minus 1min buffer
  const refreshExpires = Date.now() + 22 * 60 * 60 * 1000; // ~22h (1d refresh - 2h buffer, unchanged)
  const existing = getStoredAuth();
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      access_token: token,
      refresh_token: refreshToken || existing?.refresh_token || '',
      email,
      expires,
      refresh_expires: refreshExpires,
    }),
  );
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function isAuthenticated(): boolean {
  const auth = getStoredAuth();
  if (!auth || !auth.access_token) return false;
  // Check both access_token AND refresh_token viability
  if (Date.now() < auth.expires) return true; // access_token still valid
  if (auth.refresh_token && Date.now() < auth.refresh_expires) return true; // can refresh
  return false;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

let refreshing: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const auth = getStoredAuth();
  if (!auth?.refresh_token) return false;
  if (Date.now() >= auth.refresh_expires) return false;

  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refresh_token }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    // Update stored tokens — keep same refresh_token unless a new one is returned
    storeAuth(body.access_token, auth.email, body.refresh_token || auth.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API Error
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, body: any) {
    super(body?.detail || body?.message || `HTTP ${status}`);
    this.status = status;
    this.detail = body?.detail || '';
  }
}

// ---------------------------------------------------------------------------
// Generic fetch
// ---------------------------------------------------------------------------

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // PRE-EMPTIVE REFRESH: if token expires within 2 minutes, refresh early
  // This prevents the "bunch of parallel calls all hit expiry" scenario
  const preAuth = getStoredAuth();
  if (preAuth?.refresh_token && preAuth.expires && Date.now() >= preAuth.expires - 120_000) {
    if (!refreshing) {
      refreshing = refreshAccessToken().finally(() => { refreshing = null; });
    }
    await refreshing;
  }

  const doFetch = async (): Promise<{ res: Response; body: any }> => {
    const auth = getStoredAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (auth?.access_token) {
      headers['Authorization'] = `Bearer ${auth.access_token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const body = res.status === 204 ? undefined : await res.json().catch(() => ({}));
    return { res, body };
  };

  let { res, body } = await doFetch();

  // On 401, try refreshing the token once (deduplicates concurrent attempts)
  if (res.status === 401) {
    if (!refreshing) {
      refreshing = refreshAccessToken().finally(() => { refreshing = null; });
    }
    const refreshed = await refreshing;

    if (refreshed) {
      // Retry the original request with the new token
      ({ res, body } = await doFetch());
    }
  }

  // If still 401 after refresh attempt (or refresh failed), redirect to sign-in
  if (res.status === 401) {
    clearAuth();
    const currentPath = window.location.pathname;
    if (!currentPath.startsWith('/sign-in')) {
      window.location.href = '/sign-in';
    }
    throw new ApiError(401, { detail: 'Unauthorized' });
  }

  // No content (204)
  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Convenience methods
// ---------------------------------------------------------------------------

export const apiClient = {
  get: <T = any>(path: string) => api<T>(path),
  post: <T = any>(path: string, data?: any) =>
    api<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T = any>(path: string, data: any) =>
    api<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  patch: <T = any>(path: string, data: any) =>
    api<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T = any>(path: string) =>
    api<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Auth-specific endpoints (no token required, or custom handling)
// ---------------------------------------------------------------------------

export interface LoginResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  mfa_required: boolean;
  email: string;
  device_token: string | null;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export async function sendMfa(email: string): Promise<void> {
  await api('/api/v1/auth/send-mfa', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function verifyMfa(email: string, otp_code: string): Promise<LoginResponse> {
  return api<LoginResponse>('/api/v1/auth/verify-mfa', {
    method: 'POST',
    body: JSON.stringify({ email, otp_code }),
  });
}
