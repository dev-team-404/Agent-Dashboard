import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import DocLayout from './components/DocLayout';
import Home from './pages/Home';
import { guideSections } from './data/guides';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// Map route paths to content file paths
function guideContentPath(path: string): string {
  const map: Record<string, string> = {
    '/admin/getting-started': 'admin/getting-started.md',
    '/admin/service-management': 'admin/service-management.md',
    '/admin/llm-management': 'admin/llm-management.md',
    '/admin/user-management': 'admin/user-management.md',
    '/admin/stats': 'admin/stats.md',
    '/service/service-registration': 'service/service-registration.md',
    '/service/service-models': 'service/service-models.md',
    '/service/service-users': 'service/service-users.md',
    '/service/rate-limits': 'service/rate-limits.md',
    '/service/usage-analytics': 'service/usage-analytics.md',
    '/user/getting-started': 'user/getting-started.md',
    '/user/service-registration': 'user/service-registration.md',
    '/user/my-usage': 'user/my-usage.md',
    '/api/authentication': 'api/authentication.md',
    '/api/framework-integration': 'api/framework-integration.md',
    '/api/chat-completions': 'api/chat-completions.md',
    '/api/models': 'api/models.md',
  };
  return map[path] || '';
}

function DocRoute({ sectionTitle, path }: { sectionTitle: string; path: string }) {
  // Find the matching guide section for sidebar
  const section = guideSections.find((s) =>
    s.items.some((item) => item.path === path)
  );

  const sidebarItems = section?.items.map((item) => ({
    path: item.path,
    label: item.label,
  })) || [];

  const contentPath = guideContentPath(path);

  return <DocLayout title={sectionTitle} sidebarItems={sidebarItems} contentPath={contentPath} />;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Navbar />
      <Routes>
        <Route path="/" element={<><Home /><Footer /></>} />

        {/* Admin Guide */}
        <Route path="/admin/getting-started" element={<DocRoute sectionTitle="Admin Guide" path="/admin/getting-started" />} />
        <Route path="/admin/service-management" element={<DocRoute sectionTitle="Admin Guide" path="/admin/service-management" />} />
        <Route path="/admin/llm-management" element={<DocRoute sectionTitle="Admin Guide" path="/admin/llm-management" />} />
        <Route path="/admin/user-management" element={<DocRoute sectionTitle="Admin Guide" path="/admin/user-management" />} />
        <Route path="/admin/stats" element={<DocRoute sectionTitle="Admin Guide" path="/admin/stats" />} />

        {/* Service Guide */}
        <Route path="/service/service-registration" element={<DocRoute sectionTitle="Service Guide" path="/service/service-registration" />} />
        <Route path="/service/service-models" element={<DocRoute sectionTitle="Service Guide" path="/service/service-models" />} />
        <Route path="/service/service-users" element={<DocRoute sectionTitle="Service Guide" path="/service/service-users" />} />
        <Route path="/service/rate-limits" element={<DocRoute sectionTitle="Service Guide" path="/service/rate-limits" />} />
        <Route path="/service/usage-analytics" element={<DocRoute sectionTitle="Service Guide" path="/service/usage-analytics" />} />

        {/* User Guide */}
        <Route path="/user/getting-started" element={<DocRoute sectionTitle="User Guide" path="/user/getting-started" />} />
        <Route path="/user/service-registration" element={<DocRoute sectionTitle="User Guide" path="/user/service-registration" />} />
        <Route path="/user/my-usage" element={<DocRoute sectionTitle="User Guide" path="/user/my-usage" />} />

        {/* API Guide */}
        <Route path="/api/authentication" element={<DocRoute sectionTitle="API Guide" path="/api/authentication" />} />
        <Route path="/api/framework-integration" element={<DocRoute sectionTitle="API Guide" path="/api/framework-integration" />} />
        <Route path="/api/chat-completions" element={<DocRoute sectionTitle="API Guide" path="/api/chat-completions" />} />
        <Route path="/api/models" element={<DocRoute sectionTitle="API Guide" path="/api/models" />} />

        {/* Fallback */}
        <Route path="*" element={
          <div className="min-h-screen flex items-center justify-center bg-surface pt-16">
            <div className="text-center">
              <p className="text-6xl font-extrabold text-gradient mb-4">404</p>
              <p className="text-gray-400 mb-6">페이지를 찾을 수 없습니다</p>
              <a href="/docs/" className="text-brand-400 hover:text-brand-300 text-sm">홈으로 돌아가기</a>
            </div>
          </div>
        } />
      </Routes>
    </>
  );
}
