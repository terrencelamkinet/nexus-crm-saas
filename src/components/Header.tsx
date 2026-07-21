import { Bell, Search, ChevronDown } from 'lucide-react';

export default function Header() {
  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <Search className="w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search contacts, companies, deals..."
          className="bg-transparent border-none outline-none text-sm text-slate-600 placeholder-slate-400 w-full"
        />
      </div>
      <div className="flex items-center gap-4">
        <button className="relative p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
          <Bell className="w-5 h-5 text-slate-500" />
          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-blue-600 rounded-full"></span>
        </button>
        <div className="flex items-center gap-2 cursor-pointer">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
            TL
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-slate-700 leading-tight">Terrence Lam</p>
            <p className="text-xs text-slate-400 leading-tight">Kinetix Systems</p>
          </div>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </div>
    </header>
  );
}
