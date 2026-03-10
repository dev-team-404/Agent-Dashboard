import { useState, useEffect } from 'react';
import { ExternalLink, Search, AlertCircle, Cpu, Server, Sparkles, Layers, BookOpen, User, Building2, Calendar } from 'lucide-react';
import { serviceApi } from '../services/api';

interface MarketService {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  type?: string;
  registeredBy?: string;
  registeredByDept?: string;
  registeredByBusinessUnit?: string;
  createdAt?: string;
}

const ICON_COLORS = [
  { bg: 'bg-blue-50', ring: 'ring-blue-200/40', text: 'text-blue-600', accent: 'bg-blue-500' },
  { bg: 'bg-violet-50', ring: 'ring-violet-200/40', text: 'text-violet-600', accent: 'bg-violet-500' },
  { bg: 'bg-emerald-50', ring: 'ring-emerald-200/40', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-amber-50', ring: 'ring-amber-200/40', text: 'text-amber-600', accent: 'bg-amber-500' },
  { bg: 'bg-rose-50', ring: 'ring-rose-200/40', text: 'text-rose-600', accent: 'bg-rose-500' },
  { bg: 'bg-cyan-50', ring: 'ring-cyan-200/40', text: 'text-cyan-600', accent: 'bg-cyan-500' },
  { bg: 'bg-indigo-50', ring: 'ring-indigo-200/40', text: 'text-indigo-600', accent: 'bg-indigo-500' },
  { bg: 'bg-teal-50', ring: 'ring-teal-200/40', text: 'text-teal-600', accent: 'bg-teal-500' },
];

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function ServiceMarket() {
  const [services, setServices] = useState<MarketService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'STANDARD' | 'BACKGROUND'>('ALL');
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

  const filtered = services.filter((s) => {
    const matchSearch =
      s.displayName.toLowerCase().includes(search.toLowerCase()) ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.registeredByDept || '').toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'ALL' || s.type === typeFilter;
    return matchSearch && matchType;
  });

  const standardCount = services.filter(s => s.type !== 'BACKGROUND').length;
  const backgroundCount = services.filter(s => s.type === 'BACKGROUND').length;

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
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl animate-fade-in">
        <div className="absolute inset-0 bg-gradient-to-br from-samsung-blue via-accent-indigo to-accent-violet" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNCI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMS41Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-60" />
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/[0.06] rounded-full blur-3xl" />
        <div className="absolute -left-8 -bottom-8 w-48 h-48 bg-white/[0.04] rounded-full blur-2xl" />

        <div className="relative z-10 px-8 py-10 md:px-12 md:py-14">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center ring-1 ring-white/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-white/70 tracking-wider uppercase">Agent Stats</span>
          </div>
          <h1 className="text-3xl md:text-[38px] font-extrabold text-white mb-2 tracking-tight leading-[1.1]">
            AI 서비스 마켓
          </h1>
          <p className="text-white/60 text-base max-w-lg leading-relaxed font-medium">
            등록된 AI 서비스를 탐색하고, 연동 방법을 확인하세요.
          </p>

          <div className="flex flex-wrap gap-3 mt-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur rounded-full ring-1 ring-white/10">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-white/80">{services.length}개 서비스</span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur rounded-full ring-1 ring-white/10">
              <BookOpen className="w-3.5 h-3.5 text-white/60" />
              <span className="text-sm font-medium text-white/80">{services.filter(s => s.docsUrl).length}개 설명서</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search + Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 animate-stagger-1">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-pastel-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="서비스명, 설명, 부서로 검색..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200/60 rounded-xl text-pastel-800 placeholder-pastel-400 focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/40 transition-all shadow-sm text-sm"
          />
        </div>
        <div className="flex gap-2">
          {(['ALL', 'STANDARD', 'BACKGROUND'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-4 py-3 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                typeFilter === t
                  ? 'bg-samsung-blue text-white shadow-sm'
                  : 'bg-white text-pastel-600 border border-gray-200/60 hover:bg-gray-50'
              }`}
            >
              {t === 'ALL' ? `전체 (${services.length})` : t === 'STANDARD' ? `스탠다드 (${standardCount})` : `백그라운드 (${backgroundCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Service Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((service, index) => {
            const color = ICON_COLORS[index % ICON_COLORS.length];
            const Icon = service.type === 'BACKGROUND' ? Server : Cpu;

            return (
              <div
                key={service.id}
                className="group relative bg-white rounded-2xl border border-gray-100 hover:border-gray-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 overflow-hidden"
              >
                {/* Top color bar */}
                <div className={`h-1 ${color.accent} opacity-60`} />

                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-start gap-3.5 mb-3">
                    {service.iconUrl ? (
                      <img src={service.iconUrl} alt={service.displayName} className="w-11 h-11 rounded-xl shadow-sm ring-1 ring-black/[0.04] flex-shrink-0" />
                    ) : (
                      <div className={`w-11 h-11 rounded-xl ${color.bg} ring-1 ${color.ring} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-5.5 h-5.5 ${color.text}`} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[15px] font-bold text-pastel-800 truncate group-hover:text-samsung-blue transition-colors">
                        {service.displayName}
                      </h3>
                      <span className="text-xs text-pastel-400 font-mono">{service.name}</span>
                    </div>
                    <span className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                      service.type === 'BACKGROUND'
                        ? 'bg-violet-50 text-violet-600'
                        : 'bg-blue-50 text-samsung-blue'
                    }`}>
                      {service.type === 'BACKGROUND' ? 'BG' : 'STD'}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-[13px] text-pastel-500 leading-relaxed line-clamp-2 mb-4 min-h-[2.5rem]">
                    {service.description || '서비스 설명이 등록되지 않았습니다.'}
                  </p>

                  {/* Registration info */}
                  <div className="space-y-1.5 mb-4 py-3 px-3 bg-gray-50/80 rounded-lg">
                    <div className="flex items-center gap-2 text-xs text-pastel-500">
                      <User className="w-3.5 h-3.5 text-pastel-400 flex-shrink-0" />
                      <span className="font-medium text-pastel-600">{service.registeredBy || '알 수 없음'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-pastel-500">
                      <Building2 className="w-3.5 h-3.5 text-pastel-400 flex-shrink-0" />
                      <span className="truncate">
                        {service.registeredByDept || '부서 미상'}
                        {service.registeredByBusinessUnit && (
                          <span className="text-pastel-400"> / {service.registeredByBusinessUnit}</span>
                        )}
                      </span>
                    </div>
                    {service.createdAt && (
                      <div className="flex items-center gap-2 text-xs text-pastel-400">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{formatDate(service.createdAt)} 등록</span>
                      </div>
                    )}
                  </div>

                  {/* Action */}
                  <button
                    onClick={() => handleServiceClick(service)}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      service.docsUrl
                        ? 'bg-samsung-blue/5 text-samsung-blue hover:bg-samsung-blue/10'
                        : 'bg-gray-50 text-pastel-400 cursor-default'
                    }`}
                  >
                    {service.docsUrl ? (
                      <>
                        <ExternalLink className="w-4 h-4" />
                        설명서 보기
                      </>
                    ) : (
                      <span>설명서 없음</span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-pastel-100 flex items-center justify-center">
            <Layers className="w-8 h-8 text-pastel-400" />
          </div>
          <h3 className="text-lg font-bold text-pastel-700 mb-2">
            {search || typeFilter !== 'ALL' ? '검색 결과가 없습니다' : '등록된 서비스가 없습니다'}
          </h3>
          <p className="text-sm text-pastel-400 font-medium">
            {search ? '다른 검색어로 시도해보세요.' : '관리자에게 문의하세요.'}
          </p>
        </div>
      )}

      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={() => setErrorModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-7 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-amber-50 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className="text-lg font-bold text-pastel-800 mb-1.5">설명서가 없습니다</h3>
            <p className="text-sm text-pastel-500 leading-relaxed mb-6">
              <strong className="text-pastel-700">{errorModal}</strong> 서비스에 연결된 설명서가 아직 등록되지 않았습니다.
            </p>
            <button
              onClick={() => setErrorModal(null)}
              className="w-full px-5 py-2.5 bg-pastel-800 text-white rounded-xl hover:bg-pastel-700 transition-colors font-semibold text-sm"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
