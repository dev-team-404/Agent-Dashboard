import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Server, Shield, Brain, BarChart3, Users, Layers, Zap,
  GitBranch, Database, Globe, Sparkles,
  Network, Container, ChevronRight, Terminal,
  MonitorSpeaker, BookOpen, ChevronDown,
} from 'lucide-react';
import commitsData from './commits-data.json';

// ── 타임라인 날짜 (고정) ──
const timelineDates = [
  '2026.01.15',
  '2026.01.16 ~ 01.23',
  '2026.01.28 ~ 01.30',
  '2026.02.03 ~ 02.06',
  '2026.02.10 ~ 02.12',
  '2026.03.05',
  '2026.03.09',
  '2026.03.10 ~ 03.13',
  '2026.03.16 ~ 03.17',
  '2026.03.18 ~ 03.19',
  '2026.03.23',
  '2026.03.24 ~ 03.25',
  '2026.03.26 ~ 03.27',
  '2026.03.26 ~ 03.27',
  '2026.03.27',
  '2026.03.27',
  '2026.03.29',
  '2026.03.29',
  '2026.03.29',
  '2026.03.30',
  '2026.03.30',
  '2026.03.30',
  '2026.03.29',
  '2026.04.01',
  '2026.04.01',
  '2026.04.02',
  '2026.04.01',
  '2026.04.01',
  '2026.04.02',
  '2026.04.09',
];

