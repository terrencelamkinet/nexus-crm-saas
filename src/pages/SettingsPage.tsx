import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, CreditCard, Puzzle, Monitor, ChevronRight } from 'lucide-react'
import { apiClient } from '../lib/api'
import LanguageSwitcher from '../i18n/LanguageSwitcher';

const tabs = [
  { id: 'profile', label: 'Profile', icon: Users },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'modules', label: 'Modules', icon: Puzzle },
  { id: 'integrations', label: 'Integrations', icon: Puzzle },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'ai', label: 'AI Settings', icon: Monitor },
  { id: 'preferences', label: 'Preferences', icon: Monitor },
]

const providerModels: Record<string, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-pro'],
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const [active, setActive] = useState('profile')
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done'>('idle')

  // AI settings state
  const [aiProvider, setAiProvider] = useState('deepseek')
  const [aiModel, setAiModel] = useState('deepseek-chat')
  const [temperature, setTemperature] = useState(0.7)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [aiSaveState, setAiSaveState] = useState<'idle' | 'saving' | 'done'>('idle')

  const moduleDefs = [
    { key: 'projects', label: 'Projects', icon: '📊', desc: 'Project-based tracking, budgets, milestones. Links to contacts and companies.' },
    { key: 'sales', label: 'Sales', icon: '💰', desc: 'Deal pipeline, stages, sales reports, quotes. Links from Contacts.' },
    { key: 'shipping', label: 'Shipping', icon: '🚢', desc: 'Shipment tracking, dispatch orders, delivery management.' },
    { key: 'ai_assistant', label: 'AI Assistant', icon: '🤖', desc: 'AI daily briefing, smart widget suggestions, and chat assistant on dashboard.' },
  ]

  const loadModules = async () => {
    try {
      const list = await apiClient.get('/api/v1/crm/module-settings')
      const map: Record<string, boolean> = {}
      ;(list || []).forEach((m: any) => { map[m.module_key] = m.enabled })
      setModules(map)
      setDraft({ ...map })
      // Load AI settings if present
      const aiCfg = (list || []).find((m: any) => m.module_key === 'ai')
      if (aiCfg?.settings) {
        if (aiCfg.settings.provider) setAiProvider(aiCfg.settings.provider)
        if (aiCfg.settings.model) setAiModel(aiCfg.settings.model)
        if (aiCfg.settings.temperature !== undefined) setTemperature(aiCfg.settings.temperature)
        if (aiCfg.settings.api_key) setApiKey('••••••••')
      }
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { loadModules() }, [])

  const toggleDraft = (key: string) => {
    setDraft(p => ({ ...p, [key]: !p[key] }))
  }

  const saveModules = async () => {
    setSaveState('saving')
    try {
      for (const key of Object.keys(draft)) {
        if (modules[key] !== draft[key]) {
          await apiClient.put(`/api/v1/crm/module-settings/${key}`, { module_key: key, enabled: draft[key] })
        }
      }
      setModules({ ...draft })
      window.dispatchEvent(new CustomEvent('modules-changed'))
      setSaveState('done')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (e: any) {
      alert(e.detail || e.message)
      setSaveState('idle')
    }
  }

  const cancelChanges = () => setDraft({ ...modules })

  const handleProviderChange = (provider: string) => {
    setAiProvider(provider)
    const models = providerModels[provider]
    if (models) setAiModel(models[0])
  }

  const saveAiSettings = async () => {
    setAiSaveState('saving')
    try {
      await apiClient.put('/api/v1/crm/module-settings/ai', {
        module_key: 'ai',
        enabled: true,
        settings: { provider: aiProvider, model: aiModel, temperature, api_key: apiKey ? 'stored' : '' },
      })
      setAiSaveState('done')
      setTimeout(() => setAiSaveState('idle'), 2000)
    } catch (e: any) {
      alert(e.detail || e.message)
      setAiSaveState('idle')
    }
  }

  return (
    <div className="stg-page">
      <div className="breadcrumb">
        <span className="breadcrumb-link" onClick={() => navigate('/dashboard')}>Home</span>
        <ChevronRight />
        <span className="breadcrumb-current">Settings</span>
      </div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="stg-layout">
        <div className="stg-tabs">
          {tabs.map(tab => (
            <button key={tab.id}
              className={`stg-tab${active === tab.id ? ' active' : ''}`}
              onClick={() => setActive(tab.id)}>
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="stg-content">
          {active === 'profile' && (
            <div className="stg-panel">
              <h2>Profile</h2>
              <div className="stg-avatar-section">
                <div className="avatar-lg">TL</div>
                <button className="btn-ghost">Change avatar</button>
              </div>
              <div className="stg-fields">
                <div className="stg-field-row">
                  <label>Name</label>
                  <input type="text" value="Terrence Lam" readOnly className="input-field" />
                </div>
                <div className="stg-field-row">
                  <label>Email</label>
                  <input type="email" value="terrence@kinetix.com" readOnly className="input-field" />
                </div>
                <div className="stg-field-row">
                  <label>Phone</label>
                  <input type="text" value="+852 9553 5371" readOnly className="input-field" />
                </div>
                <div className="stg-field-row">
                  <label>Timezone</label>
                  <select className="input-field">
                    <option>Asia/Hong_Kong (UTC+8)</option>
                  </select>
                </div>
                <div className="stg-field-row">
                  <label>Language</label>
                  <LanguageSwitcher />
                </div>
              </div>
              <button className="btn-primary">Save Changes</button>
            </div>
          )}

          {active === 'team' && (
            <div className="stg-panel">
              <h2>Team Members</h2>
              <div className="stg-team-list">
                {[
                  { name: 'Terrence Lam', email: 'terrence@k.com', role: 'Admin' },
                  { name: 'Mary Chan', email: 'mary@k.com', role: 'Member' },
                ].map((m, i) => (
                  <div key={i} className="stg-team-row">
                    <div className="stg-team-avatar">{m.name.split(' ').map(n => n[0]).join('')}</div>
                    <div className="stg-team-info">
                      <p className="stg-team-name">{m.name}</p>
                      <p className="stg-team-email">{m.email}</p>
                    </div>
                    <span className="stg-role-badge">{m.role}</span>
                  </div>
                ))}
              </div>
              <button className="btn-secondary"><Users className="w-4 h-4" /> Invite Member</button>
            </div>
          )}

          {active === 'modules' && (
            <div className="stg-panel">
              <h2>Module Settings</h2>
              <p className="stg-subtitle">Enable or disable CRM modules. Disabling a module hides its navigation and pages.</p>
              {loading ? (
                <div className="stg-loading">Loading module settings...</div>
              ) : (
                <div className="stg-module-list">
                  {moduleDefs.map(def => (
                    <div key={def.key} className="stg-module-row"
                      onClick={() => toggleDraft(def.key)}>
                      <div className="stg-module-icon">{def.icon}</div>
                      <div className="stg-module-info">
                        <p className="stg-module-name">{def.label}</p>
                        <p className="stg-module-desc">{def.desc}</p>
                      </div>
                      <div className={`stg-toggle${draft[def.key] !== false ? ' on' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleDraft(def.key); }}>
                          <div className="stg-toggle-knob" />
                        </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="stg-actions">
                <button className="btn-secondary" onClick={cancelChanges}>Cancel</button>
                <button className={`btn-primary${saveState === 'saving' ? ' btn-saving' : ''}${saveState === 'done' ? ' btn-done' : ''}`}
                  onClick={saveModules} disabled={saveState !== 'idle'}>
                  {saveState === 'idle' && 'Save Changes'}
                  {saveState === 'saving' && <span className="btn-spinner" />}
                  {saveState === 'done' && <span className="btn-check">✓</span>}
                </button>
              </div>
            </div>
          )}

          {active === 'integrations' && (
            <div className="stg-panel">
              <h2>Integrations</h2>
              <p className="stg-subtitle stg-coming">Coming soon</p>
            </div>
          )}

          {active === 'billing' && (
            <div className="stg-panel">
              <h2>Billing</h2>
              <p className="stg-subtitle stg-coming">Coming soon</p>
            </div>
          )}

          {active === 'ai' && (
            <div className="stg-panel">
              <h2>AI Settings</h2>
              <p className="stg-subtitle">Configure AI provider, model, and API settings for the AI assistant features.</p>
              <div className="stg-fields">
                <div className="stg-field-row">
                  <label>AI Provider</label>
                  <select className="input-field" value={aiProvider}
                    onChange={e => handleProviderChange(e.target.value)}>
                    <option value="deepseek">DeepSeek</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </div>
                <div className="stg-field-row">
                  <label>Model</label>
                  <select className="input-field" value={aiModel}
                    onChange={e => setAiModel(e.target.value)}>
                    {providerModels[aiProvider]?.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="stg-field-row">
                  <label>Temperature</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <input type="range" min="0" max="2" step="0.1" value={temperature}
                      onChange={e => setTemperature(parseFloat(e.target.value))}
                      style={{ flex: 1 }} />
                    <span style={{ fontSize: 14, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>{temperature.toFixed(1)}</span>
                  </div>
                </div>
                <div className="stg-field-row">
                  <label>API Key</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <input type={showKey ? 'text' : 'password'} className="input-field"
                      placeholder="Enter your API key..." value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      style={{ flex: 1 }} />
                    <button className="btn-ghost" onClick={() => setShowKey(!showKey)}
                      style={{ padding: '6px 10px', fontSize: 12 }}>
                      {showKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="stg-actions">
                <button className={`btn-primary${aiSaveState === 'saving' ? ' btn-saving' : ''}${aiSaveState === 'done' ? ' btn-done' : ''}`}
                  onClick={saveAiSettings} disabled={aiSaveState !== 'idle'}>
                  {aiSaveState === 'idle' && 'Save AI Settings'}
                  {aiSaveState === 'saving' && <span className="btn-spinner" />}
                  {aiSaveState === 'done' && <span className="btn-check">✓</span>}
                </button>
              </div>
            </div>
          )}

          {active === 'preferences' && (
            <div className="stg-panel">
              <h2>Preferences</h2>
              <p className="stg-subtitle stg-coming">Coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
