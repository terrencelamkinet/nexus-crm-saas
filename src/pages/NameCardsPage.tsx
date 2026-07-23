import { ScanLine, CheckCircle } from 'lucide-react';
import { useApi, CardSkeleton, ErrorBox } from '../lib/useApi';

interface NameCard {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  created_at: string;
}

interface NameCardListResponse {
  items: NameCard[];
  total: number;
}

export default function NameCardsPage() {
  const { data, loading, error, refresh } = useApi<NameCardListResponse>('/api/v1/crm/name-cards?page=1&page_size=50');

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="main-content">
      <div className="page-header">
        <div>
          <h1>NameCard Scanner</h1>
          <p>{total} cards scanned</p>
        </div>
      </div>

      {loading ? (
        <CardSkeleton count={3} />
      ) : error ? (
        <ErrorBox message={error} onRetry={refresh} />
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm" style={{color:'var(--color-text-faint)'}}>No name cards yet</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((card) => (
            <div key={card.id} className="panel">
              <div className="h-36 flex items-center justify-center"
                   style={{background:'var(--color-surface-dynamic)'}}>
                <ScanLine className="w-12 h-12" style={{color:'var(--color-text-faint)'}} />
              </div>
              <div className="p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="list-title">{card.name}</p>
                  <CheckCircle className="w-4 h-4" style={{color:'var(--color-success)'}} />
                </div>
                <p className="list-sub">{card.title || '—'}</p>
                <p className="text-xs font-medium" style={{color:'var(--color-primary)'}}>{card.company || '—'}</p>
                <p className="list-sub">{card.phone || '—'}</p>
                <p className="list-sub">{card.email || '—'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
