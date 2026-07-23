import { useState } from 'react'
import { Users, Settings, CreditCard, Puzzle, Monitor, X, ChevronRight, ArrowUpDown, Plus, Download, Search, Trash2, Edit3, MoreHorizontal } from 'lucide-react'
import { apiClient } from '../lib/api'

const tabs = [
  { id: 'profile', label: 'Profile', icon: Users },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'modules', label: 'Modules', icon: Puzzle },
  { id: 'integrations', label: 'Integrations', icon: Puzzle },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'preferences', label: 'Preferences', icon: Monitor },
]

export default function SettingsPage() {
  const [active, setActive] = useState('profile')
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const moduleDefs = [
    { key: 'foundation', label: 'Foundation CRM', icon: '🧱', desc: 'Companies, Contacts, Touchpoints, Tasks, Notes, NameCards — core CRM (Module A).', alwaysOn: true },
    { key: 'projects', label: 'Projects', icon: '📊', desc: 'Project-based tracking, budgets, milestones. Links to contacts and companies (Module D).' },
    { key: 'sales', label: 'Sales', icon: '💰', desc: 'Deal pipeline, stages, sales reports, quotes. Links from Contacts (Module C).' },
    { key: 'inventory', label: 'Inventory', icon: '📦', desc: 'Inventory, stock levels, product catalog.' },
    { key: 'scheduling', label: 'Scheduling', icon: '📅', desc: 'Calendar sync, appointment scheduling.' },
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

  useState(() => { loadModules() })

  const toggleDraft = (key: string) => {
    setDraft(p => ({ ...p, [key]: !p[key] }))
  }

  const saveModules = async () => {
    setSaving(true)
    try {
      for (const key of Object.keys(draft)) {
        if (modules[key] !== draft[key]) {
          await apiClient.put(`/api/v1/crm/module-settings/${key}`, { module_key: key, enabled: draft[key] })
        }
      }
      setModules({ ...draft })
    } catch (e: any) { alert(e.detail || e.message) }
    finally { setSaving(false) }
  }

  const cancelChanges = () => setDraft({ ...modules })

  return (
    <div>
      <div className="breadcrumb">
        <span>Home</span>
        <ChevronRight />
        <span className="breadcrumb-current">Settings</span>
      </div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-layout">
        <div className="settings-tabs">
          {tabs.map(tab => (
            <button key={tab.id}
              className={`settings-tab${active === tab.id ? ' active' : ''}`}
              onClick={() => setActive(tab.id)}>
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-content">
          {active === 'profile' && (
            <div className="settings-panel">
              <h2>Profile</h2>
              <div className="profile-avatar-section">
                <div className="avatar-lg">TL</div>
                <button className="btn-ghost">Change avatar</button>
              </div>
              <div className="profile-fields">
                <div className="field-row">
                  <label>Name</label>
                  <input type="text" value="Terrence Lam" readOnly className="input-field" />
                </div>
                <div className="field-row">
                  <label>Email</label>
                  <input type="email" value="terrence@kinetix.com" readOnly className="input-field" />
                </div>
                <div className="field-row">
                  <label>Phone</label>
                  <input type="text" value="+852 9553 5371" readOnly className="input-field" />
                </div>
                <div className="field-row">
                  <label>Timezone</label>
                  <select className="input-field">
                    <option>Asia/Hong_Kong (UTC+8)</option>
                  </select>
                </div>
              </div>
              <button className="btn-primary">Save Changes</button>
            </div>
          )}

          {active === 'team' && (
            <div className="settings-panel">
              <h2>Team Members</h2>
              <div className="team-list">
                {[
                  { name: 'Terrence Lam', email: 'terrence@k.com', role: 'Admin' },
                  { name: 'Mary Chan', email: 'mary@k.com', role: 'Member' },
                ].map((m, i) => (
                  <div key={i} className="team-row">
                    <div className="team-avatar">{m.name.split(' ').map(n => n[0]).join('')}</div>
                    <div className="team-info">
                      <p className="team-name">{m.name}</p>
                      <p className="team-email">{m.email}</p>
                    </div>
                    <span className="role-badge">{m.role}</span>
                  </div>
                ))}
              </div>
              <button className="btn-secondary"><Users className="w-4 h-4" /> Invite Member</button>
            </div>
          )}

          {active === 'modules' && (
            <div className="settings-panel">
              <h2>Module Settings</h2>
              <p className="settings-subtitle">Enable or disable CRM modules. Disabling a module hides its navigation and pages.</p>
              {loading ? (
                <div className="loading-text">Loading module settings...</div>
              ) : (
                <div className="module-list">
                  {moduleDefs.map(def => (
                    <div key={def.key} className={`module-row${def.alwaysOn ? ' always-on' : ''}`}
                      onClick={() => !def.alwaysOn && toggleDraft(def.key)}>
                      <div className="module-icon">{def.icon}</div>
                      <div className="module-info">
                        <p className="module-name">{def.label}</p>
                        <p className="module-desc">{def.desc}</p>
                      </div>
                      {def.alwaysOn ? (
                        <span className="always-on-badge">Always on</span>
                      ) : (
                        <div className={`toggle-switch${draft[def.key] !== false ? ' on' : ''}`}
                          onClick={() => toggleDraft(def.key)}>
                          <div className="toggle-knob" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="settings-actions">
                <button className="btn-secondary" onClick={cancelChanges}>Cancel</button>
                <button className="btn-primary" onClick={saveModules} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {active === 'integrations' && (
            <div className="settings-panel">
              <h2>Integrations</h2>
              <p className="settings-subtitle coming-soon">Coming soon</p>
            </div>
          )}

          {active === 'billing' && (
            <div className="settings-panel">
              <h2>Billing</h2>
              <p className="settings-subtitle coming-soon">Coming soon</p>
            </div>
          )}

          {active === 'preferences' && (
            <div className="settings-panel">
              <h2>Preferences</h2>
              <p className="settings-subtitle coming-soon">Coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
