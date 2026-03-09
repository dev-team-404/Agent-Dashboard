import { useState, useEffect } from 'react';
import { ExternalLink, Search, AlertCircle, ArrowRight, Cpu, Server, Sparkles, Layers, BookOpen } from 'lucide-react';
import { serviceApi } from '../services/api';

interface MarketService {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  type?: string;
}

const CARD_GRADIENTS = [
  'from-blue-500/5 to-indigo-500/5',
  'from-violet-500/5 to-purple-500/5',
  'from-emerald-500/5 to-teal-500/5',
  'from-amber-500/5 to-orange-500/5',
  'from-rose-500/5 to-pink-500/5',
  'from-cyan-500/5 to-blue-500/5',
];

const ICON_COLORS = [
  { bg: 'bg-blue-50 ring-blue-100/50', text: 'text-blue-600' },
  { bg: 'bg-violet-50 ring-violet-100/50', text: 'text-violet-600' },
  { bg: 'bg-emerald-50 ring-emerald-100/50', text: 'text-emerald-600' },
  { bg: 'bg-amber-50 ring-amber-100/50', text: 'text-amber-600' },
  { bg: 'bg-rose-50 ring-rose-100/50', text: 'text-rose-600' },
  { bg: 'bg-cyan-50 ring-cyan-100/50', text: 'text-cyan-600' },
];

