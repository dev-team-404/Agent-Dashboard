import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { TrendingUp, Users, Zap, BarChart3, Activity, CalendarDays } from 'lucide-react';
import { statsApi } from '../../services/api';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ea580c', '#6366f1', '#22c55e', '#ef4444',
  '#a855f7', '#0ea5e9', '#fb923c', '#84cc16', '#f43f5e',
];

type ChartType = 'cumUsers' | 'cumTokens' | 'dau' | 'mau' | 'requests' | 'deptUsage';

const TABS: { key: ChartType; label: string; icon: React.ElementType }[] = [
  { key: 'cumUsers', label: '누적 사용자', icon: Users },
  { key: 'cumTokens', label: '누적 토큰', icon: Zap },
  { key: 'dau', label: '서비스별 DAU', icon: Activity },
  { key: 'mau', label: '서비스별 MAU', icon: CalendarDays },
  { key: 'requests', label: '일별 요청수', icon: BarChart3 },
  { key: 'deptUsage', label: '부서별 사용량', icon: TrendingUp },
];

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function formatDate(d: string): string {
  return d.slice(5); // MM-DD
}

function rankServiceKeys(data: Record<string, unknown>[], limit = 10): { top: string[]; rest: string[] } {
  const keys = new Set<string>();
  data.forEach(row => Object.keys(row).forEach(k => { if (k !== 'date') keys.add(k); }));
  const sorted = Array.from(keys).sort((a, b) => {
    const sumA = data.reduce((s, r) => s + ((r[a] as number) || 0), 0);
    const sumB = data.reduce((s, r) => s + ((r[b] as number) || 0), 0);
    return sumB - sumA;
  });
  return { top: sorted.slice(0, limit), rest: sorted.slice(limit) };
}

