import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { statsApi } from '../../services/api';

interface ServiceInfo {
  id: string;
  name: string;
  displayName: string;
  type?: string;
}

interface EstimationMeta {
  callsPerPersonPerDay: number;
  standardAvgDailyDAU: number;
  standardAvgDailyCalls: number;
  businessDays: number;
}

interface ChartDataItem {
  week: string;
  [serviceId: string]: string | number;
}

// Color palette for different services
const SERVICE_COLORS = [
  '#0c8ce6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

// DATE_RANGE_OPTIONS moved inside component for i18n

type Granularity = 'daily' | 'weekly';

export default function WeeklyBusinessDAUChart() {
  const { t } = useTranslation();
  const DATE_RANGE_OPTIONS = [
    { label: t('charts.weeklyBusinessDau.month1'), value: 30 },
    { label: t('charts.weeklyBusinessDau.month3'), value: 90 },
    { label: t('charts.weeklyBusinessDau.month6'), value: 180 },
    { label: t('charts.weeklyBusinessDau.year1'), value: 365 },
  ];
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [chartData, setChartData] = useState<ChartDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [estimationMeta, setEstimationMeta] = useState<EstimationMeta | null>(null);

  useEffect(() => {
    loadData();
  }, [days, granularity]);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await statsApi.weeklyBusinessDau(days, granularity);
      setServices(response.data.services);
      setChartData(response.data.chartData);
      setEstimationMeta(response.data.estimationMeta || null);
    } catch (error) {
      console.error('Failed to load business DAU data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  };

  // Calculate tick interval based on data points
  const tickInterval = useMemo(() => {
    const count = chartData.length;
    if (granularity === 'daily') {
      if (count <= 14) return 0;
      if (count <= 31) return 1;
      if (count <= 90) return 4;
      return 9;
    }
    if (count <= 6) return 0;
    if (count <= 13) return 1;
    if (count <= 26) return 2;
    return 3;
  }, [chartData.length, granularity]);

  // Calculate stats for each service
  const serviceStats = useMemo(() => {
    if (chartData.length === 0 || services.length === 0) return {};

    const stats: Record<string, { avg: number; max: number; latest: number }> = {};

    for (const service of services) {
      const values = chartData.map((d) => (d[service.id] as number) || 0);
      const nonZeroValues = values.filter((v) => v > 0);

      stats[service.id] = {
        avg: nonZeroValues.length > 0
          ? Math.round(nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length)
          : 0,
        max: Math.max(...values),
        latest: values[values.length - 1] || 0,
      };
    }

    return stats;
  }, [chartData, services]);

  // Rank services: top 10 in chart, rest in table
  const { topServices, restServices } = useMemo(() => {
    if (services.length <= 10) return { topServices: services, restServices: [] as ServiceInfo[] };
    const ranked = [...services].sort((a, b) => {
      const aVal = serviceStats[a.id]?.latest || serviceStats[a.id]?.avg || 0;
      const bVal = serviceStats[b.id]?.latest || serviceStats[b.id]?.avg || 0;
      return bVal - aVal;
    });
    return { topServices: ranked.slice(0, 10), restServices: ranked.slice(10) };
  }, [services, serviceStats]);

  const title = granularity === 'daily'
    ? t('charts.weeklyBusinessDau.titleDaily')
    : t('charts.weeklyBusinessDau.titleWeekly');

  const subtitle = granularity === 'daily'
    ? t('charts.weeklyBusinessDau.subtitleDaily')
    : t('charts.weeklyBusinessDau.subtitleWeekly');

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-center justify-center h-80">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-samsung-blue"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-50 rounded-xl">
            <Calendar className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Granularity toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setGranularity('daily')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                granularity === 'daily'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('charts.weeklyBusinessDau.daily')}
            </button>
            <button
              onClick={() => setGranularity('weekly')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                granularity === 'weekly'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('charts.weeklyBusinessDau.weekly')}
            </button>
          </div>
          {/* Date range */}
          <div className="flex items-center gap-2">
            {DATE_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setDays(option.value)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  days === option.value
                    ? 'bg-samsung-blue text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Estimation baseline info */}
      {estimationMeta && estimationMeta.callsPerPersonPerDay > 0 && (
        <div className="text-xs text-gray-400 text-right mb-4 space-y-0.5">
          <div>
            <span>{t('charts.weeklyBusinessDau.perPersonDailyAvg')}<strong className="text-gray-600">{t('charts.weeklyBusinessDau.perPersonDailyAvgValue', { count: estimationMeta.callsPerPersonPerDay })}</strong></span>
            <span className="mx-2">|</span>
            <span>{t('charts.weeklyBusinessDau.standardAvgDau')}<strong className="text-gray-600">{t('charts.weeklyBusinessDau.standardAvgDauValue', { count: estimationMeta.standardAvgDailyDAU })}</strong></span>
            <span className="mx-2">|</span>
            <span>{t('charts.weeklyBusinessDau.businessDays')}<strong className="text-gray-600">{t('charts.weeklyBusinessDau.businessDaysValue', { count: estimationMeta.businessDays })}</strong></span>
          </div>
          <div className="flex items-center gap-1 justify-end text-gray-400">
            <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 2" /></svg>
            <span>{t('charts.weeklyBusinessDau.estimatedBg')}</span>
            <span className="mx-1">|</span>
            <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke="#6b7280" strokeWidth="2" /></svg>
            <span>{t('charts.weeklyBusinessDau.actualStd')}</span>
          </div>
        </div>
      )}

      {/* Service Stats Summary */}
      {topServices.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {topServices.map((service, index) => {
            const stats = serviceStats[service.id];
            const isBg = service.type === 'BACKGROUND';
            return (
              <div
                key={service.id}
                className="p-3 bg-gray-50 rounded-lg border-l-4"
                style={{ borderLeftColor: SERVICE_COLORS[index % SERVICE_COLORS.length] }}
              >
                <p className="text-xs text-gray-500 truncate">
                  {service.displayName}
                  {isBg && <span className="ml-1 text-[10px] text-amber-500">({t('charts.weeklyBusinessDau.estimated')})</span>}
                </p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-bold text-gray-900">{isBg ? '≈' : ''}{stats?.latest || 0}</p>
                  <p className="text-xs text-gray-400">{t('charts.weeklyBusinessDau.latest')}</p>
                </div>
                <p className="text-[10px] text-gray-400">{t('charts.weeklyBusinessDau.average')}: {stats?.avg || 0} / {t('charts.weeklyBusinessDau.max')}: {stats?.max || 0}</p>
              </div>
            );
          })}
        </div>
      )}

      {chartData.length === 0 || services.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-gray-400">
          {t('common.noData')}
        </div>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="week"
                tickFormatter={formatDate}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                interval={tickInterval}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const date = new Date(label);
                  const dateLabel = granularity === 'daily'
                    ? t('charts.weeklyBusinessDau.dateFormatDaily', { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() })
                    : t('charts.weeklyBusinessDau.dateFormatWeekly', { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm max-w-xs">
                      <div className="font-semibold text-gray-800 mb-2 pb-2 border-b border-gray-100">{dateLabel}</div>
                      <div className="space-y-1.5">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {payload.map((entry: any) => {
                          const svcId = String(entry.dataKey || '');
                          const svc = services.find(s => s.id === svcId);
                          const displayName = svc?.displayName || svcId;
                          const isBg = svc?.type === 'BACKGROUND';
                          const value = entry.value ?? 0;
                          const cpd = estimationMeta?.callsPerPersonPerDay;
                          return (
                            <div key={svcId}>
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                                <span className="text-gray-700">{displayName}:</span>
                                <span className="font-semibold text-gray-900">
                                  {isBg ? t('charts.weeklyBusinessDau.approxUsers', { count: value }) : t('charts.weeklyBusinessDau.exactUsers', { count: value })}
                                </span>
                                <span className={`text-[10px] ${isBg ? 'text-amber-500' : 'text-blue-500'}`}>
                                  ({isBg ? t('charts.weeklyBusinessDau.estimated') : t('charts.weeklyBusinessDau.actual')})
                                </span>
                              </div>
                              {isBg && cpd && value > 0 && (
                                <p className="ml-[18px] text-[11px] text-gray-400 leading-tight mt-0.5">
                                  {t('charts.weeklyBusinessDau.dailyCallsEstimation', { calls: Math.round(value * cpd).toLocaleString(), perPerson: cpd, result: value })}
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
                  const service = topServices.find((s) => s.id === value);
                  return service?.displayName || value;
                }}
              />
              {topServices.map((service, index) => (
                <Line
                  key={service.id}
                  type="monotone"
                  dataKey={service.id}
                  name={service.id}
                  stroke={SERVICE_COLORS[index % SERVICE_COLORS.length]}
                  strokeWidth={2}
                  strokeDasharray={service.type === 'BACKGROUND' ? '5 3' : undefined}
                  dot={{ r: granularity === 'daily' ? 2 : 3, strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {restServices.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4 px-2">
          <p className="text-xs text-gray-500 mb-2">{t('charts.weeklyBusinessDau.otherServicesCount', { count: restServices.length })}</p>
          <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">{t('charts.weeklyBusinessDau.serviceColumn')}</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">{t('charts.weeklyBusinessDau.latestColumn')}</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">{t('charts.weeklyBusinessDau.averageColumn')}</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">{t('charts.weeklyBusinessDau.maxColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {restServices.map((service, i) => {
                  const stats = serviceStats[service.id];
                  return (
                    <tr key={service.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="py-1.5 px-3 text-gray-700 truncate max-w-[200px]">{service.displayName}</td>
                      <td className="text-right py-1.5 px-3 text-gray-600">{stats?.latest || 0}</td>
                      <td className="text-right py-1.5 px-3 text-gray-600">{stats?.avg || 0}</td>
                      <td className="text-right py-1.5 px-3 text-gray-600">{stats?.max || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
