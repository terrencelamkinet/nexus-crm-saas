import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Users, CreditCard, Puzzle, Monitor, ChevronRight } from 'lucide-react'
import { apiClient } from '../lib/api'
import LanguageSwitcher from '../i18n/LanguageSwitcher';

const tabs = [
  { id: 'profile', label: 'Profile', icon: Users },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'modules', label: 'Modules', icon: Puzzle },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'preferences', label: 'Preferences', icon: Monitor },
]

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate()
  const [active, setActive] = useState('profile')
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done'>('idle')

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

          {active === 'billing' && (
            <div className="stg-panel">
              <h2>{t('settings.tabs.billing')}</h2>
              <p className="stg-subtitle stg-coming">Coming soon</p>
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
