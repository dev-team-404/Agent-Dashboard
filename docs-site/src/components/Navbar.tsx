import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown } from 'lucide-react';
import { guideSections } from '../data/guides';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const location = useLocation();

  // Check if current path belongs to a section
  const isActive = (sectionId: string) => location.pathname.startsWith(`/${sectionId}/`);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-surface/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group" onClick={() => setOpen(false)}>
          <img src="/docs/images/logo.png" alt="Dashboard" className="w-9 h-9 rounded-xl shadow-lg shadow-brand-500/20 group-hover:shadow-brand-500/40 transition-shadow" />
          <div>
            <span className="text-white font-bold text-lg tracking-tight">Agent Dashboard</span>
            <span className="text-brand-400 font-bold text-lg tracking-tight ml-1">Guide</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {guideSections.map((section) => (
            <div key={section.id} className="relative group">
              <Link
                to={section.items[0].path}
                className={`px-4 py-2 text-sm rounded-lg transition-all flex items-center gap-1.5 ${
                  isActive(section.id)
                    ? 'text-white bg-white/10'
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>{section.icon}</span>
                {section.title}
                <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:rotate-180" />
              </Link>

              {/* Dropdown */}
              <div className="absolute top-full left-0 pt-2 w-80 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                <div className="p-2 rounded-xl bg-surface-light/95 backdrop-blur-xl border border-white/10 shadow-2xl">
                  {section.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors group/item ${
                        location.pathname === item.path ? 'bg-white/5' : ''
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-white group-hover/item:text-brand-400 transition-colors">{item.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <a href="/" className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg hover:bg-white/5 transition-all">
            Dashboard
          </a>
        </div>

        <div className="hidden md:flex items-center gap-3">
          {/* intentionally empty — no download/version badge */}
        </div>

        {/* Mobile toggle */}
        <button onClick={() => setOpen(!open)} className="md:hidden p-2 text-gray-300 hover:text-white">
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-surface-light/95 backdrop-blur-xl border-t border-white/5 p-4 space-y-4">
          {guideSections.map((section) => (
            <div key={section.id}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 mb-2">
                {section.icon} {section.title}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpen(false)}
                    className={`block px-4 py-2.5 rounded-lg text-sm transition-colors ${
                      location.pathname === item.path
                        ? 'text-white bg-white/10 font-medium'
                        : 'text-gray-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
