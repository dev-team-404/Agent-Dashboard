// Build-time markdown import — no runtime fetch needed
const modules = import.meta.glob('/public/content/**/*.md', { query: '?raw', eager: true }) as Record<string, { default: string }>;

// Normalize keys: '/public/content/admin/getting-started.md' → 'admin/getting-started.md'
const contentMap: Record<string, string> = {};
for (const [key, mod] of Object.entries(modules)) {
  const normalized = key.replace('/public/content/', '');
  contentMap[normalized] = mod.default;
}

export function getContent(path: string): string {
  return contentMap[path] || '# 페이지를 찾을 수 없습니다';
}
