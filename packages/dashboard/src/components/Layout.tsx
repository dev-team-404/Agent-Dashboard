import { Link, useLocation, useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Users, LogOut, Menu, X, Shield, BookOpen, BarChart3, Home, CalendarDays, Cpu, PanelLeftClose, PanelLeftOpen, Store, Code, FileText, ClipboardList, Wrench, ShieldCheck, Target, Sparkles, AlertTriangle, Key, Building2, FolderTree, Zap } from 'lucide-react';
import { serviceApi } from '../services/api';

interface User {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
}

interface Service {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  enabled: boolean;
}

function decodeUnicodeEscape(str: string): string {
  if (!str) return str;
  try {
    if (str.includes('\\u')) {
      return JSON.parse(`"${str}"`);
    }
    return str;
  } catch {
    return str;
  }
}

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface LayoutProps {
  children: React.ReactNode;
  user: User;
  isAdmin: boolean;
  adminRole: AdminRole;
  onLogout: () => void;
}

const getUserNavItems = (adminRole: AdminRole) => [
  { path: '/public-dashboard', label: '공개 대시보드', icon: BarChart3 },
  { path: '/services', label: '나에게 공개된 서비스', icon: Store },
  { path: '/my-services', label: adminRole ? '서비스 관리' : '내 서비스', icon: Wrench },
  { path: '/my-usage', label: '내 사용량', icon: BarChart3 },
  ...(!adminRole ? [{ path: '/admin-request', label: '관리자 권한 신청', icon: ShieldCheck }] : []),
];

