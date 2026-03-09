import { Link, useLocation, useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Users, LogOut, Menu, X, ChevronRight, Shield, BookOpen, BarChart3, Home, CalendarDays, Cpu, PanelLeftClose, PanelLeftOpen, Store } from 'lucide-react';
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

/**
 * Decode unicode escape sequences (e.g., \uD55C\uAE00 → 한글)
 */
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

// 모든 사용자 메뉴
const userNavItems = [
  { path: '/services', label: '서비스', icon: Store },
  { path: '/my-usage', label: '내 사용량', icon: BarChart3 },
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
    if (isAdmin) {
      loadServices();
    }
  }, [isAdmin]);

  useEffect(() => {
    const handleServiceUpdate = () => {
      if (isAdmin) {
        loadServices();
      }
    };
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
    if (location.pathname === '/models') return 'LLM 모델 관리';
    if (location.pathname === '/users') return '사용자 관리';
    if (location.pathname === '/holidays') return '휴일 관리';
    if (location.pathname === '/my-usage') return '내 사용량';
    if (location.pathname === '/services') return '서비스';
    if (location.pathname.startsWith('/service/')) {
      const service = services.find(s => s.id === serviceId);
      if (location.pathname.includes('/users')) return `${service?.displayName || ''} 사용자`;
      return `${service?.displayName || ''} 대시보드`;
    }
    return 'Agent Stats';
  };

  const roleLabel = adminRole === 'SUPER_ADMIN' ? '슈퍼관리자' :
                    adminRole === 'ADMIN' ? '관리자' : '사용자';

  const sidebarWidth = sidebarCollapsed ? 'w-[72px]' : 'w-64';
  const mainMargin = sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-64';

  const NavLink = ({ path, label, icon: Icon, onClick }: { path: string; label: string; icon: React.ElementType; onClick?: () => void }) => {
    const isActive = location.pathname === path;
    return (
      <Link
        to={path}
        onClick={() => { setSidebarOpen(false); onClick?.(); }}
        title={sidebarCollapsed ? label : undefined}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl mb-1 transition-all duration-200 group ${
          isActive
            ? 'bg-pastel-100 text-pastel-700 shadow-sm'
            : 'text-pastel-600 hover:bg-pastel-50 hover:text-pastel-700'
        } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
      >
        <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-samsung-blue' : 'text-pastel-400 group-hover:text-pastel-600'}`} />
        {!sidebarCollapsed && <span className="font-medium">{label}</span>}
        {!sidebarCollapsed && isActive && <ChevronRight className="w-4 h-4 ml-auto text-samsung-blue" />}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-pastel-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 ${sidebarWidth} bg-white border-r border-pastel-200 z-50 transform transition-all duration-300 ease-in-out lg:translate-x-0 overflow-y-auto overflow-x-hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className={`flex items-center justify-between px-4 py-5 border-b border-pastel-100 sticky top-0 bg-white z-10 ${sidebarCollapsed ? 'px-3' : 'px-6'}`}>
          <Link to={isAdmin ? '/' : '/services'} className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
            <img src="/logo.png" alt="Agent Stats" className="w-10 h-10 rounded-xl flex-shrink-0" />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h1 className="font-bold text-[15px] leading-tight tracking-tight text-pastel-800">
                  <span className="text-samsung-blue">Agent</span> Stats
                </h1>
                <p className="text-[10px] text-pastel-400 tracking-wide mt-0.5">사용량 집계 시스템</p>
              </div>
            )}
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-pastel-500 hover:text-pastel-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className={`mt-4 pb-4 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {/* Admin 섹션: 통합 대시보드 */}
          {isAdmin && (
            <div className="mb-4">
              {!sidebarCollapsed && (
                <p className="px-4 mb-2 text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                  통합 관리
                </p>
              )}
              <NavLink path="/" label="통합 대시보드" icon={Home} />
              <NavLink path="/models" label="LLM 모델" icon={Cpu} />
              {adminRole === 'SUPER_ADMIN' && (
                <NavLink path="/users" label="사용자 관리" icon={Users} />
              )}
              {adminRole === 'SUPER_ADMIN' && (
                <NavLink path="/holidays" label="휴일 관리" icon={CalendarDays} />
              )}
            </div>
          )}

          {/* 일반 섹션 */}
          <div className="mb-4">
            {!sidebarCollapsed && (
              <p className="px-4 mb-2 text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                개인
              </p>
            )}
            {userNavItems.map(({ path, label, icon }) => (
              <NavLink key={path} path={path} label={label} icon={icon} />
            ))}
          </div>

          {/* 리소스 섹션 */}
          <div className="mb-4">
            {!sidebarCollapsed && (
              <p className="px-4 mb-2 text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                리소스
              </p>
            )}
            <a
              href={import.meta.env.VITE_DOCS_URL || '/docs/'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setSidebarOpen(false)}
              title={sidebarCollapsed ? '문서' : undefined}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl mb-1 transition-all duration-200 group text-pastel-600 hover:bg-pastel-50 hover:text-pastel-700 ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            >
              <BookOpen className="w-5 h-5 text-pastel-400 group-hover:text-pastel-600 flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">문서</span>}
            </a>
          </div>

          {/* Collapse toggle (desktop only) */}
          <div className="hidden lg:block">
            <button
              onClick={toggleCollapse}
              title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl mb-1 w-full transition-all duration-200 text-pastel-500 hover:bg-pastel-50 hover:text-pastel-700 ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-5 h-5 flex-shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">사이드바 접기</span>
                </>
              )}
            </button>
          </div>
        </nav>

        {/* User info */}
        <div className={`p-4 border-t border-pastel-100 ${sidebarCollapsed ? 'px-2' : ''}`}>
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-pastel-300 to-samsung-blue rounded-full flex items-center justify-center shadow-sm">
                <span className="text-xs font-bold text-white">
                  {user.username.charAt(0).toUpperCase()}
                </span>
              </div>
              <button
                onClick={onLogout}
                className="p-2 text-pastel-500 hover:text-pastel-700 hover:bg-pastel-100 rounded-xl transition-all duration-200"
                title="로그아웃"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-pastel-800 truncate">{decodeUnicodeEscape(user.username)}</p>
                  {isAdmin && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-pastel-200 text-pastel-700 rounded">
                      <Shield className="w-2.5 h-2.5" />
                      {roleLabel}
                    </span>
                  )}
                </div>
                <p className="text-xs text-pastel-500 truncate">{decodeUnicodeEscape(user.deptname)}</p>
              </div>
              <button
                onClick={onLogout}
                className="p-2.5 text-pastel-500 hover:text-pastel-700 hover:bg-pastel-100 rounded-xl transition-all duration-200"
                title="로그아웃"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className={`${mainMargin} transition-all duration-300`}>
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-lg border-b border-pastel-100">
          <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 text-pastel-500 hover:text-pastel-700 hover:bg-pastel-100 rounded-lg transition-colors"
              >
                <Menu className="w-6 h-6" />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-pastel-800">
                  {getCurrentPageLabel()}
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-pastel-100 rounded-full">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-pastel-600">온라인</span>
              </div>
              <div className="w-8 h-8 bg-gradient-to-br from-pastel-300 to-samsung-blue rounded-full flex items-center justify-center shadow-sm">
                <span className="text-xs font-bold text-white">
                  {user.username.charAt(0).toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
