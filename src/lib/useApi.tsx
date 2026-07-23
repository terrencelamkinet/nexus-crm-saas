/**
 * Shared data-fetching hook for NEXUS CRM
 * Uses useEffect + useState — no extra dependencies.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, ApiError } from './api';

// ---------------------------------------------------------------------------
// Generic fetch hook
// ---------------------------------------------------------------------------

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useApi<T = any>(
  path: string | null,
  deps: any[] = [],
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetch_ = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<T>(path);
      if (mountedRef.current) setData(res);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof ApiError ? e.detail || e.message : String(e));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [path, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    fetch_();
    return () => { mountedRef.current = false; };
  }, [fetch_]);

  return { data, loading, error, refresh: fetch_ };
}

// ---------------------------------------------------------------------------
// Search hook — debounced, returns API-friendly query string
// ---------------------------------------------------------------------------

export function useSearch(delay = 300) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query), delay);
    return () => clearTimeout(timer.current);
  }, [query, delay]);

  return { query, setQuery, debounced, searchParams: debounced ? `?search=${encodeURIComponent(debounced)}` : '' };
}

// ---------------------------------------------------------------------------
// Pagination hook
// ---------------------------------------------------------------------------

export function usePagination() {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const nextPage = () => setPage(p => p + 1);
  const prevPage = () => setPage(p => Math.max(1, p - 1));
  const reset = () => setPage(1);
  return { page, setPage, pageSize, offset, nextPage, prevPage, reset };
}

// ---------------------------------------------------------------------------
// Create modal state
// ---------------------------------------------------------------------------

export function useCreateModal() {
  const [open, setOpen] = useState(false);
  const openModal = () => setOpen(true);
  const closeModal = () => setOpen(false);
  return { open, openModal, closeModal };
}

// ---------------------------------------------------------------------------
// Loading Skeleton component
// ---------------------------------------------------------------------------

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse">
      <table className="w-full">
        <thead>
          <tr className="text-xs text-slate-500 uppercase bg-slate-50">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="text-left px-4 py-3"><div className="h-3 bg-slate-200 rounded w-16" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-t border-slate-100">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-3/4" /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="h-36 bg-slate-100" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-slate-200 rounded w-2/3" />
            <div className="h-3 bg-slate-100 rounded w-1/2" />
            <div className="h-3 bg-slate-100 rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-6 text-center">
      <div className="inline-flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
        <span className="text-red-600 text-sm">{message}</span>
        {onRetry && (
          <button onClick={onRetry} className="text-sm font-medium text-red-700 hover:text-red-800 underline ml-2">
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
