import { useParams, Link } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { Check, AlertCircle, RefreshCw, CalendarDays, ChevronDown } from 'lucide-react';
import { integrations } from '../data/integrations';
import {
  fetchIntegrations,
  disconnectIntegration,
  fetchGoogleCalendars,
  saveGoogleCalendarSetting,
} from '../lib/integration-api';
import type { IntegrationRecord, GoogleCalendarInfo } from '../lib/integration-api';
import ConnectDialog from '../components/ConnectDialog';

export default function IntegrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const integration = integrations.find(i => i.id === id);

  const [connection, setConnection] = useState<IntegrationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);

  // Google Calendar picker state
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[]>([]);
  const [selectedCal, setSelectedCal] = useState<string>('');
  const [calLoading, setCalLoading] = useState(false);
  const [calSaving, setCalSaving] = useState(false);
  const [calSaved, setCalSaved] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  const isGoogleCal = id === 'google-calendar';

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

  // Load the user's Google calendars once connected
  useEffect(() => {
    if (!isGoogleCal || !connection) return;
    let cancelled = false;
    (async () => {
      setCalLoading(true);
      setCalError(null);
      try {
        const list = await fetchGoogleCalendars();
        if (cancelled) return;
        setCalendars(list);
        const current = (connection.config?.calendar_id as string) || '';
        if (current && list.some(c => c.id === current)) {
          setSelectedCal(current);
        } else {
          const primary = list.find(c => c.primary);
          setSelectedCal(current || primary?.id || (list[0]?.id ?? ''));
        }
      } catch (e: any) {
        if (!cancelled) setCalError(e?.message || 'Failed to load calendars');
      } finally {
        if (!cancelled) setCalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isGoogleCal, connection]);

  const handleCalChange = async (calId: string) => {
    setSelectedCal(calId);
    setCalSaving(true);
    setCalSaved(false);
    setCalError(null);
    const cal = calendars.find(c => c.id === calId);
    try {
      await saveGoogleCalendarSetting(calId, cal?.summary || '');
      setCalSaved(true);
      // update local connection state so the picker stays in sync
      setConnection((prev) => prev ? { ...prev, config: { ...prev.config, calendar_id: calId, calendar_name: cal?.summary || '' } } : prev);
    } catch (e: any) {
      setCalError(e?.message || 'Failed to save selection');
    } finally {
      setCalSaving(false);
    }
  };

  // Listen for OAuth popup completion
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'nexus-oauth-complete') {
        setShowDialog(false);
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

  const isConnected = !!connection;

  const handleDisconnect = async () => {
    if (!connection) return;
    try {
      await disconnectIntegration(connection.id);
      setConnection(null);
    } catch (err) {
      console.error('Disconnect failed', err);
    }
  };

  const handleConnected = () => {
    setShowDialog(false);
    loadConnection();
  };

  const statusColor = isConnected ? '#22c55e' : '#a0aec0';
  const statusText = isConnected ? 'Active' : loading ? 'Checking...' : 'Not connected';
  const lastSync = connection?.last_sync_at
    ? new Date(connection.last_sync_at).toLocaleString()
    : null;

  // Badge for connection method
  const methodLabel = integration.connectionMethod === 'oauth' ? 'One-click OAuth'
    : integration.connectionMethod === 'url' ? 'Paste URL'
    : integration.connectionMethod === 'webhook' ? 'Webhook'
    : 'Coming soon';

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
            <span style={{
              marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: 'var(--color-surface)', border: '1px solid var(--color-divider)',
              verticalAlign: 'middle',
            }}>
              {methodLabel}
            </span>
          </span>
          <div className="mkt-detail-meta">
            <span>{'★'.repeat(integration.popularity)}{'☆'.repeat(5 - integration.popularity)}</span>
            <span>{integration.connectionCount.toLocaleString()} connections</span>
          </div>
        </div>
        <div className="mkt-detail-action">
          {integration.connectionMethod === 'coming' ? (
            <button className="mkt-detail-btn" disabled style={{ opacity: 0.5 }}>
              Coming Soon
            </button>
          ) : isConnected ? (
            <button className="mkt-detail-btn connected" onClick={handleDisconnect}>
              Connected ✓
            </button>
          ) : (
            <button className="mkt-detail-btn connect" onClick={() => setShowDialog(true)}>
              Connect
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

      {/* Google Calendar picker — choose which calendar to sync */}
      {isGoogleCal && isConnected && (
        <div className="mkt-detail-section">
          <h2>Sync calendar</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 14px' }}>
            Choose which Google Calendar to mirror into NEXUS CRM. Events sync within 15 minutes of a change.
          </p>

          {calLoading ? (
            <div className="mkt-detail-status" style={{ color: 'var(--color-text-muted)' }}>
              <RefreshCw size={14} className="spin" style={{ marginRight: 8 }} />
              <span>Loading your calendars…</span>
            </div>
          ) : (
            <>
              <div className="gcal-picker">
                <CalendarDays size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <select
                  className="gcal-select"
                  value={selectedCal}
                  onChange={(e) => handleCalChange(e.target.value)}
                  disabled={calSaving}
                  aria-label="Google Calendar to sync"
                >
                  {calendars.length === 0 && <option value="">No calendars found</option>}
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}{c.primary ? ' (Primary)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} style={{ color: 'var(--color-text-faint)', pointerEvents: 'none', marginLeft: -26 }} />
              </div>

              <div style={{ marginTop: 10, fontSize: 12.5, minHeight: 18 }}>
                {calSaving && <span style={{ color: 'var(--color-text-muted)' }}>Saving…</span>}
                {calSaved && !calSaving && (
                  <span style={{ color: 'var(--color-success)' }}>
                    <Check size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                    Calendar updated — next sync uses this calendar
                  </span>
                )}
                {calError && <span style={{ color: '#ef4444' }}>{calError}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Connect Dialog */}
      {showDialog && (
        <ConnectDialog
          integration={integration}
          onClose={() => setShowDialog(false)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}
