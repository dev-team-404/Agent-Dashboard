import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, X, ArrowLeft, Users, BarChart3, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const CARD_COLORS = [
  { bg: 'from-blue-50 to-indigo-50', border: 'border-blue-100', accent: 'text-blue-700', bar: '#3b82f6' },
  { bg: 'from-emerald-50 to-teal-50', border: 'border-emerald-100', accent: 'text-emerald-700', bar: '#10b981' },
  { bg: 'from-violet-50 to-purple-50', border: 'border-violet-100', accent: 'text-violet-700', bar: '#8b5cf6' },
  { bg: 'from-amber-50 to-yellow-50', border: 'border-amber-100', accent: 'text-amber-700', bar: '#f59e0b' },
  { bg: 'from-rose-50 to-pink-50', border: 'border-rose-100', accent: 'text-rose-700', bar: '#ec4899' },
  { bg: 'from-cyan-50 to-sky-50', border: 'border-cyan-100', accent: 'text-cyan-700', bar: '#06b6d4' },
  { bg: 'from-orange-50 to-red-50', border: 'border-orange-100', accent: 'text-orange-700', bar: '#ea580c' },
  { bg: 'from-lime-50 to-green-50', border: 'border-lime-100', accent: 'text-lime-700', bar: '#84cc16' },
];

const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ea580c', '#6366f1', '#22c55e', '#ef4444',
  '#a855f7', '#0ea5e9', '#fb923c', '#84cc16', '#f43f5e',
];

interface CenterTeam {
  team: string;
  deptname: string;
  mau: number;
  savedMM: number;
}

interface Center {
  name: string;
  totalMau: number;
  mauChangePercent: number;
  totalSavedMM: number;
  teams: CenterTeam[];
}

interface OverviewData {
  month: string;
  centers: Center[];
}

interface TeamService {
  team: string;
  serviceName: string;
  serviceDisplayName: string;
  serviceType: string;
  savedMM: number;
  mau: number;
  llmCallCount: number;
}

interface CenterDetail {
  center: string;
  teamMauChart: Array<{ team: string; mau: number }>;
  monthlyTrend: Array<{ month: string; mau: number }>;
  teamServices: TeamService[];
}

type PeriodTab = 'current' | 'last';

function getMonthParams(p: PeriodTab): { year: number; month: number } {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (p === 'current') return { year: kst.getUTCFullYear(), month: kst.getUTCMonth() + 1 };
  const last = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
  return { year: last.getUTCFullYear(), month: last.getUTCMonth() + 1 };
}

