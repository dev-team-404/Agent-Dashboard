import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Activity, Zap, Building2, TrendingUp, Server,
  Plus, X, Clock, Trash2, BarChart3, Layers, Settings, Eye,
  Edit2, User,
} from 'lucide-react';
import { statsApi, serviceApi } from '../services/api';
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

interface Service {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  type?: string;
  enabled: boolean;
  registeredBy?: string;
  registeredByDept?: string;
  registeredByBusinessUnit?: string;
  createdAt?: string;
  _count: {
    usageLogs: number;
  };
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

// ── Sparkline ──
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 120;
  const height = 32;
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((v - min) / range) * height,
  }));
  const pathD = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
  const areaD = `${pathD} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#spark-${color})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2.5} fill={color} />
    </svg>
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

// ── Main page tabs ──
type MainTab = 'services' | 'dashboard';

export default function MainDashboard({ adminRole }: MainDashboardProps) {
  const [mainTab, setMainTab] = useState<MainTab>('services');
  const [services, setServices] = useState<Service[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ChartTab>('service');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newService, setNewService] = useState({ name: '', displayName: '', description: '', docsUrl: '', serviceType: 'STANDARD' as 'STANDARD' | 'BACKGROUND' });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Service | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', docsUrl: '', enabled: true, type: 'STANDARD' as 'STANDARD' | 'BACKGROUND' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [
        servicesRes, globalRes, serviceDailyRes, deptRes,
        deptDailyRes, deptUsersDailyRes, deptServiceReqsRes,
        latencyRes, latencyHistoryRes,
      ] = await Promise.all([
        serviceApi.list(),
        statsApi.globalOverview(),
        statsApi.globalByService(30),
        statsApi.globalByDept(30),
        statsApi.globalByDeptDaily(30, 5),
        statsApi.globalByDeptUsersDaily(30, 5),
        statsApi.globalByDeptServiceRequestsDaily(30, 10),
        statsApi.latency(),
        statsApi.latencyHistory(24, 10),
      ]);

      setServices(servicesRes.data.services || []);
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
    } catch (error) {
      console.error('Failed to load main dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newService.name || !newService.displayName) return;
    setCreating(true);
    try {
      await serviceApi.create({
        name: newService.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        displayName: newService.displayName,
        description: newService.description || undefined,
        docsUrl: newService.docsUrl || undefined,
        type: newService.serviceType,
        enabled: true,
      });
      setShowCreateModal(false);
      setNewService({ name: '', displayName: '', description: '', docsUrl: '', serviceType: 'STANDARD' });
      loadData();
      window.dispatchEvent(new CustomEvent('services-updated'));
    } catch {
      alert('서비스 생성에 실패했습니다. 이미 존재하는 이름인지 확인해주세요.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteService = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await serviceApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      loadData();
      window.dispatchEvent(new CustomEvent('services-updated'));
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { details?: { usageLogs?: number } } } };
      if (err.response?.status === 409) {
        const d = err.response.data?.details;
        setDeleteError(
          `연결된 데이터가 있어 삭제할 수 없습니다.\n` +
          `사용 기록: ${d?.usageLogs ?? 0}개\n` +
          `먼저 연결된 데이터를 삭제해주세요.`
        );
      } else {
        setDeleteError('서비스 삭제에 실패했습니다.');
      }
    } finally {
      setDeleting(false);
    }
  };

  const openEditModal = (service: Service) => {
    setEditTarget(service);
    setEditForm({
      displayName: service.displayName,
      description: service.description || '',
      docsUrl: service.docsUrl || '',
      enabled: service.enabled,
      type: (service.type || 'STANDARD') as 'STANDARD' | 'BACKGROUND',
    });
  };

  const handleEditService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      await serviceApi.update(editTarget.id, {
        displayName: editForm.displayName,
        description: editForm.description || undefined,
        docsUrl: editForm.docsUrl || undefined,
        enabled: editForm.enabled,
        type: editForm.type,
      });
      setEditTarget(null);
      loadData();
      window.dispatchEvent(new CustomEvent('services-updated'));
    } catch {
      alert('서비스 수정에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const formatNumber = useCallback((num: number): string => {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }, []);

  // ── Merge services with globalOverview ──
  const mergedServiceStats = services.map((service) => {
    const stats = globalOverview.find((s) => s.serviceId === service.id);
    return {
      ...service,
      serviceId: service.id,
      serviceName: service.name,
      serviceDisplayName: service.displayName,
      totalUsers: stats?.totalUsers || 0,
      todayActiveUsers: stats?.todayActiveUsers || 0,
      avgDailyActiveUsers: stats?.avgDailyActiveUsers || 0,
      totalTokens: stats?.totalTokens || 0,
      totalRequests: stats?.totalRequests || 0,
      hasData: !!stats && (stats.totalUsers > 0 || stats.totalRequests > 0),
    };
  });

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

  const deptTokenRechartsData = deptDailyData.map(d => ({ ...d, date: (d.date as string).slice(5) }));
  const deptUsersRechartsData = deptUsersDailyData.map(d => ({ ...d, date: (d.date as string).slice(5) }));
  const deptServiceRechartsData = deptServiceRequestsData.map(d => ({ ...d, date: (d.date as string).slice(5) }));

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

  // Per-service sparkline data
  const serviceSparklines: Record<string, number[]> = {};
  uniqueServices.forEach(svc => {
    serviceSparklines[svc] = uniqueDates.slice(-14).map(date => {
      const entry = serviceDaily.find(d => d.date === date && d.serviceName === svc);
      return entry?.requests || 0;
    });
  });

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
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={serviceRechartsData}>
              <defs>
                {uniqueServices.map((svc, i) => (
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
              {uniqueServices.map((svc, i) => (
                <Area key={svc} type="monotone" dataKey={svc} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={`url(#grad-${i})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
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
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={deptServiceRechartsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v: number) => formatNumber(v)} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(value: number) => [formatNumber(value), undefined]} />
              <Legend />
              {deptServiceCombos.map((combo, i) => (
                <RechartsLine key={combo} type="monotone" dataKey={combo} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
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
        return latencyRechartsData.length > 0 ? (
          <>
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
        ) : (
          <div className="flex items-center justify-center h-72 text-pastel-400">지연 시간 데이터가 없습니다</div>
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
    <div className="space-y-6 animate-fade-in">
      {/* ════════ Top-Level Tabs ════════ */}
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setMainTab('services')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mainTab === 'services'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Server className="w-4 h-4" />
            서비스
            <span className={`ml-0.5 px-1.5 py-0.5 text-xs rounded ${
              mainTab === 'services' ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500'
            }`}>
              {services.length}
            </span>
          </button>
          <button
            onClick={() => setMainTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mainTab === 'dashboard'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            통합 대시보드
          </button>
        </div>

        {mainTab === 'services' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            새 서비스 등록
          </button>
        )}
      </div>

      {/* ════════ TAB: 서비스 ════════ */}
      {mainTab === 'services' && (
        <div className="space-y-6">
          {/* Service summary bar */}
          <div className="flex items-center gap-5 px-4 py-2.5 bg-white rounded-lg border border-gray-200 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-gray-600">
                활성 <span className="font-semibold text-gray-900">{services.filter(s => s.enabled).length}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
              <span className="text-gray-600">
                비활성 <span className="font-semibold text-gray-900">{services.filter(s => !s.enabled).length}</span>
              </span>
            </div>
            <div className="h-4 w-px bg-gray-200" />
            <span className="text-gray-500">
              오늘 DAU <span className="font-semibold text-gray-900">{todayActive}</span>
            </span>
            <span className="text-gray-500">
              총 요청 <span className="font-semibold text-gray-900">{formatNumber(totalRequests)}</span>
            </span>
          </div>

          {/* Service Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mergedServiceStats.map((service) => (
              <div
                key={service.serviceId}
                className={`group bg-white rounded-lg border transition-all duration-150 ${
                  service.enabled
                    ? service.hasData
                      ? 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                      : 'border-dashed border-gray-300 hover:border-gray-400'
                    : 'border-gray-200 opacity-60'
                }`}
              >
                {/* Status indicator — only when active today */}
                {service.enabled && service.todayActiveUsers > 0 && (
                  <div className="h-0.5 bg-emerald-500 rounded-t-lg" />
                )}

                {/* Card content */}
                <div className="p-5">
                  {/* Header with actions */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {service.iconUrl ? (
                        <img src={service.iconUrl} alt={service.serviceDisplayName} className="w-10 h-10 rounded-lg flex-shrink-0" />
                      ) : (
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          service.enabled
                            ? service.type === 'BACKGROUND' ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'
                            : 'bg-gray-100 text-gray-400'
                        }`}>
                          <Server className="w-5 h-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">{service.serviceDisplayName}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <code className="text-xs text-gray-400 font-mono">{service.serviceName}</code>
                          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                            service.type === 'BACKGROUND'
                              ? 'bg-violet-50 text-violet-600'
                              : 'bg-blue-50 text-blue-600'
                          }`}>
                            {service.type === 'BACKGROUND' ? 'BG' : 'STD'}
                          </span>
                          {!service.enabled && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-500">
                              OFF
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Live indicator */}
                    {service.todayActiveUsers > 0 && (
                      <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 rounded flex-shrink-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        <span className="text-xs font-medium text-green-700">{service.todayActiveUsers}</span>
                      </div>
                    )}
                  </div>

                  {service.hasData ? (
                    <>
                      {/* Sparkline */}
                      {serviceSparklines[service.serviceName]?.some(v => v > 0) && (
                        <div className="mb-3 flex justify-center">
                          <Sparkline data={serviceSparklines[service.serviceName]} color="#5BA4D9" />
                        </div>
                      )}

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="text-center p-2 bg-gray-50 rounded-lg">
                          <p className="text-base font-semibold text-gray-900">{formatNumber(service.totalUsers)}</p>
                          <p className="text-[11px] text-gray-500">사용자</p>
                        </div>
                        <div className="text-center p-2 bg-gray-50 rounded-lg">
                          <p className="text-base font-semibold text-gray-900">{formatNumber(service.totalRequests)}</p>
                          <p className="text-[11px] text-gray-500">요청</p>
                        </div>
                        <div className="text-center p-2 bg-gray-50 rounded-lg">
                          <p className="text-base font-semibold text-gray-900">{formatNumber(service.totalTokens)}</p>
                          <p className="text-[11px] text-gray-500">토큰</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-6 mb-4">
                      <Eye className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">아직 요청이 없습니다</p>
                      <p className="text-xs text-gray-300 mt-1">x-service-id: {service.serviceName}</p>
                    </div>
                  )}

                  {/* Registration meta */}
                  <div className="flex items-center gap-1 text-[11px] text-gray-400 mb-4 flex-wrap">
                    <User className="w-3 h-3 flex-shrink-0" />
                    <span className="text-gray-500 font-medium">{service.registeredBy || '-'}</span>
                    <span className="text-gray-300 mx-0.5">&middot;</span>
                    <Building2 className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[100px]">
                      {service.registeredByDept || '-'}
                    </span>
                    {service.createdAt && (
                      <>
                        <span className="text-gray-300 mx-0.5">&middot;</span>
                        <span>{new Date(service.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '')}</span>
                      </>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="border-t border-gray-100 pt-3 flex items-center gap-2">
                    <Link
                      to={`/service/${service.serviceId}`}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      대시보드
                    </Link>
                    <Link
                      to={`/service/${service.serviceId}/users`}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded transition-colors"
                    >
                      <Users className="w-3.5 h-3.5" />
                      사용자
                    </Link>
                    <button
                      onClick={() => openEditModal(service)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded transition-colors"
                      title="서비스 수정"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {adminRole === 'SUPER_ADMIN' && (
                      <button
                        onClick={() => { setDeleteError(null); setDeleteTarget({ id: service.serviceId, name: service.serviceDisplayName }); }}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="서비스 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Add service card — same size as service cards */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-colors group min-h-[200px]"
            >
              <div className="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center mb-2 transition-colors">
                <Plus className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">
                {services.length === 0 ? '첫 번째 서비스 등록' : '새 서비스 등록'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">x-service-id 기반 LLM 프록시</p>
            </button>
          </div>
        </div>
      )}

      {/* ════════ TAB: 통합 대시보드 ════════ */}
      {mainTab === 'dashboard' && (
        <div className="space-y-8">
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
                <Building2 className="w-4 h-4 text-blue-600" />
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
      )}

      {/* ════════ Service Creation Modal ════════ */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 animate-slide-up">
            <div className="flex items-center justify-between p-5 border-b border-pastel-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="text-lg font-bold text-pastel-800">새 서비스 등록</h3>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-1.5 text-pastel-400 hover:text-pastel-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateService} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">
                  서비스 ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newService.name}
                  onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                  placeholder="my-service (영문 소문자, 숫자, 하이픈)"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all"
                  required
                />
                <p className="mt-1 text-xs text-pastel-400">x-service-id 헤더에 사용할 ID</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">
                  표시 이름 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newService.displayName}
                  onChange={(e) => setNewService({ ...newService, displayName: e.target.value })}
                  placeholder="My Service"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">설명</label>
                <textarea
                  value={newService.description}
                  onChange={(e) => setNewService({ ...newService, description: e.target.value })}
                  placeholder="서비스에 대한 간단한 설명"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all resize-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">설명서 URL</label>
                <input
                  type="url"
                  value={newService.docsUrl}
                  onChange={(e) => setNewService({ ...newService, docsUrl: e.target.value })}
                  placeholder="https://docs.example.com/my-service"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all"
                />
                <p className="mt-1 text-xs text-pastel-400">서비스 사용 가이드 페이지 URL (선택)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-2">서비스 타입</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewService({ ...newService, serviceType: 'STANDARD' })}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      newService.serviceType === 'STANDARD'
                        ? 'border-samsung-blue bg-samsung-blue/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-pastel-800">STANDARD</p>
                    <p className="text-xs text-pastel-500 mt-0.5">사용자 대면 서비스</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewService({ ...newService, serviceType: 'BACKGROUND' })}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      newService.serviceType === 'BACKGROUND'
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-pastel-800">BACKGROUND</p>
                    <p className="text-xs text-pastel-500 mt-0.5">배치/자동화 서비스</p>
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-5 py-2.5 text-pastel-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-medium">
                  취소
                </button>
                <button
                  type="submit"
                  disabled={creating || !newService.name || !newService.displayName}
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
                >
                  {creating ? '생성 중...' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════ Service Edit Modal ════════ */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 animate-slide-up">
            <div className="flex items-center justify-between p-5 border-b border-pastel-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Settings className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-pastel-800">서비스 수정</h3>
                  <p className="text-xs text-pastel-500">{editTarget.name}</p>
                </div>
              </div>
              <button onClick={() => setEditTarget(null)} className="p-1.5 text-pastel-400 hover:text-pastel-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditService} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">표시 이름</label>
                <input
                  type="text"
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">설명</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all resize-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">설명서 URL</label>
                <input
                  type="url"
                  value={editForm.docsUrl}
                  onChange={(e) => setEditForm({ ...editForm, docsUrl: e.target.value })}
                  placeholder="https://docs.example.com/my-service"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all"
                />
                <p className="mt-1 text-xs text-pastel-400">서비스 사용 가이드 페이지 URL (선택)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-2">서비스 타입</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEditForm({ ...editForm, type: 'STANDARD' })}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      editForm.type === 'STANDARD' ? 'border-samsung-blue bg-samsung-blue/5' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-pastel-800">STANDARD</p>
                    <p className="text-xs text-pastel-500 mt-0.5">사용자 대면</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditForm({ ...editForm, type: 'BACKGROUND' })}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      editForm.type === 'BACKGROUND' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-pastel-800">BACKGROUND</p>
                    <p className="text-xs text-pastel-500 mt-0.5">배치/자동화</p>
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-3 p-3 bg-pastel-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                <div className="relative">
                  <input type="checkbox" checked={editForm.enabled} onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })} className="sr-only peer" />
                  <div className="w-10 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                </div>
                <span className="text-sm text-pastel-700 font-medium">서비스 활성화</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditTarget(null)} className="px-5 py-2.5 text-pastel-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-medium">
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════ Service Delete Modal ════════ */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 animate-slide-up">
            <div className="flex items-center justify-between p-5 border-b border-pastel-100">
              <h3 className="text-lg font-bold text-pastel-800">서비스 삭제</h3>
              <button
                onClick={() => { if (!deleting) setDeleteTarget(null); }}
                className={`p-1.5 transition-colors rounded-lg ${deleting ? 'text-gray-200 cursor-not-allowed' : 'text-pastel-400 hover:text-pastel-600 hover:bg-gray-100'}`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-pastel-700">
                <span className="font-semibold text-pastel-800">{deleteTarget.name}</span> 서비스를 삭제하시겠습니까?
              </p>
              <p className="text-xs text-pastel-500">이 작업은 되돌릴 수 없습니다.</p>
              {deleteError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm text-red-600 whitespace-pre-line">{deleteError}</p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="px-5 py-2.5 text-pastel-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50 font-medium">
                  취소
                </button>
                <button type="button" onClick={handleDeleteService} disabled={deleting} className="px-5 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 font-medium">
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
