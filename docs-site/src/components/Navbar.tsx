import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown } from 'lucide-react';
import { services } from '../data/services';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const location = useLocation();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-surface/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group" onClick={() => setOpen(false)}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-accent flex items-center justify-center shadow-lg shadow-brand-500/20 group-hover:shadow-brand-500/40 transition-shadow">
            <span className="text-white font-bold text-sm">N</span>
          </div>
          <div>
            <span className="text-white font-bold text-lg tracking-tight">Nexus</span>
            <span className="text-brand-400 font-bold text-lg tracking-tight ml-0.5">Coder</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          <div className="relative" onMouseEnter={() => setServicesOpen(true)} onMouseLeave={() => setServicesOpen(false)}>
            <button className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg hover:bg-white/5 transition-all flex items-center gap-1">
              서비스 <ChevronDown className={`w-3.5 h-3.5 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} />
            </button>
            {servicesOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 p-2 rounded-xl bg-surface-light/95 backdrop-blur-xl border border-white/10 shadow-2xl">
                {services.map((s) => (
                  <Link
                    key={s.id}
                    to={s.path}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors group"
                    onClick={() => setServicesOpen(false)}
                  >
                    <span className="text-xl">{s.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-brand-400 transition-colors">{s.name}</p>
                      <p className="text-xs text-gray-500">{s.tagline}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <a href="/feedback" className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg hover:bg-white/5 transition-all">
            피드백
          </a>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <span className="px-2.5 py-1 text-xs font-mono text-brand-400 bg-brand-500/10 rounded-full border border-brand-500/20">
            v5.0.2
          </span>
          <a
            href={services[0].downloadUrl}
            className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-brand-500 to-brand-600 rounded-lg hover:shadow-lg hover:shadow-brand-500/25 transition-all hover:-translate-y-0.5"
          >
            다운로드
          </a>
        </div>

        {/* Mobile toggle */}
        <button onClick={() => setOpen(!open)} className="md:hidden p-2 text-gray-300 hover:text-white">
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-surface-light/95 backdrop-blur-xl border-t border-white/5 p-4 space-y-1">
          {services.map((s) => (
            <Link key={s.id} to={s.path} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:text-white hover:bg-white/5">
              <span>{s.icon}</span>
              <span className="text-sm font-medium">{s.name}</span>
            </Link>
          ))}
          <a href={services[0].downloadUrl} className="block mt-3 px-4 py-3 text-sm font-medium text-center text-white bg-gradient-to-r from-brand-500 to-brand-600 rounded-lg">
            다운로드 v5.0.2
          </a>
        </div>
      )}
    </nav>
  );
}
