import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { TrendingUp, Users, Zap, BarChart3, Activity, CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { statsApi } from '../../services/api';
import { useHolidayDates } from '../../hooks/useHolidayDates';
import { filterBusinessDays } from '../../utils/businessDayFilter';
import { useBusinessDayToggle } from '../../hooks/useBusinessDayToggle';
import i18n from '../../i18n';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ea580c', '#6366f1', '#22c55e', '#ef4444',
  '#a855f7', '#0ea5e9', '#fb923c', '#84cc16', '#f43f5e',
];

type ChartType = 'cumUsers' | 'cumTokens' | 'dau' | 'mau' | 'requests' | 'deptUsage';


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
      <p className="text-xs text-gray-500 mb-2">{i18n.t('charts.enhancedService.otherServicesSummary', { count: keys.length, label })}</p>
      <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="text-left py-2 px-3 font-medium text-gray-500">{i18n.t('charts.enhancedService.serviceColumn')}</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">{i18n.t('charts.enhancedService.totalColumn')}</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">{i18n.t('charts.enhancedService.latestColumn')}</th>
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
  const { t } = useTranslation();
  const TABS: { key: ChartType; label: string; icon: React.ElementType }[] = [
    { key: 'cumUsers', label: t('charts.enhancedService.tabCumUsers'), icon: Users },
    { key: 'cumTokens', label: t('charts.enhancedService.tabCumTokens'), icon: Zap },
    { key: 'dau', label: t('charts.enhancedService.tabDau'), icon: Activity },
    { key: 'mau', label: t('charts.enhancedService.tabMau'), icon: CalendarDays },
    { key: 'requests', label: t('charts.enhancedService.tabRequests'), icon: BarChart3 },
    { key: 'deptUsage', label: t('charts.enhancedService.tabDeptUsage'), icon: TrendingUp },
  ];
  const [tab, setTab] = useState<ChartType>('cumUsers');
  const [days, setDays] = useState(30);
  const holidayDates = useHolidayDates();
  const { exclude } = useBusinessDayToggle();
  const [loading, setLoading] = useState(true);
  const [cumUsersData, setCumUsersData] = useState<{ data: Record<string, unknown>[] }>({ data: [] });
  const [cumTokensData, setCumTokensData] = useState<{ data: Record<string, unknown>[] }>({ data: [] });
  const [dauData, setDauData] = useState<{
    data: Record<string, unknown>[];
    serviceTypeMap?: Record<string, string>;
    estimationMeta?: {
      callsPerPersonPerDay: number;
      standardAvgDailyDAU: number;
      standardAvgDailyCalls: number;
      businessDays: number;
    } | null;
  }>({ data: [] });
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
      setDauData({ data: dauRes.data.data || [], serviceTypeMap: dauRes.data.serviceTypeMap, estimationMeta: dauRes.data.estimationMeta || null });
      setRequestsData(requestsRes.data);
      setDeptUsageData(deptRes.data);
      setMauData({ monthlyData: mauRes.data.monthlyData || [], services: mauRes.data.services || [], estimationMeta: mauRes.data.estimationMeta || null });
    } catch (err) {
      console.error('Failed to load enhanced charts:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderLineChart = (rawData: Record<string, unknown>[], yFormatter?: (v: number) => string) => {
    const data = exclude ? filterBusinessDays(rawData, (d) => String(d.date), holidayDates) : rawData;
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
        <OverflowTable data={data} keys={rest} label={t('charts.enhancedService.summary')} />
      </>
    );
  };

  const renderAreaChart = (rawData: Record<string, unknown>[]) => {
    const data = exclude ? filterBusinessDays(rawData, (d) => String(d.date), holidayDates) : rawData;
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
        <OverflowTable data={data} keys={rest} label={t('charts.enhancedService.summary')} />
      </>
    );
  };

  const renderDauChart = () => {
    const { data: rawData, serviceTypeMap, estimationMeta } = dauData;
    const data = exclude ? filterBusinessDays(rawData, (d) => String(d.date), holidayDates) : rawData;
    if (data.length === 0) return <EmptyState />;
    const { top, rest } = rankServiceKeys(data, 10);
    const hasBg = top.some(k => serviceTypeMap?.[k] === 'BACKGROUND');
    return (
      <>
        {hasBg && estimationMeta && estimationMeta.callsPerPersonPerDay > 0 && (
          <div className="text-xs text-gray-400 text-right mb-3 space-y-0.5">
            <div>
              <span>{t('charts.enhancedService.perPersonDailyAvg')}<strong className="text-gray-600">{t('charts.enhancedService.perPersonDailyAvgValue', { count: estimationMeta.callsPerPersonPerDay })}</strong></span>
              <span className="mx-2">|</span>
              <span>{t('charts.enhancedService.standardAvgDau')}<strong className="text-gray-600">{t('charts.enhancedService.standardAvgDauValue', { count: estimationMeta.standardAvgDailyDAU })}</strong></span>
              <span className="mx-2">|</span>
              <span>{t('charts.enhancedService.businessDays')}<strong className="text-gray-600">{t('charts.enhancedService.businessDaysValue', { count: estimationMeta.businessDays })}</strong></span>
            </div>
            <div className="flex items-center gap-1 justify-end text-gray-400">
              <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 2" /></svg>
              <span>{t('charts.enhancedService.estimatedBg')}</span>
              <span className="mx-1">|</span>
              <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke="#6b7280" strokeWidth="2" /></svg>
              <span>{t('charts.enhancedService.actualStd')}</span>
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={formatNum} tick={{ fontSize: 11 }} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm max-w-xs">
                    <div className="font-semibold text-gray-800 mb-2 pb-2 border-b border-gray-100">{label}</div>
                    <div className="space-y-1.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {payload.map((entry: any) => {
                        const key = String(entry.dataKey || '');
                        const isBg = serviceTypeMap?.[key] === 'BACKGROUND';
                        const value = entry.value ?? 0;
                        const cpd = estimationMeta?.callsPerPersonPerDay;
                        return (
                          <div key={key}>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                              <span className="text-gray-700">{key}:</span>
                              <span className="font-semibold text-gray-900">
                                {isBg ? t('charts.enhancedService.approxUsers', { count: value }) : t('charts.enhancedService.exactUsers', { count: value })}
                              </span>
                              <span className={`text-[10px] ${isBg ? 'text-amber-500' : 'text-blue-500'}`}>
                                ({isBg ? t('charts.enhancedService.estimated') : t('charts.enhancedService.actual')})
                              </span>
                            </div>
                            {isBg && cpd && value > 0 && (
                              <p className="ml-[18px] text-[11px] text-gray-400 leading-tight mt-0.5">
                                {t('charts.enhancedService.dailyCallsEstimation', { calls: Math.round(value * cpd).toLocaleString(), perPerson: cpd, result: value })}
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
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {top.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                strokeDasharray={serviceTypeMap?.[key] === 'BACKGROUND' ? '5 3' : undefined}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <OverflowTable data={data} keys={rest} label={t('charts.enhancedService.summary')} />
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
                        {isFixed ? t('charts.enhancedService.fixed') : t('charts.enhancedService.realtime')}
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
                                {isBg ? t('charts.enhancedService.approxUsers', { count: value }) : t('charts.enhancedService.exactUsers', { count: value })}
                              </span>
                              <span className={`text-[10px] ${isBg ? 'text-amber-500' : 'text-blue-500'}`}>
                                ({isBg ? t('charts.enhancedService.estimated') : t('charts.enhancedService.actual')})
                              </span>
                            </div>
                            {isBg && bgDetail && callsPerMonth && (
                              <p className="ml-[18px] text-[11px] text-gray-400 leading-tight mt-0.5">
                                {t('charts.enhancedService.monthlyCallsEstimation', { calls: bgDetail.totalCalls.toLocaleString(), perPerson: callsPerMonth, result: bgDetail.estimatedMAU })}
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
            <p className="text-xs text-gray-500 mb-2">{t('charts.enhancedService.otherServicesCount', { count: restSvcs.length })}</p>
            <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">{t('charts.enhancedService.serviceColumn')}</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">{t('charts.enhancedService.latestMau')}</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">{t('charts.enhancedService.type')}</th>
                  </tr>
                </thead>
                <tbody>
                  {restSvcs.map((svc, i) => (
                    <tr key={svc.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="py-1.5 px-3 text-gray-700 truncate max-w-[200px]">{svc.displayName}</td>
                      <td className="text-right py-1.5 px-3 text-gray-600">{(lastMonth[svc.id] as number) || 0}</td>
                      <td className="text-right py-1.5 px-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${svc.type === 'BACKGROUND' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                          {svc.type === 'BACKGROUND' ? t('charts.enhancedService.estimated') : t('charts.enhancedService.actual')}
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
            <h2 className="text-lg font-bold text-gray-800">{t('charts.enhancedService.title')}</h2>
            <p className="text-xs text-gray-500">{t('charts.enhancedService.subtitle')}</p>
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
              {t('charts.enhancedService.daysLabel', { days: d })}
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
              <p className="mt-2 text-sm text-gray-500">{t('charts.enhancedService.chartLoading')}</p>
            </div>
          </div>
        ) : (
          <>
            {tab === 'cumUsers' && renderLineChart(cumUsersData.data)}
            {tab === 'cumTokens' && renderAreaChart(cumTokensData.data)}
            {tab === 'dau' && renderDauChart()}
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
        <p className="text-sm text-gray-500">{i18n.t('charts.enhancedService.noDataYet')}</p>
      </div>
    </div>
  );
}
