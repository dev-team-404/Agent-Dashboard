import { Link } from 'react-router-dom';
import { ArrowRight, Shield, User, Code, BookOpen, ChevronRight, Settings, Smartphone, Search, MessageCircle, Zap } from 'lucide-react';
import { guideSections } from '../data/guides';

function HeroSection() {
  return (
    <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden bg-surface">
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
          <BookOpen className="w-4 h-4 text-brand-400" />
          <span className="text-sm text-gray-300">Dashboard Usage Guide</span>
        </div>

        {/* Hero heading */}
        <h1 className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[0.9] mb-8 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <span className="text-white">Agent Registry</span>
          <br />
          <span className="text-gradient">사용 가이드</span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg sm:text-xl text-gray-400 leading-relaxed mb-12 animate-fade-up" style={{ animationDelay: '0.2s' }}>
          관리자 설정부터 API 연동까지, Dashboard의 모든 기능을 안내합니다.
          <br className="hidden sm:block" />
          역할에 맞는 가이드를 선택하여 시작하세요.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-up" style={{ animationDelay: '0.3s' }}>
          <Link
            to="/admin/getting-started"
            className="group px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-600 rounded-xl hover:shadow-2xl hover:shadow-brand-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-3"
          >
            <Shield className="w-5 h-5" />
            Admin 가이드
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            to="/user/getting-started"
            className="group px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-violet-500 to-purple-500 rounded-xl hover:shadow-2xl hover:shadow-violet-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-3"
          >
            <User className="w-5 h-5" />
            User 가이드
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            to="/api/authentication"
            className="group px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl hover:shadow-2xl hover:shadow-emerald-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-3"
          >
            <Code className="w-5 h-5" />
            API 가이드
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function GuideSectionsGrid() {
  const sectionIcons: Record<string, React.ReactNode> = {
    admin: <Shield className="w-7 h-7" />,
    service: <Settings className="w-7 h-7" />,
    user: <User className="w-7 h-7" />,
    api: <Code className="w-7 h-7" />,
  };

  return (
    <section className="bg-surface py-24 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-3">Guide Categories</p>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            역할별 가이드
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-gray-400">
            관리자, 사용자, 개발자 각각의 역할에 맞는 가이드를 제공합니다.
          </p>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-8">
          {guideSections.map((section) => (
            <div key={section.id} className="group rounded-2xl glass hover:bg-white/10 transition-all duration-300 hover:-translate-y-1 overflow-hidden">
              {/* Card header */}
              <div className={`p-6 bg-gradient-to-br ${section.gradient} bg-opacity-10`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${section.gradient} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
                    {sectionIcons[section.id]}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">{section.title}</h3>
                    <p className="text-sm text-gray-400">{section.description}</p>
                  </div>
                </div>
              </div>

              {/* Card items */}
              <div className="p-4 space-y-1">
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className="flex items-center justify-between px-4 py-3 rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-all group/item"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover/item:text-brand-400 group-hover/item:translate-x-0.5 transition-all" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuickStartSection() {
  const steps = [
    {
      number: '01',
      title: 'Dashboard 접속',
      description: '브라우저에서 Agent Registry에 접속하여 SSO 로그인합니다.',
      color: 'from-blue-500 to-cyan-400',
    },
    {
      number: '02',
      title: '서비스 등록',
      description: 'Admin이 서비스를 등록하고 LLM 모델을 설정합니다.',
      color: 'from-violet-500 to-purple-400',
    },
    {
      number: '03',
      title: 'API 연동',
      description: '서비스 ID와 인증 헤더로 API를 호출합니다.',
      color: 'from-emerald-500 to-teal-400',
    },
  ];

  return (
    <section className="relative bg-surface py-24 overflow-hidden border-t border-white/5">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-brand-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-3">Quick Start</p>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            빠른 시작 가이드
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-gray-400">
            3단계로 Agent Registry를 시작할 수 있습니다.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step) => (
            <div key={step.number} className="relative group">
              <div className="p-8 rounded-2xl glass hover:bg-white/10 transition-all duration-300 hover:-translate-y-1">
                <div className={`text-5xl font-extrabold bg-gradient-to-br ${step.color} bg-clip-text text-transparent mb-4`}>
                  {step.number}
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* API example */}
        <div className="mt-16 max-w-3xl mx-auto">
          <div className="rounded-2xl bg-surface-light/80 backdrop-blur border border-white/10 shadow-2xl overflow-hidden glow">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <span className="text-xs text-gray-500 ml-2 font-mono">API 호출 예시</span>
            </div>
            <div className="p-6 font-mono text-sm leading-7">
              <div className="text-gray-500">$ curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \</div>
              <div className="text-brand-400 ml-4">-H "Content-Type: application/json" \</div>
              <div className="text-brand-400 ml-4">-H "x-service-id: my-service" \</div>
              <div className="text-brand-400 ml-4">-H "x-user-id: gildong.hong" \</div>
              <div className="text-brand-400 ml-4">-H "x-dept-name: S/W혁신팀(S.LSI)" \</div>
              <div className="text-emerald-400 ml-4">-d '{`{"model":"gpt-4o","messages":[...]}`}'</div>
              <div className="mt-3 text-gray-500"># 200 OK</div>
              <div className="text-green-400">{`{"choices":[{"message":{"content":"안녕하세요!"}}]}`}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="relative bg-surface py-24 overflow-hidden border-t border-white/5">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-brand-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-accent/10 blur-[120px]" />
      </div>
      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-6">
          지금 시작하세요
        </h2>
        <p className="text-lg text-gray-400 mb-10">
          역할에 맞는 가이드를 선택하고 Dashboard를 활용해보세요.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/admin/getting-started"
            className="group px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-600 rounded-xl hover:shadow-2xl hover:shadow-brand-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-2"
          >
            Admin 시작하기 <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            to="/api/authentication"
            className="group px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl hover:shadow-2xl hover:shadow-emerald-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-2"
          >
            API 가이드 보기 <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function NewFeaturesSection() {
  const features = [
    {
      icon: <Smartphone className="w-7 h-7" />,
      badge: 'Coming Soon',
      badgeColor: 'from-amber-500 to-orange-500',
      gradient: 'from-amber-500/20 to-orange-500/20',
      border: 'border-amber-500/30',
      title: 'Knox Messenger 연동',
      description: '모바일 Knox Messenger에서 Jarvis AI 비서에게 직접 업무를 지시하세요. PC를 켜지 않아도 코드 리뷰, 파일 수정, 업무 정리를 요청할 수 있습니다.',
      details: [
        '챗봇 계정으로 1:1 대화 — 텍스트로 지시, 텍스트로 결과',
        'Jarvis가 자율적으로 Planner/Executor 파이프라인 실행',
        '승인 요청도 Knox 메시지로 처리 (버튼 없이 "네/아니오")',
      ],
    },
    {
      icon: <Search className="w-7 h-7" />,
      badge: 'v5.1.0',
      badgeColor: 'from-blue-500 to-cyan-500',
      gradient: 'from-blue-500/20 to-cyan-500/20',
      border: 'border-blue-500/30',
      title: 'Jira / Confluence 자동 연동',
      description: 'Jarvis가 주기적으로 사내 Jira와 Confluence를 확인합니다. 나에게 할당된 이슈, 내가 언급된 페이지를 자동으로 알려줍니다.',
      details: [
        'Jira: 내게 할당된 이슈 자동 확인 + 긴급 마감 알림',
        'Confluence: 나를 멘션한 페이지 감지 + 내용 요약',
        'SSO 인증 기반 — 별도 API 키 설정 불필요',
      ],
    },
    {
      icon: <MessageCircle className="w-7 h-7" />,
      badge: 'v5.1.0',
      badgeColor: 'from-violet-500 to-purple-500',
      gradient: 'from-violet-500/20 to-purple-500/20',
      border: 'border-violet-500/30',
      title: 'Jarvis 자율 비서 모드',
      description: '24시간 깨어있는 AI 비서가 FREE TODO, 업무기록, Jira, Confluence를 주기적으로 확인하고 자율적으로 작업을 수행합니다.',
      details: [
        '30분마다 할 일 목록 + 업무기록 자동 분석',
        'Manager LLM이 판단 → Planner/Executor에게 자율 위임',
        '영구 기억(Memory Layer) — 대화 맥락을 영원히 기억',
      ],
    },
    {
      icon: <Zap className="w-7 h-7" />,
      badge: 'v5.1.2',
      badgeColor: 'from-emerald-500 to-teal-500',
      gradient: 'from-emerald-500/20 to-teal-500/20',
      border: 'border-emerald-500/30',
      title: '사내 웹 브라우저 에이전트',
      description: 'Jira 이슈 생성, Confluence 페이지 편집을 브라우저 자동화로 수행합니다. 실시간으로 브라우저 동작을 확인하거나 백그라운드로 실행할 수 있습니다.',
      details: [
        'SSO 쿠키 자동 인증 — 로그인 한 번이면 끝',
        'Settings에서 브라우저 표시 ON/OFF 전환',
        'JQL 검색, 이슈 생성/수정, 페이지 작성/편집 가능',
      ],
    },
  ];

  return (
    <section className="relative bg-surface py-24 overflow-hidden border-t border-white/5">
      <div className="absolute inset-0">
        <div className="absolute -top-20 right-1/4 w-[600px] h-[600px] rounded-full bg-amber-500/10 blur-[150px]" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-violet-500/8 blur-[120px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-6">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-amber-300 font-medium">New in Nexus Bot v5.1</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            새로운 기능
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-gray-400">
            Nexus Bot이 Knox Messenger, Jira, Confluence와 연동됩니다.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {features.map((feature, idx) => (
            <div
              key={idx}
              className={`relative rounded-2xl glass ${feature.border} border overflow-hidden hover:bg-white/5 transition-all duration-300 hover:-translate-y-1`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-30`} />
              <div className="relative p-8">
                <div className="flex items-center gap-4 mb-4">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.badgeColor} flex items-center justify-center text-white shadow-lg`}>
                    {feature.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-white">{feature.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full bg-gradient-to-r ${feature.badgeColor} text-white font-semibold`}>
                        {feature.badge}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed mb-4">{feature.description}</p>
                <ul className="space-y-2">
                  {feature.details.map((detail, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                      <ChevronRight className="w-4 h-4 mt-0.5 text-brand-400 shrink-0" />
                      {detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <HeroSection />
      <NewFeaturesSection />
      <GuideSectionsGrid />
      <QuickStartSection />
      <CTASection />
    </>
  );
}