export default function InsightUsageRate() {
  const [period, setPeriod] = useState<PeriodTab>('current');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCenter, setSelectedCenter] = useState<string | null>(null);
  const [detail, setDetail] = useState<CenterDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async (p: PeriodTab) => {
    try {
      setLoading(true);
      setSelectedCenter(null);
      setDetail(null);
      const res = await api.get('/admin/insight/usage-rate', { params: getMonthParams(p) });
      setData(res.data);
    } catch (err) {
      console.error('Failed to load usage rate insight:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(period); }, [loadData, period]);

  const loadDetail = useCallback(async (centerName: string) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/admin/insight/usage-rate/${encodeURIComponent(centerName)}`, { params: getMonthParams(period) });
      setDetail(res.data);
    } catch (err) {
      console.error('Failed to load center detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, [period]);

  const handleCardClick = (centerName: string) => {
    setSelectedCenter(centerName);
    loadDetail(centerName);
  };

  const handleCloseDetail = () => {
    setSelectedCenter(null);
    setDetail(null);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50">
            <BarChart3 className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">AI 사용률 인사이트</h1>
            <p className="text-sm text-pastel-500 mt-0.5">센터별 AI 활용 현황을 한눈에 파악합니다</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl bg-white border border-gray-100 p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-32 mb-4" />
              <div className="h-10 bg-gray-100 rounded w-20 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
        <BarChart3 className="w-12 h-12 text-pastel-300 mb-4" />
        <p className="text-sm font-semibold text-pastel-600">데이터를 불러올 수 없습니다</p>
        <button onClick={() => loadData(period)} className="mt-3 px-4 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
          다시 시도
        </button>
      </div>
    );
  }

  const sortedCenters = [...data.centers].sort((a, b) => b.totalSavedMM - a.totalSavedMM);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50">
            <BarChart3 className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">AI 사용률 인사이트</h1>
            <p className="text-sm text-pastel-500 mt-0.5">센터별 AI 활용 현황을 한눈에 파악합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
            <button
              onClick={() => setPeriod('current')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === 'current' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              이번달 (실시간)
            </button>
            <button
              onClick={() => setPeriod('last')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === 'last' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              지난달
            </button>
          </div>
          <span className="inline-flex items-center px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium">
            {data.month}{period === 'current' ? ' (진행중)' : ''}
          </span>
        </div>
      </div>

      {/* Center Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sortedCenters.map((center, idx) => {
          const colorScheme = CARD_COLORS[idx % CARD_COLORS.length];
          const isSelected = selectedCenter === center.name;
          const trendPositive = center.mauChangePercent >= 0;

          return (
            <button
              key={center.name}
              onClick={() => handleCardClick(center.name)}
              className={`text-left rounded-xl bg-gradient-to-br ${colorScheme.bg} border ${colorScheme.border} p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
                isSelected ? 'ring-2 ring-indigo-400 shadow-lg' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className={`text-lg font-bold ${colorScheme.accent}`}>{center.name}</h3>
                <div className={`flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                  trendPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                }`}>
                  {trendPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(center.mauChangePercent).toFixed(1)}%
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-medium tracking-wider">Total MAU</p>
                  <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatNumber(center.totalMau)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-medium tracking-wider">Saved M/M</p>
                  <p className="text-2xl font-bold text-emerald-700 tabular-nums">{center.totalSavedMM.toFixed(1)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Users className="w-3 h-3" />
                <span>{center.teams.length}개 팀</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail Modal/Panel */}
      {selectedCenter && (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <button
                onClick={handleCloseDetail}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-lg font-bold text-pastel-800">{selectedCenter} 상세</h2>
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
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          ) : detail ? (
            <div className="p-6 space-y-8">
              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Team MAU Bar Chart */}
                <div>
                  <h3 className="text-sm font-semibold text-pastel-700 mb-4">팀별 MAU 비교</h3>
                  {detail.teamMauChart.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={detail.teamMauChart} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="team" tick={{ fill: '#374151', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} angle={-35} textAnchor="end" interval={0} height={80} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                          formatter={(value: number) => [formatNumber(value) + '명', 'MAU']}
                        />
                        <Bar dataKey="mau" radius={[6, 6, 0, 0]} barSize={32}>
                          {detail.teamMauChart.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-48 text-pastel-400 text-sm">데이터가 없습니다</div>
                  )}
                </div>

                {/* Monthly MAU Trend */}
                <div>
                  <h3 className="text-sm font-semibold text-pastel-700 mb-4">월별 MAU 추이</h3>
                  {detail.monthlyTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={detail.monthlyTrend} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                          formatter={(value: number) => [formatNumber(value) + '명', 'MAU']}
                        />
                        <Line type="monotone" dataKey="mau" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 5, strokeWidth: 2 }} activeDot={{ r: 7 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-48 text-pastel-400 text-sm">데이터가 없습니다</div>
                  )}
                </div>
              </div>

              {/* Team-Service Detail Table */}
              <div>
                <h3 className="text-sm font-semibold text-pastel-700 mb-4">팀-서비스 상세</h3>
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50/80">
                        <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">팀</th>
                        <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">서비스</th>
                        <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">타입</th>
                        <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">Saved M/M</th>
                        <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">MAU</th>
                        <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">LLM Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.teamServices.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-pastel-400 text-sm">상세 데이터가 없습니다</td>
                        </tr>
                      ) : (
                        detail.teamServices.map((ts, idx) => (
                          <tr key={`${ts.team}-${ts.serviceName}-${idx}`} className={`border-t border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                            <td className="py-3 px-4 font-medium text-pastel-800">{ts.team}</td>
                            <td className="py-3 px-4">
                              <span className="text-pastel-700">{ts.serviceDisplayName}</span>
                              <span className="block text-[10px] text-pastel-400 font-mono">{ts.serviceName}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${
                                ts.serviceType === 'STANDARD' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80' : 'bg-purple-50 text-purple-700 ring-1 ring-purple-200/80'
                              }`}>
                                {ts.serviceType === 'STANDARD' ? '표준' : '백그라운드'}
                              </span>
                            </td>
                            <td className="text-right py-3 px-4 font-medium text-emerald-700 tabular-nums">{ts.savedMM != null ? ts.savedMM.toFixed(1) : '-'}</td>
                            <td className="text-right py-3 px-4 text-pastel-700 tabular-nums">{formatNumber(ts.mau)}</td>
                            <td className="text-right py-3 px-4 text-pastel-700 tabular-nums">{formatNumber(ts.llmCallCount)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
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
