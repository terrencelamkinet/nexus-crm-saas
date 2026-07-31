import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Users, CreditCard, Puzzle, Monitor, ChevronRight, Calendar } from 'lucide-react'
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
  const { t } = useTranslation();
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

  // IM Push (通知與整合) state
  const [imChannels, setImChannels] = useState<Record<string, any>>({})
  const [imSaving, setImSaving] = useState(false)
  const [imSaved, setImSaved] = useState(false)
  const [imTestState, setImTestState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  const loadImPrefs = async () => {
    try {
      const res = await apiClient.get<{ channels: Record<string, any> }>('/api/v1/im-push/prefs')
      if (res?.channels) setImChannels(res.channels)
    } catch { /* non-fatal */ }
  }
  useEffect(() => { loadImPrefs() }, [])

  const saveImPrefs = async (channel: string) => {
    setImSaving(true)
    try {
      await apiClient.put('/api/v1/im-push/prefs', imChannels[channel])
      setImSaved(true)
      setTimeout(() => setImSaved(false), 1600)
    } catch { /* surface via button state */ }
    setImSaving(false)
  }

  const testImPush = async (channel: string) => {
    setImTestState('sending')
    try {
      await apiClient.post('/api/v1/im-push/test', { channel })
      setImTestState('done')
      setTimeout(() => setImTestState('idle'), 2200)
    } catch {
      setImTestState('error')
      setTimeout(() => setImTestState('idle'), 3200)
    }
  }

  // Integration state
  const [integrations] = useState<Record<string, boolean>>({
    google: false,
    outlook: false,
    caldav: false,
  })

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
        <span className="breadcrumb-current">{t('settings.title')}</span>
      </div>
      <div className="page-header">
        <h1>{t('settings.title')}</h1>
      </div>

      <div className="stg-layout">
        <div className="stg-tabs">
          {tabs.map(tab => (
            <button key={tab.id}
              className={`stg-tab${active === tab.id ? ' active' : ''}`}
              onClick={() => setActive(tab.id)}>
              <tab.icon className="w-4 h-4" />
              {t('settings.tabs.' + tab.id)}
            </button>
          ))}
        </div>

        <div className="stg-content">
          {active === 'profile' && (
            <div className="stg-panel">
              <h2>{t('settings.tabs.profile')}</h2>
              <div className="stg-avatar-section">
                <div className="avatar-lg">TL</div>
                <button className="btn-ghost">Change avatar</button>
              </div>
              <div className="stg-fields">
                <div className="stg-field-row">
                  <label>{t('settings.profile.name')}</label>
                  <input type="text" value="Terrence Lam" readOnly className="input-field" />
                </div>
                <div className="stg-field-row">
                  <label>{t('settings.profile.email')}</label>
                  <input type="email" value="terrence@kinetix.com" readOnly className="input-field" />
                </div>
                <div className="stg-field-row">
                  <label>{t('settings.profile.phone')}</label>
                  <input type="text" value="+852 9553 5371" readOnly className="input-field" />
                </div>
                <div className="stg-field-row">
                  <label>{t('settings.profile.timezone')}</label>
                  <select className="input-field">
                    <option>Asia/Hong_Kong (UTC+8)</option>
                  </select>
                </div>
                <div className="stg-field-row">
                  <label>{t('settings.profile.language')}</label>
                  <LanguageSwitcher />
                </div>
              </div>
              <button className="btn-primary">{t('settings.profile.save')}</button>
            </div>
          )}

          {active === 'team' && (
            <div className="stg-panel">
              <h2>{t('settings.tabs.team')}</h2>
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
              <h2>{t('settings.tabs.modules')}</h2>
              <p className="stg-subtitle">Enable or disable CRM modules. Disabling a module hides its navigation and pages.</p>
              {loading ? (
                <div className="stg-loading">{t('settings.loading')}</div>
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
            <div className="integ-page">
              <div>
                <h2>Integrations</h2>
                <p className="stg-subtitle">Connect your external services</p>
              </div>

              <div className="integ-section">
                <h3><Calendar className="w-4 h-4" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} /> Calendar</h3>
                <div className="integ-grid">
                  {[
                    { id: 'google', name: 'Google Calendar', desc: 'Sync events, meetings, and reminders with Google Calendar', icon: 'G', color: '#2870b8' },
                    { id: 'outlook', name: 'Microsoft Outlook', desc: 'Sync events and meetings with Microsoft 365 / Outlook Calendar', icon: 'O', color: '#2870b8' },
                    { id: 'caldav', name: 'CalDAV / iCal', desc: 'Connect any CalDAV-compatible calendar (Apple, Nextcloud, etc.)', icon: 'C', color: '#387a3a' },
                  ].map(p => (
                    <div key={p.id} className="integ-card">
                      <div className="integ-icon" style={{ background: p.color }}>{p.icon}</div>
                      <div className="integ-info">
                        <h4>{p.name}</h4>
                        <p>{p.desc}</p>
                      </div>
                      <div className="integ-status">
                        <span className={`integ-badge ${integrations[p.id] ? 'connected' : 'disconnected'}`}>
                          {integrations[p.id] ? 'Connected' : 'Not connected'}
                        </span>
                        <button className={p.id === 'caldav' ? 'btn-secondary' : 'btn-primary'}>
                          {p.id === 'caldav' ? 'Configure' : 'Connect'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="integ-section">
                <h3>More coming soon</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Additional integrations are in development. Stay tuned!</p>
              </div>
            </div>
          )}

          {active === 'billing' && (
            <div className="stg-panel">
              <h2>{t('settings.tabs.billing')}</h2>
              <p className="stg-subtitle stg-coming">Coming soon</p>
            </div>
          )}

          {active === 'ai' && (
            <div className="stg-panel">
              <h2>{t('settings.tabs.ai')}</h2>
              <p className="stg-subtitle">Configure AI provider, model, and API settings for the AI assistant features.</p>
              <div className="stg-fields">
                <div className="stg-field-row">
                  <label>{t('settings.tabs.ai')}</label>
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

              {/* ── 通知與整合 — AI 每日簡報推送 ── */}
              <div style={{ marginTop: 28, borderTop: '1px solid var(--color-divider)', paddingTop: 22 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 700, color: 'var(--color-text)' }}>
                  📲 通知與整合
                </h3>
                <p className="stg-subtitle" style={{ marginBottom: 14 }}>
                  允許 AI 透過 WhatsApp / Telegram 發送每日簡報（☀️ 早晨 / ☕ 午間 / 🌙 傍晚）
                </p>

                {Object.keys(imChannels).length === 0 && (
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-faint)', padding: '10px 0' }}>
                    尚未綁定任何通訊軟件 — 去 Marketplace 連接 WhatsApp / Telegram 後會自動啟用推送
                  </div>
                )}

                {Object.entries(imChannels).map(([ch, pref]: [string, any]) => (
                  <div key={ch} style={{
                    border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)',
                    padding: '14px 16px', marginBottom: 12, background: 'var(--color-surface)',
                  }}>
                    {/* Header row: channel name + global toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)' }}>
                        {ch === 'whatsapp' ? '💬 WhatsApp' : '✈️ Telegram'}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: pref.enabled ? '#34d399' : 'var(--color-text-faint)' }}>
                        {pref.enabled ? '已啟用' : '已關閉'}
                      </span>
                      <span style={{ marginLeft: 'auto' }} />
                      <button
                        className={`switcher${pref.enabled ? ' on' : ''}`}
                        onClick={() => setImChannels({ ...imChannels, [ch]: { ...pref, enabled: !pref.enabled } })}
                        aria-label={`${ch} 推送開關`}
                        style={{
                          width: 34, height: 19, borderRadius: 10, border: 'none', cursor: 'pointer',
                          position: 'relative', background: pref.enabled ? 'var(--color-purple, #7c3aed)' : 'var(--color-border)',
                          transition: 'background .15s',
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 2, left: pref.enabled ? 18 : 2, width: 15, height: 15,
                          borderRadius: '50%', background: '#fff', transition: 'left .15s',
                        }} />
                      </button>
                    </div>

                    {/* Slot checkboxes */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {(['morning', 'noon', 'evening'] as const).map(s => (
                        <label
                          key={s}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, cursor: 'pointer',
                            padding: '5px 12px', borderRadius: 999,
                            background: pref.slots?.[s] ? 'rgba(124,93,250,0.12)' : 'var(--color-surface-offset)',
                            color: pref.slots?.[s] ? '#7c3aed' : 'var(--color-text-muted)', fontWeight: 600,
                            transition: 'background 150ms, color 150ms',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!pref.slots?.[s]}
                            onChange={() => setImChannels({
                              ...imChannels,
                              [ch]: { ...pref, slots: { ...pref.slots, [s]: !pref.slots?.[s] } },
                            })}
                            style={{ display: 'none' }}
                          />
                          {s === 'morning' ? '☀️ 早晨' : s === 'noon' ? '☕ 午間' : '🌙 傍晚'}
                        </label>
                      ))}
                    </div>

                    {/* Weekend mute */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12.5, cursor: 'pointer', color: 'var(--color-text)' }}>
                      <input
                        type="checkbox"
                        checked={!!pref.weekend_mute}
                        onChange={() => setImChannels({ ...imChannels, [ch]: { ...pref, weekend_mute: !pref.weekend_mute } })}
                        style={{ accentColor: 'var(--color-primary)' }}
                      />
                      週末不推送（預設開啟）
                    </label>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                      <button
                        onClick={() => saveImPrefs(ch)}
                        disabled={imSaving}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 'var(--radius-md)',
                          background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer',
                          opacity: imSaving ? 0.6 : 1,
                        }}
                      >
                        💾 儲存
                      </button>
                      <button
                        onClick={() => testImPush(ch)}
                        disabled={imTestState === 'sending'}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 'var(--radius-md)',
                          background: 'var(--color-surface-offset)', color: 'var(--color-text)',
                          border: '1px solid var(--color-divider)', cursor: 'pointer',
                          opacity: imTestState === 'sending' ? 0.6 : 1,
                        }}
                      >
                        {imTestState === 'sending' ? '發送中…' : '📨 測試推送'}
                      </button>
                      {imSaved && <span style={{ fontSize: 12, fontWeight: 600, color: '#34d399' }}>✓ 已儲存</span>}
                      {imTestState === 'done' && <span style={{ fontSize: 12, fontWeight: 600, color: '#34d399' }}>✓ 已發送</span>}
                      {imTestState === 'error' && <span style={{ fontSize: 12, fontWeight: 600, color: '#f87171' }}>⚠️ 發送失敗（檢查 WhatsApp 連接 / token）</span>}
                    </div>
                  </div>
                ))}
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
