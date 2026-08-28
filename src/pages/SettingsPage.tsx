import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import SvcIcon from '../components/SvcIcon'
import { CreditCard, Monitor, Puzzle, Users } from 'lucide-react'
import { apiClient } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
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
  const { user } = useAuth()
  const [active, setActive] = useState('profile')
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done'>('idle')

  // ── Notification preferences ──
  const notifDefs = [
    { key: 'task', icon: '📋', label: 'Task', desc: '被指派任務、今日到期、任務完成通知' },
    { key: 'project', icon: '📁', label: 'Project', desc: '被指派項目、項目 deadline 提醒' },
    { key: 'calendar', icon: '📅', label: 'Calendar', desc: '日程改期、30 分鐘前提醒' },
    { key: 'ai', icon: '🤖', label: 'AI', desc: 'AI 執行完成、AI 洞察通知' },
    { key: 'system', icon: '⚙️', label: 'System', desc: '系統層面通知' },
  ]
  const [notifMuted, setNotifMuted] = useState<Record<string, boolean>>({})
  const [notifDraft, setNotifDraft] = useState<Record<string, boolean>>({})
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifSaveState, setNotifSaveState] = useState<'idle' | 'saving' | 'done'>('idle')

  const loadNotifPrefs = async () => {
    try {
      const list = await apiClient.get('/api/v1/notification-preferences')
      const muted: Record<string, boolean> = {}
      ;(list || []).forEach((p: any) => { muted[p.module_key] = !!p.is_muted })
      setNotifMuted(muted)
      setNotifDraft({})
    } catch {}
    finally { setNotifLoading(false) }
  }

  const saveNotifPrefs = async () => {
    setNotifSaveState('saving')
    try {
      const changed = Object.keys(notifDraft)
        .filter(key => !!notifDraft[key] !== !!notifMuted[key])
        .map(key => ({ module_key: key, is_muted: !!notifDraft[key] }))
      if (changed.length > 0) {
        await apiClient.put('/api/v1/notification-preferences', changed)
      }
      setNotifMuted(p => ({ ...p, ...notifDraft }))
      setNotifDraft({})
      setNotifSaveState('done')
      setTimeout(() => setNotifSaveState('idle'), 2000)
    } catch {
      setNotifSaveState('idle')
    }
  }

  const moduleDefs = [
    { key: 'projects', label: 'Projects', icon: '📊', desc: 'Project-based tracking, budgets, milestones. Links to contacts and companies.' },
    { key: 'shipping', label: 'Shipping', icon: '🚢', desc: 'Shipment tracking, dispatch orders, delivery management.' },
    { key: 'ai_assistant', label: 'AI Assistant', icon: '🤖', desc: 'AI daily briefing, smart widget suggestions, and chat assistant on dashboard.' },
    // NOTE: 'sales' (Deals) is intentionally omitted from Settings so it can't be
    // re-enabled from the UI — temporarily hidden (see backend HIDDEN_MODULES).
    // To re-open later, re-add the entry below and remove 'sales' from the
    // backend HIDDEN_MODULES set.
    // { key: 'sales', label: 'Sales', icon: '💰', desc: 'Deal pipeline, stages, sales reports, quotes. Links from Contacts.' },
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
  useEffect(() => { loadNotifPrefs() }, [])

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
        <SvcIcon name="chevron-right" />
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
                <div className="avatar-lg">{(user?.displayName || user?.email || '?').split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()}</div>
                <button className="btn-ghost">Change avatar</button>
              </div>
              <div className="stg-fields">
                <div className="stg-field-row">
                  <label>{t('settings.profile.name')}</label>
                  <input type="text" value={user?.displayName || ''} readOnly className="input-field" placeholder={t('settings.profile.namePlaceholder', { defaultValue: '未設定名稱' })} />
                </div>
                <div className="stg-field-row">
                  <label>{t('settings.profile.email')}</label>
                  <input type="email" value={user?.email || ''} readOnly className="input-field" />
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
                  { name: user?.displayName || user?.email?.split('@')[0] || 'You', email: user?.email || '', role: 'Admin' },
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
              <button className="btn-secondary"><SvcIcon name="users" className="w-4 h-4" /> Invite Member</button>
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
              <h2><SvcIcon name="bell" className="w-4 h-4" style={{ verticalAlign: -3, marginRight: 6 }} />{t('settings.notifPreference', { defaultValue: '通知偏好' })}</h2>
              <p className="stg-subtitle">{t('settings.notifPreferenceDesc', { defaultValue: '選擇每個模組嘅網內通知開關。關閉後該模組嘅通知唔會再彈出。' })}</p>
              {notifLoading ? (
                <div className="stg-loading">{t('settings.loading')}</div>
              ) : (
                <div className="stg-module-list">
                  {notifDefs.map(def => (
                    <div key={def.key} className="stg-module-row"
                      onClick={() => setNotifDraft(p => ({ ...p, [def.key]: !(p[def.key] ?? notifMuted[def.key]) }))}>
                      <div className="stg-module-icon">{def.icon}</div>
                      <div className="stg-module-info">
                        <p className="stg-module-name">{def.label}</p>
                        <p className="stg-module-desc">{def.desc}</p>
                      </div>
                      <div className={`stg-toggle${!(notifDraft[def.key] ?? notifMuted[def.key]) ? ' on' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setNotifDraft(p => ({ ...p, [def.key]: !(p[def.key] ?? notifMuted[def.key]) })); }}>
                          <div className="stg-toggle-knob" />
                        </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="stg-actions">
                <button className="btn-secondary" onClick={() => setNotifDraft({})}>Cancel</button>
                <button className={`btn-primary${notifSaveState === 'saving' ? ' btn-saving' : ''}${notifSaveState === 'done' ? ' btn-done' : ''}`}
                  onClick={saveNotifPrefs} disabled={notifSaveState !== 'idle'}>
                  {notifSaveState === 'idle' && 'Save Changes'}
                  {notifSaveState === 'saving' && <span className="btn-spinner" />}
                  {notifSaveState === 'done' && <span className="btn-check">✓</span>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
