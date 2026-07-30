import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, PackageOpen } from 'lucide-react';
import { integrations, integrationTypes } from '../data/integrations';
import { fetchIntegrations, startOAuth, disconnectIntegration } from '../lib/integration-api';
import type { IntegrationRecord } from '../lib/integration-api';

type ConnectionMap = Record<string, IntegrationRecord>;

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('All');
  const [connections, setConnections] = useState<ConnectionMap>({});
  const [loading, setLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  // Fetch user's connected integrations
  const load = useCallback(async () => {
    try {
      const list = await fetchIntegrations();
      const map: ConnectionMap = {};
      list.forEach(c => { map[c.provider] = c; });
      setConnections(map);
    } catch { /* not logged in / no integrations yet */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Listen for OAuth popup messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'nexus-oauth-complete') {
        setConnectingProvider(null);
        load(); // refresh integrations list
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [load]);

  const filtered = useMemo(() => {
    return integrations
      .filter(i => {
        const matchSearch =
          !search ||
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          i.shortDesc.toLowerCase().includes(search.toLowerCase());
        const matchType = activeType === 'All' || i.type === activeType;
        return matchSearch && matchType;
      })
      .map(i => ({
        ...i,
        isConnected: !!connections[i.id.replace('-', '_')] || !!connections[i.id],
        _connection: connections[i.id.replace('-', '_')] || connections[i.id],
      }));
  }, [search, activeType, connections]);

  const renderStars = (n: number) =>
    Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < n ? 'filled' : ''}>★</span>
    ));

  const handleConnect = async (e: React.MouseEvent, providerKey: string) => {
    e.stopPropagation();
    if (connectingProvider) return; // prevent double-click
    setConnectingProvider(providerKey);

    try {
      const res = await startOAuth(providerKey);
      if (res.oauth_url) {
        // Open popup — user only needs to login on provider side
        const w = 600;
        const h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        popupRef.current = window.open(
          res.oauth_url,
          'nexus-oauth',
          `width=${w},height=${h},left=${left},top=${top},popup=1`,
        );
      }
    } catch (err) {
      console.error('OAuth start failed', err);
      setConnectingProvider(null);
    }
  };

  const handleDisconnect = async (e: React.MouseEvent, providerKey: string) => {
    e.stopPropagation();
    const record = connections[providerKey];
    if (!record) return;
    try {
      await disconnectIntegration(record.id);
      setConnections(prev => {
        const next = { ...prev };
        delete next[providerKey];
        return next;
      });
    } catch (err) {
      console.error('Disconnect failed', err);
    }
  };

  return (
    <div className="mkt-page">
      <div className="mkt-search-wrap">
        <div className="mkt-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search integrations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className="mkt-filters">
        <button
          className={`mkt-filter${activeType === 'All' ? ' active' : ''}`}
          onClick={() => setActiveType('All')}
        >All</button>
        {integrationTypes.map(type => (
          <button
            key={type}
            className={`mkt-filter${activeType === type ? ' active' : ''}`}
            onClick={() => setActiveType(type)}
          >{type}</button>
        ))}
      </div>

      {loading ? (
        <div className="mkt-empty"><p>Loading integrations...</p></div>
      ) : filtered.length === 0 ? (
        <div className="mkt-empty">
          <PackageOpen />
          <p>No integrations found</p>
        </div>
      ) : (
        <div className="mkt-grid">
          {filtered.map(integration => {
            const providerKey = integration.id.replace('-', '_');
            const isConnected = integration.isConnected;
            const isConnecting = connectingProvider === providerKey;
            return (
              <div
                key={integration.id}
                className="mkt-card"
                onClick={() => navigate(`/marketplace/${integration.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter') navigate(`/marketplace/${integration.id}`);
                }}
              >
                <div className="mkt-card-top">
                  <div className="mkt-card-icon" style={{ background: integration.color }}>
                    {integration.icon}
                  </div>
                  <div className="mkt-card-info">
                    <div className="mkt-card-name">
                      {integration.name}
                      <span className="mkt-card-type">{integration.type}</span>
                    </div>
                    <div className="mkt-card-desc">{integration.shortDesc}</div>
                  </div>
                </div>
                <div className="mkt-card-bottom">
                  <div className="mkt-stars">
                    {renderStars(integration.popularity)}
                    <span>({integration.connectionCount.toLocaleString()})</span>
                  </div>
                  {isConnected ? (
                    <button
                      className="mkt-card-btn connected"
                      onClick={e => handleDisconnect(e, providerKey)}
                    >Connected ✓</button>
                  ) : (
                    <button
                      className="mkt-card-btn connect"
                      onClick={e => handleConnect(e, providerKey)}
                      disabled={!!connectingProvider}
                    >{isConnecting ? 'Connecting...' : 'Connect'}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
