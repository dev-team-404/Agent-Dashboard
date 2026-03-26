import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Calendar, Zap, Clock, Activity } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, PieChart, Pie, Cell
} from 'recharts';
import { myUsageApi, serviceApi } from '../services/api';

interface UsageSummary {
  today: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number };
  week: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number };
  month: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number };
}

interface DailyStat {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ModelUsage {
  modelId: string;
  modelName: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface RecentLog {
  id: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestamp: string;
}

interface ServiceInfo {
  id: string;
  name: string;
  displayName: string;
}

const COLORS = ['#4A90D9', '#6366F1', '#8B5CF6', '#10B981', '#F59E0B', '#F43F5E'];

export default function MyUsage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    loadData();
  }, [days, selectedServiceId]);

  const loadServices = async () => {
    try {
      const response = await serviceApi.listNames();
      setServices(response.data.services || []);
    } catch (error) {
      console.error('Failed to load services:', error);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const serviceId = selectedServiceId || undefined;
      const [summaryRes, dailyRes, modelRes, recentRes] = await Promise.all([
        myUsageApi.summary(serviceId),
        myUsageApi.daily(days, serviceId),
        myUsageApi.byModel(days, serviceId),
        myUsageApi.recent(20, 0, serviceId),
      ]);
      setSummary(summaryRes.data);
      setDailyStats(dailyRes.data.stats);
      setModelUsage(modelRes.data.usage);
      setRecentLogs(recentRes.data.logs);
    } catch (error) {
      console.error('Failed to load usage data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  if (loading) return <LoadingSpinner />;

  const summaryCards = summary ? [
    { label: '오늘', icon: Zap, tokens: summary.today.totalTokens, requests: summary.today.requests, iconBg: 'bg-blue-50', iconColor: 'text-samsung-blue' },
    { label: '이번 주', icon: Calendar, tokens: summary.week.totalTokens, requests: summary.week.requests, iconBg: 'bg-indigo-50', iconColor: 'text-accent-indigo' },
    { label: '이번 달', icon: TrendingUp, tokens: summary.month.totalTokens, requests: summary.month.requests, iconBg: 'bg-violet-50', iconColor: 'text-accent-violet' },
  ] : [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">내 사용량</h1>
          <p className="text-sm text-pastel-500 mt-1">나의 LLM API 사용 현황을 확인하세요</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            내 토큰 사용량과 요청 기록을 확인합니다. Rate Limit이 설정된 경우 남은 한도를 확인할 수 있습니다. 서비스별 필터로 상세 내역을 조회하세요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {services.length > 0 && (
            <select
              value={selectedServiceId}
              onChange={(e) => setSelectedServiceId(e.target.value)}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/40 bg-white shadow-sm font-medium text-pastel-700 transition-all"
            >
              <option value="">전체 서비스</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>{service.displayName}</option>
              ))}
            </select>
          )}
          <div className="flex bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-4 py-2.5 text-sm font-semibold transition-all ${
                  days === d
                    ? 'bg-samsung-blue text-white shadow-sm'
                    : 'text-pastel-600 hover:bg-pastel-50'
                }`}
              >
                {d}일
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {summaryCards.map(({ label, icon: Icon, tokens, requests, iconBg, iconColor }, i) => (
            <div key={label} className={`metric-card animate-stagger-${i + 1}`}>
              <div className="flex items-center justify-between mb-4">
                <div className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center ring-1 ring-black/[0.02]`}>
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <span className="text-xs font-semibold text-pastel-400 uppercase tracking-wider">{label}</span>
              </div>
              <p className="text-3xl font-bold text-pastel-800 tracking-tight">{formatNumber(tokens)}</p>
              <div className="flex items-center gap-1.5 mt-2">
                <Activity className="w-3.5 h-3.5 text-pastel-400" />
                <p className="text-sm text-pastel-500 font-medium">{requests.toLocaleString()} 요청</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Usage Chart */}
        <div className="lg:col-span-2 bg-white rounded-lg p-6 border border-gray-100/80 shadow-sm hover:shadow-md transition-shadow animate-stagger-4">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <BarChart3 className="w-[18px] h-[18px] text-samsung-blue" />
            </div>
            <h2 className="font-bold text-pastel-800 text-[15px]">일별 토큰 사용량</h2>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStats}>
                <defs>
                  <linearGradient id="colorTokensMyUsage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4A90D9" stopOpacity={0.2}/>
                    <stop offset="100%" stopColor="#4A90D9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="date" tickFormatter={formatDate} stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={formatNumber} stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'white', border: '1px solid #E2E8F0', borderRadius: '8px', boxShadow: '0 8px 32px rgb(0 0 0 / 0.08)', padding: '12px 16px' }}
                  formatter={(value: number) => [formatNumber(value), '토큰']}
                  labelFormatter={(label) => `날짜: ${label}`}
                />
                <Area type="monotone" dataKey="totalTokens" stroke="#4A90D9" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTokensMyUsage)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Model Usage Pie */}
        <div className="bg-white rounded-lg p-6 border border-gray-100/80 shadow-sm hover:shadow-md transition-shadow animate-stagger-5">
          <h2 className="font-bold text-pastel-800 text-[15px] mb-6">모델별 사용량</h2>
          {modelUsage.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={modelUsage}
                    dataKey="totalTokens"
                    nameKey="modelName"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    innerRadius={50}
                    strokeWidth={2}
                    stroke="#fff"
                    label={({ modelName, percent }) =>
                      `${modelName.slice(0, 10)}${modelName.length > 10 ? '..' : ''} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {modelUsage.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatNumber(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-pastel-100 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-pastel-400" />
                </div>
                <p className="text-sm text-pastel-500 font-medium">사용 데이터가 없습니다</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Daily Requests Bar Chart */}
      <div className="bg-white rounded-lg p-6 border border-gray-100/80 shadow-sm hover:shadow-md transition-shadow animate-stagger-6">
        <h2 className="font-bold text-pastel-800 text-[15px] mb-6">일별 요청 수 및 토큰</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tickFormatter={formatDate} stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" stroke="#4A90D9" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#6366F1" fontSize={12} tickFormatter={formatNumber} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #E2E8F0', borderRadius: '8px', boxShadow: '0 8px 32px rgb(0 0 0 / 0.08)', padding: '12px 16px' }} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar yAxisId="left" dataKey="requests" fill="#4A90D9" name="요청 수" radius={[6, 6, 0, 0]} />
              <Bar yAxisId="right" dataKey="inputTokens" fill="#6366F1" name="입력 토큰" radius={[6, 6, 0, 0]} />
              <Bar yAxisId="right" dataKey="outputTokens" fill="#8B5CF6" name="출력 토큰" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Usage Table */}
      <div className="bg-white rounded-lg border border-gray-100/80 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <Clock className="w-[18px] h-[18px] text-samsung-blue" />
            </div>
            <h2 className="font-bold text-pastel-800 text-[15px]">최근 사용 기록</h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">시간</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">모델</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider">입력</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider">출력</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider">합계</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentLogs.length > 0 ? (
                recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-pastel-600">{formatDateTime(log.timestamp)}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-pastel-700">
                        {log.modelName}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-pastel-600 tabular-nums">{formatNumber(log.inputTokens)}</td>
                    <td className="px-6 py-4 text-sm text-right text-pastel-600 tabular-nums">{formatNumber(log.outputTokens)}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-pastel-800 tabular-nums">{formatNumber(log.totalTokens)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-pastel-500 text-sm font-medium">
                    사용 기록이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model Usage Detail Table */}
      {modelUsage.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-100/80 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100/80">
            <h2 className="font-bold text-pastel-800 text-[15px]">모델별 상세 사용량</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">모델</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider">요청</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider">입력</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider">출력</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {modelUsage.map((model, i) => (
                  <tr key={model.modelId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="font-semibold text-pastel-800 text-sm">{model.modelName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-pastel-600 tabular-nums">{model.requests.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-right text-pastel-600 tabular-nums">{formatNumber(model.inputTokens)}</td>
                    <td className="px-6 py-4 text-sm text-right text-pastel-600 tabular-nums">{formatNumber(model.outputTokens)}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-pastel-800 tabular-nums">{formatNumber(model.totalTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
