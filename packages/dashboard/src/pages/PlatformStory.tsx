import {
  Server, Shield, Brain, BarChart3, Cpu, Users, Layers, Zap,
  GitBranch, Database, Globe, Lock, Clock, ArrowRight,
  Activity, Eye, AlertTriangle, Bot, Sparkles, FileText,
  Network, Container, ChevronRight, Terminal, Gauge,
  MonitorSpeaker, TreePine, KeyRound, CalendarDays, BookOpen,
} from 'lucide-react';

// ── 타임라인 데이터 (커밋 히스토리 기반) ──
const timeline = [
  {
    date: '2026.01 초',
    title: '프로젝트 시작',
    desc: '멀티서비스 대시보드 초기 구조 설계, LLM 프록시 라우팅 구현, 서비스 등록/관리 시스템',
    tags: ['프록시', '서비스 CRUD', '모델 CRUD'],
  },
  {
    date: '2026.01 중',
    title: '권한 체계 & 모니터링 기반',
    desc: '5단계→3단계 권한 시스템, 통합 대시보드, 부서별 사용량 분석, Rate Limiting, 레이턴시 모니터링',
    tags: ['권한 체계', '대시보드', 'Rate Limit', '레이턴시'],
  },
  {
    date: '2026.01 말',
    title: 'SubModel & 고가용성',
    desc: 'SubModel 로드밸런싱, 자동 Failover, 엔드포인트 헬스체크, 에러 텔레메트리, Knox 인증 연동',
    tags: ['SubModel', 'Failover', '헬스체크', 'Knox'],
  },
  {
    date: '2026.02',
    title: '조직 연동 & 인사이트',
    desc: '조직도(org_nodes) 기반 부서 계층 통합, 가시성(Visibility) 스코프, 인사이트 대시보드, Saved M/M 관리',
    tags: ['조직도', '가시성', '인사이트', 'M/M'],
  },
  {
    date: '2026.03 초',
    title: 'GPU 모니터링 & AI 기능',
    desc: 'SSH 기반 GPU 실시간 모니터링, LLM 서빙 메트릭 자동 탐지, AI M/M 추정, 에러 자동 분석, GPU 수요 예측',
    tags: ['GPU 모니터링', 'AI 추정', '에러 분석', '수요 예측'],
  },
  {
    date: '2026.03 중',
    title: '가이드 투어 & AI 도우미',
    desc: '권한별 온보딩 가이드 투어, 등록 마법사, AI 도우미 챗봇(SSE 스트리밍), 서비스 로고 AI 생성',
    tags: ['가이드 투어', 'AI 챗봇', '로고 생성'],
  },
  {
    date: '2026.03 말',
    title: '성능 최적화 & 고도화',
    desc: '382→6 쿼리 통합, Batch API, AI 코칭, 서비스 품질 메트릭 6종(TTFT/TPOT/E2E 등), FP8 자동 감지, 처리량 3단 분석',
    tags: ['성능 최적화', 'AI 코칭', '품질 메트릭', 'FP8'],
  },
];

// ── 기능 카테고리 ──
const featureGroups = [
  {
    title: '서비스 관리',
    icon: Server,
    color: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    features: [
      'LLM 프록시 라우팅 (OpenAI 호환)',
      '가중치 기반 라운드로빈 로드밸런싱',
      'SubModel 자동 Failover',
      '토큰 기반 Rate Limiting',
      '서비스 마켓플레이스 & 배포 관리',
      'STANDARD / BACKGROUND 서비스 타입',
    ],
  },
  {
    title: '모니터링 & 분석',
    icon: BarChart3,
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
    features: [
      'SSH 기반 GPU 실시간 모니터링',
      '토큰 사용량 / DAU·MAU 대시보드',
      '모델 레이턴시 & 헬스체크 (10분 주기)',
      '에러 추적 & Failover 시도 상세',
      '부서별 / 본부별 인사이트',
      '서비스 품질 메트릭 (TTFT, TPOT, E2E)',
    ],
  },
  {
    title: 'AI 기능',
    icon: Brain,
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-100',
    features: [
      'M/M 절감 AI 자동 추정',
      '에러 패턴 AI 자동 분석/분류',
      'GPU 수요 예측 (LLM 기반)',
      '서비스 로고 AI 자동 생성',
      'AI 도우미 챗봇 (SSE 스트리밍)',
      'GPU 서버 AI 코칭 리포트',
    ],
  },
  {
    title: '보안 & 거버넌스',
    icon: Shield,
    color: 'from-amber-500 to-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    features: [
      '3단계 권한 체계 (SUPER_ADMIN → ADMIN → USER)',
      '5단계 모델 가시성 (Visibility Scope)',
      '감사 로그 & 요청 로그',
      'Knox 임직원 인증 연동',
      '조직도 기반 부서 관리',
      'API 비밀번호 & 서비스 격리',
    ],
  },
];

// ── 아키텍처 레이어 ──
const archLayers = [
  { label: 'Nginx', sub: 'Reverse Proxy · :8090', icon: Globe, color: 'bg-slate-700' },
  { label: 'React Dashboard', sub: 'Vite + Tailwind CSS', icon: MonitorSpeaker, color: 'bg-blue-600' },
  { label: 'Express API', sub: 'Prisma ORM · SSE', icon: Server, color: 'bg-emerald-600' },
  { label: 'PostgreSQL + Redis', sub: '영속 저장소 · 캐시', icon: Database, color: 'bg-violet-600' },
];

