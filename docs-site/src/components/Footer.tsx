import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-surface border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <img src="/docs/images/logo.png?v=20260316" alt="Dashboard" className="w-8 h-8 rounded-lg" />
              <span className="text-white font-bold">Agent Registry</span>
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">
              Agent Registry<br />사용 가이드
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-4">Admin Guide</h4>
            <ul className="space-y-2.5">
              <li><Link to="/admin/getting-started" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">Admin 시작하기</Link></li>
              <li><Link to="/admin/service-management" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">서비스 관리</Link></li>
              <li><Link to="/admin/llm-management" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">LLM 관리</Link></li>
              <li><Link to="/admin/user-management" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">사용자/권한 관리</Link></li>
              <li><Link to="/admin/stats" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">통계 활용</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-4">User Guide</h4>
            <ul className="space-y-2.5">
              <li><Link to="/user/getting-started" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">사용자 시작하기</Link></li>
              <li><Link to="/user/my-usage" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">사용량 확인</Link></li>
            </ul>

            <h4 className="text-sm font-semibold text-gray-300 mb-4 mt-8">API Guide</h4>
            <ul className="space-y-2.5">
              <li><Link to="/api/authentication" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">API 인증</Link></li>
              <li><Link to="/api/chat-completions" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">Chat Completions</Link></li>
              <li><Link to="/api/models" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">Models API</Link></li>
              <li><Link to="/api/service-registration" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">서비스 등록</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-4">Links</h4>
            <ul className="space-y-2.5">
              <li><a href="/feedback" className="text-sm text-gray-500 hover:text-brand-400 transition-colors">피드백</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">&copy; {new Date().getFullYear()} A2G Dev Space. Samsung DS Internal Use Only.</p>
          <p className="text-xs text-gray-600">Contact: syngha.han</p>
        </div>
      </div>
    </footer>
  );
}
