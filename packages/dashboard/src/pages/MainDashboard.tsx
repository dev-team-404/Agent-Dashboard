import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, Activity, Zap, TrendingUp,
  Clock, BarChart3, Layers, CalendarDays,
  Cpu, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { statsApi, gpuServerApi, gpuCapacityApi } from '../services/api';
import WeeklyBusinessDAUChart from '../components/Charts/WeeklyBusinessDAUChart';
import UsageAnalytics from '../components/Charts/UsageAnalytics';
import EnhancedServiceCharts from '../components/Charts/EnhancedServiceCharts';
import {
  AreaChart, Area, LineChart, Line as RechartsLine, Bar, BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import { api } from '../services/api';
import { Sparkles, Target } from 'lucide-react';
import { useHolidayDates } from '../hooks/useHolidayDates';
import { isBusinessDay } from '../utils/businessDayFilter';
import { useBusinessDayToggle } from '../hooks/useBusinessDayToggle';
import BusinessDayToggle from '../components/BusinessDayToggle';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface MainDashboardProps {
  adminRole: AdminRole;
  isAdmin?: boolean;
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
type ChartTab = 'service' | 'dept-users' | 'dept-requests' | 'dept-tokens';

// ── Color palette ──
const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ea580c', '#6366f1', '#22c55e', '#ef4444',
  '#a855f7', '#0ea5e9', '#fb923c', '#84cc16', '#f43f5e',
];

/** UTC ISO 문자열 → KST "HH:mm" 변환 */
function toKstHHmm(isoOrDate: string | Date): string {
  return new Date(isoOrDate).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
}
/** UTC ISO 문자열 → KST 정렬용 버킷 키 "YYYY-MM-DDTHH:mm" */
function toKstBucketKey(isoOrDate: string | Date): string {
  const d = new Date(isoOrDate);
  const parts = d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }); // "2026-03-23 18:05:00"
  return parts.slice(0, 16).replace(' ', 'T'); // "2026-03-23T18:05"
}