export default function Layout({ children, user, isAdmin, adminRole, onLogout }: LayoutProps) {
  const location = useLocation();
  const { serviceId } = useParams<{ serviceId?: string }>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    if (isAdmin) loadServices();
  }, [isAdmin]);

  useEffect(() => {
    const handleServiceUpdate = () => { if (isAdmin) loadServices(); };
    window.addEventListener('services-updated', handleServiceUpdate);
    return () => window.removeEventListener('services-updated', handleServiceUpdate);
  }, [isAdmin]);

  const loadServices = async () => {
    try {
      const res = await serviceApi.list();
      setServices(res.data.services || []);
    } catch (error) {
      console.error('Failed to load services:', error);
    }
  };

  const toggleCollapse = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  const getCurrentPageLabel = () => {
    if (location.pathname === '/') return '통합 대시보드';
    if (location.pathname === '/public-dashboard') return '공개 대시보드';
    if (location.pathname === '/models') return 'LLM 모델 관리';
    if (location.pathname === '/users') return '사용자 관리';
    if (location.pathname === '/service-targets') return 'Saved M/M 관리';
    if (location.pathname === '/holidays') return '휴일 관리';
    if (location.pathname === '/my-usage') return '내 사용량';
    if (location.pathname === '/my-services') return adminRole ? '서비스 관리' : '내 서비스';
    if (location.pathname === '/services') return '나에게 공개된 서비스';
    if (location.pathname === '/admin-request') return '관리자 권한 신청';
    if (location.pathname === '/admin-requests-manage') return '권한 신청 관리';
    if (location.pathname === '/system-llm') return '레지스트리 LLM 관리';
    if (location.pathname === '/api-key') return 'API 비밀번호';
    if (location.pathname === '/request-logs') return '요청 로그';
    if (location.pathname === '/audit-logs') return '감사 로그';
    if (location.pathname === '/error-management') return '에러 관리';
    if (location.pathname === '/knox-verifications') return '인증 기록';
    if (location.pathname === '/insight-usage-rate') return 'AI 사용률 인사이트';
    if (location.pathname === '/insight-service-usage') return '서비스 사용량 인사이트';
    if (location.pathname === '/org-tree') return '조직도';
    if (location.pathname === '/dept-mapping') return '부서 매핑 관리';
    if (location.pathname === '/gpu-power') return 'DT GPU Power Usage';
    if (location.pathname.startsWith('/service/')) {
      const service = services.find(s => s.id === serviceId);
      if (location.pathname.includes('/users')) return `${service?.displayName || ''} 사용자`;
      return `${service?.displayName || ''} 대시보드`;
    }
    return 'Agent Registry';
  };

  const roleLabel = adminRole === 'SUPER_ADMIN' ? '슈퍼관리자' :
                    adminRole === 'ADMIN' ? '시스템 관리자' : '사용자';

  const sidebarWidth = sidebarCollapsed ? 'w-[72px]' : 'w-60';
  const mainMargin = sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-60';

  const NavLink = ({ path, label, icon: Icon }: { path: string; label: string; icon: React.ElementType }) => {
    const isActive = location.pathname === path;
    return (
      <Link
        to={path}
        onClick={() => setSidebarOpen(false)}
        title={sidebarCollapsed ? label : undefined}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors ${
          isActive
            ? 'bg-white/10 text-white font-medium'
            : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.06]'
        } ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
      >
        <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-white' : ''}`} />
        {!sidebarCollapsed && <span>{label}</span>}
      </Link>
    );
  };

  const ExternalNavLink = ({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => setSidebarOpen(false)}
      title={sidebarCollapsed ? label : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] transition-colors ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
    >
      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
      {!sidebarCollapsed && <span>{label}</span>}
    </a>
  );

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar (dark) ── */}
      <aside className={`fixed inset-y-0 left-0 ${sidebarWidth} bg-[#0F1117] z-50 transform transition-all duration-200 lg:translate-x-0 overflow-y-auto overflow-x-hidden flex flex-col ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>

        {/* Logo */}
        <div className={`flex items-center justify-between h-14 shrink-0 border-b border-white/[0.06] ${sidebarCollapsed ? 'px-4' : 'px-5'}`}>
          <Link to={isAdmin ? '/' : '/public-dashboard'} className="flex items-center gap-2.5" onClick={() => setSidebarOpen(false)}>
            <img src="/logo.png?v=20260316" alt="Agent Registry" className="w-7 h-7 rounded-md flex-shrink-0 bg-white" />
            {!sidebarCollapsed && (
              <span className="font-semibold text-[13px] text-white tracking-tight">Agent Registry</span>
            )}
          </Link>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 py-4 ${sidebarCollapsed ? 'px-2' : 'px-3'} space-y-5`}>
          {/* System Admin */}
          {isAdmin && (
            <div>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">시스템 관리</p>
              )}
              <div className="space-y-0.5">
                <NavLink path="/" label="통합 대시보드" icon={Home} />
                <NavLink path="/models" label="LLM 모델 관리" icon={Cpu} />
                <NavLink path="/users" label="사용자 관리" icon={Users} />
                <NavLink path="/service-targets" label="Saved M/M 관리" icon={Target} />
                <NavLink path="/insight-usage-rate" label="AI 사용률 인사이트" icon={BarChart3} />
                <NavLink path="/insight-service-usage" label="서비스 사용량 인사이트" icon={Cpu} />
                <NavLink path="/admin-requests-manage" label="권한 신청 관리" icon={ShieldCheck} />
              </div>
            </div>
          )}

          {/* Super Admin only */}
          {adminRole === 'SUPER_ADMIN' && (
            <div>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">슈퍼 관리자</p>
              )}
              <div className="space-y-0.5">
                <NavLink path="/system-llm" label="레지스트리 LLM 관리" icon={Sparkles} />
                <NavLink path="/api-key" label="API 비밀번호" icon={Key} />
                <NavLink path="/request-logs" label="요청 로그" icon={FileText} />
                <NavLink path="/audit-logs" label="감사 로그" icon={ClipboardList} />
                <NavLink path="/error-management" label="에러 관리" icon={AlertTriangle} />
                <NavLink path="/knox-verifications" label="인증 기록" icon={ShieldCheck} />
                <NavLink path="/holidays" label="휴일 관리" icon={CalendarDays} />
                <NavLink path="/org-tree" label="조직도" icon={FolderTree} />
                <NavLink path="/dept-mapping" label="부서 매핑 관리" icon={Building2} />
                <NavLink path="/gpu-power" label="DT GPU Power Usage" icon={Zap} />
              </div>
            </div>
          )}

          {/* Personal */}
          <div>
            {!sidebarCollapsed && (
              <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">개인</p>
            )}
            <div className="space-y-0.5">
              {getUserNavItems(adminRole).map(({ path, label, icon }) => (
                <NavLink key={path} path={path} label={label} icon={icon} />
              ))}
            </div>
          </div>

          {/* Resources */}
          <div>
            {!sidebarCollapsed && (
              <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">리소스</p>
            )}
            <div className="space-y-0.5">
              <ExternalNavLink href={import.meta.env.VITE_DOCS_URL || '/docs/'} label="문서" icon={BookOpen} />
              {isAdmin && (
                <ExternalNavLink href="/api/api-docs/ui" label="API 문서" icon={Code} />
              )}
            </div>
          </div>

          {/* Collapse toggle */}
          <div className="hidden lg:block pt-2">
            <button
              onClick={toggleCollapse}
              title={sidebarCollapsed ? '펼치기' : '접기'}
              className={`flex items-center gap-3 px-3 py-2 rounded-md w-full text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-colors ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-[18px] h-[18px] flex-shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="w-[18px] h-[18px] flex-shrink-0" />
                  <span>접기</span>
                </>
              )}
            </button>
          </div>
        </nav>

        {/* User — bottom */}
        <div className={`shrink-0 p-3 border-t border-white/[0.06] ${sidebarCollapsed ? 'px-2' : ''}`}>
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-7 h-7 bg-gray-700 rounded-full flex items-center justify-center">
                <span className="text-[11px] font-medium text-gray-200">{user.username.charAt(0).toUpperCase()}</span>
              </div>
              <button onClick={onLogout} className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors" title="로그아웃">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-[11px] font-medium text-gray-200">{user.username.charAt(0).toUpperCase()}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-[13px] font-medium text-gray-200 truncate">{decodeUnicodeEscape(user.username)}</p>
                  {isAdmin && (
                    <span className="px-1 py-0.5 text-[9px] font-medium bg-white/10 text-gray-400 rounded">
                      <Shield className="w-2 h-2 inline mr-0.5" />{roleLabel}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 truncate">{decodeUnicodeEscape(user.deptname)}</p>
              </div>
              <button onClick={onLogout} className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors" title="로그아웃">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className={`${mainMargin} transition-all duration-200`}>
        {/* Topbar */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 h-14">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-1.5 text-gray-500 hover:text-gray-700 rounded-md transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h2 className="text-sm font-medium text-gray-900">{getCurrentPageLabel()}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:block text-xs text-gray-400">{decodeUnicodeEscape(user.deptname)}</span>
              <div className="w-7 h-7 bg-gray-900 rounded-full flex items-center justify-center">
                <span className="text-[11px] font-medium text-white">{user.username.charAt(0).toUpperCase()}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
