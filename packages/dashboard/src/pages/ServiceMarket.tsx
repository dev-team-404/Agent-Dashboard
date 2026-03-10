import { useState, useEffect } from 'react';
import { Search, AlertCircle, Server, Cpu, User, Building2, Calendar, ArrowUpRight, BookOpen, Layers } from 'lucide-react';
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

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-28 bg-gray-100 animate-pulse rounded" />
          <div className="h-3 w-20 bg-gray-50 animate-pulse rounded" />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="h-3.5 w-full bg-gray-50 animate-pulse rounded" />
        <div className="h-3.5 w-3/5 bg-gray-50 animate-pulse rounded" />
      </div>
      <div className="h-px bg-gray-100" />
      <div className="h-3.5 w-36 bg-gray-50 animate-pulse rounded" />
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <div className="h-7 w-36 bg-gray-100 animate-pulse rounded" />
          <div className="h-4 w-72 bg-gray-50 animate-pulse rounded" />
        </div>
        <div className="h-10 bg-gray-50 animate-pulse rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">AI 서비스 마켓</h1>
        <p className="text-sm text-gray-500 mt-1">
          등록된 {services.length}개 서비스를 탐색하고, API 연동 가이드를 확인하세요.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="서비스명, 설명, 부서 검색..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
          />
        </div>
        <div className="inline-flex border border-gray-300 rounded-lg overflow-hidden flex-shrink-0">
          {(['ALL', 'STANDARD', 'BACKGROUND'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3.5 py-2 text-sm font-medium border-r border-gray-300 last:border-r-0 transition-colors whitespace-nowrap ${
                typeFilter === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'ALL' ? `전체 ${services.length}` : t === 'STANDARD' ? `표준 ${standardCount}` : `백그라운드 ${backgroundCount}`}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((service) => {
            const isBG = service.type === 'BACKGROUND';
            const Icon = isBG ? Server : Cpu;

            return (
              <div
                key={service.id}
                className="group bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all duration-150 flex flex-col"
              >
                <div className="p-5 flex-1">
                  {/* Header */}
                  <div className="flex items-start gap-3 mb-3">
                    {service.iconUrl ? (
                      <img src={service.iconUrl} alt="" className="w-10 h-10 rounded-lg flex-shrink-0" />
                    ) : (
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isBG ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        <Icon className="w-5 h-5" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">{service.displayName}</h3>
                        <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                          isBG ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {isBG ? 'BG' : 'STD'}
                        </span>
                      </div>
                      <code className="text-xs text-gray-400 font-mono">{service.name}</code>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 mb-4">
                    {service.description || '설명이 등록되지 않았습니다.'}
                  </p>

                  {/* Registration metadata */}
                  <div className="flex items-center gap-1 text-xs text-gray-400 flex-wrap">
                    <User className="w-3 h-3 flex-shrink-0" />
                    <span>{service.registeredBy || '-'}</span>
                    <span className="text-gray-300 mx-0.5">&middot;</span>
                    <Building2 className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[120px]">
                      {service.registeredByDept || '-'}
                      {service.registeredByBusinessUnit && ` / ${service.registeredByBusinessUnit}`}
                    </span>
                    {service.createdAt && (
                      <>
                        <span className="text-gray-300 mx-0.5">&middot;</span>
                        <Calendar className="w-3 h-3 flex-shrink-0" />
                        <span>{formatDate(service.createdAt)}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action */}
                <div className="border-t border-gray-100 px-5 py-3">
                  <button
                    onClick={() => handleServiceClick(service)}
                    className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                      service.docsUrl
                        ? 'text-blue-600 hover:text-blue-700'
                        : 'text-gray-300 cursor-default'
                    }`}
                  >
                    {service.docsUrl ? (
                      <>
                        <BookOpen className="w-3.5 h-3.5" />
                        설명서 보기
                        <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </>
                    ) : (
                      '설명서 없음'
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900 mb-1">
            {search || typeFilter !== 'ALL' ? '검색 결과가 없습니다' : '등록된 서비스가 없습니다'}
          </p>
          <p className="text-sm text-gray-500">
            {search ? '다른 키워드로 검색해보세요.' : '관리자가 서비스를 등록하면 표시됩니다.'}
          </p>
        </div>
      )}

      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50" onClick={() => setErrorModal(null)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">설명서 없음</h3>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  <strong className="text-gray-700">{errorModal}</strong> 서비스의 설명서가 아직 등록되지 않았습니다.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setErrorModal(null)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