// ── 기능 그룹 키/스타일 메타 (번역 불필요 부분) ──
const featureGroupMeta = [
  { key: 'serviceManagement', icon: Server, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', count: 7 },
  { key: 'monitoringAnalysis', icon: BarChart3, color: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', count: 19 },
  { key: 'aiFunctions', icon: Brain, color: 'from-violet-500 to-violet-600', bg: 'bg-violet-50', border: 'border-violet-100', count: 6 },
  { key: 'securityGovernance', icon: Shield, color: 'from-amber-500 to-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', count: 8 },
  { key: 'infraDevOps', icon: Server, color: 'from-cyan-500 to-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100', count: 6 },
];

// ── 팀 멤버 스타일 메타 ──
const teamMeta = [
  { initials: 'SH', color: 'from-blue-500 to-indigo-600' },
  { initials: 'BJ', color: 'from-emerald-500 to-teal-600' },
  { initials: 'YS', color: 'from-violet-500 to-purple-600' },
];

// ── 기술 스택 ──
const techStack = [
  'React 18', 'TypeScript', 'Vite', 'Tailwind CSS',
  'Express.js', 'Prisma', 'PostgreSQL 15', 'Redis 7',
  'Docker Compose', 'Nginx', 'SSE Streaming', 'SSH2',
];

export default function PlatformStory() {
  const { t } = useTranslation();

  // ── 아키텍처 레이어 (번역 적용) ──
  const archLayers = useMemo(() => [
    { label: 'Nginx', sub: t('platformStory.architecture.layers.nginx'), icon: Globe, color: 'bg-slate-700' },
    { label: 'React Dashboard', sub: t('platformStory.architecture.layers.dashboard'), icon: MonitorSpeaker, color: 'bg-blue-600' },
    { label: 'Express API', sub: t('platformStory.architecture.layers.api'), icon: Server, color: 'bg-emerald-600' },
    { label: 'PostgreSQL + Redis', sub: t('platformStory.architecture.layers.db'), icon: Database, color: 'bg-violet-600' },
  ], [t]);

  return (
    <div className="max-w-5xl mx-auto space-y-16 pb-20">

      {/* ════ Hero ════ */}
      <section className="relative pt-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            {t('platformStory.hero.badge')}
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-3">
            {t('platformStory.hero.title')}
          </h1>
          <p className="text-lg text-gray-500 font-medium">
            {t('platformStory.hero.subtitle')}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { value: '31', label: t('platformStory.stats.pages'), icon: Layers, color: 'text-blue-600 bg-blue-50' },
            { value: '80+', label: t('platformStory.stats.apiEndpoints'), icon: Network, color: 'text-emerald-600 bg-emerald-50' },
            { value: '6', label: t('platformStory.stats.aiFunctions'), icon: Brain, color: 'text-violet-600 bg-violet-50' },
            { value: t('platformStory.stats.threeLevel'), label: t('platformStory.stats.permissionLevels'), icon: Shield, color: 'text-amber-600 bg-amber-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-5 text-center shadow-sm">
              <div className={`w-10 h-10 rounded-lg ${stat.color} flex items-center justify-center mx-auto mb-3`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Feature Highlights ════ */}
      <section>
        <SectionHeader icon={Zap} title={t('platformStory.sections.featureHighlights')} subtitle={t('platformStory.sections.featureHighlightsSub')} />
        <div className="grid md:grid-cols-2 gap-5">
          {featureGroupMeta.map((group) => (
            <div key={group.key} className={`${group.bg} ${group.border} border rounded-xl p-6`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${group.color} flex items-center justify-center`}>
                  <group.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-gray-800 text-sm">{t(`platformStory.featureGroups.${group.key}.title`)}</h3>
              </div>
              <ul className="space-y-2">
                {Array.from({ length: group.count }, (_, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-gray-600">
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    {t(`platformStory.featureGroups.${group.key}.features.${i}`)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Architecture ════ */}
      <section>
        <SectionHeader icon={Container} title={t('platformStory.sections.architecture')} subtitle={t('platformStory.sections.architectureSub')} />
        <div className="bg-white rounded-xl border border-gray-100 p-8 shadow-sm">
          {/* Layers */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <Users className="w-4 h-4" /> {t('platformStory.architecture.userRequest')}
            </div>
            {archLayers.map((layer, i) => (
              <div key={layer.label} className="w-full max-w-md">
                <div className={`${layer.color} rounded-lg px-5 py-3.5 text-white flex items-center gap-3`}>
                  <layer.icon className="w-5 h-5 opacity-80" />
                  <div>
                    <div className="font-semibold text-sm">{layer.label}</div>
                    <div className="text-xs opacity-70">{layer.sub}</div>
                  </div>
                </div>
                {i < archLayers.length - 1 && (
                  <div className="flex justify-center py-1">
                    <div className="w-px h-4 bg-gray-300" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Monorepo */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">{t('platformStory.architecture.monorepoStructure')}</div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { name: 'packages/dashboard', desc: 'React SPA', icon: MonitorSpeaker },
                { name: 'packages/api', desc: 'Express REST API', icon: Server },
                { name: 'docs-site', desc: 'Documentation', icon: BookOpen },
              ].map((pkg) => (
                <div key={pkg.name} className="flex items-center gap-2.5 px-3 py-2.5 bg-gray-50 rounded-lg">
                  <pkg.icon className="w-4 h-4 text-gray-400" />
                  <div>
                    <div className="text-xs font-mono font-medium text-gray-700">{pkg.name}</div>
                    <div className="text-[10px] text-gray-400">{pkg.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deploy */}
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
            <Container className="w-3.5 h-3.5" />
            {t('platformStory.architecture.deployNote')}
          </div>
        </div>
      </section>

      {/* ════ Development Timeline ════ */}
      <section>
        <SectionHeader icon={GitBranch} title={t('platformStory.sections.timeline')} subtitle={t('platformStory.sections.timelineSub')} />
        <div className="relative">
          {/* 수직 라인 */}
          <div className="absolute left-[18px] top-2 bottom-2 w-px bg-gradient-to-b from-blue-200 via-violet-200 to-emerald-200" />

          <div className="space-y-6">
            {timelineDates.map((date, i) => (
              <div key={i} className="relative flex gap-5">
                {/* 도트 */}
                <div className="relative z-10 mt-1.5">
                  <div className="w-[9px] h-[9px] rounded-full bg-white border-[2.5px] border-blue-500 shadow-sm" />
                </div>

                {/* 콘텐츠 */}
                <div className="flex-1 pb-2">
                  <div className="text-xs font-mono text-blue-600 font-medium mb-1">{date}</div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-1">{t(`platformStory.timeline.${i}.title`)}</h4>
                  <p className="text-[13px] text-gray-500 leading-relaxed mb-2">{t(`platformStory.timeline.${i}.desc`)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {t(`platformStory.timeline.${i}.tags`).split(',').map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════ Team ════ */}
      <section>
        <SectionHeader icon={Users} title={t('platformStory.sections.team')} subtitle={t('platformStory.sections.teamSub')} />
        <div className="grid md:grid-cols-3 gap-5">
          {teamMeta.map((meta, i) => (
            <div key={meta.initials} className="bg-white rounded-xl border border-gray-100 p-6 text-center shadow-sm">
              <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${meta.color} flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/10`}>
                <span className="text-white font-bold text-lg">{meta.initials}</span>
              </div>
              <h4 className="font-semibold text-gray-800 text-sm">{t(`platformStory.team.${i}.name`)}</h4>
              <p className="text-xs text-blue-600 font-medium mt-0.5">{t(`platformStory.team.${i}.role`)}</p>
              <p className="text-xs text-gray-400 mt-1">{t(`platformStory.team.${i}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Tech Stack ════ */}
      <section>
        <SectionHeader icon={Terminal} title={t('platformStory.sections.techStack')} subtitle={t('platformStory.sections.techStackSub')} />
        <div className="flex flex-wrap gap-2 justify-center">
          {techStack.map((tech) => (
            <span key={tech} className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-600 shadow-sm">
              {tech}
            </span>
          ))}
        </div>
      </section>

      {/* ════ Commit History (접이식, 작게) ════ */}
      <CommitHistory />

      {/* ════ Footer Quote ════ */}
      <section className="text-center pt-8 border-t border-gray-100">
        <p className="text-lg text-gray-400 italic font-light">
          {t('platformStory.footer.quote')}
        </p>
        <p className="text-xs text-gray-300 mt-2 font-medium">
          {t('platformStory.footer.author')}
        </p>
      </section>
    </div>
  );
}

// ── Commit History (접이식) ──
interface Commit { hash: string; date: string; author: string; subject: string; }

const authorColors: Record<string, string> = {
  'syngha.han': 'text-blue-600',
  'byeongjulee91-dev': 'text-emerald-600',
  '한승하': 'text-blue-600',
  'Claude': 'text-violet-500',
};

function CommitHistory() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const commits = commitsData as Commit[];
  const total = commits.length;

  // 날짜별 그루핑
  const grouped = commits.reduceRight((acc, c) => {
    const d = c.date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(c);
    return acc;
  }, {} as Record<string, Commit[]>);
  const dates = Object.keys(grouped);

  return (
    <section className="pt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[11px] text-gray-300 hover:text-gray-400 transition-colors mx-auto"
      >
        <GitBranch className="w-3 h-3" />
        <span>{t('platformStory.commitHistory.toggle')}{total > 0 ? ` (${total})` : ''}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 max-h-[500px] overflow-y-auto border border-gray-100 rounded-lg bg-gray-50/50">
          <div className="divide-y divide-gray-100">
            {dates.map(date => (
              <div key={date}>
                <div className="sticky top-0 bg-gray-50 px-4 py-1.5 border-b border-gray-100">
                  <span className="text-[10px] font-mono font-medium text-gray-400">{date}</span>
                  <span className="text-[10px] text-gray-300 ml-2">{t('platformStory.commitHistory.count', { count: grouped[date].length })}</span>
                </div>
                {grouped[date].map(c => (
                  <div key={c.hash} className="px-4 py-1.5 flex items-start gap-2 hover:bg-white/60 transition-colors">
                    <code className="text-[10px] font-mono text-gray-300 mt-px flex-shrink-0">{c.hash}</code>
                    <span className={`text-[10px] font-medium flex-shrink-0 w-24 truncate ${authorColors[c.author] || 'text-gray-400'}`}>
                      {c.author}
                    </span>
                    <span className="text-[10px] text-gray-500 leading-relaxed">{c.subject}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Section Header ──
function SectionHeader({ icon: Icon, title, subtitle }: { icon: typeof Zap; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
        <Icon className="w-4 h-4 text-gray-500" />
      </div>
      <div>
        <h2 className="text-sm font-bold text-gray-800 tracking-wide">{title}</h2>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}
