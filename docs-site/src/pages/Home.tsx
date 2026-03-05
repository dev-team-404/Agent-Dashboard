import { Link } from 'react-router-dom';
import { ArrowRight, Terminal, Sparkles, Zap, Globe, FileText, GitBranch } from 'lucide-react';
import { services } from '../data/services';

function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-surface">
      {/* Animated gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-brand-500/20 blur-[120px] animate-float" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-accent/15 blur-[120px] animate-float-delay" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-brand-600/10 blur-[150px]" />
      </div>

      {/* Grid pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />

      <div className="relative max-w-7xl mx-auto px-6 py-32 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 mb-8 animate-fade-up">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm text-gray-300">v5.0.2 — Latest Release</span>
          <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
        </div>

        {/* Hero heading */}
        <h1 className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[0.9] mb-8 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <span className="text-white">Code with</span>
          <br />
          <span className="text-gradient">AI Intelligence</span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg sm:text-xl text-gray-400 leading-relaxed mb-12 animate-fade-up" style={{ animationDelay: '0.2s' }}>
          자연어로 요구사항을 설명하면 AI가 코드를 작성합니다.
          <br className="hidden sm:block" />
          브라우저 자동화, 오피스 자동화까지 — 올인원 코딩 에이전트.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20 animate-fade-up" style={{ animationDelay: '0.3s' }}>
          <Link
            to="/nexus-coder"
            className="group px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-600 rounded-xl hover:shadow-2xl hover:shadow-brand-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-2"
          >
            시작하기
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        {/* Terminal preview */}
        <div className="max-w-3xl mx-auto animate-fade-up" style={{ animationDelay: '0.4s' }}>
          <div className="rounded-2xl bg-surface-light/80 backdrop-blur border border-white/10 shadow-2xl overflow-hidden glow">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <span className="text-xs text-gray-500 ml-2 font-mono">nexus</span>
            </div>
            <div className="p-6 font-mono text-sm leading-7">
              <div className="text-gray-500">$ nexus</div>
              <div className="text-brand-400 mt-2">╭ Nexus Coder v5.0.2</div>
              <div className="text-gray-400">│</div>
              <div className="text-white">│ <span className="text-green-400">✓</span> Connected to AI Engine</div>
              <div className="text-white">│ <span className="text-green-400">✓</span> Browser Tools Ready</div>
              <div className="text-white">│ <span className="text-green-400">✓</span> Office Tools Ready</div>
              <div className="text-gray-400">│</div>
              <div className="text-brand-400">╰ Ready. What would you like to build?</div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-accent">❯</span>
                <span className="text-gray-300">React 대시보드를 만들어줘. 차트와 테이블이 포함된</span>
                <span className="inline-block w-2 h-5 bg-brand-400 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  const stats = [
    { value: '4', label: '통합 서비스', suffix: '' },
    { value: '56+', label: 'Office 도구', suffix: '' },
    { value: '100', label: 'Air-Gapped', suffix: '%' },
    { value: '5.0', label: '최신 버전', suffix: '' },
  ];

  return (
    <section className="relative bg-surface border-y border-white/5">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <div key={i} className="text-center">
              <p className="text-4xl font-extrabold text-gradient-brand">{stat.value}{stat.suffix}</p>
              <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    { icon: <Terminal className="w-6 h-6" />, title: 'Vibe Coding', description: '자연어 대화로 코드를 작성하고 리팩토링합니다. 복잡한 프로젝트도 대화로 완성하세요.', color: 'from-blue-500 to-cyan-400' },
    { icon: <Globe className="w-6 h-6" />, title: 'Browser Automation', description: 'Chrome, Edge를 직접 제어하여 프론트엔드 테스트와 데이터 수집을 자동화합니다.', color: 'from-violet-500 to-purple-400' },
    { icon: <FileText className="w-6 h-6" />, title: 'Office Automation', description: 'Word 16개, Excel 27개, PowerPoint 13개 도구로 문서 작업을 완전 자동화합니다.', color: 'from-emerald-500 to-teal-400' },
    { icon: <Zap className="w-6 h-6" />, title: 'Planning Mode', description: '복잡한 작업을 TODO 리스트로 분해하여 체계적으로 실행합니다.', color: 'from-amber-500 to-orange-400' },
    { icon: <GitBranch className="w-6 h-6" />, title: 'Git Integration', description: '커밋, 브랜치 관리, PR 생성, 충돌 해결까지 Git 워크플로우를 자동화합니다.', color: 'from-pink-500 to-rose-400' },
    { icon: <Sparkles className="w-6 h-6" />, title: 'Context Intelligence', description: '대화 컨텍스트를 자동 압축하여 긴 세션에서도 정확한 응답을 유지합니다.', color: 'from-indigo-500 to-blue-400' },
  ];

  return (
    <section className="bg-surface py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-3">Capabilities</p>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            개발의 모든 것을 자동화
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-gray-400">
            코드 작성부터 브라우저 테스트, 오피스 문서 작업, Git 관리까지 — AI가 모두 처리합니다.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div key={i} className="group p-6 rounded-2xl glass hover:bg-white/10 transition-all duration-300 hover:-translate-y-1">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                {f.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ServicesSection() {
  return (
    <section className="bg-white py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-500 uppercase tracking-wider mb-3">Platform</p>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight">
            통합 AI 서비스 플랫폼
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-gray-500">
            코딩 자동화부터 지식 관리, 주간보고까지 — 4개의 AI 서비스가 하나의 플랫폼에서 동작합니다.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {services.map((s) => (
            <Link
              key={s.id}
              to={s.path}
              className="group relative p-8 rounded-2xl border border-gray-100 bg-white hover:shadow-xl hover:shadow-gray-100/50 transition-all duration-300 hover:-translate-y-1 overflow-hidden"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />
              <div className="relative">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">{s.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-gray-900">{s.name}</h3>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                        s.status === 'stable' ? 'bg-green-100 text-green-700' :
                        s.status === 'beta' ? 'bg-amber-100 text-amber-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {s.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{s.tagline}</p>
                  </div>
                </div>
                <p className="text-gray-600 leading-relaxed mb-6">{s.description}</p>
                <div className="flex items-center text-sm font-medium text-brand-500 group-hover:text-brand-600">
                  자세히 보기
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="relative bg-surface py-24 overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-brand-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-accent/10 blur-[120px]" />
      </div>
      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-6">
          지금 시작하세요
        </h2>
        <p className="text-lg text-gray-400 mb-10">
          설치부터 첫 코드 생성까지 3분이면 충분합니다.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/guide/getting-started"
            className="group px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-600 rounded-xl hover:shadow-2xl hover:shadow-brand-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-2"
          >
            CLI 시작하기 <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            to="/guide-windows/getting-started"
            className="px-8 py-4 text-base font-semibold text-gray-300 glass rounded-xl hover:bg-white/10 transition-all">
            Windows 다운로드
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <HeroSection />
      <StatsSection />
      <FeaturesSection />
      <ServicesSection />
      <CTASection />
    </>
  );
}