// ── 기술 스택 ──
const techStack = [
  'React 18', 'TypeScript', 'Vite', 'Tailwind CSS',
  'Express.js', 'Prisma', 'PostgreSQL 15', 'Redis 7',
  'Docker Compose', 'Nginx', 'SSE Streaming', 'SSH2',
];

// ── 팀 ──
const team = [
  { name: '한승하', initials: 'SH', role: 'Developer', desc: '기획 · 설계 · 풀스택 개발', color: 'from-blue-500 to-indigo-600' },
  { name: '이병주', initials: 'BJ', role: 'Developer', desc: '기획 · 설계 · 개발', color: 'from-emerald-500 to-teal-600' },
  { name: '김영섭', initials: 'YS', role: 'Developer', desc: '기획 · 설계 · 개발', color: 'from-violet-500 to-purple-600' },
];

export default function PlatformStory() {
  return (
    <div className="max-w-5xl mx-auto space-y-16 pb-20">

      {/* ════ Hero ════ */}
      <section className="relative pt-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            572 commits · 52,000+ lines of code
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-3">
            Agent Registry & Dashboard
          </h1>
          <p className="text-lg text-gray-500 font-medium">
            사내 AI 서비스의 통합 관제탑
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { value: '27', label: '페이지', icon: Layers, color: 'text-blue-600 bg-blue-50' },
            { value: '50+', label: 'API 엔드포인트', icon: Network, color: 'text-emerald-600 bg-emerald-50' },
            { value: '6', label: 'AI 기능', icon: Brain, color: 'text-violet-600 bg-violet-50' },
            { value: '3단계', label: '권한 체계', icon: Shield, color: 'text-amber-600 bg-amber-50' },
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
        <SectionHeader icon={Zap} title="Feature Highlights" subtitle="플랫폼 핵심 기능" />
        <div className="grid md:grid-cols-2 gap-5">
          {featureGroups.map((group) => (
            <div key={group.title} className={`${group.bg} ${group.border} border rounded-xl p-6`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${group.color} flex items-center justify-center`}>
                  <group.icon className="w-4.5 h-4.5 text-white" />
                </div>
                <h3 className="font-semibold text-gray-800 text-sm">{group.title}</h3>
              </div>
              <ul className="space-y-2">
                {group.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-gray-600">
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Architecture ════ */}
      <section>
        <SectionHeader icon={Container} title="Architecture" subtitle="시스템 아키텍처" />
        <div className="bg-white rounded-xl border border-gray-100 p-8 shadow-sm">
          {/* Layers */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <Users className="w-4 h-4" /> 사용자 요청
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
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Monorepo 구조</div>
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
            Docker Compose 기반 Blue-Green 배포 · git pull && ./deploy.sh
          </div>
        </div>
      </section>

      {/* ════ Development Timeline ════ */}
      <section>
        <SectionHeader icon={GitBranch} title="Development Timeline" subtitle="개발 여정 · 572 commits" />
        <div className="relative">
          {/* 수직 라인 */}
          <div className="absolute left-[18px] top-2 bottom-2 w-px bg-gradient-to-b from-blue-200 via-violet-200 to-emerald-200" />

          <div className="space-y-6">
            {timeline.map((item, i) => (
              <div key={i} className="relative flex gap-5">
                {/* 도트 */}
                <div className="relative z-10 mt-1.5">
                  <div className="w-[9px] h-[9px] rounded-full bg-white border-[2.5px] border-blue-500 shadow-sm" />
                </div>

                {/* 콘텐츠 */}
                <div className="flex-1 pb-2">
                  <div className="text-xs font-mono text-blue-600 font-medium mb-1">{item.date}</div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-1">{item.title}</h4>
                  <p className="text-[13px] text-gray-500 leading-relaxed mb-2">{item.desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
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
        <SectionHeader icon={Users} title="Team" subtitle="개발팀" />
        <div className="grid md:grid-cols-3 gap-5">
          {team.map((member) => (
            <div key={member.name} className="bg-white rounded-xl border border-gray-100 p-6 text-center shadow-sm">
              <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${member.color} flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/10`}>
                <span className="text-white font-bold text-lg">{member.initials}</span>
              </div>
              <h4 className="font-semibold text-gray-800 text-sm">{member.name}</h4>
              <p className="text-xs text-blue-600 font-medium mt-0.5">{member.role}</p>
              <p className="text-xs text-gray-400 mt-1">{member.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Tech Stack ════ */}
      <section>
        <SectionHeader icon={Terminal} title="Tech Stack" subtitle="기술 스택" />
        <div className="flex flex-wrap gap-2 justify-center">
          {techStack.map((tech) => (
            <span key={tech} className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-600 shadow-sm">
              {tech}
            </span>
          ))}
        </div>
      </section>

      {/* ════ Footer Quote ════ */}
      <section className="text-center pt-8 border-t border-gray-100">
        <p className="text-lg text-gray-400 italic font-light">
          "모든 팀이 AI의 힘을 쉽게 활용할 수 있도록"
        </p>
        <p className="text-xs text-gray-300 mt-2 font-medium">
          — Agent Registry Team
        </p>
      </section>
    </div>
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
