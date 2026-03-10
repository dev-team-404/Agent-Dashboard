import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import { authApi } from './services/api';

// Lazy-loaded pages (code splitting)
const MainDashboard = lazy(() => import('./pages/MainDashboard'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Models = lazy(() => import('./pages/Models'));
const Users = lazy(() => import('./pages/Users'));
const UnifiedUsers = lazy(() => import('./pages/UnifiedUsers'));
const MyUsage = lazy(() => import('./pages/MyUsage'));
const Holidays = lazy(() => import('./pages/Holidays'));
const ServiceMarket = lazy(() => import('./pages/ServiceMarket'));
const MyServices = lazy(() => import('./pages/MyServices'));
const RequestLogs = lazy(() => import('./pages/RequestLogs'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));

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
    <Layout user={user} isAdmin={isAdmin} adminRole={adminRole} onLogout={handleLogout}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* All users */}
          <Route path="/services" element={<ServiceMarket />} />
          <Route path="/my-services" element={<MyServices />} />
          <Route path="/my-usage" element={<MyUsage />} />

          {/* Admin only */}
          {isAdmin && (
            <>
              <Route path="/" element={<MainDashboard adminRole={adminRole} />} />

              {/* LLM Models (independent of services) */}
              <Route path="/models" element={<Models adminRole={adminRole} />} />

              {/* Super Admin only */}
              {adminRole === 'SUPER_ADMIN' && (
                <Route path="/users" element={<UnifiedUsers />} />
              )}
              {adminRole === 'SUPER_ADMIN' && (
                <Route path="/holidays" element={<Holidays />} />
              )}

              {/* Logs */}
              <Route path="/request-logs" element={<RequestLogs />} />
              <Route path="/audit-logs" element={<AuditLogs />} />

              {/* Service-specific routes */}
              <Route path="/service/:serviceId" element={<ServiceDashboardWrapper adminRole={adminRole} />} />
              <Route path="/service/:serviceId/users" element={<ServiceUsersWrapper />} />
            </>
          )}

          <Route
            path="*"
            element={<Navigate to={isAdmin ? '/' : '/services'} replace />}
          />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default App;