/** 모델명 → 고정 색상 인덱스 (granularity 변경 시에도 동일 모델은 같은 색 유지) */
function stableColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return ((hash % CHART_COLORS.length) + CHART_COLORS.length) % CHART_COLORS.length;
}

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
  const [mauMonthlyData, setMauMonthlyData] = useState<Record<string, unknown>[]>([]);
  const [mauServices, setMauServices] = useState<{ id: string; name: string; displayName: string; type: string }[]>([]);
  const [mauEstimationMeta, setMauEstimationMeta] = useState<{
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
  } | null>(null);
  const [avgMau, setAvgMau] = useState(0);
  const [latencyStats, setLatencyStats] = useState<LatencyStat[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistory>({});
  const [healthCheckHistory, setHealthCheckHistory] = useState<HealthCheckHistory>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ChartTab>('service');
  const holidayDates = useHolidayDates();
  const [gpuData, setGpuData] = useState<any[]>([]);
  const [gpuPrediction, setGpuPrediction] = useState<any>(null);
  const { exclude } = useBusinessDayToggle();

  // Health status
  const [healthStatuses, setHealthStatuses] = useState<Record<string, { modelName: string; success: boolean; latencyMs: number | null; checkedAt: string; errorMessage: string | null }>>({});
  const [totalEnabledModels, setTotalEnabledModels] = useState(0);

  // Latency trend (일별/주별/월별)
  type LatencyGranularity = 'daily' | 'weekly' | 'monthly';
  const [latencyGranularity, setLatencyGranularity] = useState<LatencyGranularity>('daily');
  const [latencyTrendHC, setLatencyTrendHC] = useState<Record<string, Array<{ period: string; avgLatency: number; successRate: number; count: number }>>>({});
  const [latencyTrendUsage, setLatencyTrendUsage] = useState<Record<string, Array<{ period: string; avgLatency: number; count: number }>>>({});
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [latencyTableOpen, setLatencyTableOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState<Record<string, boolean>>({});

  // 서버 시간 (1분마다 갱신)
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [serverNow, setServerNow] = useState('');
  useEffect(() => {
    api.get('/health').then(res => {
      const serverDate = res.headers?.['date'];
      if (serverDate) setServerTimeOffset(new Date(serverDate).getTime() - Date.now());
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const tick = () => {
      const now = new Date(Date.now() + serverTimeOffset);
      setServerNow(now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [serverTimeOffset]);

  // 에러 빈도 (모델별 일별)
  const [errorRateDaily, setErrorRateDaily] = useState<Array<{ day: string; byModel: Record<string, Record<string, number>> }>>([]);

  // M/M 목표 관리 데이터
  const [mmTargetData, setMmTargetData] = useState<{
    byDept: Array<{ dept: string; savedMM: number }>;
    totalTargetMM: number;
    totalSavedMM: number;
    totalAiEstimatedMM: number;
  }>({ byDept: [], totalTargetMM: 0, totalSavedMM: 0, totalAiEstimatedMM: 0 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [
        globalRes, serviceDailyRes, deptRes,
        deptDailyRes, deptUsersDailyRes, deptServiceReqsRes,
        latencyRes, latencyHistoryRes, healthcheckRes,
        mauRes, healthStatusRes, errorRateRes,
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
        statsApi.globalMauByService(6).catch(() => ({ data: { services: [], monthlyData: [], estimationMeta: null } })),
        statsApi.healthStatus().catch(() => ({ data: { statuses: {}, totalEnabledModels: 0 } })),
        statsApi.errorRate(10).catch(() => ({ data: { daily: [], summary: [], days: 10 } })),
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
      setMauServices(mauRes.data.services || []);
      setMauMonthlyData(mauRes.data.monthlyData || []);
      setMauEstimationMeta(mauRes.data.estimationMeta || null);
      // Calculate avg MAU from last 3 months
      const mData = mauRes.data.monthlyData || [];
      if (mData.length > 0) {
        const recentMonths = mData.slice(-3);
        const allServiceIds = (mauRes.data.services || []).map((s: { id: string }) => s.id);
        const monthTotals = recentMonths.map((m: Record<string, unknown>) =>
          allServiceIds.reduce((sum: number, sid: string) => sum + ((m[sid] as number) || 0), 0)
        );
        const avg = monthTotals.reduce((a: number, b: number) => a + b, 0) / monthTotals.length;
        setAvgMau(Math.round(avg));
      }
      setLatencyStats((latencyRes.data.stats || []).sort((a: LatencyStat, b: LatencyStat) => a.modelName.localeCompare(b.modelName)));
      setLatencyHistory(latencyHistoryRes.data.history || {});
      setHealthCheckHistory(healthcheckRes.data.history || {});
      setHealthStatuses(healthStatusRes.data.statuses || {});
      setTotalEnabledModels(healthStatusRes.data.totalEnabledModels || 0);
      setErrorRateDaily(errorRateRes.data.daily || []);

      // GPU 리소스 데이터 (별도 fetch — 실패해도 대시보드 동작)
      try {
        const [gpuRes, predRes] = await Promise.all([
          gpuServerApi.realtime().catch(() => ({ data: { data: [] } })),
          gpuCapacityApi.latest().catch(() => ({ data: { prediction: null } })),
        ]);
        setGpuData(gpuRes.data.data || []);
        setGpuPrediction(predRes.data.prediction);
      } catch {}

      // M/M 목표 관리 데이터 (별도 fetch — 실패해도 대시보드 동작)
      try {
        const [targetsRes, aiRes] = await Promise.all([
          api.get('/admin/service-targets'),
          api.get('/admin/ai-estimations').catch(() => ({ data: { estimations: [] } })),
        ]);
        const services = targetsRes.data.services || [];
        const aiMap = new Map<string, number>();
        for (const e of (aiRes.data.estimations || [])) {
          aiMap.set(e.serviceId, e.estimatedMM);
        }
        // 부서별 savedMM 합산 (새 시스템: savedMMBreakdown 사용)
        const deptMap = new Map<string, number>();
        let totalTarget = 0;
        let totalSaved = 0;
        let totalAi = 0;
        for (const s of services) {
          totalTarget += s.targetMM || 0;
          // 새 시스템: aggregatedSavedMM (DeptServiceSavedMM 합산)
          const saved = s.aggregatedSavedMM ?? s.savedMM ?? 0;
          totalSaved += saved;
          // AI 추정: 부서별 합산 우선, 없으면 기존 AiEstimation 사용
          const ai = s.aggregatedAiEstimatedMM ?? aiMap.get(s.id) ?? 0;
          totalAi += ai;
          // 부서별 breakdown이 있으면 부서 단위로 집계
          if (s.savedMMBreakdown && s.savedMMBreakdown.length > 0) {
            for (const bd of s.savedMMBreakdown) {
              if (bd.savedMM != null) {
                deptMap.set(bd.deptname, (deptMap.get(bd.deptname) || 0) + bd.savedMM);
              }
            }
          } else if (saved > 0) {
            // 레거시 호환: breakdown 없으면 등록 부서에 귀속
            const dept = s.registeredByDept || '미지정';
            deptMap.set(dept, (deptMap.get(dept) || 0) + saved);
          }
        }
        const byDept = [...deptMap.entries()]
          .map(([dept, savedMM]) => ({ dept, savedMM: Math.round(savedMM * 10) / 10 }))
          .sort((a, b) => b.savedMM - a.savedMM);
        setMmTargetData({ byDept, totalTargetMM: totalTarget, totalSavedMM: Math.round(totalSaved * 10) / 10, totalAiEstimatedMM: Math.round(totalAi * 10) / 10 });
      } catch (err) {
        console.error('Failed to load M/M target data:', err);
      }
    } catch (error) {
      console.error('Failed to load main dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Latency trend 로드 (granularity 변경 시)
  const loadLatencyTrend = useCallback(async (g: LatencyGranularity) => {
    setLoadingTrend(true);
    try {
      const res = await statsApi.latencyTrend(g);
      setLatencyTrendHC(res.data.healthcheck || {});
      setLatencyTrendUsage(res.data.usage || {});
    } catch {
      // ignore
    } finally {
      setLoadingTrend(false);
    }
  }, []);

  useEffect(() => {
    loadLatencyTrend(latencyGranularity);
  }, [latencyGranularity, loadLatencyTrend]);

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

  // ── Chart data transforms (토글에 따라 주말/휴일 제외) ──
  const uniqueDates = [...new Set(serviceDaily.map(d => d.date))]
    .sort()
    .filter(date => exclude ? isBusinessDay(date, holidayDates) : true);
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

  const deptTokenRechartsData = deptDailyData
    .filter(d => exclude ? isBusinessDay(d.date as string, holidayDates) : true)
    .map(d => ({ ...d, date: (d.date as string).slice(5) }));
  const deptUsersRechartsData = deptUsersDailyData
    .filter(d => exclude ? isBusinessDay(d.date as string, holidayDates) : true)
    .map(d => ({ ...d, date: (d.date as string).slice(5) }));
  const deptServiceRechartsData: DeptServiceRequestsDaily[] = deptServiceRequestsData
    .filter(d => exclude ? isBusinessDay(d.date as string, holidayDates) : true)
    .map(d => ({ ...d, date: (d.date as string).slice(5) }));

  // Top 10 dept-service combos by total requests
  const rankedCombos = [...deptServiceCombos].sort((a, b) => {
    const sumA = deptServiceRechartsData.reduce((s, r) => s + ((r[a] as number) || 0), 0);
    const sumB = deptServiceRechartsData.reduce((s, r) => s + ((r[b] as number) || 0), 0);
    return sumB - sumA;
  });
  const topCombos = rankedCombos.slice(0, 10);
  const restCombos = rankedCombos.slice(10);

  const latencyKeys = Object.keys(latencyHistory).sort();
  const latencyRechartsData = latencyKeys.length > 0
    ? (latencyHistory[latencyKeys[0]] || []).map((point, idx) => {
        const row: Record<string, string | number> = {
          time: toKstHHmm(point.time),
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
  const hcModelNames = Object.keys(healthCheckHistory).sort();
  // 버킷별 에러 정보 (tooltip 표시용)
  const hcErrorMap = new Map<string, Record<string, string>>();
  const hcRechartsData: Record<string, string | number>[] = (() => {
    if (hcModelNames.length === 0) return [];
    // 분 단위 버킷: KST "2026-03-12T18:05" 형태로 그룹핑
    const bucketMap = new Map<string, Record<string, string | number>>();
    hcModelNames.forEach(name => {
      healthCheckHistory[name]?.forEach(p => {
        const bucket = toKstBucketKey(p.time);
        const timeLabel = toKstHHmm(p.time);
        if (!bucketMap.has(bucket)) {
          bucketMap.set(bucket, { time: timeLabel });
        }
        const row = bucketMap.get(bucket)!;
        if (p.latency != null) {
          row[name] = p.latency;
        }
        // 에러 정보 저장
        if (p.error) {
          if (!hcErrorMap.has(timeLabel)) hcErrorMap.set(timeLabel, {});
          hcErrorMap.get(timeLabel)![name] = p.error;
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

      default:
        return null;
    }
  };

  const chartTabs: { key: ChartTab; label: string; icon: React.ElementType }[] = [
    { key: 'service', label: '서비스별 요청', icon: BarChart3 },
    { key: 'dept-users', label: '사업부 사용자', icon: Users },
    { key: 'dept-requests', label: '사업부 API 요청', icon: Zap },
    { key: 'dept-tokens', label: '사업부 토큰', icon: Layers },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Toggle */}
      <div className="flex justify-end">
        <BusinessDayToggle />
      </div>
      {/* Hero Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 lg:gap-5">
        <StatCard label="전체 사용자" value={totalUsers} icon={Users} gradient="bg-gradient-to-r from-blue-500 to-blue-600" description="모든 서비스 합계" delay={0} />
        <StatCard label="오늘 DAU" value={todayActive} icon={Activity} gradient="bg-gradient-to-r from-emerald-500 to-teal-500" description="실시간 활성 사용자" delay={80} />
        <StatCard label="영업일 평균 DAU" value={Math.round(avgDailyActiveExcluding)} icon={Activity} gradient="bg-gradient-to-r from-orange-500 to-amber-500" description="최근 30일, 주말/휴일 제외" highlight delay={160} />
        <StatCard label="평균 MAU" value={avgMau} icon={CalendarDays} gradient="bg-gradient-to-r from-indigo-500 to-blue-500" description="최근 3개월 평균" delay={240} />
        <StatCard label="총 토큰 사용" value={totalTokens} icon={TrendingUp} gradient="bg-gradient-to-r from-violet-500 to-purple-500" description="누적 합계" delay={320} />
        <StatCard label="총 API 요청" value={totalRequests} icon={Zap} gradient="bg-gradient-to-r from-amber-500 to-yellow-500" description="누적 합계" delay={400} />
      </div>
      {/* GPU 리소스 요약 */}
      {gpuData.length > 0 && (() => {
        const online = gpuData.filter((e: any) => e.metrics && !e.metrics.error);
        const totGpu = gpuData.reduce((a: number, e: any) => a + (e.metrics?.gpus?.length || 0), 0);
        const avgUtil = (() => { let s = 0, c = 0; gpuData.forEach((e: any) => e.metrics?.gpus?.forEach((g: any) => { s += g.utilGpu; c++; })); return c > 0 ? Math.round(s / c) : 0; })();
        const avgHealth = (() => { const h = gpuData.filter((e: any) => e.throughputAnalysis?.gpuHealthPct != null).map((e: any) => e.throughputAnalysis.gpuHealthPct); return h.length > 0 ? Math.round(h.reduce((a: number, v: number) => a + v, 0) / h.length) : null; })();
        const totLlm = gpuData.reduce((a: number, e: any) => a + (e.metrics?.llmEndpoints?.length || 0), 0);
        const totTps = gpuData.reduce((a: number, e: any) => a + (e.throughputAnalysis?.currentTps || 0), 0);
        // 과사용/저사용 서버
        const serverUtils = gpuData.filter((e: any) => e.metrics?.gpus?.length > 0).map((e: any) => {
          const avg = e.metrics.gpus.reduce((s: number, g: any) => s + g.utilGpu, 0) / e.metrics.gpus.length;
          return { name: e.server.name, util: Math.round(avg), health: e.throughputAnalysis?.gpuHealthPct };
        }).sort((a: any, b: any) => b.util - a.util);
        const over = serverUtils.filter((s: any) => s.util > 70);
        const under = serverUtils.filter((s: any) => s.util < 20);

        return (
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border border-blue-100 p-4 animate-slide-up" style={{ animationDelay: '450ms' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><Cpu className="w-4 h-4 text-blue-600" /><span className="text-sm font-bold text-gray-900">GPU 리소스</span><span className="text-[10px] text-gray-400">서버 {online.length}/{gpuData.length} 온라인</span></div>
              <a href="/resource-monitor" className="text-[10px] text-blue-600 hover:underline">상세 보기 →</a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
              <div><span className="text-gray-500">GPU</span><p className="text-lg font-bold text-gray-900">{totGpu}<span className="text-xs font-normal text-gray-400">장</span></p></div>
              <div><span className="text-gray-500">GPU 사용률</span><p className={`text-lg font-bold ${avgUtil >= 80 ? 'text-red-600' : avgUtil >= 50 ? 'text-amber-600' : 'text-gray-900'}`}>{avgUtil}%</p></div>
              {avgHealth != null && <div><span className="text-gray-500">건강도</span><p className={`text-lg font-bold ${avgHealth >= 85 ? 'text-emerald-600' : avgHealth >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{avgHealth}%</p></div>}
              <div><span className="text-gray-500">LLM</span><p className="text-lg font-bold text-purple-600">{totLlm}<span className="text-xs font-normal text-gray-400">개</span></p></div>
              {totTps > 0 && <div><span className="text-gray-500">처리량</span><p className="text-lg font-bold text-blue-600">{totTps.toFixed(1)}<span className="text-[10px] font-normal"> tok/s</span></p></div>}
              {gpuPrediction && <div className="sm:col-span-2 bg-white/60 rounded-lg p-2 border border-indigo-100"><span className="text-gray-500">GPU 예측 ({gpuPrediction.targetUserCount?.toLocaleString()}명)</span><p className="text-lg font-bold text-indigo-700">{gpuPrediction.predictedB300Units} B300<span className="text-[10px] font-normal text-gray-400 ml-1">추가 필요</span></p></div>}
            </div>
            {/* 과사용/저사용 */}
            {(over.length > 0 || under.length > 0) && (
              <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
                {over.map((s: any) => <span key={s.name} className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded">{s.name} <b>{s.util}%</b> 과부하</span>)}
                {under.map((s: any) => <span key={s.name} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{s.name} <b>{s.util}%</b> 여유</span>)}
              </div>
            )}
          </div>
        );
      })()}

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

      {/* Model Health Status */}
      {(() => {
        const allEntries = Object.entries(healthStatuses);
        if (allEntries.length === 0 && totalEnabledModels === 0) return null;
        const healthyCount = allEntries.filter(([, s]) => s.success).length;
        const unhealthyEntries = allEntries.filter(([, s]) => !s.success);
        const checkedCount = allEntries.length;
        const uncheckedCount = Math.max(0, totalEnabledModels - checkedCount);

        const hasIssue = unhealthyEntries.length > 0;

        return (
          <div className={`bg-white rounded-lg border shadow-card overflow-hidden ${hasIssue ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200'}`}>
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${hasIssue ? 'bg-red-50' : 'bg-blue-50'}`}>
                  {hasIssue ? <AlertTriangle className="w-4 h-4 text-red-500" /> : <Cpu className="w-4 h-4 text-blue-600" />}
                </div>
                <h2 className="text-sm font-semibold text-pastel-800">
                  모델 상태
                  {hasIssue && <span className="ml-2 text-xs text-red-600 font-medium">장애 {unhealthyEntries.length}건</span>}
                </h2>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-pastel-500">전체 <span className="font-bold text-pastel-700">{totalEnabledModels}</span></span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-green-700 font-medium">{healthyCount}</span>
                </span>
                {unhealthyEntries.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-red-600 font-medium">{unhealthyEntries.length}</span>
                  </span>
                )}
                {uncheckedCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gray-300" />
                    <span className="text-pastel-400 font-medium">{uncheckedCount}</span>
                  </span>
                )}
              </div>
            </div>
            {unhealthyEntries.length > 0 && (
              <div className="px-6 pb-4 pt-0">
                <div className="flex items-center gap-1.5 text-xs text-red-600 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="font-medium">장애 모델</span>
                </div>
                <div className="space-y-2">
                  {unhealthyEntries.map(([modelId, s]) => {
                    const ago = Math.round((Date.now() - new Date(s.checkedAt).getTime()) / 60000);
                    return (
                      <div
                        key={modelId}
                        className="px-3 py-2 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                          <span className="font-medium">{s.modelName}</span>
                          <span className="text-red-400 text-[10px] ml-auto">{ago}분 전</span>
                        </div>
                        {s.errorMessage && (
                          <p className="mt-1 text-[11px] text-red-500 break-all line-clamp-2 ml-3">
                            {s.errorMessage}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 응답 지연 (독립 섹션) ── */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-card overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50">
              <Clock className="w-4 h-4 text-indigo-600" />
            </div>
            <h2 className="text-sm font-semibold text-pastel-800">응답 지연</h2>
          </div>
          {serverNow && (
            <span className="text-xs text-pastel-400 font-mono">서버 {serverNow}</span>
          )}
        </div>
        <div className="p-6 space-y-8">
          {/* 1) 헬스체크 모니터링 (10분 간격 프로빙) */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <h3 className="text-sm font-semibold text-pastel-700">헬스체크 모니터링</h3>
              <span className="text-xs text-pastel-400 ml-1">10분 간격 자동 프로빙</span>
              {hcModelNames.length > 0 && (
                <div className="relative ml-auto">
                  <button
                    onClick={() => setLegendOpen(prev => ({ ...prev, hc: !prev.hc }))}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-pastel-500 hover:text-pastel-700 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
                  >
                    범례
                    <ChevronDown className={`w-3 h-3 transition-transform ${legendOpen.hc ? 'rotate-180' : ''}`} />
                  </button>
                  {legendOpen.hc && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg border border-gray-200 shadow-lg p-3 min-w-[160px]">
                      {hcModelNames.map((name, i) => (
                        <div key={name} className="flex items-center gap-2 py-1">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="text-xs text-pastel-700 truncate">{name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {hcRechartsData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={hcRechartsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" domain={[0, 'auto']} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`} />
                  <Tooltip
                    wrapperStyle={{ zIndex: 9999 }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', maxWidth: 400 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const errors = hcErrorMap.get(label as string);
                      const sorted = [...payload].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
                      return (
                        <div style={{ background: '#fff', borderRadius: 12, padding: '10px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{label}</p>
                          {sorted.map((entry) => {
                            const modelName = String(entry.name || '');
                            const val = Number(entry.value || 0);
                            const err = errors?.[modelName];
                            return (
                              <div key={modelName} style={{ marginBottom: 4 }}>
                                <span style={{ color: entry.color as string, fontWeight: 600, fontSize: 13 }}>
                                  {modelName}: {val >= 1000 ? `${(val / 1000).toFixed(2)}s` : `${Math.round(val)}ms`}
                                </span>
                                {err && (
                                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2, maxWidth: 350, wordBreak: 'break-all' }}>
                                    {err.length > 120 ? err.slice(0, 120) + '...' : err}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
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

          {/* 2) 실제 사용 기반 응답 지연 */}
          {latencyRechartsData.length > 0 && (
            <div className="border-t border-gray-100 pt-6">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-semibold text-pastel-700">실제 사용 기반 응답 지연</h3>
                {latencyKeys.length > 0 && (
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setLegendOpen(prev => ({ ...prev, usage: !prev.usage }))}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs text-pastel-500 hover:text-pastel-700 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
                    >
                      범례
                      <ChevronDown className={`w-3 h-3 transition-transform ${legendOpen.usage ? 'rotate-180' : ''}`} />
                    </button>
                    {legendOpen.usage && (
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg border border-gray-200 shadow-lg p-3 min-w-[160px]">
                        {latencyKeys.map((key, i) => (
                          <div key={key} className="flex items-center gap-2 py-1">
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="text-xs text-pastel-700 truncate">{key}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                  <Tooltip wrapperStyle={{ zIndex: 9999 }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} itemSorter={(item) => -(Number(item.value) || 0)} formatter={(value: number, name: string) => [`${(value / 1000).toFixed(2)}s`, name]} />
                  {latencyKeys.map((key, i) => (
                    <RechartsLine key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 3) 일별/주별/월별 추이 */}
          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-pastel-700">응답 지연 추이</h3>
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                {(['daily', 'weekly', 'monthly'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setLatencyGranularity(g)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      latencyGranularity === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {g === 'daily' ? '일별' : g === 'weekly' ? '주별' : '월별'}
                  </button>
                ))}
              </div>
            </div>

            {loadingTrend ? (
              <div className="flex items-center justify-center h-40 text-pastel-400 text-sm">로딩 중...</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 헬스체크 프로빙 추이 */}
                {Object.keys(latencyTrendHC).length > 0 && (() => {
                  const allPeriods = [...new Set(Object.values(latencyTrendHC).flatMap(arr => arr.map(d => d.period)))].sort();
                  const trendData = allPeriods.map(p => {
                    const row: Record<string, string | number> = { period: p };
                    Object.entries(latencyTrendHC).forEach(([model, arr]) => {
                      const found = arr.find(d => d.period === p);
                      row[model] = found ? found.avgLatency : 0;
                    });
                    return row;
                  });
                  const trendKeys = Object.keys(latencyTrendHC).sort();
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <p className="text-xs text-pastel-400">헬스체크 프로빙 평균 응답시간</p>
                        <div className="relative ml-auto">
                          <button
                            onClick={() => setLegendOpen(prev => ({ ...prev, trendHC: !prev.trendHC }))}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs text-pastel-500 hover:text-pastel-700 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
                          >
                            범례
                            <ChevronDown className={`w-3 h-3 transition-transform ${legendOpen.trendHC ? 'rotate-180' : ''}`} />
                          </button>
                          {legendOpen.trendHC && (
                            <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg border border-gray-200 shadow-lg p-3 min-w-[160px]">
                              {trendKeys.map((key) => (
                                <div key={key} className="flex items-center gap-2 py-1">
                                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[stableColorIndex(key)] }} />
                                  <span className="text-xs text-pastel-700 truncate">{key}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={trendData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: string) => latencyGranularity === 'monthly' ? v : v.slice(5)} />
                          <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`} />
                          <Tooltip wrapperStyle={{ zIndex: 9999 }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} itemSorter={(item) => -(Number(item.value) || 0)} formatter={(value: number, name: string) => [value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`, name]} />
                          {trendKeys.map((key) => (
                            <RechartsLine key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[stableColorIndex(key)]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}

                {/* 실사용 추이 */}
                {Object.keys(latencyTrendUsage).length > 0 && (() => {
                  const allPeriods = [...new Set(Object.values(latencyTrendUsage).flatMap(arr => arr.map(d => d.period)))].sort();
                  const trendData = allPeriods.map(p => {
                    const row: Record<string, string | number> = { period: p };
                    Object.entries(latencyTrendUsage).forEach(([model, arr]) => {
                      const found = arr.find(d => d.period === p);
                      row[model] = found ? found.avgLatency : 0;
                    });
                    return row;
                  });
                  const trendKeys = Object.keys(latencyTrendUsage).sort();
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <p className="text-xs text-pastel-400">실사용 평균 응답시간</p>
                        <div className="relative ml-auto">
                          <button
                            onClick={() => setLegendOpen(prev => ({ ...prev, trendUsage: !prev.trendUsage }))}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs text-pastel-500 hover:text-pastel-700 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
                          >
                            범례
                            <ChevronDown className={`w-3 h-3 transition-transform ${legendOpen.trendUsage ? 'rotate-180' : ''}`} />
                          </button>
                          {legendOpen.trendUsage && (
                            <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg border border-gray-200 shadow-lg p-3 min-w-[160px]">
                              {trendKeys.map((key) => (
                                <div key={key} className="flex items-center gap-2 py-1">
                                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[stableColorIndex(key)] }} />
                                  <span className="text-xs text-pastel-700 truncate">{key}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={trendData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: string) => latencyGranularity === 'monthly' ? v : v.slice(5)} />
                          <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`} />
                          <Tooltip wrapperStyle={{ zIndex: 9999 }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} itemSorter={(item) => -(Number(item.value) || 0)} formatter={(value: number, name: string) => [value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`, name]} />
                          {trendKeys.map((key) => (
                            <RechartsLine key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[stableColorIndex(key)]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}

                {Object.keys(latencyTrendHC).length === 0 && Object.keys(latencyTrendUsage).length === 0 && (
                  <div className="col-span-full flex items-center justify-center h-40 text-pastel-400 text-sm">추이 데이터가 없습니다</div>
                )}
              </div>
            )}
          </div>

          {/* 4) 데이터 테이블 (접기/펼치기) */}
          {latencyStats.length > 0 && (
            <div className="border-t border-gray-100 pt-6">
              <button
                onClick={() => setLatencyTableOpen(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-pastel-700 hover:text-pastel-900 transition-colors mb-3"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${latencyTableOpen ? 'rotate-180' : ''}`} />
                서비스 / 모델 상세 ({latencyStats.length})
              </button>
              {latencyTableOpen && (
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
              )}
            </div>
          )}

          {/* 5) 일별 모델별 Timeout 횟수 */}
          {errorRateDaily.length > 0 && (() => {
            // Timeout만 추출
            const timeoutModels = new Set<string>();
            const timeoutChartData = errorRateDaily.map(d => {
              const row: Record<string, string | number> = { day: d.day.slice(5) };
              for (const [model, types] of Object.entries(d.byModel)) {
                const tc = types['Timeout'] || 0;
                if (tc > 0) {
                  timeoutModels.add(model);
                  row[model] = tc;
                }
              }
              return row;
            });
            const sortedModels = [...timeoutModels].sort();
            const totalTimeouts = errorRateDaily.reduce((s, d) =>
              s + Object.values(d.byModel).reduce((s2, types) => s2 + (types['Timeout'] || 0), 0), 0);

            if (sortedModels.length === 0) return null;
            return (
              <div className="border-t border-gray-100 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-pastel-700">Timeout 발생 현황</h3>
                    <span className="text-xs text-pastel-400">최근 10 영업일 · 요청 timeout 2분</span>
                  </div>
                  <span className="text-xs text-orange-600 font-bold">총 {totalTimeouts}건</span>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={timeoutChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                    <Tooltip wrapperStyle={{ zIndex: 9999 }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                    <Legend />
                    {sortedModels.map(model => (
                      <Bar key={model} dataKey={model} stackId="timeout" fill={CHART_COLORS[stableColorIndex(model)]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {latencyRechartsData.length === 0 && hcRechartsData.length === 0 && Object.keys(latencyTrendHC).length === 0 && Object.keys(latencyTrendUsage).length === 0 && latencyStats.length === 0 && (
            <div className="flex items-center justify-center h-40 text-pastel-400">지연 시간 데이터가 없습니다</div>
          )}
        </div>
      </div>

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

      </div>

      {/* M/M 목표 달성 현황 */}
      {(mmTargetData.totalTargetMM > 0 || mmTargetData.byDept.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. 부서별 Saved M/M 분포 원 그래프 */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-card overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-5 border-b border-pastel-100/80">
              <div className="p-2 rounded-lg bg-emerald-50">
                <Target className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-pastel-800">부서별 Saved M/M 분포</h2>
                <p className="text-xs text-pastel-500">부서별 절감 실적 비중</p>
              </div>
            </div>
            <div className="p-6">
              {mmTargetData.byDept.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={mmTargetData.byDept}
                        dataKey="savedMM"
                        nameKey="dept"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={50}
                        paddingAngle={2}
                        label={({ dept, savedMM, percent }) =>
                          `${(dept as string).length > 10 ? (dept as string).slice(0, 10) + '…' : dept} ${savedMM} (${(percent * 100).toFixed(0)}%)`
                        }
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {mmTargetData.byDept.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.[0]) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                              <p className="font-semibold text-gray-800">{d.dept}</p>
                              <p className="text-emerald-600 font-bold">{d.savedMM} M/M</p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72 flex items-center justify-center text-pastel-400 text-sm">
                  Saved M/M 데이터가 없습니다
                </div>
              )}
            </div>
          </div>

          {/* 2. 올해 목표 7000 M/M 대비 달성 비교 바 차트 */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-card overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-5 border-b border-pastel-100/80">
              <div className="p-2 rounded-lg bg-violet-50">
                <Sparkles className="w-4 h-4 text-violet-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-pastel-800">연간 M/M 목표 달성 현황</h2>
                <p className="text-xs text-pastel-500">올해 목표 7,000 M/M 대비</p>
              </div>
            </div>
            <div className="p-6">
              {(() => {
                const ANNUAL_TARGET = 7000;
                const chartData = [
                  { name: '연간 목표', value: ANNUAL_TARGET, fill: '#e5e7eb' },
                  { name: '실제 Saved M/M', value: Math.round(mmTargetData.totalSavedMM * 10) / 10, fill: '#10b981' },
                  { name: 'AI 추정 합산', value: mmTargetData.totalAiEstimatedMM, fill: '#8b5cf6' },
                ];
                const maxVal = Math.max(ANNUAL_TARGET, mmTargetData.totalSavedMM, mmTargetData.totalAiEstimatedMM);
                return (
                  <div className="space-y-5">
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                          <XAxis type="number" domain={[0, Math.ceil(maxVal * 1.1)]} tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                          <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#374151', fontSize: 12 }} tickLine={false} axisLine={false} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.[0]) return null;
                              const d = payload[0].payload;
                              return (
                                <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                                  <p className="font-semibold text-gray-800">{d.name}</p>
                                  <p className="font-bold" style={{ color: d.fill }}>{d.value.toLocaleString()} M/M</p>
                                  <p className="text-xs text-gray-400">{ANNUAL_TARGET > 0 ? ((d.value / ANNUAL_TARGET) * 100).toFixed(1) : 0}% of 7,000</p>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
                            {chartData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-emerald-50 rounded-lg text-center">
                        <p className="text-[10px] text-emerald-500 font-medium uppercase">실제 Saved</p>
                        <p className="text-lg font-bold text-emerald-700">{mmTargetData.totalSavedMM.toFixed(1)}</p>
                        <p className="text-[10px] text-emerald-400">{((mmTargetData.totalSavedMM / ANNUAL_TARGET) * 100).toFixed(1)}%</p>
                      </div>
                      <div className="p-3 bg-violet-50 rounded-lg text-center">
                        <p className="text-[10px] text-violet-500 font-medium uppercase">AI 추정</p>
                        <p className="text-lg font-bold text-violet-700">{mmTargetData.totalAiEstimatedMM.toFixed(1)}</p>
                        <p className="text-[10px] text-violet-400">{((mmTargetData.totalAiEstimatedMM / ANNUAL_TARGET) * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Weekly Business DAU */}
      <WeeklyBusinessDAUChart />

      {/* MAU Monthly Chart */}
      {mauMonthlyData.length > 0 && mauServices.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-50 rounded-xl">
                <CalendarDays className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">MAU 월별 변화</h2>
                <p className="text-sm text-gray-500 mt-0.5">서비스별 월간 활성 사용자 추이 (BACKGROUND: 추정)</p>
              </div>
            </div>
            {mauEstimationMeta && (() => {
              const baselineMonths = Object.keys(mauEstimationMeta.monthlyBaseline || {}).sort();
              const latestBaselineKey = baselineMonths[baselineMonths.length - 1];
              const latestBaseline = latestBaselineKey ? mauEstimationMeta.monthlyBaseline?.[latestBaselineKey] : null;
              return (
                <div className="text-xs text-gray-400 text-right space-y-0.5">
                  {latestBaseline && (
                    <div>
                      <span>1인당 하루 평균: <strong className="text-gray-600">{latestBaseline.callsPerPersonPerDay}건</strong></span>
                      <span className="mx-2">|</span>
                      <span>1인당 월 평균: <strong className="text-gray-600">{latestBaseline.callsPerPersonPerMonth}건</strong></span>
                      <span className="mx-2">|</span>
                      <span>영업일: <strong className="text-gray-600">{latestBaseline.businessDays}일</strong></span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 justify-end text-gray-400">
                    <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 2" /></svg>
                    <span>= 추정 (BACKGROUND)</span>
                    <span className="mx-1">|</span>
                    <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke="#6b7280" strokeWidth="2" /></svg>
                    <span>= 실측 (STANDARD)</span>
                  </div>
                </div>
              );
            })()}
          </div>
          {/* Service summary cards */}
          {(() => {
            const rankedSvcs = [...mauServices].sort((a, b) => {
              const lastMonth = mauMonthlyData[mauMonthlyData.length - 1];
              return ((lastMonth?.[b.id] as number) || 0) - ((lastMonth?.[a.id] as number) || 0);
            });
            const topMauServices = rankedSvcs.slice(0, 10);
            const restMauServices = rankedSvcs.slice(10);
            const bgMonthlyDetail = mauEstimationMeta?.backgroundMonthlyDetail || {};
            const latestMonthKey = mauMonthlyData.length > 0 ? (mauMonthlyData[mauMonthlyData.length - 1]?.month as string) : null;
            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                  {topMauServices.map((svc, i) => {
                    const latestMau = (mauMonthlyData[mauMonthlyData.length - 1]?.[svc.id] as number) || 0;
                    const prevMau = mauMonthlyData.length > 1 ? (mauMonthlyData[mauMonthlyData.length - 2]?.[svc.id] as number) || 0 : 0;
                    const diff = latestMau - prevMau;
                    const isBg = svc.type === 'BACKGROUND';
                    const bgDetail = latestMonthKey ? bgMonthlyDetail[`${svc.id}|${latestMonthKey}`] : null;
                    return (
                      <div key={svc.id} className="p-3 bg-gray-50 rounded-lg border-l-4" style={{ borderLeftColor: CHART_COLORS[i % CHART_COLORS.length] }}>
                        <p className="text-xs text-gray-500 truncate">
                          {svc.displayName}
                          {isBg && <span className="ml-1 text-[10px] text-amber-500 font-medium">(추정)</span>}
                        </p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-lg font-bold text-gray-900">{latestMau}</p>
                          {diff !== 0 && (
                            <span className={`text-xs font-medium ${diff > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {diff > 0 ? '+' : ''}{diff}
                            </span>
                          )}
                        </div>
                        {isBg && bgDetail && (
                          <p className="text-[10px] text-amber-500">
                            월 호출: {bgDetail.totalCalls.toLocaleString()}건
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mauMonthlyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        content={({ active, payload, label: monthLabel }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const baseline = mauEstimationMeta?.monthlyBaseline?.[monthLabel as string];
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
                                  const svc = mauServices.find(s => s.id === svcId);
                                  const displayName = svc?.displayName || svcId;
                                  const isBg = svc?.type === 'BACKGROUND';
                                  const value = entry.value ?? 0;
                                  const bgDetail = mauEstimationMeta?.backgroundMonthlyDetail?.[`${svcId}|${monthLabel}`];
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
                          const svc = mauServices.find(s => s.id === value);
                          return svc?.displayName || value;
                        }}
                      />
                      {topMauServices.map((svc, i) => (
                        <RechartsLine
                          key={svc.id}
                          type="monotone"
                          dataKey={svc.id}
                          name={svc.id}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]}
                          strokeWidth={2}
                          strokeDasharray={svc.type === 'BACKGROUND' ? '5 3' : undefined}
                          dot={{ r: 4, strokeWidth: 2 }}
                          activeDot={{ r: 6 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {restMauServices.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-4 px-2">
                    <p className="text-xs text-gray-500 mb-2">그 외 {restMauServices.length}개 서비스</p>
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
                          {restMauServices.map((svc, i) => {
                            const latestMau = (mauMonthlyData[mauMonthlyData.length - 1]?.[svc.id] as number) || 0;
                            return (
                              <tr key={svc.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                <td className="py-1.5 px-3 text-gray-700 truncate max-w-[200px]">{svc.displayName}</td>
                                <td className="text-right py-1.5 px-3 text-gray-600">{latestMau}</td>
                                <td className="text-right py-1.5 px-3">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${svc.type === 'BACKGROUND' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                                    {svc.type === 'BACKGROUND' ? '추정' : '실측'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

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
