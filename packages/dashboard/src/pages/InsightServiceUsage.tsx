import { useState, useEffect, useCallback } from 'react';
import { Zap, X, ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ea580c', '#6366f1', '#22c55e', '#ef4444',
  '#a855f7', '#0ea5e9', '#fb923c', '#84cc16', '#f43f5e',
];

const CARD_GRADIENTS = [
  'from-blue-50 to-indigo-50',
  'from-emerald-50 to-teal-50',
  'from-violet-50 to-purple-50',
  'from-amber-50 to-yellow-50',
  'from-rose-50 to-pink-50',
  'from-cyan-50 to-sky-50',
  'from-orange-50 to-red-50',
  'from-lime-50 to-green-50',
];

const CARD_BORDERS = [
  'border-blue-100',
  'border-emerald-100',
  'border-violet-100',
  'border-amber-100',
  'border-rose-100',
  'border-cyan-100',
  'border-orange-100',
  'border-lime-100',
];

interface ServiceUsage {
  id: string;
  name: string;
  displayName: string;
  llmCallCount: number;
  tokenUsage: { input: number; output: number; total: number };
  mau: number;
}

interface OverviewData {
  month: string;
  services: ServiceUsage[];
}

interface TeamToken {
  team: string;
  tokensM: number;
}

interface ServiceDetail {
  service: { id: string; name: string; displayName: string };
  teamTokens: TeamToken[];
}

export default function InsightServiceUsage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/insight/service-usage');
      setData(res.data);
    } catch (err) {
      console.error('Failed to load service usage insight:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadDetail = useCallback(async (serviceId: string) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/admin/insight/service-usage/${serviceId}`);
      setDetail(res.data);
    } catch (err) {
      console.error('Failed to load service detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleCardClick = (serviceId: string) => {
    setSelectedService(serviceId);
    loadDetail(serviceId);
  };

  const handleCloseDetail = () => {
    setSelectedService(null);
    setDetail(null);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  const formatTokens = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-violet-50">
            <Zap className="w-6 h-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">서비스 사용량 인사이트</h1>
            <p className="text-sm text-pastel-500 mt-0.5">서비스별 LLM 호출 및 토큰 사용량을 분석합니다</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl bg-white border border-gray-100 p-6 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-28 mb-4" />
              <div className="h-8 bg-gray-100 rounded w-24 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
        <Zap className="w-12 h-12 text-pastel-300 mb-4" />
        <p className="text-sm font-semibold text-pastel-600">데이터를 불러올 수 없습니다</p>
        <button onClick={loadData} className="mt-3 px-4 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
          다시 시도
        </button>
      </div>
    );
  }

  const sortedServices = [...data.services].sort((a, b) => b.llmCallCount - a.llmCallCount);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-violet-50">
            <Zap className="w-6 h-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">서비스 사용량 인사이트</h1>
            <p className="text-sm text-pastel-500 mt-0.5">서비스별 LLM 호출 및 토큰 사용량을 분석합니다</p>
          </div>
        </div>
        <div className="inline-flex items-center px-3 py-1.5 bg-violet-50 text-violet-700 rounded-full text-sm font-medium">
          {data.month}
        </div>
      </div>

      {/* Service Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sortedServices.map((svc, idx) => {
          const gradient = CARD_GRADIENTS[idx % CARD_GRADIENTS.length];
          const border = CARD_BORDERS[idx % CARD_BORDERS.length];
          const isSelected = selectedService === svc.id;

          return (
            <button
              key={svc.id}
              onClick={() => handleCardClick(svc.id)}
              className={`text-left rounded-xl bg-gradient-to-br ${gradient} border ${border} p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
                isSelected ? 'ring-2 ring-violet-400 shadow-lg' : ''
              }`}
            >
              <div className="mb-3">
                <h3 className="text-base font-bold text-gray-900 truncate" title={svc.displayName}>{svc.displayName}</h3>
                <p className="text-[10px] text-gray-400 font-mono">{svc.name}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-medium tracking-wider">LLM Calls</p>
                  <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatNumber(svc.llmCallCount)}</p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-medium tracking-wider">Tokens</p>
                    <p className="text-sm font-semibold text-gray-700 tabular-nums">{formatTokens(svc.tokenUsage.total)} tokens</p>
                  </div>
                  <div className="inline-flex items-center px-2 py-0.5 bg-white/60 rounded-full text-xs font-medium text-gray-600">
                    MAU {formatNumber(svc.mau)}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-gray-400">
                  <span>In: {formatTokens(svc.tokenUsage.input)}</span>
                  <span>Out: {formatTokens(svc.tokenUsage.output)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail Panel */}
      {selectedService && (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <button
                onClick={handleCloseDetail}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-lg font-bold text-pastel-800">
                {detail?.service.displayName || '상세 분석'}
              </h2>
            </div>
            <button
              onClick={handleCloseDetail}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            </div>
          ) : detail ? (
            <div className="p-6">
              <h3 className="text-sm font-semibold text-pastel-700 mb-4">팀별 토큰 사용량 (M)</h3>
              {detail.teamTokens.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={detail.teamTokens} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="team" tick={{ fill: '#374151', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} angle={-35} textAnchor="end" interval={0} height={80} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={(v: number) => `${v.toFixed(1)}M`} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                      formatter={(value: number) => [`${value.toFixed(2)}M tokens`, 'Tokens']}
                    />
                    <Bar dataKey="tokensM" radius={[6, 6, 0, 0]} barSize={32}>
                      {detail.teamTokens.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-48 text-pastel-400 text-sm">
                  팀별 토큰 데이터가 없습니다
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-pastel-400">
              상세 데이터를 불러올 수 없습니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}
