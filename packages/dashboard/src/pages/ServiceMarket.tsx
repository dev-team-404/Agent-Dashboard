import { useState, useEffect } from 'react';
import {
  Search, AlertCircle, Server, Cpu, Layers,
  BookOpen, User, Building2, Calendar, ArrowUpRight,
  Sparkles,
} from 'lucide-react';
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

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/* ── Skeleton Card ── */
function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-gray-100/80 bg-white p-6 space-y-4">
      <div className="flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-xl skeleton" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 skeleton rounded-md" />
          <div className="h-3 w-20 skeleton rounded-md" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full skeleton rounded-md" />
        <div className="h-3 w-2/3 skeleton rounded-md" />
      </div>
      <div className="separator-gradient" />
      <div className="h-3 w-44 skeleton rounded-md" />
      <div className="h-10 w-full skeleton rounded-xl" />
    </div>
  );
}

export default function ServiceMarket() {
  const [services, setServices] = useState<MarketService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'STANDARD' | 'BACKGROUND'>('ALL');
  const [errorModal, setErrorModal] = useState<string | null>(null);

  useEffect(() => { loadServices(); }, []);

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
    const q = search.toLowerCase();
    const matchSearch = !q ||
      s.displayName.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.registeredByDept || '').toLowerCase().includes(q);
    const matchType = typeFilter === 'ALL' || s.type === typeFilter;
    return matchSearch && matchType;
  });

  const standardCount = services.filter(s => s.type !== 'BACKGROUND').length;
  const backgroundCount = services.filter(s => s.type === 'BACKGROUND').length;

  /* ── Loading: Skeleton ── */
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl skeleton" />
            <div className="h-8 w-48 skeleton rounded-xl" />
          </div>
          <div className="h-4 w-72 skeleton rounded-lg ml-[52px]" />
        </div>
        <div className="h-12 w-full skeleton rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* ════════ Header ════════ */}
      <div className="animate-fade-in pt-1">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-samsung-blue to-accent-indigo flex items-center justify-center shadow-glow-blue">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl md:text-[32px] font-extrabold tracking-tight">
            <span className="gradient-text">AI 서비스 마켓</span>
          </h1>
        </div>
        <p className="text-pastel-500 text-[15px] ml-[52px] leading-relaxed">
          등록된 AI 서비스를 탐색하고, API 연동 방법을 확인하세요.
        </p>

        {/* Stat pills */}
        <div className="flex items-center gap-2.5 mt-5 ml-[52px]">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full shadow-depth text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-pastel-700">{services.length}</span>
            <span className="text-pastel-400 text-xs">서비스</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full shadow-depth text-sm">
            <BookOpen className="w-3.5 h-3.5 text-pastel-400" />
            <span className="font-semibold text-pastel-700">{services.filter(s => s.docsUrl).length}</span>
            <span className="text-pastel-400 text-xs">설명서</span>
          </div>
        </div>
      </div>

      {/* ════════ Search + Filter ════════ */}
      <div className="flex flex-col sm:flex-row gap-3 animate-stagger-1">
        <div className="relative flex-1 group/search">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-pastel-300 group-focus-within/search:text-samsung-blue transition-colors duration-200" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="서비스명, 설명, 부서로 검색..."
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200/60 rounded-xl text-sm font-medium text-pastel-800 placeholder-pastel-300 focus:ring-2 focus:ring-samsung-blue/10 focus:border-samsung-blue/30 transition-all shadow-depth"
          />
        </div>
        <div className="flex rounded-xl bg-white shadow-depth border border-gray-200/60 p-1">
          {(['ALL', 'STANDARD', 'BACKGROUND'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
                typeFilter === t
                  ? 'bg-samsung-blue text-white shadow-sm'
                  : 'text-pastel-500 hover:text-pastel-700 hover:bg-gray-50'
              }`}
            >
              {t === 'ALL' ? `전체 ${services.length}` : t === 'STANDARD' ? `스탠다드 ${standardCount}` : `백그라운드 ${backgroundCount}`}
            </button>
          ))}
        </div>
      </div>

      {/* ════════ Service Grid ════════ */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((service, index) => {
            const isBG = service.type === 'BACKGROUND';
            const Icon = isBG ? Server : Cpu;

            return (
              <div
                key={service.id}
                className={`group relative bg-white rounded-2xl border border-gray-100/80 overflow-hidden ${isBG ? 'card-glow-violet' : 'card-glow'}`}
                style={{ animation: `slideUp 0.45s cubic-bezier(0.16,1,0.3,1) ${index * 60}ms both` }}
              >
                <div className="p-6">
                  {/* Header */}
                  <div className="flex items-start gap-3.5 mb-4">
                    {service.iconUrl ? (
                      <img
                        src={service.iconUrl}
                        alt={service.displayName}
                        className="w-11 h-11 rounded-xl shadow-card ring-1 ring-black/[0.04] flex-shrink-0"
                      />
                    ) : (
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${
                        isBG ? 'from-violet-500 to-purple-600' : 'from-samsung-blue to-blue-600'
                      } flex items-center justify-center flex-shrink-0 shadow-sm`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[15px] font-bold text-pastel-800 truncate group-hover:text-samsung-blue transition-colors duration-200">
                        {service.displayName}
                      </h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-[11px] text-pastel-400 font-mono">{service.name}</code>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-wide ${
                          isBG ? 'bg-violet-50 text-violet-500' : 'bg-blue-50 text-blue-500'
                        }`}>
                          {isBG ? 'BG' : 'STD'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-[13px] text-pastel-500 leading-[1.65] line-clamp-2 mb-5 min-h-[2.6rem]">
                    {service.description || '서비스 설명이 등록되지 않았습니다.'}
                  </p>

                  {/* Separator */}
                  <div className="separator-gradient mb-4" />

                  {/* Registration meta — compact inline */}
                  <div className="flex items-center gap-1.5 text-[11px] text-pastel-400 mb-5 flex-wrap">
                    <User className="w-3 h-3 flex-shrink-0" />
                    <span className="text-pastel-500 font-medium">{service.registeredBy || '알 수 없음'}</span>
                    <span className="text-pastel-200">·</span>
                    <Building2 className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[140px]">
                      {service.registeredByDept || '부서 미상'}
                      {service.registeredByBusinessUnit && ` / ${service.registeredByBusinessUnit}`}
                    </span>
                    {service.createdAt && (
                      <>
                        <span className="text-pastel-200">·</span>
                        <Calendar className="w-3 h-3 flex-shrink-0" />
                        <span>{formatDate(service.createdAt)}</span>
                      </>
                    )}
                  </div>

                  {/* Action button */}
                  <button
                    onClick={() => handleServiceClick(service)}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      service.docsUrl
                        ? 'bg-pastel-50 text-samsung-blue hover:bg-samsung-blue hover:text-white'
                        : 'bg-gray-50/80 text-pastel-300 cursor-default'
                    }`}
                  >
                    {service.docsUrl ? (
                      <>
                        <BookOpen className="w-4 h-4" />
                        설명서 보기
                        <ArrowUpRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
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
        /* ── Empty state ── */
        <div className="text-center py-24 animate-fade-in">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-3xl bg-pastel-100/60 rotate-6" />
            <div className="relative w-20 h-20 rounded-3xl bg-white shadow-card flex items-center justify-center">
              <Layers className="w-9 h-9 text-pastel-300" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-pastel-700 mb-2">
            {search || typeFilter !== 'ALL' ? '검색 결과가 없습니다' : '등록된 서비스가 없습니다'}
          </h3>
          <p className="text-sm text-pastel-400 max-w-xs mx-auto leading-relaxed">
            {search ? '다른 키워드로 검색하거나 필터를 변경해보세요.' : '관리자가 서비스를 등록하면 이곳에 표시됩니다.'}
          </p>
        </div>
      )}

      {/* ════════ Error Modal ════════ */}
      {errorModal && (
        <div
          className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
          onClick={() => setErrorModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-modal w-full max-w-sm mx-4 p-8 text-center animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-50 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className="text-lg font-bold text-pastel-800 mb-2">설명서가 없습니다</h3>
            <p className="text-sm text-pastel-500 leading-relaxed mb-7">
              <strong className="text-pastel-700">{errorModal}</strong> 서비스의 설명서가 아직 등록되지 않았습니다.
            </p>
            <button
              onClick={() => setErrorModal(null)}
              className="w-full px-5 py-3 bg-pastel-800 text-white rounded-xl hover:bg-pastel-700 transition-colors font-semibold text-sm active:scale-[0.98]"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
