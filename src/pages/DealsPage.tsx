import { Plus } from 'lucide-react';

const stages = [
  { name: 'Proposal', color: 'bg-blue-500', deals: [
    { name: 'HKMA AppScan', company: 'Kinetix', amount: '$500K', prob: '85%', owner: 'Peter W' },
    { name: 'Firewall Renewal', company: 'HCL', amount: '$350K', prob: '70%', owner: 'Mary C' },
  ]},
  { name: 'Negotiate', color: 'bg-amber-500', deals: [
    { name: 'Network Upgrade', company: 'Kinetix', amount: '$1.2M', prob: '60%', owner: 'Peter W' },
    { name: 'EDR Solution', company: 'Kaspersky', amount: '$800K', prob: '55%', owner: 'John L' },
  ]},
  { name: 'P.O.', color: 'bg-emerald-500', deals: [
    { name: 'License Renewal', company: 'Digidations', amount: '$150K', prob: '95%', owner: 'Cathy C' },
  ]},
  { name: 'Delivery', color: 'bg-purple-500', deals: [
    { name: 'Server Migration', company: 'HCL', amount: '$600K', prob: '90%', owner: 'Mary C' },
  ]},
];

export default function DealsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Deals Pipeline</h1>
          <p className="text-sm text-slate-500 mt-1">14 active deals · $4.2M total</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> New Deal
        </button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <div key={stage.name} className="flex-shrink-0 w-72">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-3 h-3 rounded-full ${stage.color}`}></div>
              <h3 className="text-sm font-semibold text-slate-700">{stage.name}</h3>
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full ml-auto">{stage.deals.length}</span>
            </div>
            <div className="space-y-2">
              {stage.deals.map((deal, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                  <p className="text-sm font-semibold text-slate-900">{deal.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{deal.company}</p>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <span className="text-sm font-bold text-slate-900">{deal.amount}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${stage.color}`} style={{ width: deal.prob }}></div>
                      </div>
                      <span className="text-xs text-slate-500">{deal.prob}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">{deal.owner}</p>
                </div>
              ))}
              <button className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
                + Add deal
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
