import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Cell,
} from 'recharts';
import {
  Download, Loader2, Calendar, BarChart3, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { statsApi } from '../../services/api';
import { useHolidayDates } from '../../hooks/useHolidayDates';
import { filterBusinessDays } from '../../utils/businessDayFilter';
import { useBusinessDayToggle } from '../../hooks/useBusinessDayToggle';

const COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#3B82F6', '#EF4444', '#14B8A6', '#F97316', '#06B6D4',
];

type Tab = 'overview' | 'user' | 'model' | 'department';
type Preset = '7d' | '30d' | '90d';

interface UsageAnalyticsProps {
  serviceId?: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  return dateStr.slice(5); // MM-DD
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportToCsv(data: Record<string, any>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')),
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

interface DailyItem {
  date: string | Date;
  _sum: {
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    requestCount: number | null;
  };
}

interface UserItem {
  userId: string;
  _sum: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  _count: number;
  user?: { loginid: string; username: string; deptname: string };
}

interface ModelItem {
  modelId: string;
  _sum: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  _count: number;
  model?: { id: string; name: string; displayName: string };
}

interface DeptItem {
  deptname: string;
  _sum: {
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    requestCount: number | null;
  };
}

interface DauItem {
  date: string;
  userCount: number;
}

export default function UsageAnalytics({ serviceId }: UsageAnalyticsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [preset, setPreset] = useState<Preset>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [dailyData, setDailyData] = useState<DailyItem[]>([]);
  const [userData, setUserData] = useState<UserItem[]>([]);
  const holidayDates = useHolidayDates();
  const { exclude } = useBusinessDayToggle();
  const [modelData, setModelData] = useState<ModelItem[]>([]);
  const [deptData, setDeptData] = useState<DeptItem[]>([]);
  const [dauData, setDauData] = useState<DauItem[]>([]);

  const days = useMemo(() => {
    if (preset === '7d') return 7;
    if (preset === '30d') return 30;
    return 90;
  }, [preset]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '개요' },
    { key: 'user', label: '사용자별' },
    { key: 'model', label: '모델별' },
    { key: 'department', label: '부서별' },
  ];

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // Always fetch daily + DAU for overview
      const [dailyRes, dauRes] = await Promise.all([
        statsApi.daily(days, serviceId),
        statsApi.dailyActiveUsers(days, serviceId),
      ]);
      setDailyData(dailyRes.data.dailyStats || []);
      setDauData(dauRes.data.chartData || []);

      // Fetch tab-specific data
      if (activeTab === 'user' || activeTab === 'overview') {
        const userRes = await statsApi.byUser(days, serviceId);
        setUserData(userRes.data.userStats || []);
      }
      if (activeTab === 'model' || activeTab === 'overview') {
        const modelRes = await statsApi.byModel(days, serviceId);
        setModelData(modelRes.data.modelStats || []);
      }
      if (activeTab === 'department') {
        const deptRes = await statsApi.byDept(days, serviceId);
        setDeptData(deptRes.data.deptStats || []);
      }
    } catch (err) {
      console.error('UsageAnalytics load error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [days, serviceId, activeTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Transform daily data for charts (주말/휴일 제외)
  const dailyChartData = useMemo(() => {
    const mapped = dailyData.map((d) => ({
      date: typeof d.date === 'string' ? d.date.split('T')[0] : new Date(d.date).toISOString().split('T')[0],
      inputTokens: d._sum.totalInputTokens || 0,
      outputTokens: d._sum.totalOutputTokens || 0,
      requests: d._sum.requestCount || 0,
    }));
    return exclude ? filterBusinessDays(mapped, (d) => d.date, holidayDates) : mapped;
  }, [dailyData, holidayDates, exclude]);

  // Business day averages (토글 상태에 따라 영업일만 또는 전체)
  const businessDayStats = useMemo(() => {
    if (dailyChartData.length === 0) return null;
    const totalReq = dailyChartData.reduce((s, d) => s + d.requests, 0);
    const totalIn = dailyChartData.reduce((s, d) => s + d.inputTokens, 0);
    const totalOut = dailyChartData.reduce((s, d) => s + d.outputTokens, 0);
    return {
      avgRequests: Math.round(totalReq / dailyChartData.length),
      avgInputTokens: Math.round(totalIn / dailyChartData.length),
      avgOutputTokens: Math.round(totalOut / dailyChartData.length),
      days: dailyChartData.length,
      totalDays: dailyData.length,
    };
  }, [dailyChartData, dailyData.length]);

  // Transform user data for charts
  const userChartData = useMemo(() =>
    userData.map((u) => ({
      loginid: u.user?.loginid || 'Unknown',
      username: u.user?.username || 'Unknown',
      deptname: u.user?.deptname || '',
      requests: u._count,
      inputTokens: u._sum.inputTokens || 0,
      outputTokens: u._sum.outputTokens || 0,
    })),
  [userData]);

  // Transform model data for charts
  const modelChartData = useMemo(() =>
    modelData.map((m) => ({
      modelName: m.model?.displayName || m.model?.name || 'Unknown',
      requests: m._count,
      inputTokens: m._sum.inputTokens || 0,
      outputTokens: m._sum.outputTokens || 0,
    })),
  [modelData]);

  // Transform dept data for charts
  const deptChartData = useMemo(() =>
    deptData.map((d) => ({
      deptname: d.deptname || 'Unknown',
      requests: d._sum.requestCount || 0,
      inputTokens: d._sum.totalInputTokens || 0,
      outputTokens: d._sum.totalOutputTokens || 0,
    })),
  [deptData]);

  // DAU 차트 데이터 (주말/휴일 제외)
  const filteredDauData = useMemo(() =>
    exclude ? filterBusinessDays(dauData, (d) => d.date, holidayDates) : dauData,
  [dauData, holidayDates, exclude]);

  const handleExport = () => {
    switch (activeTab) {
      case 'overview':
        exportToCsv(dailyChartData as Record<string, unknown>[], 'daily_usage');
        break;
      case 'user':
        exportToCsv(userChartData as Record<string, unknown>[], 'user_usage');
        break;
      case 'model':
        exportToCsv(modelChartData as Record<string, unknown>[], 'model_usage');
        break;
      case 'department':
        exportToCsv(deptChartData as Record<string, unknown>[], 'department_usage');
        break;
    }
  };

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-8">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertTriangle className="w-12 h-12 text-red-400" />
          <p className="text-gray-600">사용량 데이터를 불러오는데 실패했습니다.</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-samsung-blue text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> 다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-samsung-blue" />
          사용량 분석
        </h2>
        <button
          onClick={handleExport}
          className="px-3.5 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
      </div>

      {/* Date Range */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-400" />
          <div className="flex gap-2">
            {(['7d', '30d', '90d'] as Preset[]).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  preset === p
                    ? 'bg-samsung-blue text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p === '7d' ? '7일' : p === '30d' ? '30일' : '90일'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-samsung-blue text-samsung-blue'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-samsung-blue" />
        </div>
      )}

      {/* ═══════ Overview Tab ═══════ */}
      {!loading && activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Business Day Average Cards */}
          {businessDayStats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                label="일평균 요청 (영업일)"
                value={formatNumber(businessDayStats.avgRequests)}
              />
              <SummaryCard
                label="일평균 입력 토큰"
                value={formatNumber(businessDayStats.avgInputTokens)}
              />
              <SummaryCard
                label="일평균 출력 토큰"
                value={formatNumber(businessDayStats.avgOutputTokens)}
              />
              <SummaryCard
                label="영업일 수"
                value={`${businessDayStats.days}일`}
                sub={`전체 ${businessDayStats.totalDays}일 중`}
              />
            </div>
          )}

          {/* Daily Trend Area Chart */}
          <div className="bg-white rounded-xl shadow-card p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">일별 토큰 사용량 추이</h3>
            {dailyChartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-gray-400">데이터가 없습니다</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dailyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatDate} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNumber} />
                  <Tooltip formatter={(value: number) => formatNumber(value)} labelFormatter={(l) => `날짜: ${l}`} />
                  <Legend />
                  <Area type="monotone" dataKey="inputTokens" name="입력 토큰" stroke="#06B6D4" fill="#06B6D4" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="outputTokens" name="출력 토큰" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* DAU + Model Side-by-Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* DAU */}
            <div className="bg-white rounded-xl shadow-card p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">일별 활성 사용자</h3>
              {filteredDauData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400">데이터가 없습니다</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={filteredDauData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatDate} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(l) => `날짜: ${l}`} />
                    <Line type="monotone" dataKey="userCount" name="활성 사용자" stroke="#10B981" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Model usage */}
            <div className="bg-white rounded-xl shadow-card p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">모델별 사용량</h3>
              {modelChartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400">데이터가 없습니다</div>
              ) : (
                <ResponsiveContainer width="100%" height={280 + (modelChartData.length > 5 ? 40 : 0)}>
                  <BarChart data={modelChartData} margin={{ bottom: modelChartData.length > 5 ? 60 : 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="modelName"
                      tick={{ fontSize: 10 }}
                      interval={0}
                      angle={modelChartData.length > 5 ? -35 : 0}
                      textAnchor={modelChartData.length > 5 ? 'end' : 'middle'}
                      height={modelChartData.length > 5 ? 80 : 30}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNumber} />
                    <Tooltip formatter={(value: number) => formatNumber(value)} />
                    <Legend />
                    <Bar dataKey="inputTokens" name="입력 토큰" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outputTokens" name="출력 토큰" radius={[4, 4, 0, 0]}>
                      {modelChartData.map((_: unknown, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ User Tab ═══════ */}
      {!loading && activeTab === 'user' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-card p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">사용자별 사용량 (Top 20)</h3>
            {userChartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-gray-400">데이터가 없습니다</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(300, userChartData.length * 28)}>
                <BarChart data={userChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatNumber} />
                  <YAxis type="category" dataKey="loginid" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip formatter={(value: number) => formatNumber(value)} />
                  <Legend />
                  <Bar dataKey="requests" name="요청 수" fill="#6366F1" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="inputTokens" name="입력 토큰" fill="#06B6D4" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="outputTokens" name="출력 토큰" fill="#EC4899" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Data Table */}
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-500">사용자 ID</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">이름</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">부서</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">요청 수</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">입력 토큰</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">출력 토큰</th>
                  </tr>
                </thead>
                <tbody>
                  {userChartData.map((u) => (
                    <tr key={u.loginid} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-mono text-gray-700 text-xs">{u.loginid}</td>
                      <td className="py-2.5 px-4 text-gray-900">{u.username}</td>
                      <td className="py-2.5 px-4 text-gray-500 text-xs">{u.deptname}</td>
                      <td className="py-2.5 px-4 text-right">{u.requests.toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-gray-600">{u.inputTokens.toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-medium">{u.outputTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Model Tab ═══════ */}
      {!loading && activeTab === 'model' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-card p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">모델별 사용량</h3>
            {modelChartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-gray-400">데이터가 없습니다</div>
            ) : (
              <ResponsiveContainer width="100%" height={300 + (modelChartData.length > 5 ? 40 : 0)}>
                <BarChart data={modelChartData} margin={{ bottom: modelChartData.length > 5 ? 60 : 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="modelName"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={modelChartData.length > 5 ? -35 : 0}
                    textAnchor={modelChartData.length > 5 ? 'end' : 'middle'}
                    height={modelChartData.length > 5 ? 80 : 30}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNumber} />
                  <Tooltip formatter={(value: number) => formatNumber(value)} />
                  <Legend />
                  <Bar dataKey="requests" name="요청 수" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="inputTokens" name="입력 토큰" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outputTokens" name="출력 토큰" fill="#EC4899" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-500">모델</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">요청 수</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">입력 토큰</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">출력 토큰</th>
                  </tr>
                </thead>
                <tbody>
                  {modelChartData.map((m) => (
                    <tr key={m.modelName} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-medium text-gray-900">{m.modelName}</td>
                      <td className="py-2.5 px-4 text-right">{m.requests.toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-gray-600">{m.inputTokens.toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-medium">{m.outputTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Department Tab ═══════ */}
      {!loading && activeTab === 'department' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-card p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">부서별 사용량</h3>
            {deptChartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-gray-400">데이터가 없습니다</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(300, deptChartData.length * 28)}>
                <BarChart data={deptChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatNumber} />
                  <YAxis type="category" dataKey="deptname" tick={{ fontSize: 10 }} width={140} />
                  <Tooltip formatter={(value: number) => formatNumber(value)} />
                  <Legend />
                  <Bar dataKey="requests" name="요청 수" fill="#6366F1" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="inputTokens" name="입력 토큰" fill="#06B6D4" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="outputTokens" name="출력 토큰" fill="#F59E0B" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-500">부서</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">요청 수</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">입력 토큰</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">출력 토큰</th>
                  </tr>
                </thead>
                <tbody>
                  {deptChartData.map((d) => (
                    <tr key={d.deptname} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-medium text-gray-900">{d.deptname}</td>
                      <td className="py-2.5 px-4 text-right">{d.requests.toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right text-gray-600">{d.inputTokens.toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-right font-medium">{d.outputTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-card p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
