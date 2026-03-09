import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Menu, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { guideSections } from '../data/guides';

interface SidebarItem {
  path: string;
  label: string;
}

interface DocLayoutProps {
  title: string;
  sidebarItems: SidebarItem[];
  contentPath: string;
}

export default function DocLayout({ title, sidebarItems, contentPath }: DocLayoutProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setLoading(true);
    fetch(`/docs/content/${contentPath}`)
      .then((r) => r.ok ? r.text() : '# 페이지를 찾을 수 없습니다')
      .then((text) => {
        // Strip frontmatter
        const cleaned = text.replace(/^---[\s\S]*?---\n*/m, '');
        // Convert ::: tip/warning/danger blocks to blockquotes
        const processed = cleaned
          .replace(/::: (tip|warning|danger|info)(.*)\n([\s\S]*?):::/g, (_m, type, title, body) => {
            const icons: Record<string, string> = { tip: '💡', warning: '⚠️', danger: '🚨', info: 'ℹ️' };
            const icon = icons[type] || 'ℹ️';
            const heading = (title || '').trim();
            const lines = body.trim().split('\n').map((l: string) => `> ${l}`).join('\n');
            return heading
              ? `> ${icon} **${heading}**\n>\n${lines}\n`
              : `> ${icon}\n>\n${lines}\n`;
          });
        setContent(processed);
        setLoading(false);
      })
      .catch(() => { setContent('# 로딩 실패'); setLoading(false); });
    window.scrollTo(0, 0);
  }, [contentPath]);

  return (
    <div className="min-h-screen bg-white pt-16">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed bottom-6 right-6 z-40 p-3 bg-brand-500 text-white rounded-full shadow-lg shadow-brand-500/30"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      <div className="max-w-7xl mx-auto flex">
        {/* Sidebar */}
        <aside className={`fixed lg:sticky top-16 left-0 h-[calc(100vh-4rem)] w-72 bg-white lg:bg-transparent border-r border-gray-100 lg:border-r-0 z-30 overflow-y-auto transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-6">
            {/* Current section */}
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h3>
            <ul className="space-y-1">
              {sidebarItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                        isActive
                          ? 'bg-brand-50 text-brand-600 font-medium'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {isActive && <ChevronRight className="w-3.5 h-3.5 text-brand-500" />}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Other sections */}
            <div className="mt-8 pt-6 border-t border-gray-100">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">다른 가이드</h4>
              {guideSections
                .filter((s) => s.title !== title)
                .map((section) => (
                  <Link
                    key={section.id}
                    to={section.items[0].path}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-all"
                  >
                    <span>{section.icon}</span>
                    <span>{section.title}</span>
                  </Link>
                ))}
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 px-6 lg:px-12 py-10 lg:ml-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <article className="prose max-w-3xl">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {content}
              </ReactMarkdown>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
