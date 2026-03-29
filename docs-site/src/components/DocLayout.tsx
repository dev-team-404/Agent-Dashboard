import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Menu, X, Copy, Check, FileDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { guideSections } from '../data/guides';
import { getContent } from '../data/content';

interface SidebarItem {
  path: string;
  label: string;
}

interface DocLayoutProps {
  title: string;
  sidebarItems: SidebarItem[];
  contentPath: string;
}

/** 코드 블록에 복사 버튼 추가 */
function CodeBlockWithCopy({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
  const [codeCopied, setCodeCopied] = useState(false);
  const copyCode = () => {
    // children에서 텍스트 추출
    const child = children as React.ReactElement<{ children?: string }> | undefined;
    const raw = child?.props?.children || '';
    const text = typeof raw === 'string' ? raw : String(raw);
    navigator.clipboard.writeText(text).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };
  return (
    <div className="relative group">
      <button
        onClick={copyCode}
        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white rounded transition-all opacity-0 group-hover:opacity-100"
        title="코드 복사"
      >
        {codeCopied ? <><Check className="w-3 h-3" /> 복사됨</> : <><Copy className="w-3 h-3" /> 복사</>}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

export default function DocLayout({ title, sidebarItems, contentPath }: DocLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const location = useLocation();

  /** 원본 마크다운을 클립보드에 복사 */
  const copyMarkdown = useCallback(() => {
    const raw = getContent(contentPath);
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [contentPath]);

  /** 원본 마크다운을 .md 파일로 다운로드 */
  const downloadMarkdown = useCallback(() => {
    const raw = getContent(contentPath);
    const filename = contentPath.replace(/\//g, '-').replace(/\.md$/, '') + '.md';
    const blob = new Blob([raw], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [contentPath]);

  const content = useMemo(() => {
    const raw = getContent(contentPath);
    // Strip frontmatter
    const cleaned = raw.replace(/^---[\s\S]*?---\n*/m, '');
    // Convert ::: tip/warning/danger blocks to blockquotes
    return cleaned
      .replace(/::: (tip|warning|danger|info)(.*)\n([\s\S]*?):::/g, (_m, type, tipTitle, body) => {
        const icons: Record<string, string> = { tip: '💡', warning: '⚠️', danger: '🚨', info: 'ℹ️' };
        const icon = icons[type] || 'ℹ️';
        const heading = (tipTitle || '').trim();
        const lines = body.trim().split('\n').map((l: string) => `> ${l}`).join('\n');
        return heading
          ? `> ${icon} **${heading}**\n>\n${lines}\n`
          : `> ${icon}\n>\n${lines}\n`;
      });
  }, [contentPath]);

  useEffect(() => {
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
          {/* 마크다운 복사/다운로드 버튼 */}
          <div className="flex items-center gap-2 mb-6 max-w-3xl">
            <button
              onClick={copyMarkdown}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
              title="마크다운 원본을 클립보드에 복사합니다 (Claude, ChatGPT 등에 붙여넣기 가능)"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '복사됨' : 'Copy as Markdown'}
            </button>
            <button
              onClick={downloadMarkdown}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
              title="마크다운 파일(.md)로 다운로드합니다"
            >
              <FileDown className="w-3.5 h-3.5" />
              Download .md
            </button>
          </div>
          <article className="prose max-w-3xl">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                pre({ children, ...props }) {
                  return <CodeBlockWithCopy {...props}>{children}</CodeBlockWithCopy>;
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        </main>
      </div>
    </div>
  );
}
