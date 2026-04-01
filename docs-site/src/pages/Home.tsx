import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Shield, User, Code, BookOpen, ChevronRight, Settings, MessageSquare, ImageIcon, Mic, Layers, Sparkles, Eye } from 'lucide-react';
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

interface PromotedModel {
  id: string;
  displayName: string;
  name: string;
  type: string;
  supportsVision: boolean;
  maxTokens: number;
}

const MODEL_TYPE_META: Record<string, { icon: typeof MessageSquare; label: string; gradient: string }> = {
  CHAT: { icon: MessageSquare, label: 'Chat', gradient: 'from-blue-500 to-cyan-500' },
  IMAGE: { icon: ImageIcon, label: 'Image', gradient: 'from-pink-500 to-rose-500' },
  EMBEDDING: { icon: Layers, label: 'Embedding', gradient: 'from-emerald-500 to-teal-500' },
  RERANKING: { icon: Layers, label: 'Rerank', gradient: 'from-orange-500 to-amber-500' },
  ASR: { icon: Mic, label: 'ASR', gradient: 'from-violet-500 to-purple-500' },
};

function PromotedModelsSection() {
  const [models, setModels] = useState<PromotedModel[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/public/promoted-models')
      .then(res => res.json())
      .then(data => { setModels(data.models || []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded || models.length === 0) return null;

  return (
    <section className="relative bg-surface py-24 overflow-hidden border-t border-white/5">
      <div className="absolute inset-0">
        <div className="absolute top-1/3 -right-20 w-[600px] h-[600px] rounded-full bg-amber-500/8 blur-[140px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-brand-500/8 blur-[120px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-6">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-amber-300">Supported Models</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            AX과제 정식 등록시
            <br />
            <span className="text-gradient-brand">아래 모델들을 지원해드립니다!</span>
          </h2>
          <p className="max-w-2xl mx-auto text-gray-400 text-lg">
            과제 등록 후 바로 사용 가능한 LLM 모델 라인업입니다.
          </p>
        </div>

        {/* Model Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {models.map((model, idx) => {
            const meta = MODEL_TYPE_META[model.type] || MODEL_TYPE_META.CHAT;
            const Icon = meta.icon;
            return (
              <div
                key={model.id}
                className="group relative rounded-2xl glass hover:bg-white/10 transition-all duration-300 hover:-translate-y-1 overflow-hidden animate-fade-up"
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                {/* Top gradient bar */}
                <div className={`h-1 bg-gradient-to-r ${meta.gradient}`} />

                <div className="p-5">
                  {/* Icon + Type */}
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {model.supportsVision && (
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/20">
                          <Eye className="w-3 h-3 inline mr-0.5" />Vision
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full bg-white/5 text-gray-400 border border-white/10`}>
                        {meta.label}
                      </span>
                    </div>
                  </div>

                  {/* Name */}
                  <h3 className="text-base font-bold text-white mb-1 group-hover:text-brand-300 transition-colors">
                    {model.displayName}
                  </h3>
                  <p className="text-xs font-mono text-gray-500 mb-3">{model.name}</p>

                  {/* Max Tokens */}
                  {model.maxTokens > 0 && (
                    <div className="text-xs text-gray-500">
                      Max Tokens: <span className="text-gray-300 font-medium">{(model.maxTokens / 1000).toFixed(0)}K</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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

export default function Home() {
  return (
    <>
      <HeroSection />
      <PromotedModelsSection />
      <GuideSectionsGrid />
      <QuickStartSection />
      <CTASection />
    </>
  );
}
