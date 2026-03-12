import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, Activity, Zap, TrendingUp,
  Clock, BarChart3, Layers,
} from 'lucide-react';
import { statsApi } from '../services/api';
import WeeklyBusinessDAUChart from '../components/Charts/WeeklyBusinessDAUChart';
import UsageAnalytics from '../components/Charts/UsageAnalytics';
import EnhancedServiceCharts from '../components/Charts/EnhancedServiceCharts';
import {
  AreaChart, Area, LineChart, Line as RechartsLine, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart,
} from 'recharts';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface MainDashboardProps {
  adminRole: AdminRole;
}

interface GlobalOverviewService {
  serviceId: string;
  serviceName: string;
  serviceDisplayName: string;
  totalUsers: number;
  todayActiveUsers: number;
  avgDailyActiveUsers: number;
  totalTokens: number;
  totalRequests: number;
}

interface ServiceDailyData {
  date: string;
  serviceId: string;
  serviceName: string;
  requests: number;
  totalTokens: number;
}

interface DeptStats {
  deptname: string;
  cumulativeUsers: number;
  avgDailyActiveUsers: number;
  totalTokens: number;
  tokensByModel: { modelName: string; tokens: number }[];
}

interface DeptDailyData {
  date: string;
  [businessUnit: string]: string | number;
}

interface DeptUsersDaily {
  date: string;
  [key: string]: string | number;
}

interface DeptServiceRequestsDaily {
  date: string;
  [key: string]: string | number;
}

interface GlobalTotals {
  totalServices: number;
  totalUsers: number;
  todayActiveUsers: number;
  avgDailyActiveUsers: number;
  avgDailyActiveUsersExcluding: number;
  totalRequests: number;
  totalTokens: number;
}

interface LatencyStat {
  serviceId: string;
  serviceName: string;
  modelId: string;
  modelName: string;
  avg10m: number | null;
  avg30m: number | null;
  avg1h: number | null;
  avg24h: number | null;
  count10m: number;
  count30m: number;
  count1h: number;
  count24h: number;
}

interface LatencyHistoryPoint {
  time: string;
  avgLatency: number;
  count: number;
}

interface LatencyHistory {
  [key: string]: LatencyHistoryPoint[];
}

interface HealthCheckPoint {
  time: string;
  latency: number | null;
  success: boolean;
  error?: string;
}

interface HealthCheckHistory {
  [modelName: string]: HealthCheckPoint[];
}