function OverflowTable({ data, keys, label }: { data: Record<string, unknown>[]; keys: string[]; label: string }) {
  if (keys.length === 0) return null;
  const rows = keys.map(key => ({
    name: key,
    total: data.reduce((s, r) => s + ((r[key] as number) || 0), 0),
    latest: (data[data.length - 1]?.[key] as number) || 0,
  })).sort((a, b) => b.total - a.total);

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="text-xs text-gray-500 mb-2">그 외 {keys.length}개 서비스 {label}</p>
      <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="text-left py-2 px-3 font-medium text-gray-500">서비스</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">합계</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">최근</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td className="py-1.5 px-3 text-gray-700 truncate max-w-[200px]">{r.name}</td>
                <td className="text-right py-1.5 px-3 text-gray-600">{formatNum(r.total)}</td>
                <td className="text-right py-1.5 px-3 text-gray-600">{formatNum(r.latest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EnhancedServiceCharts() {
  const [tab, setTab] = useState<ChartType>('cumUsers');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [cumUsersData, setCumUsersData] = useState<{ data: Record<string, unknown>[] }>({ data: [] });
  const [cumTokensData, setCumTokensData] = useState<{ data: Record<string, unknown>[] }>({ data: [] });
  const [dauData, setDauData] = useState<{ data: Record<string, unknown>[] }>({ data: [] });
  const [requestsData, setRequestsData] = useState<{ data: Record<string, unknown>[] }>({ data: [] });
  const [deptUsageData, setDeptUsageData] = useState<{ data: { serviceName: string; deptname: string; totalTokens: number; requestCount: number }[] }>({ data: [] });
  const [mauData, setMauData] = useState<{
    monthlyData: Record<string, unknown>[];
    services: { id: string; displayName: string; type: string }[];
    estimationMeta?: {
      monthlyBaseline?: Record<string, {
        callsPerPersonPerDay: number;
        callsPerPersonPerMonth: number;
        standardMAU: number;
        standardTotalCalls: number;
        avgDailyDAU: number;
        businessDays: number;
        isFixed: boolean;
      }>;
      backgroundMonthlyDetail?: Record<string, { totalCalls: number; estimatedMAU: number }>;
    } | null;
  }>({ monthlyData: [], services: [] });

  useEffect(() => {
    loadChartData();
  }, [days]);

  const loadChartData = async () => {
    setLoading(true);
    try {
      const months = days <= 30 ? 3 : days <= 90 ? 6 : 12;
      const [cumUsersRes, cumTokensRes, dauRes, requestsRes, deptRes, mauRes] = await Promise.all([
        statsApi.globalCumulativeUsersByService(days),
        statsApi.globalCumulativeTokensByService(days),
        statsApi.globalDauByService(days),
        statsApi.globalServiceDailyRequests(days),
        statsApi.globalDeptUsageByService(days),
        statsApi.globalMauByService(months).catch(() => ({ data: { services: [], monthlyData: [] } })),
      ]);
      setCumUsersData(cumUsersRes.data);
      setCumTokensData(cumTokensRes.data);
      setDauData(dauRes.data);
      setRequestsData(requestsRes.data);
      setDeptUsageData(deptRes.data);
      setMauData({ monthlyData: mauRes.data.monthlyData || [], services: mauRes.data.services || [], estimationMeta: mauRes.data.estimationMeta || null });
    } catch (err) {
      console.error('Failed to load enhanced charts:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderLineChart = (data: Record<string, unknown>[], yFormatter?: (v: number) => string) => {
    if (data.length === 0) return <EmptyState />;
    const { top, rest } = rankServiceKeys(data, 10);
    return (
      <>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={yFormatter || formatNum} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value: number) => (yFormatter ? yFormatter(value) : formatNum(value))}
              labelFormatter={(l: string) => l}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {top.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <OverflowTable data={data} keys={rest} label="요약" />
      </>
    );
  };

  const renderAreaChart = (data: Record<string, unknown>[]) => {
    if (data.length === 0) return <EmptyState />;
    const { top, rest } = rankServiceKeys(data, 10);
    return (
      <>
        <ResponsiveContainer width="100%" height={360}>
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={formatNum} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value: number) => formatNum(value)}
              labelFormatter={(l: string) => l}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {top.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <OverflowTable data={data} keys={rest} label="요약" />
      </>
    );
  };

  const renderMauChart = () => {
    const { monthlyData, services, estimationMeta } = mauData;
    if (monthlyData.length === 0 || services.length === 0) return <EmptyState />;

    // Rank by latest month's MAU
    const lastMonth = monthlyData[monthlyData.length - 1] || {};
    const ranked = [...services].sort((a, b) => ((lastMonth[b.id] as number) || 0) - ((lastMonth[a.id] as number) || 0));
    const topSvcs = ranked.slice(0, 10);
    const restSvcs = ranked.slice(10);

    return (
      <>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={monthlyData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              content={({ active, payload, label: monthLabel }) => {
                if (!active || !payload || payload.length === 0) return null;
                const baseline = estimationMeta?.monthlyBaseline?.[monthLabel as string];
                const isFixed = baseline?.isFixed ?? true;
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm max-w-xs">
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
                      <span className="font-semibold text-gray-800">{monthLabel}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isFixed ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                        {isFixed ? '확정' : '실시간'}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {payload.map((entry: any) => {
                        const svcId = String(entry.dataKey || '');
                        const svc = services.find(s => s.id === svcId);
                        const displayName = svc?.displayName || svcId;
                        const isBg = svc?.type === 'BACKGROUND';
                        const value = entry.value ?? 0;
                        const bgDetail = estimationMeta?.backgroundMonthlyDetail?.[`${svcId}|${monthLabel}`];
                        const callsPerMonth = baseline?.callsPerPersonPerMonth;
                        return (
                          <div key={svcId}>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                              <span className="text-gray-700">{displayName}:</span>
                              <span className="font-semibold text-gray-900">
                                {isBg ? `≈${value}명` : `${value}명`}
                              </span>
                              <span className={`text-[10px] ${isBg ? 'text-amber-500' : 'text-blue-500'}`}>
                                ({isBg ? '추정' : '실측'})
                              </span>
                            </div>
                            {isBg && bgDetail && callsPerMonth && (
                              <p className="ml-[18px] text-[11px] text-gray-400 leading-tight mt-0.5">
                                해당 월 호출 {bgDetail.totalCalls.toLocaleString()}회 &divide; 1인당 월평균 {callsPerMonth}회 = {bgDetail.estimatedMAU}명
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              formatter={(value: string) => {
                const svc = services.find(s => s.id === value);
                return svc?.displayName || value;
              }}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            {topSvcs.map((svc, i) => (
              <Line
                key={svc.id}
                type="monotone"
                dataKey={svc.id}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                strokeDasharray={svc.type === 'BACKGROUND' ? '5 3' : undefined}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {restSvcs.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 mb-2">그 외 {restSvcs.length}개 서비스</p>
            <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">서비스</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">최근 MAU</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">타입</th>
                  </tr>
                </thead>
                <tbody>
                  {restSvcs.map((svc, i) => (
                    <tr key={svc.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="py-1.5 px-3 text-gray-700 truncate max-w-[200px]">{svc.displayName}</td>
                      <td className="text-right py-1.5 px-3 text-gray-600">{(lastMonth[svc.id] as number) || 0}</td>
                      <td className="text-right py-1.5 px-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${svc.type === 'BACKGROUND' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                          {svc.type === 'BACKGROUND' ? '추정' : '실측'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderDeptUsageChart = () => {
    const data = deptUsageData.data || [];
    if (data.length === 0) return <EmptyState />;

    // Group by serviceName for bar chart
    const grouped: Record<string, { deptname: string; tokens: number }[]> = {};
    data.forEach(d => {
      if (!grouped[d.serviceName]) grouped[d.serviceName] = [];
      grouped[d.serviceName].push({ deptname: d.deptname, tokens: d.totalTokens });
    });

    // Flatten for recharts — pivot by dept
    const allDepts = [...new Set(data.map(d => d.deptname))];
    const serviceNames = Object.keys(grouped);
    const chartData = serviceNames.map(svc => {
      const row: Record<string, unknown> = { service: svc };
      const items = grouped[svc];
      allDepts.forEach(dept => {
        const match = items.find(i => i.deptname === dept);
        row[dept] = match ? match.tokens : 0;
      });
      return row;
    });

    return (
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="service" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={60} />
          <YAxis tickFormatter={formatNum} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value: number) => formatNum(value)}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {allDepts.slice(0, 10).map((dept, i) => (
            <Bar key={dept} dataKey={dept} stackId="a" fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-50">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">서비스별 상세 메트릭</h2>
            <p className="text-xs text-gray-500">모든 서비스의 주요 지표를 한눈에 비교</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === d
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Chart content */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center h-80">
            <div className="text-center">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="mt-2 text-sm text-gray-500">차트 로딩 중...</p>
            </div>
          </div>
        ) : (
          <>
            {tab === 'cumUsers' && renderLineChart(cumUsersData.data)}
            {tab === 'cumTokens' && renderAreaChart(cumTokensData.data)}
            {tab === 'dau' && renderLineChart(dauData.data)}
            {tab === 'mau' && renderMauChart()}
            {tab === 'requests' && renderAreaChart(requestsData.data)}
            {tab === 'deptUsage' && renderDeptUsageChart()}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-80">
      <div className="text-center">
        <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">데이터가 아직 없습니다</p>
      </div>
    </div>
  );
}
