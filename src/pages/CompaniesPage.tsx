import { Plus, Search, Building2 } from 'lucide-react';

const companies = [
  { name: 'Kinetix Systems', industry: 'IT Solutions', contacts: 12, deals: 3, value: '$1.2M', status: 'Active' },
  { name: 'HCL Technologies', industry: 'IT Services', contacts: 8, deals: 5, value: '$2.1M', status: 'Active' },
  { name: 'Digidations HK', industry: 'Digital Agency', contacts: 3, deals: 1, value: '$150K', status: 'Warm' },
  { name: 'Wymax Technologies', industry: 'Networking', contacts: 2, deals: 0, value: '$0', status: 'New' },
  { name: 'Kaspersky Lab', industry: 'Cybersecurity', contacts: 4, deals: 2, value: '$800K', status: 'Active' },
];

export default function CompaniesPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
          <p className="text-sm text-slate-500 mt-1">48 companies</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> New Company
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-1 max-w-sm px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
            <Search className="w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search companies..." className="bg-transparent border-none outline-none text-sm w-full" />
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-500 uppercase bg-slate-50">
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Industry</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Contacts</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Active Deals</th>
              <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Total Value</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><Building2 className="w-4 h-4 text-purple-600" /></div>
                    <span className="text-sm font-medium text-slate-900">{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{c.industry}</td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden md:table-cell">{c.contacts}</td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden md:table-cell">{c.deals}</td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden lg:table-cell">{c.value}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    c.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                    c.status === 'Warm' ? 'bg-amber-100 text-amber-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
