import { useParams, Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { integrations } from '../data/integrations';

export default function IntegrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const integration = integrations.find(i => i.id === id);

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

  return (
    <div className="mkt-detail">
      {/* Breadcrumb */}
      <div className="mkt-detail-breadcrumb">
        <Link to="/marketplace">Marketplace</Link>
        <span>›</span>
        <span>{integration.type}</span>
        <span>›</span>
        <span>{integration.name}</span>
      </div>

      {/* Header */}
      <div className="mkt-detail-header">
        <div
          className="mkt-detail-icon"
          style={{ background: integration.color }}
        >
          {integration.icon}
        </div>
        <div className="mkt-detail-title">
          <h1>{integration.name}</h1>
          <span className="mkt-card-type" style={{ display: 'inline-block' }}>
            {integration.typeIcon} {integration.type}
          </span>
          <div className="mkt-detail-meta">
            <span>
              {'★'.repeat(integration.popularity)}{'☆'.repeat(5 - integration.popularity)}
            </span>
            <span>{integration.connectionCount.toLocaleString()} connections</span>
          </div>
        </div>
        <div className="mkt-detail-action">
          <button
            className={`mkt-detail-btn ${integration.isConnected ? 'connected' : 'connect'}`}
            onClick={() => {
              // future: trigger OAuth flow
            }}
          >
            {integration.isConnected ? 'Connected ✓' : 'Connect'}
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="mkt-detail-section">
        <h2>About this integration</h2>
        <p>{integration.longDesc}</p>
      </div>

      {/* How it works */}
      <div className="mkt-detail-section">
        <h2>How it works</h2>
        <p>{integration.howItWorks}</p>
      </div>

      {/* Features */}
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

      {/* Status */}
      <div className="mkt-detail-section">
        <h2>Connection status</h2>
        <div className="mkt-detail-status">
          <span className={`dot ${integration.isConnected ? 'green' : 'gray'}`} />
          {integration.isConnected
            ? 'Connected — configuration options coming soon'
            : 'Not connected — click the Connect button above to get started'}
        </div>
      </div>
    </div>
  );
}
