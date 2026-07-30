import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, PackageOpen } from 'lucide-react';
import { integrations, integrationTypes } from '../data/integrations';

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('All');

  const filtered = useMemo(() => {
    return integrations.filter(i => {
      const matchSearch =
        !search ||
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        i.shortDesc.toLowerCase().includes(search.toLowerCase());
      const matchType = activeType === 'All' || i.type === activeType;
      return matchSearch && matchType;
    });
  }, [search, activeType]);

  const renderStars = (n: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < n ? 'filled' : ''}>
        ★
      </span>
    ));
  };

  return (
    <div className="mkt-page">
      {/* Search bar */}
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

      {/* Category filters */}
      <div className="mkt-filters">
        <button
          className={`mkt-filter${activeType === 'All' ? ' active' : ''}`}
          onClick={() => setActiveType('All')}
        >
          All
        </button>
        {integrationTypes.map(type => (
          <button
            key={type}
            className={`mkt-filter${activeType === type ? ' active' : ''}`}
            onClick={() => setActiveType(type)}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="mkt-empty">
          <PackageOpen />
          <p>No integrations found</p>
        </div>
      ) : (
        <div className="mkt-grid">
          {filtered.map(integration => (
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
                <div
                  className="mkt-card-icon"
                  style={{ background: integration.color }}
                >
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
                <button
                  className={`mkt-card-btn ${integration.isConnected ? 'connected' : 'connect'}`}
                  onClick={e => {
                    e.stopPropagation();
                    // future: trigger OAuth flow
                  }}
                >
                  {integration.isConnected ? 'Connected' : 'Connect'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
