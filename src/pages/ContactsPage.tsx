import { Plus, Search, Filter } from 'lucide-react';

const contacts = [
  { name: 'Peter Wong', company: 'Kinetix Systems', email: 'peter@kinetix.com', phone: '+852 9123 4567', status: 'Active' },
  { name: 'Mary Chen', company: 'HCL Technologies', email: 'mary@hcl.com', phone: '+852 9456 7890', status: 'Warm' },
  { name: 'John Lau', company: '—', email: 'john@example.com', phone: '+852 9789 0123', status: 'Cold' },
  { name: 'Cathy Cheung', company: 'Digidations HK', email: 'cathy@digi.com', phone: '+852 9001 2345', status: 'Active' },
  { name: 'Ken Lau', company: 'Wymax Technologies', email: 'ken@wymax.com', phone: '+852 8111 2222', status: 'Warm' },
];

export default function ContactsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
          <p className="text-sm text-slate-500 mt-1">192 contacts total</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" />
          New Contact
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
            <Search className="w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search contacts..." className="bg-transparent border-none outline-none text-sm w-full" />
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">
            <Filter className="w-4 h-4" />
            Filter
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-500 uppercase bg-slate-50">
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Company</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Email</th>
              <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Phone</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-medium">
                      {c.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <span className="text-sm font-medium text-slate-900">{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{c.company}</td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden md:table-cell">{c.email}</td>
                <td className="px-4 py-3 text-sm text-slate-600 hidden lg:table-cell">{c.phone}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    c.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                    c.status === 'Warm' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
          <span>1-5 of 192</span>
          <div className="flex gap-1">
            <button className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50">‹</button>
            <button className="px-3 py-1 rounded bg-blue-600 text-white">1</button>
            <button className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50">2</button>
            <button className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50">3</button>
            <button className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}
