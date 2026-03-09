import { useState, useEffect } from 'react';
import { Layers, ExternalLink, Search, AlertCircle, Sparkles, ArrowRight, Cpu, Server } from 'lucide-react';
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

  const ServiceIcon = ({ service }: { service: MarketService }) => {
    if (service.iconUrl) {
      return <img src={service.iconUrl} alt={service.displayName} className="w-12 h-12 rounded-2xl shadow-sm" />;
    }
    const Icon = service.type === 'BACKGROUND' ? Server : Cpu;
    return (
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-samsung-blue/10 to-blue-100 flex items-center justify-center">
        <Icon className="w-6 h-6 text-samsung-blue" />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-samsung-blue border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-pastel-500">서비스 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-samsung-blue via-blue-600 to-indigo-700 p-8 md:p-12">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-blue-200" />
            <span className="text-sm font-medium text-blue-200 tracking-wide">AX Portal</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3 tracking-tight">
            AI 서비스 마켓
          </h1>
          <p className="text-blue-100 text-lg max-w-xl">
            사용 가능한 AI 서비스를 탐색하고, 각 서비스의 설명서를 확인하세요.
          </p>
        </div>
        {/* Decorative elements */}
        <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/5 rounded-full blur-2xl" />
        <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-white/5 rounded-full blur-xl" />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="서비스 검색..."
          className="w-full pl-12 pr-4 py-3.5 bg-white border border-pastel-200 rounded-2xl text-pastel-800 placeholder-pastel-400 focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all shadow-sm"
        />
      </div>

      {/* Service Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((service) => (
            <button
              key={service.id}
              onClick={() => handleServiceClick(service)}
              className="group relative bg-white rounded-2xl border border-pastel-100 p-6 text-left transition-all duration-300 hover:shadow-xl hover:shadow-samsung-blue/5 hover:border-samsung-blue/30 hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20"
            >
              {/* Top row */}
              <div className="flex items-start justify-between mb-4">
                <ServiceIcon service={service} />
                <div className="flex items-center gap-1.5 text-pastel-400 group-hover:text-samsung-blue transition-colors">
                  {service.docsUrl ? (
                    <>
                      <span className="text-xs font-medium">설명서</span>
                      <ExternalLink className="w-4 h-4" />
                    </>
                  ) : (
                    <span className="text-xs text-pastel-300">설명서 없음</span>
                  )}
                </div>
              </div>

              {/* Content */}
              <h3 className="text-lg font-bold text-pastel-800 mb-1 group-hover:text-samsung-blue transition-colors">
                {service.displayName}
              </h3>
              <p className="text-sm text-pastel-500 mb-4 line-clamp-2 min-h-[2.5rem]">
                {service.description || '서비스 설명이 없습니다.'}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                  service.type === 'BACKGROUND'
                    ? 'bg-purple-50 text-purple-600'
                    : 'bg-blue-50 text-samsung-blue'
                }`}>
                  {service.type === 'BACKGROUND' ? '백그라운드' : '스탠다드'}
                </span>
                <ArrowRight className="w-4 h-4 text-pastel-300 group-hover:text-samsung-blue group-hover:translate-x-1 transition-all" />
              </div>

              {/* Hover gradient overlay */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-samsung-blue/0 to-samsung-blue/0 group-hover:from-samsung-blue/[0.02] group-hover:to-blue-600/[0.02] transition-all pointer-events-none" />
            </button>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Layers className="w-12 h-12 text-pastel-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-pastel-600 mb-2">
            {search ? '검색 결과가 없습니다' : '사용 가능한 서비스가 없습니다'}
          </h3>
          <p className="text-sm text-pastel-400">
            {search ? '다른 검색어로 시도해보세요.' : '관리자에게 문의하세요.'}
          </p>
        </div>
      )}

      {/* Stats Footer */}
      {services.length > 0 && (
        <div className="flex items-center justify-center gap-6 py-4 text-sm text-pastel-400">
          <span>전체 서비스 <strong className="text-pastel-600">{services.length}</strong>개</span>
          <span className="w-1 h-1 bg-pastel-300 rounded-full" />
          <span>스탠다드 <strong className="text-pastel-600">{services.filter(s => s.type !== 'BACKGROUND').length}</strong></span>
          <span className="w-1 h-1 bg-pastel-300 rounded-full" />
          <span>백그라운드 <strong className="text-pastel-600">{services.filter(s => s.type === 'BACKGROUND').length}</strong></span>
        </div>
      )}

      {/* Error Modal — 설명서 없음 */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={() => setErrorModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className="text-lg font-bold text-pastel-800 mb-2">설명서가 없습니다</h3>
            <p className="text-sm text-pastel-500 mb-6">
              <strong className="text-pastel-700">{errorModal}</strong> 서비스에 연결된 설명서가 아직 등록되지 않았습니다.
              서비스 담당자에게 문의해 주세요.
            </p>
            <button
              onClick={() => setErrorModal(null)}
              className="w-full px-5 py-2.5 bg-pastel-100 text-pastel-700 rounded-xl hover:bg-pastel-200 transition-colors font-medium"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
