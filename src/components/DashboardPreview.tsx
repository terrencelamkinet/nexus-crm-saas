import {
  Users,
  TrendingUp,
  CheckSquare,
  Calendar,
  ArrowUpRight,
  Phone,
  Mail,
  Building2,
} from 'lucide-react';

const stats = [
  {
    label: 'Total Contacts',
    value: '192',
    change: '+12',
    positive: true,
    icon: Users,
    color: 'bg-blue-500',
  },
  {
    label: 'Active Deals',
    value: '$4.2M',
    change: '+8.3%',
    positive: true,
    icon: TrendingUp,
    color: 'bg-emerald-500',
  },
  {
    label: 'Open Tasks',
    value: '13',
    change: '-3',
    positive: false,
    icon: CheckSquare,
    color: 'bg-amber-500',
  },
  {
    label: 'Upcoming Events',
    value: '5',
    change: 'Today',
    positive: true,
    icon: Calendar,
    color: 'bg-purple-500',
  },
];

const recentActivity = [
  {
    type: 'call',
    title: 'Call with Peter Wong',
    desc: 'Discussed Q4 pipeline, demo scheduled',
    company: 'Kinetix Systems',
    time: '2h ago',
    icon: Phone,
    color: 'text-blue-600 bg-blue-100',
  },
  {
    type: 'meeting',
    title: 'Vendor Briefing - HPE',
    desc: 'New Aruba networking lineup presentation',
    company: 'HPE Hong Kong',
    time: '4h ago',
    icon: Users,
    color: 'text-emerald-600 bg-emerald-100',
  },
  {
    type: 'email',
    title: 'Proposal sent to Mary Chen',
    desc: 'Fortinet Firewall renewal quote',
    company: 'HCL Technologies',
    time: '1d ago',
    icon: Mail,
    color: 'text-purple-600 bg-purple-100',
  },
  {
    type: 'namecard',
    title: 'NameCard scanned: Cathy Cheung',
    desc: 'Director at Digidations',
    company: 'Digidations HK',
    time: '1d ago',
    icon: Building2,
    color: 'text-amber-600 bg-amber-100',
  },
];

const upcomingEvents = [
  { title: 'POC Session - HKMA AppScan', time: '14:00', company: 'Kinetix' },
  { title: 'Lunch with Winston', time: '12:30', company: 'HCL' },
  { title: 'Kaspersky Enablement', time: '10:00', company: 'Kaspersky' },
];

export default function DashboardPreview() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Welcome back, here's your overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg ${s.color} flex items-center justify-center`}>
                <s.icon className="w-5 h-5 text-white" />
              </div>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center ${
                  s.positive ? 'text-emerald-700 bg-emerald-100' : 'text-red-700 bg-red-100'
                }`}
              >
                {s.change}
                <ArrowUpRight className={`w-3 h-3 ml-0.5 ${s.positive ? '' : 'rotate-180'}`} />
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{s.value}</p>
            <p className="text-sm text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Main panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Recent Activity</h2>
          <div className="space-y-0">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
                <div className={`w-9 h-9 rounded-lg ${a.color} flex items-center justify-center flex-shrink-0`}>
                  <a.icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{a.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{a.desc}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{a.company}</p>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">{a.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Events */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Upcoming Today</h2>
          <div className="space-y-3">
            {upcomingEvents.map((e, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{e.title}</p>
                  <p className="text-xs text-blue-600 font-medium">{e.time}</p>
                  <p className="text-xs text-slate-500">{e.company}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mini pipeline */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Deal Pipeline</h2>
          <a href="/deals" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all →
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['Proposal', 'Negotiate', 'P.O.'].map((stage) => (
            <div key={stage} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700">{stage}</span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  {stage === 'Proposal' ? '3' : stage === 'Negotiate' ? '5' : '2'}
                </span>
              </div>
              <div className="space-y-2">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <p className="text-sm font-medium text-slate-800">Kinetix - HKMA</p>
                  <p className="text-xs text-slate-500">$500K · 85%</p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <p className="text-sm font-medium text-slate-800">HCL - Firewall</p>
                  <p className="text-xs text-slate-500">$350K · 70%</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
