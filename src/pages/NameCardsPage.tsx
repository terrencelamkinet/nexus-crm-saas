import { Upload, ScanLine, CheckCircle } from 'lucide-react';

const cards = [
  { name: 'Cathy Cheung', title: 'Director', company: 'Digidations HK', phone: '+852 9001 2345', email: 'cathy@digi.com', status: 'Saved' },
  { name: 'Ken Lau', title: 'Sales Manager', company: 'Wymax Technologies', phone: '+852 8111 2222', email: 'ken@wymax.com', status: 'Saved' },
  { name: 'Kirby Tsang', title: 'Engineer', company: 'Wymax Technologies', phone: '+852 8333 4444', email: 'kirby@wymax.com', status: 'Saved' },
];

export default function NameCardsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">NameCard Scanner</h1>
          <p className="text-sm text-slate-500 mt-1">3 cards scanned today</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Upload className="w-4 h-4" /> Upload Card
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="h-36 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
              <ScanLine className="w-12 h-12 text-slate-300" />
            </div>
            <div className="p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">{card.name}</p>
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-xs text-slate-500">{card.title}</p>
              <p className="text-xs text-blue-600 font-medium">{card.company}</p>
              <p className="text-xs text-slate-500">{card.phone}</p>
              <p className="text-xs text-slate-500">{card.email}</p>
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                <button className="flex-1 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">View</button>
                <button className="flex-1 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Re-scan</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
