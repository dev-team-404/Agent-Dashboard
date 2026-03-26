import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import TourProvider from './components/Tour/TourProvider';
import TourTriggerButton from './components/Tour/TourTriggerButton';
import { authApi } from './services/api';

// 배포 후 구버전 chunk 404 방지: 실패 시 페이지 자동 새로고침
function lazyWithRetry(importFn: () => Promise<{ default: React.ComponentType<any> }>) {
  return lazy(() =>
    importFn().catch(() => {
      const reloadedKey = 'chunk_reload_' + window.location.pathname;
      if (!sessionStorage.getItem(reloadedKey)) {
        sessionStorage.setItem(reloadedKey, '1');
        window.location.reload();
      }
      // 무한 새로고침 방지: 이미 한번 reload 했으면 에러 전파
      return importFn();
    })
  );
}

// Lazy-loaded pages (code splitting)
const MainDashboard = lazyWithRetry(() => import('./pages/MainDashboard'));
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const Models = lazyWithRetry(() => import('./pages/Models'));
const Users = lazyWithRetry(() => import('./pages/Users'));
const UnifiedUsers = lazyWithRetry(() => import('./pages/UnifiedUsers'));
const MyUsage = lazyWithRetry(() => import('./pages/MyUsage'));
const Holidays = lazyWithRetry(() => import('./pages/Holidays'));
const ServiceMarket = lazyWithRetry(() => import('./pages/ServiceMarket'));
const MyServices = lazyWithRetry(() => import('./pages/MyServices'));
const RequestLogs = lazyWithRetry(() => import('./pages/RequestLogs'));
const AuditLogs = lazyWithRetry(() => import('./pages/AuditLogs'));
const ErrorManagement = lazyWithRetry(() => import('./pages/ErrorManagement'));
const KnoxVerifications = lazyWithRetry(() => import('./pages/KnoxVerifications'));
const ServiceTargets = lazyWithRetry(() => import('./pages/ServiceTargets'));
const SystemLlmSettings = lazyWithRetry(() => import('./pages/SystemLlmSettings'));
const ApiKeySettings = lazyWithRetry(() => import('./pages/ApiKeySettings'));
const AdminRequestPage = lazyWithRetry(() => import('./pages/AdminRequestPage'));
const AdminRequestsManage = lazyWithRetry(() => import('./pages/AdminRequestsManage'));
const ServiceDetail = lazyWithRetry(() => import('./pages/ServiceDetail'));
const PublicDashboard = lazyWithRetry(() => import('./pages/PublicDashboard'));
const InsightUsageRate = lazyWithRetry(() => import('./pages/InsightUsageRate'));
const InsightServiceUsage = lazyWithRetry(() => import('./pages/InsightServiceUsage'));
const DeptMapping = lazyWithRetry(() => import('./pages/DeptMapping'));
const OrgTree = lazyWithRetry(() => import('./pages/OrgTree'));
const GpuPowerUsage = lazyWithRetry(() => import('./pages/GpuPowerUsage'));

interface User {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
}

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-samsung-blue border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="mt-3 text-sm text-pastel-500">로딩 중...</p>
      </div>
    </div>
  );
}

function ServiceDashboardWrapper({ adminRole }: { adminRole: AdminRole }) {
  const { serviceId } = useParams<{ serviceId: string }>();
  return <Dashboard serviceId={serviceId} adminRole={adminRole} />;
}

function ServiceUsersWrapper() {
  const { serviceId } = useParams<{ serviceId: string }>();
  return <Users serviceId={serviceId} />;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminRole, setAdminRole] = useState<AdminRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('agent_stats_token');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await authApi.check();
      setUser(response.data.user);
      setIsAdmin(response.data.isAdmin);
      setAdminRole(response.data.adminRole);
    } catch {
      localStorage.removeItem('agent_stats_token');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (userData: User, token: string, admin: boolean, role: string | null) => {
    localStorage.setItem('agent_stats_token', token);
    setUser(userData);
    setIsAdmin(admin);
    setAdminRole(role as AdminRole);
  };

  const handleLogout = () => {
    localStorage.removeItem('agent_stats_token');
    setUser(null);
    setIsAdmin(false);
    setAdminRole(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pastel-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-samsung-blue border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-sm text-pastel-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <TourProvider userId={user.id} adminRole={adminRole}>
    <Layout user={user} isAdmin={isAdmin} adminRole={adminRole} onLogout={handleLogout}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* All users */}
          <Route path="/public-dashboard" element={<PublicDashboard />} />
          <Route path="/services" element={<ServiceMarket />} />
          <Route path="/my-services" element={<MyServices user={user} adminRole={adminRole} />} />
          <Route path="/my-services/:serviceId" element={<ServiceDetail user={user} adminRole={adminRole} />} />

          <Route path="/my-usage" element={<MyUsage />} />
          <Route path="/admin-request" element={<AdminRequestPage isAdmin={isAdmin} />} />

          {/* System Admin (ADMIN + SUPER_ADMIN) */}
          {isAdmin && (
            <>
              <Route path="/" element={<MainDashboard adminRole={adminRole} isAdmin={isAdmin} />} />
              <Route path="/models" element={<Models adminRole={adminRole} isAdmin={isAdmin} />} />
              <Route path="/users" element={<UnifiedUsers adminRole={adminRole} />} />
              <Route path="/service-targets" element={<ServiceTargets />} />
              <Route path="/admin-requests-manage" element={<AdminRequestsManage />} />
              <Route path="/insight-usage-rate" element={<InsightUsageRate />} />
              <Route path="/insight-service-usage" element={<InsightServiceUsage />} />
              <Route path="/service/:serviceId" element={<ServiceDashboardWrapper adminRole={adminRole} />} />
              <Route path="/service/:serviceId/users" element={<ServiceUsersWrapper />} />
            </>
          )}

          {/* Super Admin only */}
          {adminRole === 'SUPER_ADMIN' && (
            <>
              <Route path="/system-llm" element={<SystemLlmSettings />} />
              <Route path="/api-key" element={<ApiKeySettings />} />
              <Route path="/holidays" element={<Holidays />} />
              <Route path="/request-logs" element={<RequestLogs />} />
              <Route path="/audit-logs" element={<AuditLogs />} />
              <Route path="/error-management" element={<ErrorManagement />} />
              <Route path="/knox-verifications" element={<KnoxVerifications />} />
              <Route path="/dept-mapping" element={<DeptMapping />} />
              <Route path="/org-tree" element={<OrgTree />} />
              <Route path="/gpu-power" element={<GpuPowerUsage />} />
            </>
          )}

          <Route
            path="*"
            element={<Navigate to={isAdmin ? '/' : '/public-dashboard'} replace />}
          />
        </Routes>
      </Suspense>
    </Layout>
    <TourTriggerButton />
    </TourProvider>
  );
}

export default App;
