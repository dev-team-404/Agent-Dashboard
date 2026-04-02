import { Link, useLocation, useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Users, LogOut, Menu, X, Shield, BookOpen, BarChart3, Home, CalendarDays, Cpu, PanelLeftClose, PanelLeftOpen, Store, Code, FileText, ClipboardList, Wrench, ShieldCheck, Target, Sparkles, AlertTriangle, Key, KeyRound, FolderTree, Zap, Activity, Flame, Megaphone, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

const getUserNavItems = (adminRole: AdminRole, t: (key: string) => string) => [
  { path: '/public-dashboard', label: t('sidebar.publicDashboard'), icon: BarChart3 },
  { path: '/services', label: t('sidebar.availableServices'), icon: Store },
  { path: '/my-services', label: adminRole ? t('sidebar.serviceManagement') : t('sidebar.myServices'), icon: Wrench },
  { path: '/my-usage', label: t('sidebar.myUsage'), icon: BarChart3 },
  ...(!adminRole ? [{ path: '/admin-request', label: t('sidebar.adminRequest'), icon: ShieldCheck }] : []),
];

export default function Layout({ children, user, isAdmin, adminRole, onLogout }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { serviceId } = useParams<{ serviceId?: string }>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [services, setServices] = useState<Service[]>([]);

  const toggleLanguage = () => {
    const next = i18n.language === 'ko' ? 'en' : 'ko';
    i18n.changeLanguage(next);
  };

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
    if (location.pathname === '/') return t('pageTitle.unifiedDashboard');
    if (location.pathname === '/public-dashboard') return t('pageTitle.publicDashboard');
    if (location.pathname === '/models') return t('pageTitle.llmModelManagement');
    if (location.pathname === '/users') return t('pageTitle.userManagement');
    if (location.pathname === '/service-targets') return t('pageTitle.savedMmManagement');
    if (location.pathname === '/holidays') return t('pageTitle.holidayManagement');
    if (location.pathname === '/my-usage') return t('pageTitle.myUsage');
    if (location.pathname === '/my-services') return adminRole ? t('pageTitle.serviceManagement') : t('pageTitle.myServices');
    if (location.pathname === '/services') return t('pageTitle.availableServices');
    if (location.pathname === '/admin-request') return t('pageTitle.adminRequest');
    if (location.pathname === '/admin-requests-manage') return t('pageTitle.permissionRequestManagement');
    if (location.pathname === '/system-llm') return t('pageTitle.registryLlmManagement');
    if (location.pathname === '/api-key') return t('pageTitle.apiPassword');
    if (location.pathname === '/request-logs') return t('pageTitle.requestLogs');
    if (location.pathname === '/audit-logs') return t('pageTitle.auditLogs');
    if (location.pathname === '/error-management') return t('pageTitle.errorManagement');
    if (location.pathname === '/knox-verifications') return t('pageTitle.authRecords');
    if (location.pathname === '/insight-usage-rate') return t('pageTitle.aiUsageInsight');
    if (location.pathname === '/insight-service-usage') return t('pageTitle.serviceUsageInsight');
    if (location.pathname === '/org-tree') return t('pageTitle.orgTree');
    if (location.pathname === '/gpu-power') return t('pageTitle.gpuPower');
    if (location.pathname === '/resource-monitor') return t('pageTitle.resourceMonitoring');
    if (location.pathname === '/oidc-clients') return t('pageTitle.oidcClients');
    if (location.pathname === '/llm-heatmap') return t('pageTitle.llmHeatmap');
    if (location.pathname === '/promotional-models') return t('pageTitle.promotionalModels');
    if (location.pathname === '/platform-story') return t('pageTitle.platformStory');
    if (location.pathname.startsWith('/service/')) {
      const service = services.find(s => s.id === serviceId);
      if (location.pathname.includes('/users')) return t('pageTitle.serviceUsers', { name: service?.displayName || '' });
      return t('pageTitle.serviceDashboard', { name: service?.displayName || '' });
    }
    return 'Agent Registry';
  };

  const roleLabel = adminRole === 'SUPER_ADMIN' ? t('roles.superAdmin') :
                    adminRole === 'ADMIN' ? t('roles.admin') : t('roles.user');

  const sidebarWidth = sidebarCollapsed ? 'w-[72px]' : 'w-60';
  const mainMargin = sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-60';

  // Expand sidebar when tour requests it
  useEffect(() => {
    const handleExpandSidebar = () => {
      if (sidebarCollapsed) {
        setSidebarCollapsed(false);
        localStorage.setItem('sidebar_collapsed', 'false');
      }
    };
    window.addEventListener('expand-sidebar', handleExpandSidebar);
    return () => window.removeEventListener('expand-sidebar', handleExpandSidebar);
  }, [sidebarCollapsed]);

  const NavLink = ({ path, label, icon: Icon }: { path: string; label: string; icon: React.ElementType }) => {
    const isActive = location.pathname === path;
    return (
      <Link
        to={path}
        onClick={() => setSidebarOpen(false)}
        title={sidebarCollapsed ? label : undefined}
        data-tour={`nav-${path}`}
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
                <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">{t('sidebar.systemAdmin')}</p>
              )}
              <div className="space-y-0.5">
                <NavLink path="/" label={t('sidebar.unifiedDashboard')} icon={Home} />
                <NavLink path="/models" label={t('sidebar.llmModelManagement')} icon={Cpu} />
                <NavLink path="/service-targets" label={t('sidebar.savedMmManagement')} icon={Target} />
                <NavLink path="/insight-usage-rate" label={t('sidebar.aiUsageInsight')} icon={BarChart3} />
                <NavLink path="/insight-service-usage" label={t('sidebar.serviceUsageInsight')} icon={Cpu} />
                <NavLink path="/admin-requests-manage" label={t('sidebar.permissionRequestManagement')} icon={ShieldCheck} />
              </div>
            </div>
          )}

          {/* Super Admin only */}
          {adminRole === 'SUPER_ADMIN' && (
            <div>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">{t('sidebar.superAdmin')}</p>
              )}
              <div className="space-y-0.5">
                <NavLink path="/users" label={t('sidebar.userManagement')} icon={Users} />
                <NavLink path="/system-llm" label={t('sidebar.registryLlmManagement')} icon={Sparkles} />
                <NavLink path="/api-key" label={t('sidebar.apiPassword')} icon={Key} />
                <NavLink path="/request-logs" label={t('sidebar.requestLogs')} icon={FileText} />
                <NavLink path="/audit-logs" label={t('sidebar.auditLogs')} icon={ClipboardList} />
                <NavLink path="/error-management" label={t('sidebar.errorManagement')} icon={AlertTriangle} />
                <NavLink path="/knox-verifications" label={t('sidebar.authRecords')} icon={ShieldCheck} />
                <NavLink path="/holidays" label={t('sidebar.holidayManagement')} icon={CalendarDays} />
                <NavLink path="/org-tree" label={t('sidebar.orgTree')} icon={FolderTree} />
                <NavLink path="/gpu-power" label={t('sidebar.gpuPower')} icon={Zap} />
                <NavLink path="/llm-heatmap" label={t('sidebar.llmHeatmap')} icon={Flame} />
                <NavLink path="/resource-monitor" label={t('sidebar.resourceMonitoring')} icon={Activity} />
                <NavLink path="/oidc-clients" label={t('sidebar.oidcClients')} icon={KeyRound} />
                <NavLink path="/promotional-models" label={t('sidebar.promotionalModels')} icon={Megaphone} />
                <ExternalNavLink href="/internal/docs" label={t('sidebar.internalApi')} icon={Code} />
              </div>
            </div>
          )}

          {/* Personal */}
          <div>
            {!sidebarCollapsed && (
              <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">{t('sidebar.personal')}</p>
            )}
            <div className="space-y-0.5">
              {getUserNavItems(adminRole, t).map(({ path, label, icon }) => (
                <NavLink key={path} path={path} label={label} icon={icon} />
              ))}
            </div>
          </div>

          {/* Resources */}
          <div>
            {!sidebarCollapsed && (
              <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">{t('sidebar.resources')}</p>
            )}
            <div className="space-y-0.5">
              <ExternalNavLink href={import.meta.env.VITE_DOCS_URL || '/docs/'} label={t('sidebar.docs')} icon={BookOpen} />
              {isAdmin && (
                <ExternalNavLink href="/api/api-docs/ui" label={t('sidebar.apiDocs')} icon={Code} />
              )}
              <NavLink path="/platform-story" label={t('sidebar.platformStory')} icon={FileText} />
            </div>
          </div>

          {/* Language toggle */}
          <div className={sidebarCollapsed ? '' : ''}>
            <button
              onClick={toggleLanguage}
              title={t('language.label')}
              className={`flex items-center gap-3 px-3 py-2 rounded-md w-full text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-colors ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
            >
              <Globe className="w-[18px] h-[18px] flex-shrink-0" />
              {!sidebarCollapsed && <span>{i18n.language === 'ko' ? 'English' : '한국어'}</span>}
            </button>
          </div>

          {/* Collapse toggle */}
          <div className="hidden lg:block">
            <button
              onClick={toggleCollapse}
              title={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
              className={`flex items-center gap-3 px-3 py-2 rounded-md w-full text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-colors ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-[18px] h-[18px] flex-shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="w-[18px] h-[18px] flex-shrink-0" />
                  <span>{t('sidebar.collapse')}</span>
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
              <button onClick={onLogout} className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors" title={t('sidebar.logout')}>
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
              <button onClick={onLogout} className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors" title={t('sidebar.logout')}>
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
