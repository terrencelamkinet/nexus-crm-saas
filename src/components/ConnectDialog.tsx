import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import type { Integration } from '../data/integrations';

interface Props {
  integration: Integration;
  onClose: () => void;
  onConnected: () => void;
}

export default function ConnectDialog({ integration, onClose, onConnected }: Props) {
  const [url, setUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  // Generate a fake webhook URL for webhook-based integrations
  const webhookUrl = `${window.location.origin}/api/v1/webhooks/${integration.id}/${Date.now().toString(36)}`;

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  };

  const handleConnect = async () => {
    if (!url.trim()) {
      setError('Please paste your connection URL or key');
      return;
    }
    setConnecting(true);
    setError('');

    try {
      const authRaw = localStorage.getItem('nexus_crm_auth');
      if (!authRaw) { setError('Not signed in'); setConnecting(false); return; }
      const auth = JSON.parse(authRaw);
      const token = auth.access_token;

      const res = await fetch('/api/v1/integrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider: integration.id.replace('-', '_'),
          provider_display: integration.name,
          status: 'active',
          config: { connection_url: url.trim() },
          metadata_: { connected_at: new Date().toISOString() },
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.detail || 'Connection failed');
      }

      onConnected();
    } catch (err: any) {
      setError(err?.message || 'Failed to connect');
    }
    setConnecting(false);
  };

  const handleOAuthConnect = () => {
    // OAuth popup flow — opens Google/Microsoft login
    fetch('/api/v1/integrations/oauth/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JSON.parse(localStorage.getItem('nexus_crm_auth') || '{}').access_token}`,
      },
      body: JSON.stringify({ provider: integration.id.replace('-', '_'), origin: window.location.origin }),
    }).then(r => r.json()).then(data => {
      if (data.oauth_url) {
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        window.open(data.oauth_url, 'nexus-oauth', `width=${w},height=${h},left=${left},top=${top},popup=1`);
        window.addEventListener('message', function handler(e) {
          if (e.data?.type === 'nexus-oauth-complete') {
            window.removeEventListener('message', handler);
            onConnected();
          }
        });
      }
    }).catch(err => setError(err?.message || 'Failed to start OAuth'));
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        {/* Header */}
        <div className="dialog-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="mkt-card-icon" style={{ background: integration.color, width: 36, height: 36, fontSize: 14 }}>
              {integration.icon}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Connect {integration.name}</h3>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{integration.typeIcon} {integration.type}</span>
            </div>
          </div>
          <button className="dialog-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="dialog-body" style={{ padding: '20px 24px' }}>
          {integration.connectionMethod === 'coming' && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <p style={{ fontSize: 16, margin: '0 0 8px' }}>🚧 Coming Soon</p>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
                {integration.name} integration is under development. We'll notify you when it's ready.
              </p>
            </div>
          )}

          {integration.connectionMethod === 'webhook' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 16px' }}>
                Use this webhook URL in {integration.name} to send data to NEXUS:
              </p>
              <div className="mkt-url-row">
                <code className="mkt-url-display">{webhookUrl}</code>
                <button className="mkt-copy-btn" onClick={() => handleCopy(webhookUrl)}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.5 }}>
                {integration.howItWorks}
              </p>
            </>
          )}

          {integration.connectionMethod === 'url' && (
            <>
              <div className="mkt-steps">
                {integration.connectSteps?.map((step, i) => (
                  <div key={i} className="mkt-step">
                    <span className="mkt-step-num">{i + 1}</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Paste your connection URL or key</label>
                <input
                  className="mkt-url-input"
                  type="text"
                  placeholder={integration.connectPlaceholder || 'Paste URL here...'}
                  value={url}
                  onChange={e => { setUrl(e.target.value); setError(''); }}
                  autoFocus
                />
              </div>
              {error && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{error}</p>}
            </>
          )}

          {integration.connectionMethod === 'oauth' && (
            <div style={{ textAlign: 'center', padding: 12 }}>
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                Click Connect to authorize NEXUS via {integration.name}
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                {integration.howItWorks}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="dialog-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px' }}>
          <button className="mkt-card-btn" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border-color)' }}>
            Cancel
          </button>
          {integration.connectionMethod === 'url' && (
            <button className="mkt-card-btn connect" onClick={handleConnect} disabled={connecting}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
          {integration.connectionMethod === 'oauth' && (
            <button className="mkt-card-btn connect" onClick={handleOAuthConnect}>
              Authorize with {integration.name}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
