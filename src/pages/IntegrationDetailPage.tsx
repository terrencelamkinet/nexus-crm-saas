import { useParams, Link } from 'react-router-dom';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Check, AlertCircle, RefreshCw } from 'lucide-react';
import { integrations } from '../data/integrations';
import { fetchIntegrations, startOAuth, disconnectIntegration } from '../lib/integration-api';
import type { IntegrationRecord } from '../lib/integration-api';

export default function IntegrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const integration = integrations.find(i => i.id === id);

  const [connection, setConnection] = useState<IntegrationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const loadConnection = useCallback(async () => {
    if (!id) return;
    try {
      const list = await fetchIntegrations();
      const providerKey = id.replace('-', '_');
      const found = list.find(c => c.provider === providerKey);
      setConnection(found || null);
    } catch { /* no connections */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadConnection(); }, [loadConnection]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'nexus-oauth-complete') {
        setActionLoading(null);
        loadConnection();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [loadConnection]);

  if (!integration) {
    return (
      <div className="mkt-detail">
        <div className="mkt-empty">
          <p>Integration not found</p>
          <Link to="/marketplace" style={{ color: 'var(--color-primary)', fontSize: 14 }}>
            ← Back to Marketplace
          </Link>
        </div>
      </div>
    );
  }

  const providerKey = integration.id.replace('-', '_');
  const isConnected = !!connection;

  const handleConnect = async () => {
    if (actionLoading) return;
    setActionLoading('connect');
    try {
      const res = await startOAuth(providerKey);
      if (res.oauth_url) {
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
      setActionLoading(null);
    }
  };

  const handleDisconnect = async () => {
    if (!connection) return;
    setActionLoading('disconnect');
    try {
      await disconnectIntegration(connection.id);
      setConnection(null);
    } catch (err) {
      console.error('Disconnect failed', err);
    }
    setActionLoading(null);
  };

  const statusColor = isConnected ? '#22c55e' : loading ? '#a0aec0' : '#a0aec0';
  const statusText = isConnected
    ? 'Active'
    : loading ? 'Checking...' : 'Not connected';
  const lastSync = connection?.last_sync_at
    ? new Date(connection.last_sync_at).toLocaleString()
    : null;

  return (
    <div className="mkt-detail">
      <div className="mkt-detail-breadcrumb">
        <Link to="/marketplace">Marketplace</Link>
        <span>›</span>
        <span>{integration.type}</span>
        <span>›</span>
        <span>{integration.name}</span>
      </div>

      <div className="mkt-detail-header">
        <div className="mkt-detail-icon" style={{ background: integration.color }}>
          {integration.icon}
        </div>
        <div className="mkt-detail-title">
          <h1>{integration.name}</h1>
          <span className="mkt-card-type" style={{ display: 'inline-block' }}>
            {integration.typeIcon} {integration.type}
          </span>
          <div className="mkt-detail-meta">
            <span>{'★'.repeat(integration.popularity)}{'☆'.repeat(5 - integration.popularity)}</span>
            <span>{integration.connectionCount.toLocaleString()} connections</span>
          </div>
        </div>
        <div className="mkt-detail-action">
          {isConnected ? (
            <button
              className="mkt-detail-btn connected"
              onClick={handleDisconnect}
              disabled={actionLoading === 'disconnect'}
            >
              {actionLoading === 'disconnect' ? 'Disconnecting...' : 'Connected ✓'}
            </button>
          ) : (
            <button
              className="mkt-detail-btn connect"
              onClick={handleConnect}
              disabled={!!actionLoading}
            >
              {actionLoading === 'connect' ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      <div className="mkt-detail-section">
        <h2>About this integration</h2>
        <p>{integration.longDesc}</p>
      </div>

      <div className="mkt-detail-section">
        <h2>How it works</h2>
        <p>{integration.howItWorks}</p>
      </div>

      <div className="mkt-detail-section">
        <h2>Key features</h2>
        <div className="mkt-detail-features">
          {integration.features.map((feat, i) => (
            <div key={i} className="mkt-detail-feat">
              <Check />
              <span>{feat}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mkt-detail-section">
        <h2>Connection status</h2>
        <div className="mkt-detail-status">
          <span className="dot" style={{ background: statusColor }} />
          <span>
            {statusText}
            {isConnected && (
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                — {integration.name} is connected to your account
              </span>
            )}
          </span>
        </div>
        {lastSync && (
          <div className="mkt-detail-status" style={{ marginTop: 8 }}>
            <RefreshCw size={14} style={{ marginRight: 8, color: 'var(--color-text-muted)' }} />
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Last synced: {lastSync}
            </span>
          </div>
        )}
        {connection?.status === 'error' && (
          <div className="mkt-detail-status" style={{ color: '#ef4444', marginTop: 8 }}>
            <AlertCircle size={14} style={{ marginRight: 8 }} />
            <span>Connection error — re-connect or check provider status</span>
          </div>
        )}
      </div>
    </div>
  );
}
