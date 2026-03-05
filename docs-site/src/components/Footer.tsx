import { Link } from 'react-router-dom';
import { services } from '../data/services';

export default function Footer() {
  return (
    <footer className="bg-surface border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-accent flex items-center justify-center">
                <span className="text-white font-bold text-xs">N</span>
              </div>
              <span className="text-white font-bold">Nexus Coder</span>
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">
              삼성 DS를 위한<br />AI 코딩 자동화 플랫폼
            </p>
            <p className="text-xs text-gray-600 mt-4">v5.0.2</p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-4">서비스</h4>
            <ul className="space-y-2.5">
              {services.map((s) => (
                <li key={s.id}>
                  <Link to={s.path} className="text-sm text-gray-500 hover:text-brand-400 transition-colors">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-4">가이드</h4>
            <ul className="space-y-2.5">
              <li><Link to="/guide/getting-started" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">CLI 시작하기</Link></li>
              <li><Link to="/guide-windows/getting-started" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">Windows 시작하기</Link></li>
              <li><a href="/feedback" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">피드백</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-4">리소스</h4>
            <ul className="space-y-2.5">
              <li><Link to="/guide/browser-tools" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">Browser Tools</Link></li>
              <li><Link to="/guide/office-tools" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">Office Tools</Link></li>
              <li><Link to="/guide/compact" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">Context 관리</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">© {new Date().getFullYear()} A2G Dev Space. Samsung DS Internal Use Only.</p>
          <p className="text-xs text-gray-600">Contact: syngha.han</p>
        </div>
      </div>
    </footer>
  );
}