// ── Animated Counter Hook ──
function useAnimatedCounter(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

// ── Stat Card ──
function StatCard({
  label, value, icon: Icon, gradient, description, highlight, delay,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  gradient: string;
  description: string;
  highlight?: boolean;
  delay: number;
}) {
  const animatedValue = useAnimatedCounter(value);

  const formatNum = (num: number): string => {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <div
      className="group relative overflow-hidden rounded-lg bg-white border border-gray-200 shadow-card hover:shadow-soft transition-all duration-500 hover:-translate-y-1"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute top-0 left-0 right-0 h-1 ${gradient}`} />
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-pastel-500">{label}</p>
            <p className={`text-3xl font-bold tracking-tight ${highlight ? 'text-orange-600' : 'text-pastel-800'}`}>
              {formatNum(animatedValue)}
            </p>
            <p className="text-xs text-pastel-400">{description}</p>
          </div>
          <div className={`p-3 rounded-xl ${gradient} shadow-lg`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chart Tabs ──
type ChartTab = 'service' | 'dept-users' | 'dept-requests' | 'dept-tokens' | 'latency';

// ── Color palette ──
const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ea580c', '#6366f1', '#22c55e', '#ef4444',
  '#a855f7', '#0ea5e9', '#fb923c', '#84cc16', '#f43f5e',
];

export default function MainDashboard({ adminRole: _adminRole }: MainDashboardProps) {
  const [globalOverview, setGlobalOverview] = useState<GlobalOverviewService[]>([]);
  const [globalTotals, setGlobalTotals] = useState<GlobalTotals | null>(null);
  const [serviceDaily, setServiceDaily] = useState<ServiceDailyData[]>([]);
  const [deptStats, setDeptStats] = useState<DeptStats[]>([]);
  const [deptDailyData, setDeptDailyData] = useState<DeptDailyData[]>([]);
  const [deptBusinessUnits, setDeptBusinessUnits] = useState<string[]>([]);
  const [deptUsersDailyData, setDeptUsersDailyData] = useState<DeptUsersDaily[]>([]);
  const [deptUsersBUs, setDeptUsersBUs] = useState<string[]>([]);
  const [deptServiceRequestsData, setDeptServiceRequestsData] = useState<DeptServiceRequestsDaily[]>([]);
  const [deptServiceCombos, setDeptServiceCombos] = useState<string[]>([]);
  const [latencyStats, setLatencyStats] = useState<LatencyStat[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistory>({});
  const [healthCheckHistory, setHealthCheckHistory] = useState<HealthCheckHistory>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ChartTab>('service');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [
        globalRes, serviceDailyRes, deptRes,
        deptDailyRes, deptUsersDailyRes, deptServiceReqsRes,
        latencyRes, latencyHistoryRes, healthcheckRes,
      ] = await Promise.all([
        statsApi.globalOverview(),
        statsApi.globalByService(30),
        statsApi.globalByDept(30),
        statsApi.globalByDeptDaily(30, 5),
        statsApi.globalByDeptUsersDaily(30, 5),
        statsApi.globalByDeptServiceRequestsDaily(30, 10),
        statsApi.latency(),
        statsApi.latencyHistory(24, 10),
        statsApi.latencyHealthcheck(24),
      ]);

      setGlobalOverview(globalRes.data.services || []);
      setGlobalTotals(globalRes.data.totals || null);
      setServiceDaily(serviceDailyRes.data.dailyData || []);
      setDeptStats(deptRes.data.deptStats || []);
      setDeptDailyData(deptDailyRes.data.chartData || []);
      setDeptBusinessUnits(deptDailyRes.data.businessUnits || []);
      setDeptUsersDailyData(deptUsersDailyRes.data.chartData || []);
      setDeptUsersBUs(deptUsersDailyRes.data.businessUnits || []);
      setDeptServiceRequestsData(deptServiceReqsRes.data.chartData || []);
      setDeptServiceCombos(deptServiceReqsRes.data.combinations || []);
      setLatencyStats(latencyRes.data.stats || []);
      setLatencyHistory(latencyHistoryRes.data.history || {});
      setHealthCheckHistory(healthcheckRes.data.history || {});
    } catch (error) {
      console.error('Failed to load main dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = useCallback((num: number): string => {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }, []);

  // ── Derived totals ──
  const totalUsers = globalTotals?.totalUsers ?? 0;
  const todayActive = globalTotals?.todayActiveUsers ?? 0;
  const avgDailyActiveExcluding = globalTotals?.avgDailyActiveUsersExcluding ?? 0;
  const totalTokens = globalTotals?.totalTokens ?? globalOverview.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalRequests = globalTotals?.totalRequests ?? globalOverview.reduce((sum, s) => sum + s.totalRequests, 0);

  // ── Chart data transforms ──
  const uniqueDates = [...new Set(serviceDaily.map(d => d.date))].sort();
  const uniqueServices = [...new Set(serviceDaily.map(d => d.serviceName))];

  const serviceRechartsData = uniqueDates.map(date => {
    const row: Record<string, string | number> = { date: date.slice(5) };
    uniqueServices.forEach(svc => {
      const entry = serviceDaily.find(d => d.date === date && d.serviceName === svc);
      row[svc] = entry?.requests || 0;
    });
    return row;
  });

  // Top 10 services by total requests
  const rankedServices = [...uniqueServices].sort((a, b) => {
    const sumA = serviceRechartsData.reduce((s, r) => s + ((r[a] as number) || 0), 0);
    const sumB = serviceRechartsData.reduce((s, r) => s + ((r[b] as number) || 0), 0);
    return sumB - sumA;
  });
  const topServices = rankedServices.slice(0, 10);
  const restServices = rankedServices.slice(10);

  const deptTokenRechartsData = deptDailyData.map(d => ({ ...d, date: (d.date as string).slice(5) }));
  const deptUsersRechartsData = deptUsersDailyData.map(d => ({ ...d, date: (d.date as string).slice(5) }));
  const deptServiceRechartsData: DeptServiceRequestsDaily[] = deptServiceRequestsData.map(d => ({ ...d, date: (d.date as string).slice(5) }));

  // Top 10 dept-service combos by total requests
  const rankedCombos = [...deptServiceCombos].sort((a, b) => {
    const sumA = deptServiceRechartsData.reduce((s, r) => s + ((r[a] as number) || 0), 0);
    const sumB = deptServiceRechartsData.reduce((s, r) => s + ((r[b] as number) || 0), 0);
    return sumB - sumA;
  });
  const topCombos = rankedCombos.slice(0, 10);
  const restCombos = rankedCombos.slice(10);

  const latencyKeys = Object.keys(latencyHistory);
  const latencyRechartsData = latencyKeys.length > 0
    ? (latencyHistory[latencyKeys[0]] || []).map((point, idx) => {
        const time = new Date(point.time);
        const row: Record<string, string | number> = {
          time: `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`,
        };
        latencyKeys.forEach(key => {
          row[key] = latencyHistory[key]?.[idx]?.avgLatency || 0;
        });
        return row;
      })
    : [];

  // ── Healthcheck chart data ──
  // 같은 헬스체크 사이클의 모델들은 타임스탬프가 밀리초 단위로 다르므로
  // 분 단위로 버킷팅하여 하나의 행으로 합침
  const hcModelNames = Object.keys(healthCheckHistory);
  const hcRechartsData: Record<string, string | number>[] = (() => {
    if (hcModelNames.length === 0) return [];
    // 분 단위 버킷: "2026-03-12T03:41" 형태로 그룹핑
    const bucketMap = new Map<string, Record<string, string | number>>();
    hcModelNames.forEach(name => {
      healthCheckHistory[name]?.forEach(p => {
        const d = new Date(p.time);
        const bucket = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        if (!bucketMap.has(bucket)) {
          bucketMap.set(bucket, {
            time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          });
        }
        const row = bucketMap.get(bucket)!;
        if (p.latency != null) {
          row[name] = p.latency;
        }
      });
    });
    return [...bucketMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, row]) => row);
  })();

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex gap-2">
          <div className="h-11 w-28 bg-gray-200 rounded-xl animate-pulse" />
          <div className="h-11 w-36 bg-gray-100 rounded-xl animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-lg bg-white border border-pastel-100 p-6">
              <div className="animate-pulse space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gray-200 rounded-xl" />
                  <div className="space-y-2 flex-1">
                    <div className="h-5 bg-gray-200 rounded w-32" />
                    <div className="h-3 bg-gray-100 rounded w-20" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[...Array(3)].map((_, j) => (
                    <div key={j} className="h-16 bg-pastel-50 rounded-xl" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Chart tab rendering ──
  const renderChartContent = () => {
    switch (activeTab) {
      case 'service':
        return serviceRechartsData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={serviceRechartsData}>
                <defs>
                  {topServices.map((svc, i) => (
                    <linearGradient key={svc} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v: number) => formatNumber(v)} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(value: number) => [formatNumber(value), undefined]} />
                <Legend />
                {topServices.map((svc, i) => (
                  <Area key={svc} type="monotone" dataKey={svc} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={`url(#grad-${i})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            {restServices.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-400 mb-2">그 외 {restServices.length}개 서비스</p>
                <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">서비스</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500">총 요청</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500">최근</th>
                      </tr>
                    </thead>
                    <tbody>
                      {restServices.map((svc, i) => {
                        const total = serviceRechartsData.reduce((s, r) => s + ((r[svc] as number) || 0), 0);
                        const latest = (serviceRechartsData[serviceRechartsData.length - 1]?.[svc] as number) || 0;
                        return (
                          <tr key={svc} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                            <td className="py-1.5 px-3 text-gray-700 truncate max-w-[200px]">{svc}</td>
                            <td className="text-right py-1.5 px-3 text-gray-600">{formatNumber(total)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-600">{formatNumber(latest)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-72 text-pastel-400">데이터가 없습니다</div>
        );

      case 'dept-users':
        return deptUsersRechartsData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={deptUsersRechartsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v: number) => formatNumber(v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v: number) => formatNumber(v)} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(value: number, name: string) => [formatNumber(value) + '명', name]} />
              <Legend />
              {deptUsersBUs.map((bu, i) => (
                <RechartsLine key={`${bu}_cumulative`} yAxisId="left" type="monotone" dataKey={`${bu}_cumulative`} name={`${bu} (누적)`} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
              ))}
              {deptUsersBUs.map((bu, i) => (
                <Bar key={`${bu}_active`} yAxisId="right" dataKey={`${bu}_active`} name={`${bu} (활성)`} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.4} radius={[2, 2, 0, 0]} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-72 text-pastel-400">데이터가 없습니다</div>
        );

      case 'dept-requests':
        return deptServiceRechartsData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={deptServiceRechartsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v: number) => formatNumber(v)} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(value: number) => [formatNumber(value), undefined]} />
                <Legend />
                {topCombos.map((combo, i) => (
                  <RechartsLine key={combo} type="monotone" dataKey={combo} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {restCombos.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-400 mb-2">그 외 {restCombos.length}개 조합</p>
                <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">사업부/서비스</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500">총 요청</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500">최근</th>
                      </tr>
                    </thead>
                    <tbody>
                      {restCombos.map((combo, i) => {
                        const total = deptServiceRechartsData.reduce((s, r) => s + ((r[combo] as number) || 0), 0);
                        const latest = (deptServiceRechartsData[deptServiceRechartsData.length - 1]?.[combo] as number) || 0;
                        return (
                          <tr key={combo} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                            <td className="py-1.5 px-3 text-gray-700 truncate max-w-[200px]">{combo}</td>
                            <td className="text-right py-1.5 px-3 text-gray-600">{formatNumber(total)}</td>
                            <td className="text-right py-1.5 px-3 text-gray-600">{formatNumber(latest)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-72 text-pastel-400">데이터가 없습니다</div>
        );

      case 'dept-tokens':
        return deptTokenRechartsData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={deptTokenRechartsData}>
              <defs>
                {deptBusinessUnits.map((bu, i) => (
                  <linearGradient key={bu} id={`dept-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v: number) => formatNumber(v)} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(value: number) => [formatNumber(value), undefined]} />
              <Legend />
              {deptBusinessUnits.map((bu, i) => (
                <Area key={bu} type="monotone" dataKey={bu} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={`url(#dept-grad-${i})`} strokeWidth={2} dot={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-72 text-pastel-400">데이터가 없습니다</div>
        );

      case 'latency':
        return (
          <>
            {/* Healthcheck Monitor (10분 간격 프로빙) */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
                <h3 className="text-sm font-semibold text-pastel-700">헬스체크 모니터링</h3>
                <span className="text-xs text-pastel-400 ml-1">10분 간격 자동 프로빙</span>
              </div>
              {hcRechartsData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={hcRechartsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                      formatter={(value: number, name: string) => [value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`, name]}
                    />
                    <Legend />
                    {hcModelNames.map((name, i) => (
                      <RechartsLine key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-pastel-400 text-sm bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  헬스체크 데이터 수집 중... (최초 실행까지 약 1분 소요)
                </div>
              )}
            </div>

            {/* Usage-based latency */}
            {latencyRechartsData.length > 0 && (
              <>
                <div className="border-t border-gray-100 pt-6 mb-4">
                  <h3 className="text-sm font-semibold text-pastel-700 mb-4">실제 사용 기반 응답 지연</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  {latencyStats.slice(0, 4).map((stat) => (
                    <div key={`${stat.serviceId}-${stat.modelId}`} className="p-3 bg-gray-50 rounded-lg border border-pastel-100">
                      <p className="text-xs text-pastel-500 truncate" title={`${stat.serviceName} / ${stat.modelName}`}>
                        {stat.serviceName} / {stat.modelName.length > 15 ? stat.modelName.slice(0, 15) + '...' : stat.modelName}
                      </p>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                        <div><span className="text-pastel-400">10분:</span> <span className="font-medium">{stat.avg10m ? `${(stat.avg10m / 1000).toFixed(1)}s` : '-'}</span></div>
                        <div><span className="text-pastel-400">30분:</span> <span className="font-medium">{stat.avg30m ? `${(stat.avg30m / 1000).toFixed(1)}s` : '-'}</span></div>
                        <div><span className="text-pastel-400">1시간:</span> <span className="font-medium">{stat.avg1h ? `${(stat.avg1h / 1000).toFixed(1)}s` : '-'}</span></div>
                        <div><span className="text-pastel-400">24시간:</span> <span className="font-medium">{stat.avg24h ? `${(stat.avg24h / 1000).toFixed(1)}s` : '-'}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={latencyRechartsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(value: number) => [`${(value / 1000).toFixed(2)}s`, undefined]} />
                    <Legend />
                    {latencyKeys.map((key, i) => (
                      <RechartsLine key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
            {latencyRechartsData.length === 0 && hcRechartsData.length === 0 && (
              <div className="flex items-center justify-center h-72 text-pastel-400">지연 시간 데이터가 없습니다</div>
            )}
          </>
        );

      default:
        return null;
    }
  };

  const chartTabs: { key: ChartTab; label: string; icon: React.ElementType }[] = [
    { key: 'service', label: '서비스별 요청', icon: BarChart3 },
    { key: 'dept-users', label: '사업부 사용자', icon: Users },
    { key: 'dept-requests', label: '사업부 API 요청', icon: Zap },
    { key: 'dept-tokens', label: '사업부 토큰', icon: Layers },
    { key: 'latency', label: '응답 지연', icon: Clock },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-5">
        <StatCard label="전체 사용자" value={totalUsers} icon={Users} gradient="bg-gradient-to-r from-blue-500 to-blue-600" description="모든 서비스 합계" delay={0} />
        <StatCard label="오늘 DAU" value={todayActive} icon={Activity} gradient="bg-gradient-to-r from-emerald-500 to-teal-500" description="실시간 활성 사용자" delay={80} />
        <StatCard label="영업일 평균 DAU" value={Math.round(avgDailyActiveExcluding)} icon={Activity} gradient="bg-gradient-to-r from-orange-500 to-amber-500" description="최근 30일, 주말/휴일 제외" highlight delay={160} />
        <StatCard label="총 토큰 사용" value={totalTokens} icon={TrendingUp} gradient="bg-gradient-to-r from-violet-500 to-purple-500" description="누적 합계" delay={240} />
        <StatCard label="총 API 요청" value={totalRequests} icon={Zap} gradient="bg-gradient-to-r from-amber-500 to-yellow-500" description="누적 합계" delay={320} />
      </div>
      {/* Real-time indicator */}
      {todayActive > 0 && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-emerald-50 border border-emerald-100 animate-slide-up">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-emerald-700">
            현재 <span className="font-bold text-emerald-800">{todayActive}명</span>이 오늘 서비스를 사용했습니다
          </span>
          <span className="text-xs text-emerald-500 ml-auto">실시간</span>
        </div>
      )}

      {/* Charts Section with Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-card overflow-hidden">
        <div className="px-6 pt-5 pb-0">
          <h2 className="text-lg font-bold text-pastel-800 mb-4">상세 분석</h2>
          <div className="flex gap-1 overflow-x-auto pb-0 -mb-px scrollbar-hide">
            {chartTabs.map(({ key, label, icon: TabIcon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-xl border border-b-0 whitespace-nowrap transition-all ${
                  activeTab === key
                    ? 'bg-white text-samsung-blue border-gray-200 shadow-card'
                    : 'text-pastel-500 hover:text-pastel-700 border-transparent hover:bg-pastel-50'
                }`}
              >
                <TabIcon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 border-t border-pastel-100">
          {renderChartContent()}
        </div>

        {/* Data tables */}
        {activeTab === 'dept-users' && deptUsersBUs.length > 0 && (
          <div className="px-6 pb-6">
            <div className="overflow-x-auto rounded-lg border border-pastel-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-pastel-50/80">
                    <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">사업부</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">누적 사용자</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">일평균 활성</th>
                  </tr>
                </thead>
                <tbody>
                  {deptUsersBUs.map((bu, index) => {
                    const lastData = deptUsersDailyData[deptUsersDailyData.length - 1];
                    const cumulative = lastData ? (lastData[`${bu}_cumulative`] as number) || 0 : 0;
                    const activeSum = deptUsersDailyData.reduce((sum, d) => sum + ((d[`${bu}_active`] as number) || 0), 0);
                    const avgActive = deptUsersDailyData.length > 0 ? activeSum / deptUsersDailyData.length : 0;
                    return (
                      <tr key={bu} className={`border-t border-pastel-50 ${index % 2 === 0 ? 'bg-white' : 'bg-pastel-50/30'}`}>
                        <td className="py-3 px-4 font-medium text-pastel-800">{bu}</td>
                        <td className="text-right py-3 px-4 text-pastel-700">{formatNumber(cumulative)}</td>
                        <td className="text-right py-3 px-4 text-pastel-700">{avgActive.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'dept-requests' && deptServiceCombos.length > 0 && (
          <div className="px-6 pb-6">
            <div className="overflow-x-auto rounded-lg border border-pastel-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-pastel-50/80">
                    <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">사업부</th>
                    <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">서비스</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">총 요청수</th>
                  </tr>
                </thead>
                <tbody>
                  {deptServiceCombos.map((combo, index) => {
                    const [bu, svc] = combo.split('/');
                    const total = deptServiceRequestsData.reduce((sum, d) => sum + ((d[combo] as number) || 0), 0);
                    return (
                      <tr key={combo} className={`border-t border-pastel-50 ${index % 2 === 0 ? 'bg-white' : 'bg-pastel-50/30'}`}>
                        <td className="py-3 px-4 font-medium text-pastel-800">{bu}</td>
                        <td className="py-3 px-4 text-pastel-700">{svc}</td>
                        <td className="text-right py-3 px-4 text-pastel-700">{formatNumber(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'latency' && latencyStats.length > 0 && (
          <div className="px-6 pb-6">
            <div className="overflow-x-auto rounded-lg border border-pastel-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-pastel-50/80">
                    <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">서비스 / 모델</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">10분</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">30분</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">1시간</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">24시간</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">요청수</th>
                  </tr>
                </thead>
                <tbody>
                  {latencyStats.map((stat, index) => (
                    <tr key={`${stat.serviceId}-${stat.modelId}`} className={`border-t border-pastel-50 ${index % 2 === 0 ? 'bg-white' : 'bg-pastel-50/30'}`}>
                      <td className="py-3 px-4 font-medium text-pastel-800">{stat.serviceName} / {stat.modelName}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{stat.avg10m ? `${(stat.avg10m / 1000).toFixed(2)}s` : '-'}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{stat.avg30m ? `${(stat.avg30m / 1000).toFixed(2)}s` : '-'}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{stat.avg1h ? `${(stat.avg1h / 1000).toFixed(2)}s` : '-'}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{stat.avg24h ? `${(stat.avg24h / 1000).toFixed(2)}s` : '-'}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{formatNumber(stat.count24h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Weekly Business DAU */}
      <WeeklyBusinessDAUChart />

      {/* Enhanced Service Metrics */}
      <EnhancedServiceCharts />

      {/* Usage Analytics (Global) */}
      <UsageAnalytics />

      {/* Department Token Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-card overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-pastel-100/80">
          <div className="p-2 rounded-lg bg-blue-50">
            <BarChart3 className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-pastel-800">사업부별 상세 통계</h2>
            <p className="text-xs text-pastel-500">최근 30일 기준</p>
          </div>
        </div>
        <div className="p-6">
          {deptStats.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-pastel-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-pastel-50/80">
                    <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">사업부</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">누적 사용자</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">일평균 활성</th>
                    <th className="text-right py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">총 토큰</th>
                    <th className="text-left py-3 px-4 font-semibold text-pastel-600 text-xs uppercase tracking-wide">모델별 토큰</th>
                  </tr>
                </thead>
                <tbody>
                  {deptStats.slice(0, 15).map((dept, index) => (
                    <tr key={dept.deptname} className={`border-t border-pastel-50 ${index % 2 === 0 ? 'bg-white' : 'bg-pastel-50/30'}`}>
                      <td className="py-3 px-4 font-medium text-pastel-800">{dept.deptname}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{formatNumber(dept.cumulativeUsers)}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{dept.avgDailyActiveUsers.toFixed(1)}</td>
                      <td className="text-right py-3 px-4 text-pastel-700">{formatNumber(dept.totalTokens)}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {(dept.tokensByModel || []).slice(0, 3).map((model) => (
                            <span key={model.modelName} className="inline-flex items-center px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-full">
                              {model.modelName.length > 12 ? model.modelName.slice(0, 12) + '...' : model.modelName}: {formatNumber(model.tokens)}
                            </span>
                          ))}
                          {(dept.tokensByModel || []).length > 3 && (
                            <span className="text-xs text-pastel-400">+{dept.tokensByModel.length - 3}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {deptStats.length > 15 && (
                <p className="text-center text-sm text-pastel-400 py-3 border-t border-pastel-50">
                  {deptStats.length - 15}개 사업부 더 있음
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-pastel-400">
              사업부별 통계 데이터가 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