export default function ServiceMarket() {
  const [services, setServices] = useState<MarketService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [errorModal, setErrorModal] = useState<string | null>(null);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const res = await serviceApi.listNames();
      setServices(res.data.services || []);
    } catch (error) {
      console.error('Failed to load services:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleServiceClick = (service: MarketService) => {
    if (service.docsUrl) {
      window.open(service.docsUrl, '_blank', 'noopener,noreferrer');
    } else {
      setErrorModal(service.displayName);
    }
  };

  const filtered = services.filter((s) =>
    s.displayName.toLowerCase().includes(search.toLowerCase()) ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full bg-samsung-blue/10 animate-ping" />
            <div className="relative w-16 h-16 border-[3px] border-samsung-blue/20 border-t-samsung-blue rounded-full animate-spin" />
          </div>
          <p className="text-sm font-medium text-pastel-500">서비스 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl animate-fade-in">
        {/* Background with mesh gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-samsung-blue via-accent-indigo to-accent-violet" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNCI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMS41Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-60" />

        {/* Decorative orbs */}
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/[0.06] rounded-full blur-3xl" />
        <div className="absolute -left-8 -bottom-8 w-48 h-48 bg-white/[0.04] rounded-full blur-2xl" />
        <div className="absolute right-1/4 bottom-0 w-32 h-32 bg-accent-violet/20 rounded-full blur-2xl" />

        <div className="relative z-10 px-8 py-12 md:px-12 md:py-16">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center ring-1 ring-white/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-white/70 tracking-wider uppercase">Agent Stats</span>
          </div>
          <h1 className="text-3xl md:text-[40px] font-extrabold text-white mb-3 tracking-tight leading-[1.1]">
            AI 서비스 마켓
          </h1>
          <p className="text-white/60 text-base md:text-lg max-w-lg leading-relaxed font-medium">
            사용 가능한 AI 서비스를 탐색하고, 각 서비스의 설명서를 확인하세요.
          </p>

          {/* Stats pills */}
          <div className="flex flex-wrap gap-3 mt-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur rounded-full ring-1 ring-white/10">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-white/80">{services.length}개 서비스 운영 중</span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur rounded-full ring-1 ring-white/10">
              <BookOpen className="w-3.5 h-3.5 text-white/60" />
              <span className="text-sm font-medium text-white/80">{services.filter(s => s.docsUrl).length}개 설명서 제공</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative animate-stagger-1">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="서비스 이름, 설명으로 검색..."
          className="w-full pl-14 pr-5 py-4 bg-white border border-gray-200/60 rounded-2xl text-pastel-800 placeholder-pastel-400 focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/40 transition-all shadow-depth text-[15px]"
        />
        {search && (
          <span className="absolute right-5 top-1/2 -translate-y-1/2 text-xs text-pastel-400 font-medium">
            {filtered.length}개 결과
          </span>
        )}
      </div>

      {/* Service Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((service, index) => {
            const colorIdx = index % ICON_COLORS.length;
            const gradientIdx = index % CARD_GRADIENTS.length;
            const Icon = service.type === 'BACKGROUND' ? Server : Cpu;

            return (
              <button
                key={service.id}
                onClick={() => handleServiceClick(service)}
                className={`group relative bg-white rounded-2xl border border-gray-100/80 text-left transition-all duration-500 hover:shadow-card-hover hover:border-gray-200/60 hover:-translate-y-1.5 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 overflow-hidden animate-stagger-${Math.min(index + 1, 6)}`}
              >
                {/* Top gradient accent */}
                <div className={`absolute inset-x-0 top-0 h-32 bg-gradient-to-b ${CARD_GRADIENTS[gradientIdx]} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                <div className="relative p-6">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-5">
                    {service.iconUrl ? (
                      <img src={service.iconUrl} alt={service.displayName} className="w-14 h-14 rounded-2xl shadow-soft ring-1 ring-black/[0.03]" />
                    ) : (
                      <div className={`w-14 h-14 rounded-2xl ${ICON_COLORS[colorIdx].bg} ring-1 flex items-center justify-center`}>
                        <Icon className={`w-7 h-7 ${ICON_COLORS[colorIdx].text}`} />
                      </div>
                    )}
                    {service.docsUrl ? (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-samsung-blue/5 text-samsung-blue opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0">
                        <span className="text-xs font-semibold">설명서</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <span className="text-[11px] text-pastel-300 font-medium px-2.5 py-1 bg-gray-50 rounded-full">설명서 없음</span>
                    )}
                  </div>

                  {/* Content */}
                  <h3 className="text-[17px] font-bold text-pastel-800 mb-1.5 group-hover:text-samsung-blue transition-colors duration-300">
                    {service.displayName}
                  </h3>
                  <p className="text-[13px] text-pastel-500 leading-relaxed line-clamp-2 min-h-[2.5rem]">
                    {service.description || '서비스 설명이 없습니다.'}
                  </p>

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100/60">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${
                      service.type === 'BACKGROUND'
                        ? 'bg-violet-50 text-violet-600'
                        : 'bg-blue-50 text-samsung-blue'
                    }`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${service.type === 'BACKGROUND' ? 'bg-violet-400' : 'bg-samsung-blue'}`} />
                      {service.type === 'BACKGROUND' ? '백그라운드' : '스탠다드'}
                    </span>
                    <ArrowRight className="w-4 h-4 text-pastel-300 group-hover:text-samsung-blue group-hover:translate-x-1.5 transition-all duration-300" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-pastel-100 flex items-center justify-center">
            <Layers className="w-8 h-8 text-pastel-400" />
          </div>
          <h3 className="text-lg font-bold text-pastel-700 mb-2">
            {search ? '검색 결과가 없습니다' : '사용 가능한 서비스가 없습니다'}
          </h3>
          <p className="text-sm text-pastel-400 font-medium">
            {search ? '다른 검색어로 시도해보세요.' : '관리자에게 문의하세요.'}
          </p>
        </div>
      )}

      {/* Stats Footer */}
      {services.length > 0 && (
        <div className="flex items-center justify-center gap-8 py-6 text-sm text-pastel-400 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-pastel-300" />
            <span>전체 <strong className="text-pastel-600 font-semibold">{services.length}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-samsung-blue" />
            <span>스탠다드 <strong className="text-pastel-600 font-semibold">{services.filter(s => s.type !== 'BACKGROUND').length}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent-violet" />
            <span>백그라운드 <strong className="text-pastel-600 font-semibold">{services.filter(s => s.type === 'BACKGROUND').length}</strong></span>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={() => setErrorModal(null)}>
          <div className="bg-white rounded-3xl shadow-modal w-full max-w-sm mx-4 p-8 text-center animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-amber-50 flex items-center justify-center ring-1 ring-amber-100/50">
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-xl font-bold text-pastel-800 mb-2">설명서가 없습니다</h3>
            <p className="text-sm text-pastel-500 leading-relaxed mb-7">
              <strong className="text-pastel-700">{errorModal}</strong> 서비스에 연결된 설명서가 아직 등록되지 않았습니다.
              서비스 담당자에게 문의해 주세요.
            </p>
            <button
              onClick={() => setErrorModal(null)}
              className="w-full px-5 py-3 bg-pastel-800 text-white rounded-xl hover:bg-pastel-700 transition-colors font-semibold text-sm"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
