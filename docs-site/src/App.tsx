import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import DocLayout from './components/DocLayout';
import Home from './pages/Home';
import ServicePage from './pages/ServicePage';
import { services } from './data/services';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// Lookup content path for doc routes
function guideContentPath(path: string): string {
  // Map route paths to content file paths
  const map: Record<string, string> = {
    '/guide/getting-started': 'guide/getting-started.md',
    '/guide/basic-usage': 'guide/basic-usage.md',
    '/guide/advanced-usage': 'guide/advanced-usage.md',
    '/guide/browser-tools': 'guide/browser-tools.md',
    '/guide/office-tools': 'guide/office-tools.md',
    '/guide/compact': 'guide/compact.md',
    '/guide/wsl-setup': 'guide/wsl-setup.md',
    '/guide-windows/getting-started': 'guide-windows/getting-started.md',
    '/guide-windows/basic-usage': 'guide-windows/basic-usage.md',
    '/guide-windows/faq': 'guide-windows/faq.md',
    '/once/guide/getting-started': 'once/guide/getting-started.md',
    '/once/guide/basic-usage': 'once/guide/basic-usage.md',
    '/once/guide/collaboration': 'once/guide/collaboration.md',
    '/once/guide/advanced': 'once/guide/advanced.md',
    '/once/faq': 'once/faq.md',
    '/free/guide/getting-started': 'free/guide/getting-started.md',
    '/free/guide/basic-usage': 'free/guide/basic-usage.md',
    '/free/guide/reports': 'free/guide/reports.md',
    '/free/guide/admin': 'free/guide/admin.md',
    '/free/faq': 'free/faq.md',
  };
  return map[path] || '';
}

function DocRoute({ sectionTitle, path }: { sectionTitle: string; path: string }) {
  const service = services.find((s) =>
    s.guides.some((g) => g.path === path) ||
    path.startsWith(s.path.replace(/^\//, '') + '/')
  );

  // Build sidebar from the matching service's guides
  let sidebarItems = service?.guides || [];

  // For CLI guide, also include the guide/* items
  if (path.startsWith('/guide/') && !path.startsWith('/guide-windows/')) {
    sidebarItems = services[0].guides;
  } else if (path.startsWith('/guide-windows/')) {
    sidebarItems = services[1].guides;
  } else if (path.startsWith('/once/')) {
    sidebarItems = services[2].guides;
  } else if (path.startsWith('/free/')) {
    sidebarItems = services[3].guides;
  }

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

        {/* Service pages */}
        <Route path="/nexus-coder" element={<><ServicePage /><Footer /></>} />
        <Route path="/nexus-coder-windows" element={<><ServicePage /><Footer /></>} />
        <Route path="/once" element={<><ServicePage /><Footer /></>} />
        <Route path="/free" element={<><ServicePage /><Footer /></>} />

        {/* CLI Guide docs */}
        <Route path="/guide/getting-started" element={<DocRoute sectionTitle="Nexus Coder 가이드" path="/guide/getting-started" />} />
        <Route path="/guide/basic-usage" element={<DocRoute sectionTitle="Nexus Coder 가이드" path="/guide/basic-usage" />} />
        <Route path="/guide/advanced-usage" element={<DocRoute sectionTitle="Nexus Coder 가이드" path="/guide/advanced-usage" />} />
        <Route path="/guide/browser-tools" element={<DocRoute sectionTitle="Nexus Coder 가이드" path="/guide/browser-tools" />} />
        <Route path="/guide/office-tools" element={<DocRoute sectionTitle="Nexus Coder 가이드" path="/guide/office-tools" />} />
        <Route path="/guide/compact" element={<DocRoute sectionTitle="Nexus Coder 가이드" path="/guide/compact" />} />
        <Route path="/guide/wsl-setup" element={<DocRoute sectionTitle="Nexus Coder 가이드" path="/guide/wsl-setup" />} />

        {/* Windows Guide docs */}
        <Route path="/guide-windows/getting-started" element={<DocRoute sectionTitle="Windows 가이드" path="/guide-windows/getting-started" />} />
        <Route path="/guide-windows/basic-usage" element={<DocRoute sectionTitle="Windows 가이드" path="/guide-windows/basic-usage" />} />
        <Route path="/guide-windows/faq" element={<DocRoute sectionTitle="Windows 가이드" path="/guide-windows/faq" />} />

        {/* ONCE docs */}
        <Route path="/once/guide/getting-started" element={<DocRoute sectionTitle="ONCE 가이드" path="/once/guide/getting-started" />} />
        <Route path="/once/guide/basic-usage" element={<DocRoute sectionTitle="ONCE 가이드" path="/once/guide/basic-usage" />} />
        <Route path="/once/guide/collaboration" element={<DocRoute sectionTitle="ONCE 가이드" path="/once/guide/collaboration" />} />
        <Route path="/once/guide/advanced" element={<DocRoute sectionTitle="ONCE 가이드" path="/once/guide/advanced" />} />
        <Route path="/once/faq" element={<DocRoute sectionTitle="ONCE 가이드" path="/once/faq" />} />

        {/* FREE docs */}
        <Route path="/free/guide/getting-started" element={<DocRoute sectionTitle="FREE 가이드" path="/free/guide/getting-started" />} />
        <Route path="/free/guide/basic-usage" element={<DocRoute sectionTitle="FREE 가이드" path="/free/guide/basic-usage" />} />
        <Route path="/free/guide/reports" element={<DocRoute sectionTitle="FREE 가이드" path="/free/guide/reports" />} />
        <Route path="/free/guide/admin" element={<DocRoute sectionTitle="FREE 가이드" path="/free/guide/admin" />} />
        <Route path="/free/faq" element={<DocRoute sectionTitle="FREE 가이드" path="/free/faq" />} />

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
