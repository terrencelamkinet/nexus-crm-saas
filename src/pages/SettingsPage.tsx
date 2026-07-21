import { User, Users, Link, CreditCard, Bell } from 'lucide-react';
import { useState } from 'react';

const tabs = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'integrations', label: 'Integrations', icon: Link },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'preferences', label: 'Preferences', icon: Bell },
];

export default function SettingsPage() {
  const [active, setActive] = useState('profile');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Settings</h1>
      <div className="flex gap-6">
        <div className="w-52 flex-shrink-0 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                active === tab.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-6">
          {active === 'profile' && (
            <div className="space-y-5 max-w-lg">
              <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl font-bold">TL</div>
                <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">Change avatar</button>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Name</label>
                <input type="text" value="Terrence Lam" className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Email</label>
                <input type="email" value="terrence@kinetix.com" className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Phone</label>
                <input type="text" value="+852 9553 5371" className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Timezone</label>
                <select className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                  <option>Asia/Hong_Kong (UTC+8)</option>
                </select>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Save Changes</button>
            </div>
          )}
          {active === 'team' && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Team Members</h2>
              <div className="space-y-2">
                {[
                  { name: 'Terrence Lam', email: 'terrence@k.com', role: 'Admin' },
                  { name: 'Mary Chan', email: 'mary@k.com', role: 'Member' },
                ].map((m, i) => (
                  <div key={i} className="flex items-center justify-between py-3 px-4 rounded-lg bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-medium">
                        {m.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{m.name}</p>
                        <p className="text-xs text-slate-500">{m.email}</p>
                      </div>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">{m.role}</span>
                  </div>
                ))}
              </div>
              <button className="mt-4 px-4 py-2 border border-slate-200 text-sm font-medium rounded-lg hover:bg-slate-50 flex items-center gap-2">
                <Users className="w-4 h-4" /> Invite Member
              </button>
            </div>
          )}
          {active === 'integrations' && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Integrations</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-lg">📅</div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">Google Calendar</p>
                      <p className="text-xs text-emerald-600 font-medium">✓ Connected</p>
                    </div>
                  </div>
                  <button className="text-sm text-slate-500 hover:text-red-600">Disconnect</button>
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg">📄</div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">Notion CRM</p>
                      <p className="text-xs text-slate-500">○ Not connected</p>
                    </div>
                  </div>
                  <button className="text-sm text-blue-600 font-medium hover:text-blue-700">Connect</button>
                </div>
              </div>
            </div>
          )}
          {active === 'billing' && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Billing</h2>
              <div className="p-6 rounded-xl border border-slate-200 text-center">
                <p className="text-2xl font-bold text-slate-900">Pro Plan</p>
                <p className="text-sm text-slate-500 mt-1">$29/month · 5 users · AI features</p>
                <button className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg">Upgrade to Enterprise</button>
              </div>
            </div>
          )}
          {active === 'preferences' && (
            <div className="space-y-4 max-w-lg">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Preferences</h2>
              {[
                { label: 'Meeting nudges (60min before)', enabled: true },
                { label: 'Meeting nudges (15min before)', enabled: true },
                { label: 'Daily task summary (07:35)', enabled: true },
                { label: 'Night review (23:00)', enabled: false },
                { label: 'NameCard scanner notifications', enabled: true },
              ].map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-700">{p.label}</span>
                  <div className={`w-10 h-5 rounded-full cursor-pointer transition-colors ${p.enabled ? 'bg-blue-600' : 'bg-slate-300'} relative`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${p.enabled ? 'left-5' : 'left-0.5'}`}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
