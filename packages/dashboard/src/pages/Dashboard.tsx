import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users, Activity, Zap, RotateCcw, X, TrendingUp,
  Server, Hash,
} from 'lucide-react';
import { statsApi, serviceApi } from '../services/api';
import BusinessDayToggle from '../components/BusinessDayToggle';
import UserStatsChart from '../components/Charts/UserStatsChart';
import ModelUsageChart from '../components/Charts/ModelUsageChart';
import UsersByModelChart from '../components/Charts/UsersByModelChart';
import ModelRatingChart from '../components/Charts/ModelRatingChart';
import UsageAnalytics from '../components/Charts/UsageAnalytics';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface OverviewStats {
  activeUsers: number;
  todayUsage: {
    inputTokens: number;
    outputTokens: number;
    requests: number;
  };
  totalUsers: number;
  totalModels: number;
}

interface ServiceStats {
  serviceId: string;
  avgDailyActiveUsers: number;
  avgDailyActiveUsersExcluding: number;
}

interface ServiceInfo {
  id: string;
  name: string;
  displayName: string;
  description?: string;
}

interface DashboardProps {
  serviceId?: string;
  adminRole?: AdminRole;
}

// ── Animated Counter ──
function useAnimatedCounter(target: number, duration = 1000) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const from = prevTarget.current;
    prevTarget.current = target;

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutExpo
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

// ── Donut Ring Chart for Token Breakdown ──
const TOKEN_COLORS = ['#4A90D9', '#8B5CF6', '#10B981'];

function TokenDonutChart({
  inputTokens,
  outputTokens,
  formatNumber,
}: {
  inputTokens: number;
  outputTokens: number;
  formatNumber: (n: number) => string;
}) {
  const { t } = useTranslation();
  const total = inputTokens + outputTokens;
  const data = [
    { name: t('dashboard.inputTokens'), value: inputTokens, color: TOKEN_COLORS[0] },
    { name: t('dashboard.outputTokens'), value: outputTokens, color: TOKEN_COLORS[1] },
  ];

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-pastel-400 text-sm font-medium">
        {t('dashboard.noTokenData')}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <div className="relative w-44 h-44 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={72}
              paddingAngle={4}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => formatNumber(value)}
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-400">{t('dashboard.totalTokens')}</span>
          <span className="text-lg font-bold text-gray-900">{formatNumber(total)}</span>
        </div>
      </div>

      <div className="space-y-3 flex-1">
        {data.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-sm text-gray-600">{item.name}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-semibold text-gray-900">{formatNumber(item.value)}</span>
              <span className="text-xs text-gray-400 ml-1.5">
                ({total > 0 ? ((item.value / total) * 100).toFixed(1) : 0}%)
              </span>
            </div>
          </div>
        ))}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{t('common.total')}</span>
          <span className="text-sm font-bold text-gray-900">{formatNumber(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Metric Card ──
function MetricCard({
  label, value, icon: Icon, iconBg, iconColor, description, highlight, delay, suffix,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  description: string;
  highlight?: boolean;
  delay: number;
  suffix?: string;
}) {
  const animatedValue = useAnimatedCounter(value);

  const formatNumber = (num: number): string => {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <div
      className="group relative overflow-hidden rounded-lg bg-white border border-gray-200 shadow-sm hover:shadow-md transition-all duration-500 hover:-translate-y-1"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-pastel-500">{label}</p>
            <p className={`text-3xl font-bold tracking-tight ${highlight ? 'text-orange-600' : 'text-pastel-800'}`}>
              {formatNumber(animatedValue)}{suffix && <span className="text-lg ml-0.5">{suffix}</span>}
            </p>
            <p className="text-xs text-pastel-400">{description}</p>
          </div>
          <div className={`p-3 rounded-xl ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Loading Skeleton ──
function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Service header skeleton */}
      <div className="rounded-lg bg-gray-100 p-6 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-64" />
      </div>

      {/* Metric cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="rounded-lg bg-white border border-gray-200 shadow-sm p-5">
            <div className="animate-pulse space-y-3">
              <div className="h-3 bg-gray-200 rounded w-20" />
              <div className="h-8 bg-gray-200 rounded w-16" />
              <div className="h-2 bg-gray-100 rounded w-24" />
            </div>
          </div>
        ))}
      </div>

      {/* Token donut skeleton */}
      <div className="rounded-lg bg-white border border-gray-200 shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-40 mb-6" />
          <div className="flex items-center gap-6">
            <div className="w-44 h-44 bg-gray-100 rounded-full" />
            <div className="flex-1 space-y-4">
              <div className="h-4 bg-gray-200 rounded w-32" />
              <div className="h-4 bg-gray-200 rounded w-28" />
              <div className="h-4 bg-gray-200 rounded w-36" />
            </div>
          </div>
        </div>
      </div>

      {/* Charts skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-lg bg-white border border-gray-200 shadow-sm p-6">
            <div className="animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-48 mb-4" />
              <div className="h-64 bg-gray-100 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ serviceId, adminRole }: DashboardProps) {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [serviceStats, setServiceStats] = useState<ServiceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [serviceId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [overviewRes, globalRes] = await Promise.all([
        statsApi.overview(serviceId),
        statsApi.globalOverview(),
      ]);
      setOverview(overviewRes.data);

      if (serviceId && globalRes.data.services) {
        const svcStats = globalRes.data.services.find(
          (s: ServiceStats) => s.serviceId === serviceId
        );
        if (svcStats) {
          setServiceStats(svcStats);
        }
      }

      if (serviceId) {
        const serviceRes = await serviceApi.get(serviceId);
        setServiceInfo(serviceRes.data.service);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetData = async () => {
    if (!serviceId) return;
    setResetting(true);
    setResetResult(null);
    try {
      const res = await serviceApi.resetData(serviceId);
      const d = res.data.deleted;
      setResetResult(
        t('dashboard.resetResult', { usageLogs: d.usageLogs, dailyStats: d.dailyStats, ratings: d.ratings, userServices: d.userServices })
      );
      loadData();
      window.dispatchEvent(new CustomEvent('services-updated'));
    } catch {
      setResetResult(t('dashboard.resetFailed'));
    } finally {
      setResetting(false);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  const todayTokens = overview?.todayUsage
    ? overview.todayUsage.inputTokens + overview.todayUsage.outputTokens
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ════════ Service Info Header ════════ */}
      {serviceInfo && (
        <div className="rounded-lg bg-white border border-gray-200 p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3.5 bg-blue-50 rounded-lg">
                <Server className="w-7 h-7 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">{serviceInfo.displayName}</h1>
                {serviceInfo.description && (
                  <p className="text-gray-500 mt-1.5 text-sm font-medium">{serviceInfo.description}</p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600">
                    <Hash className="w-3 h-3" />
                    {serviceInfo.name}
                  </span>
                </div>
              </div>
            </div>
            {adminRole === 'SUPER_ADMIN' && (
              <button
                onClick={() => { setResetResult(null); setShowResetModal(true); }}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg transition-all hover:bg-gray-50 font-medium"
              >
                <RotateCcw className="w-4 h-4" />
                {t('dashboard.resetData')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ════════ Data Reset Modal ════════ */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in" onClick={() => { if (!resetting) setShowResetModal(false); }}>
          <div className="bg-white rounded-xl shadow-modal w-full max-w-md mx-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-100/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center ring-1 ring-red-100/50">
                  <RotateCcw className="w-5 h-5 text-red-500" />
                </div>
                <h3 className="text-lg font-bold text-pastel-800">{t('dashboard.resetDataTitle')}</h3>
              </div>
              <button
                onClick={() => { if (!resetting) setShowResetModal(false); }}
                className={`p-2 rounded-xl transition-colors ${resetting ? 'text-pastel-200 cursor-not-allowed' : 'text-pastel-400 hover:text-pastel-600 hover:bg-pastel-50'}`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-pastel-600 leading-relaxed">
                <span className="font-semibold text-pastel-800">{serviceInfo?.displayName}</span>{t('dashboard.resetConfirmMessage')}
              </p>
              <div className="p-4 bg-amber-50 border border-amber-200/60 rounded-lg">
                <p className="text-sm text-amber-700 leading-relaxed">
                  {t('dashboard.resetWarning')}
                </p>
              </div>
              {resetResult && (
                <div className={`p-4 rounded-lg border ${resetResult.startsWith(t('dashboard.deleteComplete')) ? 'bg-emerald-50 border-emerald-200/60' : 'bg-rose-50 border-rose-200/60'}`}>
                  <p className={`text-sm ${resetResult.startsWith(t('dashboard.deleteComplete')) ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {resetResult}
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  disabled={resetting}
                  className="px-5 py-2.5 text-pastel-600 bg-pastel-50 rounded-lg hover:bg-pastel-100 transition-colors disabled:opacity-50 font-semibold text-sm"
                >
                  {resetResult?.startsWith(t('dashboard.deleteComplete')) ? t('common.close') : t('common.cancel')}
                </button>
                {!resetResult?.startsWith(t('dashboard.deleteComplete')) && (
                  <button
                    type="button"
                    onClick={handleResetData}
                    disabled={resetting}
                    className="px-5 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 font-semibold text-sm"
                  >
                    {resetting ? t('dashboard.resetting') : t('common.reset')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════ Toggle ════════ */}
      <div className="flex justify-end">
        <BusinessDayToggle />
      </div>

      {/* ════════ Metric Cards ════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-5">
        <MetricCard
          label={t('dashboard.activeUsers')}
          value={overview?.activeUsers || 0}
          icon={Activity}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
          description={t('dashboard.last30min')}
          delay={0}
        />
        <MetricCard
          label={t('dashboard.totalUsers')}
          value={overview?.totalUsers || 0}
          icon={Users}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          description={t('dashboard.registeredUsers')}
          delay={80}
        />
        <MetricCard
          label={t('dashboard.dailyAvgBusinessDay')}
          value={serviceStats?.avgDailyActiveUsersExcluding || 0}
          icon={TrendingUp}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
          description={t('dashboard.last1MonthExclWeekend')}
          highlight
          delay={160}
        />
        <MetricCard
          label={t('dashboard.todayRequests')}
          value={overview?.todayUsage?.requests || 0}
          icon={Zap}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          description={t('dashboard.apiCallCount')}
          delay={240}
        />
        <MetricCard
          label={t('dashboard.todayTokens')}
          value={todayTokens}
          icon={Hash}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          description={t('dashboard.inputPlusOutput')}
          delay={320}
        />
      </div>

      {/* ════════ Active Users Pulse ════════ */}
      {(overview?.activeUsers || 0) > 0 && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-emerald-50 border border-emerald-100 animate-slide-up">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-emerald-700">
            {t('dashboard.activeUsersMessage', { count: overview?.activeUsers })}
          </span>
          <span className="text-xs text-emerald-500 ml-auto">{t('dashboard.realtime')}</span>
        </div>
      )}

      {/* ════════ Token Donut Chart ════════ */}
      <div className="bg-white rounded-lg border border-gray-100/80 shadow-card overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100/60">
          <div className="p-2.5 rounded-xl bg-violet-50">
            <Hash className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-pastel-800">{t('dashboard.todayTokenUsage')}</h2>
            <p className="text-xs text-pastel-400 font-medium">{t('dashboard.tokenRatio')}</p>
          </div>
        </div>
        <div className="p-6">
          <TokenDonutChart
            inputTokens={overview?.todayUsage?.inputTokens || 0}
            outputTokens={overview?.todayUsage?.outputTokens || 0}
            formatNumber={formatNumber}
          />
        </div>
      </div>

      {/* ════════ Charts Grid ════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Stats Chart (Cumulative + Daily Active) */}
        <div className="lg:col-span-2">
          <UserStatsChart serviceId={serviceId} />
        </div>

        {/* Model Usage Chart */}
        <div className="lg:col-span-1">
          <ModelUsageChart serviceId={serviceId} />
        </div>

        {/* Model Rating Chart */}
        <div className="lg:col-span-1">
          <ModelRatingChart serviceId={serviceId} />
        </div>

        {/* Users by Model Chart */}
        <div className="lg:col-span-2">
          <UsersByModelChart serviceId={serviceId} />
        </div>
      </div>

      {/* ════════ Usage Analytics (Admin Only) ════════ */}
      {adminRole && (
        <UsageAnalytics serviceId={serviceId} />
      )}
    </div>
  );
}
