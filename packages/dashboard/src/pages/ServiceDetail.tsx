import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrgCodeResolver } from '../hooks/useOrgCodeResolver';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Edit2, Trash2, ChevronDown, ChevronRight, Loader2,
  Layers, ToggleLeft, ToggleRight, Search, Filter,
  Zap, MessageSquare, Image, Cpu, Sparkles, Mic,
  AlertTriangle, X, Check, UserPlus, Users,
  Crown, Shield, User, Gauge, Server, FlaskConical,
  Activity, TrendingUp, Hash, BarChart3, CalendarDays,
  Globe, Building2, Lock, ExternalLink,
  Ticket, Clock, Tag, Wifi, WifiOff, Timer,
  Copy,
} from 'lucide-react';
import { api, serviceApi, serviceRateLimitScopedApi, statsApi, testAccountApi, scopeApi } from '../services/api';
import type { TestAccount } from '../services/api';
import {
  Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

import BusinessDayToggle from '../components/BusinessDayToggle';
import ServiceDetailGuide from '../components/Tour/ServiceDetailGuide';

// ── Reusable chart components ──
import UserStatsChart from '../components/Charts/UserStatsChart';
import ModelUsageChart from '../components/Charts/ModelUsageChart';
import UsersByModelChart from '../components/Charts/UsersByModelChart';
import ModelRatingChart from '../components/Charts/ModelRatingChart';
import UsageAnalytics from '../components/Charts/UsageAnalytics';

// ════════════════════════════════════════════
// Types
// ════════════════════════════════════════════

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;
type TabId = 'dashboard' | 'members' | 'ratelimit' | 'models' | 'errors' | 'logs' | 'testaccounts';

interface ServiceDetailProps {
  user: { id: string; loginid: string; username: string; deptname: string };
  adminRole: AdminRole;
}

interface Service {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  serviceUrl?: string;
  type: 'STANDARD' | 'BACKGROUND';
  status: 'DEVELOPMENT' | 'DEPLOYED';
  enabled: boolean;
  registeredBy?: string;
  registeredByDept?: string;
  registeredByBusinessUnit?: string;
  team?: string;
  center2Name?: string;
  center1Name?: string;
  deployScope?: 'ALL' | 'BUSINESS_UNIT' | 'TEAM';
  deployScopeValue?: string[];
  targetMM?: number | null;
  serviceCategory?: string | null;
  jiraTicket?: string | null;
  apiOnly?: boolean;
  createdAt: string;
  _count?: { usageLogs: number; userServices: number; serviceModels: number };
  _isServiceAdmin?: boolean;
  _isCreator?: boolean;
}

interface ServiceMember {
  id: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'USER';
  user: { id: string; loginid: string; username: string; deptname: string };
}

interface SearchUser {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
}

interface ServiceModelItem {
  id: string;
  serviceId: string;
  modelId: string;
  aliasName: string;
  sortOrder: number;
  weight: number;
  enabled: boolean;
  fallbackModelId?: string | null;
  fallbackModel?: { id: string; name: string; displayName: string; type: string } | null;
  maxRetries?: number;
  addedBy?: string;
  addedAt: string;
  accessible: boolean;
  model: {
    id: string; name: string; displayName: string;
    type: string; enabled: boolean; visibility?: string;
    maxTokens?: number; supportsVision?: boolean;
  };
}

interface AvailableModel {
  id: string; name: string; displayName: string;
  type: string; enabled: boolean; visibility?: string;
}

interface OverviewStats {
  activeUsers: number;
  todayUsage: { inputTokens: number; outputTokens: number; requests: number };
  totalUsers: number;
  totalModels: number;
}

interface UserRateLimit {
  userId: string;
  maxTokens: number;
  window: 'FIVE_HOURS' | 'DAY';
  enabled: boolean;
  user: { id: string; loginid: string; username: string; deptname: string };
}

interface CommonRateLimit {
  maxTokens: number;
  window: 'FIVE_HOURS' | 'DAY';
  enabled: boolean;
}

// ════════════════════════════════════════════
// Shared utilities
// ════════════════════════════════════════════

const TABS: { id: TabId; labelKey: string; icon: typeof BarChart3 }[] = [
  { id: 'dashboard', labelKey: 'serviceDetail.tabs.dashboard', icon: BarChart3 },
  { id: 'members', labelKey: 'serviceDetail.tabs.members', icon: Users },
  { id: 'ratelimit', labelKey: 'serviceDetail.tabs.rateLimit', icon: Gauge },
  { id: 'models', labelKey: 'serviceDetail.tabs.models', icon: Layers },
  { id: 'errors', labelKey: 'serviceDetail.tabs.errors', icon: AlertTriangle },
  { id: 'testaccounts', labelKey: 'serviceDetail.tabs.testAccounts', icon: FlaskConical },
];

const MODEL_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  CHAT: MessageSquare, IMAGE: Image, EMBEDDING: Layers, RERANKING: Sparkles, ASR: Mic,
};
const MODEL_TYPE_I18N_KEYS: Record<string, string> = {
  CHAT: 'serviceDetail.modelTypes.chat',
  IMAGE: 'serviceDetail.modelTypes.image',
  EMBEDDING: 'serviceDetail.modelTypes.embedding',
  RERANKING: 'serviceDetail.modelTypes.reranking',
  ASR: 'serviceDetail.modelTypes.asr',
};
const GROUP_COLORS = [
  'border-l-blue-400', 'border-l-emerald-400', 'border-l-amber-400',
  'border-l-purple-400', 'border-l-rose-400', 'border-l-cyan-400',
  'border-l-teal-400', 'border-l-orange-400',
];

function formatTokens(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ── Animated counter ──
function useAnimatedCounter(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const from = prevRef.current;
    prevRef.current = target;
    const animate = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
}

function AnimatedStat({ value, suffix }: { value: number; suffix?: string }) {
  const v = useAnimatedCounter(value);
  return <>{formatTokens(v)}{suffix && <span className="text-lg ml-0.5 font-semibold">{suffix}</span>}</>;
}

// ── Role helpers ──
function roleBadgeClass(role: string) {
  if (role === 'OWNER') return 'bg-amber-100 text-amber-700 border border-amber-200';
  if (role === 'ADMIN') return 'bg-blue-100 text-blue-700 border border-blue-200';
  return 'bg-gray-100 text-gray-600 border border-gray-200';
}
function roleIcon(role: string) {
  if (role === 'OWNER') return <Crown className="w-2.5 h-2.5 mr-0.5" />;
  if (role === 'ADMIN') return <Shield className="w-2.5 h-2.5 mr-0.5" />;
  return <User className="w-2.5 h-2.5 mr-0.5" />;
}
const ROLE_I18N_KEYS: Record<string, string> = {
  OWNER: 'serviceDetail.roles.owner',
  ADMIN: 'serviceDetail.roles.admin',
  USER: 'serviceDetail.roles.user',
};

const TOKEN_COLORS = ['#3B82F6', '#8B5CF6'];
// ════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════

export default function ServiceDetail({ user, adminRole }: ServiceDetailProps) {
  const { t } = useTranslation();
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  const { resolveAll } = useOrgCodeResolver();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [showDetailGuide, setShowDetailGuide] = useState(false);

  // 서비스 등록 가이드에서 넘어온 경우 자동 시작
  useEffect(() => {
    const guideData = sessionStorage.getItem('service_detail_guide');
    if (guideData) {
      sessionStorage.removeItem('service_detail_guide');
      // 페이지 로딩 후 시작
      const timer = setTimeout(() => setShowDetailGuide(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const loadService = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    try {
      const res = await api.get(`/services/${serviceId}`);
      setService(res.data.service);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [serviceId]);

  useEffect(() => { loadService(); }, [loadService]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-[3px] border-samsung-blue/20 border-t-samsung-blue rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-sm text-gray-400 font-medium">{t('serviceDetail.hero.serviceLoading')}</p>
        </div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">{t('serviceDetail.hero.serviceNotFound')}</p>
        <button onClick={() => navigate('/my-services')} className="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium">
          {t('serviceDetail.hero.backToServices')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      {/* ═══════ Hero Header ═══════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 mb-6">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
          backgroundSize: '24px 24px',
        }} />
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative p-6 lg:p-8">
          {/* Back + Actions row */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={() => navigate('/my-services')}
              className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('serviceDetail.hero.serviceList')}
            </button>
            <div className="flex items-center gap-2">
              {service.serviceUrl && (
                <a
                  href={service.serviceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-500/80 rounded-lg hover:bg-blue-500 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('serviceDetail.hero.openService')}
                </a>
              )}
              {service.docsUrl && (
                <a
                  href={service.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/70 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('serviceDetail.hero.apiDocs')}
                </a>
              )}
              {service.jiraTicket && (
                <a
                  href={service.jiraTicket}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-300 bg-violet-500/20 rounded-lg hover:bg-violet-500/30 transition-colors"
                >
                  <Ticket className="w-3 h-3" />
                  Jira
                </a>
              )}
            </div>
          </div>

          {/* Service identity */}
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0 ring-1 ring-white/10">
              {service.iconUrl ? (
                <img src={service.iconUrl} alt="" className="w-10 h-10 rounded-lg" />
              ) : (
                <Server className="w-7 h-7 text-white/80" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl lg:text-3xl font-bold text-white tracking-tight">
                  {service.displayName}
                </h1>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 text-[11px] font-semibold rounded-full ${
                    service.status === 'DEPLOYED'
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
                  }`}>
                    {service.status === 'DEPLOYED' ? t('serviceDetail.hero.deployed') : t('serviceDetail.hero.developing')}
                  </span>
                  <span className={`px-2.5 py-1 text-[11px] font-semibold rounded-full ${
                    service.type === 'STANDARD'
                      ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30'
                      : 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30'
                  }`}>
                    {service.type === 'STANDARD' ? 'STANDARD' : 'BACKGROUND'}
                  </span>
                </div>
              </div>
              {service.description && (
                <p className="text-white/50 text-sm mt-2 max-w-2xl leading-relaxed">{service.description}</p>
              )}
              <div className="flex items-center gap-4 mt-4 text-xs text-white/40 flex-wrap">
                <code className="px-2 py-0.5 bg-white/5 rounded-md font-mono text-white/50">{service.name}</code>
                <span>{t('serviceDetail.hero.registeredBy', { name: service.registeredBy })}</span>
                <span>{service.registeredByDept}</span>
                <span>{formatDate(service.createdAt)}</span>
                {service.deployScope && (
                  <span className="inline-flex items-center gap-1">
                    {service.deployScope === 'ALL' ? <Globe className="w-3 h-3" /> :
                     service.deployScope === 'BUSINESS_UNIT' ? <Building2 className="w-3 h-3" /> :
                     <Lock className="w-3 h-3" />}
                    {service.deployScope}
                    {service.deployScopeValue?.length ? ` · ${resolveAll(service.deployScopeValue).join(', ')}` : ''}
                  </span>
                )}
              </div>
              {(() => {
                const parts = [
                  service.center1Name && service.center1Name !== 'none' ? service.center1Name : '',
                  service.center2Name && service.center2Name !== 'none' ? service.center2Name : '',
                  service.team || '',
                ].filter(Boolean);
                if (parts.length === 0) return null;
                return (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-white/30">
                    {parts.map((p, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-white/20">&rsaquo;</span>}
                        <span className={i === parts.length - 1 ? 'text-white/50 font-medium' : ''}>{p}</span>
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ Tab Navigation ═══════ */}
      <div className="flex items-center gap-1 bg-gray-100/80 rounded-xl p-1 mb-6">
        {TABS.filter(tab => (tab.id !== 'models' || !service?.apiOnly)).map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              data-tour={`svc-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      {/* ═══════ Tab Content ═══════ */}
      <div className="min-h-[50vh]">
        {activeTab === 'dashboard' && <DashboardTab serviceId={serviceId!} adminRole={adminRole} />}
        {activeTab === 'members' && <MembersTab serviceId={serviceId!} />}
        {activeTab === 'ratelimit' && <RateLimitTab serviceId={serviceId!} />}
        {activeTab === 'models' && <ModelsTab serviceId={serviceId!} />}
        {activeTab === 'errors' && <ServiceErrorsTab serviceId={serviceId!} />}
        {activeTab === 'testaccounts' && <TestAccountsTab serviceId={serviceId!} />}
      </div>

      {showDetailGuide && (
        <ServiceDetailGuide
          onClose={() => setShowDetailGuide(false)}
          serviceName={service?.name}
          userId={user?.loginid}
          deptName={user?.deptname}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════
// TAB 1: Dashboard
// ════════════════════════════════════════════

function DashboardTab({ serviceId, adminRole }: { serviceId: string; adminRole: AdminRole }) {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [serviceStats, setServiceStats] = useState<{ avgDailyActiveUsers: number; avgDailyActiveUsersExcluding: number } | null>(null);
  const [serviceMauData, setServiceMauData] = useState<{
    latestMau: number; prevMau: number; isEstimated: boolean;
    latestMonth?: string;
    totalCalls?: number;
    callsPerPersonPerDay?: number;
    callsPerPersonPerMonth?: number;
    businessDays?: number;
    isFixed?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // /admin/stats/* 경로는 인증 사용자 누구나 접근 가능
        const [ovRes, glRes, mauRes] = await Promise.all([
          statsApi.overview(serviceId),
          statsApi.globalOverview(),
          statsApi.globalMauByService(3).catch(() => ({ data: { services: [], monthlyData: [], estimationMeta: null } })),
        ]);
        setOverview(ovRes.data);
        const svc = glRes.data.services?.find((s: { serviceId: string }) => s.serviceId === serviceId);
        if (svc) setServiceStats(svc);

        // Extract MAU for this service
        const mauMonthly = mauRes.data.monthlyData || [];
        const mauSvcs = mauRes.data.services || [];
        const thisSvc = mauSvcs.find((s: { id: string }) => s.id === serviceId);
        if (thisSvc && mauMonthly.length > 0) {
          const latestMau = (mauMonthly[mauMonthly.length - 1]?.[serviceId] as number) || 0;
          const prevMau = mauMonthly.length > 1 ? (mauMonthly[mauMonthly.length - 2]?.[serviceId] as number) || 0 : 0;
          const meta = mauRes.data.estimationMeta;
          const latestMonthKey = mauMonthly[mauMonthly.length - 1]?.month as string | undefined;
          const baseline = latestMonthKey ? meta?.monthlyBaseline?.[latestMonthKey] : null;
          const bgDetail = latestMonthKey ? meta?.backgroundMonthlyDetail?.[`${serviceId}|${latestMonthKey}`] : null;
          setServiceMauData({
            latestMau,
            prevMau,
            isEstimated: thisSvc.type === 'BACKGROUND',
            latestMonth: latestMonthKey,
            totalCalls: bgDetail?.totalCalls,
            callsPerPersonPerDay: baseline?.callsPerPersonPerDay,
            callsPerPersonPerMonth: baseline?.callsPerPersonPerMonth,
            businessDays: baseline?.businessDays,
            isFixed: baseline?.isFixed,
          });
        }
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [serviceId]);

  if (loading) return <TabSkeleton />;

  const todayTokens = (overview?.todayUsage?.inputTokens || 0) + (overview?.todayUsage?.outputTokens || 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          { label: t('serviceDetail.dashboard.activeUsers'), value: overview?.activeUsers || 0, icon: Activity, color: 'emerald', desc: t('serviceDetail.dashboard.last30min') },
          { label: t('serviceDetail.dashboard.totalUsers'), value: overview?.totalUsers || 0, icon: Users, color: 'blue', desc: t('serviceDetail.dashboard.registeredUsers') },
          { label: t('serviceDetail.dashboard.dailyAvgDAU'), value: serviceStats?.avgDailyActiveUsersExcluding || 0, icon: TrendingUp, color: 'orange', desc: t('serviceDetail.dashboard.businessDay1Month') },
          { label: serviceMauData?.isEstimated ? t('serviceDetail.dashboard.estimatedMAU') : t('serviceDetail.dashboard.mau'), value: serviceMauData?.latestMau || 0, icon: CalendarDays, color: 'indigo', desc: serviceMauData?.isEstimated ? t('serviceDetail.dashboard.estimatedRecentMonth') : t('serviceDetail.dashboard.recentMonth') },
          { label: t('serviceDetail.dashboard.todayRequests'), value: overview?.todayUsage?.requests || 0, icon: Zap, color: 'amber', desc: t('serviceDetail.dashboard.apiCallCount') },
          { label: t('serviceDetail.dashboard.todayTokens'), value: todayTokens, icon: Hash, color: 'violet', desc: t('serviceDetail.dashboard.inputPlusOutput') },
        ].map((s, i) => (
          <StatCard key={s.label} {...s} delay={i * 60} />
        ))}
      </div>
      {/* ── Estimation detail for BACKGROUND ── */}
      {serviceMauData?.isEstimated && (
        <div className="flex items-start gap-3 px-5 py-3 rounded-xl bg-amber-50 border border-amber-100">
          <CalendarDays className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-700">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('serviceDetail.dashboard.estimatedDAUMAU')}</span>
              <span className="mx-0.5">—</span>
              <span>{t('serviceDetail.dashboard.estimatedDAUMAUDesc')}</span>
              {serviceMauData.latestMonth && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${serviceMauData.isFixed ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                  {serviceMauData.isFixed ? t('serviceDetail.dashboard.confirmed') : t('serviceDetail.dashboard.realtime')}
                </span>
              )}
            </div>
            {(serviceMauData.callsPerPersonPerDay != null || serviceMauData.totalCalls != null) && (
              <div className="mt-2 space-y-1 text-xs text-amber-600">
                {serviceMauData.latestMonth && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-amber-400">{t('serviceDetail.dashboard.baseMonth')}</span>
                    <strong>{serviceMauData.latestMonth}</strong>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  {serviceMauData.callsPerPersonPerDay != null && (
                    <span>{t('serviceDetail.dashboard.avgPerPersonPerDay')} <strong>{t('serviceDetail.dashboard.avgPerPersonPerDayValue', { count: serviceMauData.callsPerPersonPerDay })}</strong></span>
                  )}
                  {serviceMauData.callsPerPersonPerMonth != null && (
                    <span>{t('serviceDetail.dashboard.avgPerPersonPerMonth')} <strong>{t('serviceDetail.dashboard.avgPerPersonPerMonthValue', { count: serviceMauData.callsPerPersonPerMonth })}</strong></span>
                  )}
                  {serviceMauData.businessDays != null && (
                    <span>{t('serviceDetail.dashboard.businessDays')} <strong>{t('serviceDetail.dashboard.businessDaysValue', { count: serviceMauData.businessDays })}</strong></span>
                  )}
                </div>
                {serviceMauData.totalCalls != null && serviceMauData.callsPerPersonPerMonth != null && (
                  <div className="pt-1 border-t border-amber-200/50 text-amber-500">
                    {t('serviceDetail.dashboard.monthCalls')} <strong className="text-amber-600">{t('serviceDetail.dashboard.monthCallsValue', { count: serviceMauData.totalCalls.toLocaleString() })}</strong>
                    {' '}&divide; {t('serviceDetail.dashboard.perPersonMonthAvg')} <strong className="text-amber-600">{t('serviceDetail.dashboard.perPersonMonthAvgValue', { count: serviceMauData.callsPerPersonPerMonth })}</strong>
                    {' '}= {t('serviceDetail.dashboard.estimatedMAUResult')} <strong className="text-amber-600">{t('serviceDetail.dashboard.estimatedMAUResultValue', { count: serviceMauData.latestMau })}</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Active users pulse ── */}
      {(overview?.activeUsers || 0) > 0 && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-emerald-50 border border-emerald-100">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-emerald-700">
            {t('serviceDetail.dashboard.currentlyUsingPrefix')}<span className="font-bold text-emerald-900">{t('serviceDetail.dashboard.currentlyUsingCount', { count: overview?.activeUsers })}</span>{t('serviceDetail.dashboard.currentlyUsingSuffix')}
          </span>
        </div>
      )}

      {/* ── Token Donut ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <div className="p-2 rounded-lg bg-violet-50"><Hash className="w-4 h-4 text-violet-600" /></div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{t('serviceDetail.dashboard.todayTokenUsage')}</h3>
            <p className="text-xs text-gray-400">{t('serviceDetail.dashboard.tokenRatio')}</p>
          </div>
        </div>
        <div className="p-6">
          <TokenDonut
            input={overview?.todayUsage?.inputTokens || 0}
            output={overview?.todayUsage?.outputTokens || 0}
          />
        </div>
      </div>

      {/* ── Toggle ── */}
      <div className="flex justify-end">
        <BusinessDayToggle />
      </div>

      {/* ── Charts Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-2"><UserStatsChart serviceId={serviceId} /></div>
        <ModelUsageChart serviceId={serviceId} />
        <ModelRatingChart serviceId={serviceId} />
        <div className="lg:col-span-2"><UsersByModelChart serviceId={serviceId} /></div>
      </div>

      {/* ── Usage Analytics ── */}
      {adminRole && <UsageAnalytics serviceId={serviceId} />}
    </div>
  );
}

// ── Stat Card ──
function StatCard({ label, value, icon: Icon, color, desc, delay }: {
  label: string; value: number; icon: typeof Activity; color: string; desc: string; delay: number;
}) {
  const colorMap: Record<string, { bg: string; text: string; ring: string }> = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
    orange: { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', ring: 'ring-indigo-100' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <div
      className="group relative overflow-hidden rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-all duration-500 hover:-translate-y-0.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
            <p className="text-2xl lg:text-3xl font-bold text-gray-900 mt-1 tracking-tight">
              <AnimatedStat value={value} />
            </p>
            <p className="text-[11px] text-gray-400 mt-1">{desc}</p>
          </div>
          <div className={`p-2.5 rounded-xl ${c.bg} ring-1 ${c.ring}`}>
            <Icon className={`w-5 h-5 ${c.text}`} />
          </div>
        </div>
      </div>
      <div className={`h-1 ${c.bg} opacity-60`} />
    </div>
  );
}

// ── Token Donut ──
function TokenDonut({ input, output }: { input: number; output: number }) {
  const { t } = useTranslation();
  const total = input + output;
  const data = [
    { name: t('serviceDetail.dashboard.inputTokens'), value: input, color: TOKEN_COLORS[0] },
    { name: t('serviceDetail.dashboard.outputTokens'), value: output, color: TOKEN_COLORS[1] },
  ];
  if (total === 0) {
    return <div className="flex items-center justify-center h-44 text-gray-400 text-sm">{t('serviceDetail.dashboard.noTokenData')}</div>;
  }
  return (
    <div className="flex items-center gap-8">
      <div className="relative w-44 h-44 flex-shrink-0">
        <ResponsiveContainer><PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={52} outerRadius={72} paddingAngle={4} dataKey="value" strokeWidth={0}>
            {data.map((e, i) => <Cell key={i} fill={e.color} />)}
          </Pie>
          <RTooltip formatter={(v: number) => formatTokens(v)}
            contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
        </PieChart></ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-400">{t('serviceDetail.dashboard.totalTokens')}</span>
          <span className="text-lg font-bold text-gray-900">{formatTokens(total)}</span>
        </div>
      </div>
      <div className="space-y-3 flex-1">
        {data.map(item => (
          <div key={item.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-sm text-gray-600">{item.name}</span>
            </div>
            <div>
              <span className="text-sm font-semibold text-gray-900">{formatTokens(item.value)}</span>
              <span className="text-xs text-gray-400 ml-1.5">({((item.value / total) * 100).toFixed(1)}%)</span>
            </div>
          </div>
        ))}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{t('serviceDetail.dashboard.sum')}</span>
          <span className="text-sm font-bold text-gray-900">{formatTokens(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// TAB 2: Members
// ════════════════════════════════════════════

function MembersTab({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<ServiceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await serviceApi.listMembers(serviceId);
      setMembers(res.data.members || []);
    } catch { /* */ } finally { setLoading(false); }
  }, [serviceId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const memberIds = new Set(members.map(m => m.user.id));

  const handleSearch = (q: string) => {
    setUserSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await serviceApi.searchUsers(q);
        setSearchResults(res.data.users || []);
      } catch { /* */ } finally { setSearchLoading(false); }
    }, 300);
  };

  const addMember = async (userId: string) => {
    setActionLoading(true);
    try {
      await serviceApi.addMember(serviceId, userId);
      setUserSearch(''); setSearchResults([]);
      await loadMembers();
    } catch { /* */ } finally { setActionLoading(false); }
  };

  const changeRole = async (userId: string, role: string) => {
    setActionLoading(true);
    try {
      await serviceApi.updateMemberRole(serviceId, userId, role);
      await loadMembers();
    } catch { /* */ } finally { setActionLoading(false); }
  };

  const removeMember = async (userId: string) => {
    if (!confirm(t('serviceDetail.members.confirmRemove'))) return;
    setActionLoading(true);
    try {
      await serviceApi.removeMember(serviceId, userId);
      await loadMembers();
    } catch { /* */ } finally { setActionLoading(false); }
  };

  if (loading) return <TabSkeleton />;

  const owners = members.filter(m => m.role === 'OWNER');
  const admins = members.filter(m => m.role === 'ADMIN');
  const users = members.filter(m => m.role === 'USER');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t('serviceDetail.members.owners'), count: owners.length, icon: Crown, bg: 'bg-amber-50', text: 'text-amber-500' },
          { label: t('serviceDetail.members.admins'), count: admins.length, icon: Shield, bg: 'bg-blue-50', text: 'text-blue-500' },
          { label: t('serviceDetail.members.users'), count: users.length, icon: User, bg: 'bg-gray-50', text: 'text-gray-500' },
        ].map(g => (
          <div key={g.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{g.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{g.count}</p>
              </div>
              <div className={`p-2.5 rounded-xl ${g.bg}`}>
                <g.icon className={`w-5 h-5 ${g.text}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Add */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-blue-500" />
          {t('serviceDetail.members.addMember')}
        </h3>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={userSearch}
            onChange={e => handleSearch(e.target.value)}
            placeholder={t('serviceDetail.members.searchPlaceholder')}
            className="w-full pl-10 pr-10 py-3 text-sm bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:bg-white transition-all"
          />
          {searchLoading && <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
        </div>

        {searchResults.length > 0 && (
          <div className="mt-2 border border-gray-200 rounded-xl bg-white shadow-sm max-h-48 overflow-y-auto divide-y divide-gray-50">
            {searchResults.map(u => {
              const already = memberIds.has(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => !already && addMember(u.loginid)}
                  disabled={already || actionLoading}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                    already ? 'text-gray-400 bg-gray-50 cursor-not-allowed' : 'hover:bg-blue-50/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                      <span className="text-xs font-medium text-gray-600">{u.username.charAt(0)}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-900">{u.username}</span>
                      <span className="text-gray-400 ml-1.5 text-xs">{u.loginid}</span>
                      <p className="text-xs text-gray-400">{u.deptname}</p>
                    </div>
                  </div>
                  {already ? (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t('serviceDetail.members.alreadyMember')}</span>
                  ) : (
                    <UserPlus className="w-4 h-4 text-blue-500" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Member Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-500" />
            {t('serviceDetail.members.memberList')}
            <span className="text-xs font-normal text-gray-400">{t('serviceDetail.members.memberCount', { count: members.length })}</span>
          </h3>
        </div>
        {members.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium">{t('serviceDetail.members.noMembers')}</p>
            <p className="text-xs mt-1">{t('serviceDetail.members.noMembersHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {members.map(member => (
              <div key={member.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-gray-600">{member.user.username.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{member.user.username}</span>
                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-semibold rounded-full ${roleBadgeClass(member.role)}`}>
                      {roleIcon(member.role)}{t(ROLE_I18N_KEYS[member.role] || 'serviceDetail.roles.user')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{member.user.loginid} · {member.user.deptname}</p>
                </div>
                {member.role !== 'OWNER' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="relative">
                      <select
                        value={member.role}
                        onChange={e => changeRole(member.userId, e.target.value)}
                        disabled={actionLoading}
                        className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none pr-7 cursor-pointer"
                      >
                        <option value="ADMIN">{t('serviceDetail.roles.serviceAdmin')}</option>
                        <option value="USER">{t('serviceDetail.roles.user')}</option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    </div>
                    <button
                      onClick={() => removeMember(member.userId)}
                      disabled={actionLoading}
                      className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      title={t('serviceDetail.members.removeMember')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// TAB 3: Rate Limit
// ════════════════════════════════════════════

function RateLimitTab({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation();
  const [commonRL, setCommonRL] = useState<CommonRateLimit | null>(null);
  const [userRLs, setUserRLs] = useState<UserRateLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rlForm, setRlForm] = useState({ maxTokens: '100000', window: 'DAY' as 'FIVE_HOURS' | 'DAY' });
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ maxTokens: '', window: 'DAY' as 'FIVE_HOURS' | 'DAY' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, uRes] = await Promise.all([
        serviceRateLimitScopedApi.getCommon(serviceId),
        serviceRateLimitScopedApi.list(serviceId),
      ]);
      setCommonRL(cRes.data.rateLimit || null);
      setUserRLs(uRes.data.rateLimits || []);
    } catch { /* */ } finally { setLoading(false); }
  }, [serviceId]);

  useEffect(() => { loadData(); }, [loadData]);

  const saveCommon = async () => {
    const tokens = parseInt(rlForm.maxTokens);
    if (!tokens || tokens < 1) return;
    setSaving(true);
    try {
      await serviceRateLimitScopedApi.setCommon(serviceId, { maxTokens: tokens, window: rlForm.window });
      await loadData();
    } catch { /* */ } finally { setSaving(false); }
  };

  const removeCommon = async () => {
    setSaving(true);
    try {
      await serviceRateLimitScopedApi.removeCommon(serviceId);
      setCommonRL(null);
      await loadData();
    } catch { /* */ } finally { setSaving(false); }
  };

  const saveUserRL = async (userId: string) => {
    const tokens = parseInt(editForm.maxTokens);
    if (!tokens || tokens < 1) return;
    setSaving(true);
    try {
      await serviceRateLimitScopedApi.setUser(serviceId, userId, { maxTokens: tokens, window: editForm.window });
      setEditUserId(null);
      await loadData();
    } catch { /* */ } finally { setSaving(false); }
  };

  const removeUserRL = async (userId: string) => {
    setSaving(true);
    try {
      await serviceRateLimitScopedApi.removeUser(serviceId, userId);
      await loadData();
    } catch { /* */ } finally { setSaving(false); }
  };

  if (loading) return <TabSkeleton />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Common Rate Limit */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-blue-500" />
            {t('serviceDetail.rateLimit.commonRateLimit')}
          </h3>
          <p className="text-xs text-gray-400 mt-1">{t('serviceDetail.rateLimit.commonRateLimitDesc')}</p>
        </div>
        <div className="p-6">
          {commonRL && (
            <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl px-5 py-4 mb-5 ring-1 ring-blue-100">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100"><Gauge className="w-4 h-4 text-blue-600" /></div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{t('serviceDetail.rateLimit.tokens', { count: formatTokens(commonRL.maxTokens) })}</p>
                  <p className="text-xs text-gray-500">/ {commonRL.window === 'FIVE_HOURS' ? t('serviceDetail.rateLimit.fiveHours') : t('serviceDetail.rateLimit.twentyFourHours')}</p>
                </div>
              </div>
              <button onClick={removeCommon} disabled={saving}
                className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
                {t('common.remove')}
              </button>
            </div>
          )}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('serviceDetail.rateLimit.maxTokens')}</label>
              <input type="number" value={rlForm.maxTokens} onChange={e => setRlForm({ ...rlForm, maxTokens: e.target.value })}
                min={1} className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors" />
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('serviceDetail.rateLimit.period')}</label>
              <div className="relative">
                <select value={rlForm.window} onChange={e => setRlForm({ ...rlForm, window: e.target.value as 'FIVE_HOURS' | 'DAY' })}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none pr-8 transition-colors">
                  <option value="FIVE_HOURS">{t('serviceDetail.rateLimit.fiveHours')}</option>
                  <option value="DAY">{t('serviceDetail.rateLimit.twentyFourHours')}</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <button onClick={saveCommon} disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.save')}
            </button>
          </div>
        </div>
      </div>

      {/* Per-user Rate Limits */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-500" />
            {t('serviceDetail.rateLimit.perUserRateLimit')}
            <span className="text-xs font-normal text-gray-400">{t('serviceDetail.rateLimit.perUserCount', { count: userRLs.length })}</span>
          </h3>
          <p className="text-xs text-gray-400 mt-1">{t('serviceDetail.rateLimit.perUserRateLimitDesc')}</p>
        </div>
        {userRLs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Gauge className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium">{t('serviceDetail.rateLimit.noUserRateLimit')}</p>
            <p className="text-xs mt-1">{t('serviceDetail.rateLimit.noUserRateLimitHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {userRLs.map(rl => (
              <div key={rl.userId} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-medium text-gray-600">{rl.user.username.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900">{rl.user.username}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{rl.user.loginid}</span>
                </div>
                {editUserId === rl.userId ? (
                  <div className="flex items-center gap-2">
                    <input type="number" value={editForm.maxTokens} onChange={e => setEditForm({ ...editForm, maxTokens: e.target.value })}
                      className="w-28 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    <select value={editForm.window} onChange={e => setEditForm({ ...editForm, window: e.target.value as 'FIVE_HOURS' | 'DAY' })}
                      className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                      <option value="FIVE_HOURS">5h</option>
                      <option value="DAY">24h</option>
                    </select>
                    <button onClick={() => saveUserRL(rl.userId)} disabled={saving}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{t('common.save')}</button>
                    <button onClick={() => setEditUserId(null)} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-sm font-semibold text-gray-900">{formatTokens(rl.maxTokens)}</span>
                      <span className="text-xs text-gray-400 ml-1">/ {rl.window === 'FIVE_HOURS' ? '5h' : '24h'}</span>
                    </div>
                    <button onClick={() => { setEditUserId(rl.userId); setEditForm({ maxTokens: String(rl.maxTokens), window: rl.window }); }}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeUserRL(rl.userId)} disabled={saving}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// TAB 4: Models
// ════════════════════════════════════════════

function ModelsTab({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation();
  const [, setService] = useState<{ name: string; displayName: string; type: string; status: string } | null>(null);
  const [serviceModels, setServiceModels] = useState<ServiceModelItem[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newAliasName, setNewAliasName] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [addingToAlias, setAddingToAlias] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [addWeight, setAddWeight] = useState(1);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [editAliasValue, setEditAliasValue] = useState('');
  // Copy models state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [myServices, setMyServices] = useState<{ id: string; name: string; displayName: string }[]>([]);
  const [copySourceId, setCopySourceId] = useState('');
  const [copyMode, setCopyMode] = useState<'merge' | 'replace'>('merge');
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<{ message: string; copied: number; skipped: number } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, mRes, aRes] = await Promise.all([
        api.get(`/services/${serviceId}`),
        api.get(`/services/${serviceId}/models`),
        api.get(`/services/${serviceId}/available-models`),
      ]);
      setService(sRes.data.service);
      setServiceModels(mRes.data.serviceModels || []);
      setAvailableModels(aRes.data.models || []);
    } catch { /* */ } finally { setLoading(false); }
  }, [serviceId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Alias groups
  const aliasGroups: { aliasName: string; items: ServiceModelItem[] }[] = [];
  const aMap = new Map<string, ServiceModelItem[]>();
  serviceModels.forEach(sm => {
    if (!aMap.has(sm.aliasName)) aMap.set(sm.aliasName, []);
    aMap.get(sm.aliasName)!.push(sm);
  });
  aMap.forEach((items, aliasName) => aliasGroups.push({ aliasName, items: items.sort((a, b) => a.sortOrder - b.sortOrder) }));

  const getGroupedAvailable = (alias: string) => {
    const used = new Set(serviceModels.filter(sm => sm.aliasName === alias).map(sm => sm.modelId));
    const filtered = availableModels.filter(m => m.enabled && !used.has(m.id));
    const groups: { type: string; label: string; models: AvailableModel[] }[] = [];
    const typeOrder = ['CHAT', 'IMAGE', 'EMBEDDING', 'RERANKING', 'ASR'];
    for (const tp of typeOrder) {
      const models = filtered.filter(m => m.type === tp);
      if (models.length > 0) groups.push({ type: tp, label: MODEL_TYPE_I18N_KEYS[tp] ? t(MODEL_TYPE_I18N_KEYS[tp]) : tp, models });
    }
    const knownTypes = new Set(typeOrder);
    const others = filtered.filter(m => !knownTypes.has(m.type));
    if (others.length > 0) groups.push({ type: 'OTHER', label: t('serviceDetail.modelTypes.other'), models: others });
    return groups;
  };

  const addModel = async (alias: string) => {
    if (!selectedModelId) return;
    setSaving(true);
    try {
      await api.post(`/services/${serviceId}/models`, { modelId: selectedModelId, aliasName: alias, weight: addWeight, sortOrder: serviceModels.filter(sm => sm.aliasName === alias).length });
      setSelectedModelId(''); setAddWeight(1);
      await loadData();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('serviceDetail.models.failed'));
    } finally { setSaving(false); }
  };

  const removeModel = async (sm: ServiceModelItem) => {
    if (!confirm(t('serviceDetail.models.confirmRemoveModel', { name: sm.model.displayName }))) return;
    setSaving(true);
    try { await api.delete(`/services/${serviceId}/service-models/${sm.id}`); await loadData(); } catch { /* */ } finally { setSaving(false); }
  };

  const toggleEnabled = async (sm: ServiceModelItem) => {
    setSaving(true);
    try { await api.put(`/services/${serviceId}/models/${sm.id}`, { enabled: !sm.enabled }); await loadData(); } catch { /* */ } finally { setSaving(false); }
  };

  const changeWeight = async (sm: ServiceModelItem, w: number) => {
    const clamped = Math.max(1, Math.min(10, w));
    setSaving(true);
    try { await api.put(`/services/${serviceId}/models/${sm.id}`, { weight: clamped }); await loadData(); } catch { /* */ } finally { setSaving(false); }
  };

  const deleteGroup = async (alias: string) => {
    const items = serviceModels.filter(sm => sm.aliasName === alias);
    if (!confirm(t('serviceDetail.models.confirmDeleteGroup', { alias, count: items.length }))) return;
    setSaving(true);
    try { for (const sm of items) await api.delete(`/services/${serviceId}/service-models/${sm.id}`); await loadData(); } catch { /* */ } finally { setSaving(false); }
  };

  const renameAlias = async (old: string) => {
    const nv = editAliasValue.trim();
    if (!nv || nv === old) { setEditingAlias(null); return; }
    setSaving(true);
    try {
      const items = serviceModels.filter(sm => sm.aliasName === old);
      for (const sm of items) {
        await api.delete(`/services/${serviceId}/service-models/${sm.id}`);
        await api.post(`/services/${serviceId}/models`, { modelId: sm.modelId, aliasName: nv, weight: sm.weight, sortOrder: sm.sortOrder, enabled: sm.enabled });
      }
      setEditingAlias(null); await loadData();
    } catch (err: unknown) { alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('serviceDetail.models.failed')); } finally { setSaving(false); }
  };

  const openCopyModal = async () => {
    setShowCopyModal(true);
    setCopySourceId('');
    setCopyMode('merge');
    setCopyResult(null);
    try {
      const res = await serviceApi.listMy(true);
      const services = (res.data.services || []).filter((s: { id: string }) => s.id !== serviceId);
      setMyServices(services);
    } catch { setMyServices([]); }
  };

  const handleCopy = async () => {
    if (!copySourceId) return;
    setCopying(true);
    setCopyResult(null);
    try {
      const res = await serviceApi.copyModels(serviceId, copySourceId, copyMode);
      setCopyResult(res.data);
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || t('serviceDetail.models.copyModelsFailed'));
    } finally {
      setCopying(false);
    }
  };

  if (loading) return <TabSkeleton />;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Info banner + Copy button */}
      <div className="flex items-start gap-3">
        <div className="flex-1 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl px-5 py-4">
          <p className="text-sm text-blue-800 font-medium">{t('serviceDetail.models.virtualModelConfig')}</p>
          <p className="text-xs text-blue-600 mt-1 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: t('serviceDetail.models.virtualModelDesc').replace(/<1>/g, '<strong>').replace(/<\/1>/g, '</strong>').replace(/<3>/g, '<strong>').replace(/<\/3>/g, '</strong>') }}
          />
        </div>
        <button
          onClick={openCopyModal}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
          title={t('serviceDetail.models.copyConfigTooltip')}
        >
          <Copy className="w-3.5 h-3.5" />
          {t('serviceDetail.models.copyConfig')}
        </button>
      </div>

      {/* Copy Modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCopyModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Copy className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-semibold text-gray-900">{t('serviceDetail.models.copyFromOtherService')}</h3>
              </div>
              <button onClick={() => setShowCopyModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Source selection */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('serviceDetail.models.selectSourceService')}</label>
                <select
                  value={copySourceId}
                  onChange={e => { setCopySourceId(e.target.value); setCopyResult(null); }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                >
                  <option value="">{t('serviceDetail.models.selectServicePlaceholder')}</option>
                  {myServices.map(s => (
                    <option key={s.id} value={s.id}>{s.displayName} ({s.name})</option>
                  ))}
                </select>
                {myServices.length === 0 && (
                  <p className="text-[11px] text-gray-400 mt-1">{t('serviceDetail.models.noOtherServices')}</p>
                )}
              </div>

              {/* Mode selection */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('serviceDetail.models.copyMode')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setCopyMode('merge'); setCopyResult(null); }}
                    className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      copyMode === 'merge'
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-semibold">{t('serviceDetail.models.merge')}</div>
                    <div className="text-[10px] mt-0.5 opacity-70">{t('serviceDetail.models.mergeDesc')}</div>
                  </button>
                  <button
                    onClick={() => { setCopyMode('replace'); setCopyResult(null); }}
                    className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      copyMode === 'replace'
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-semibold">{t('serviceDetail.models.overwrite')}</div>
                    <div className="text-[10px] mt-0.5 opacity-70">{t('serviceDetail.models.overwriteDesc')}</div>
                  </button>
                </div>
                {copyMode === 'replace' && (
                  <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {t('serviceDetail.models.overwriteWarning')}
                  </p>
                )}
              </div>

              {/* Result */}
              {copyResult && (
                <div className={`px-3 py-2.5 rounded-lg text-xs ${copyResult.copied > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                  <p className="font-medium">{copyResult.message}</p>
                  {copyResult.skipped > 0 && (
                    <p className="mt-1 text-[11px] opacity-70">{t('serviceDetail.models.skipped', { count: copyResult.skipped })}</p>
                  )}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowCopyModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {copyResult ? t('common.close') : t('common.cancel')}
              </button>
              {!copyResult && (
                <button
                  onClick={handleCopy}
                  disabled={!copySourceId || copying}
                  className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    copyMode === 'replace' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Copy className="w-3 h-3" />}
                  {copyMode === 'replace' ? t('serviceDetail.models.overwrite') : t('common.copy')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Alias Groups */}
      {aliasGroups.map((group, gi) => {
        const totalW = group.items.filter(sm => sm.enabled).reduce((s, sm) => s + sm.weight, 0);
        const enabledN = group.items.filter(sm => sm.enabled).length;
        const colorCls = GROUP_COLORS[gi % GROUP_COLORS.length];
        const isEditing = editingAlias === group.aliasName;
        return (
          <div key={group.aliasName} className={`bg-white border border-gray-200 rounded-xl overflow-hidden border-l-4 ${colorCls}`}>
            {/* Group header */}
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
              <Zap className="w-4 h-4 text-blue-500 flex-shrink-0" />
              {isEditing ? (
                <div className="flex items-center gap-2 flex-1">
                  <input type="text" value={editAliasValue} onChange={e => setEditAliasValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && renameAlias(group.aliasName)}
                    className="px-2 py-1 text-sm font-semibold border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 flex-1" autoFocus />
                  <button onClick={() => renameAlias(group.aliasName)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditingAlias(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-semibold text-gray-900">{group.aliasName}</code>
                      <button onClick={() => { setEditingAlias(group.aliasName); setEditAliasValue(group.aliasName); }}
                        className="p-0.5 text-gray-300 hover:text-gray-500"><Edit2 className="w-3 h-3" /></button>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {t('serviceDetail.models.modelCount', { count: group.items.length })}{enabledN > 1 ? ` · ${t('serviceDetail.models.roundRobin', { count: totalW })}` : ''}
                      {group.items[0]?.fallbackModel && (
                        <span className="ml-1.5 text-amber-600">· {t('serviceDetail.models.fallback', { name: group.items[0].fallbackModel.displayName })}</span>
                      )}
                    </p>
                  </div>
                  {/* Fallback model dropdown */}
                  <select
                    value={group.items[0]?.fallbackModelId || ''}
                    onChange={async (e) => {
                      const val = e.target.value || null;
                      try {
                        setSaving(true);
                        await api.put(`/services/${serviceId}/models/fallback`, { aliasName: group.aliasName, fallbackModelId: val });
                        await loadData();
                      } catch (err) {
                        console.error('Failed to set fallback:', err);
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-600 max-w-[150px] truncate focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    title={t('serviceDetail.models.fallbackTooltip')}
                  >
                    <option value="">{t('serviceDetail.models.noFallback')}</option>
                    {availableModels.filter(m => m.enabled).map(m => (
                      <option key={m.id} value={m.id}>{m.displayName}</option>
                    ))}
                  </select>
                  {/* Retry count */}
                  <div className="flex items-center gap-1" title={t('serviceDetail.models.retryLabel')}>
                    <span className="text-[10px] text-gray-400">{t('serviceDetail.models.retryLabel')}</span>
                    <select
                      value={group.items[0]?.maxRetries ?? 0}
                      onChange={async (e) => {
                        try {
                          setSaving(true);
                          await api.put(`/services/${serviceId}/models/max-retries`, { aliasName: group.aliasName, maxRetries: parseInt(e.target.value) });
                          await loadData();
                        } catch (err) {
                          console.error('Failed to set max retries:', err);
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                      className="w-12 px-1 py-1.5 text-xs text-center border border-gray-200 rounded-lg bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      {[0, 1, 2, 3, 5, 10].map(n => (
                        <option key={n} value={n}>{t('serviceDetail.models.retryCount', { count: n })}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => setAddingToAlias(addingToAlias === group.aliasName ? null : group.aliasName)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100">
                    <Plus className="w-3 h-3" />{t('serviceDetail.models.addModel')}
                  </button>
                  <button onClick={() => deleteGroup(group.aliasName)} disabled={saving}
                    className="p-1.5 text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </>
              )}
            </div>

            {/* Add model form */}
            {addingToAlias === group.aliasName && (
              <div className="px-5 py-3 border-b border-gray-100 bg-blue-50/30">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">{t('serviceDetail.models.selectModelByType')}</label>
                    <select value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none">
                      <option value="">{t('serviceDetail.models.selectModelPlaceholder')}</option>
                      {getGroupedAvailable(group.aliasName).map(g => (
                        <optgroup key={g.type} label={`── ${g.label} (${g.models.length}) ──`}>
                          {g.models.map(m => <option key={m.id} value={m.id}>{m.displayName} ({m.name})</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">{t('serviceDetail.models.weight')}</label>
                    <input type="number" min={1} max={10} value={addWeight} onChange={e => setAddWeight(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      className="w-full px-2 py-1.5 text-xs text-center border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  </div>
                  <button onClick={() => addModel(group.aliasName)} disabled={!selectedModelId || saving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}{t('common.add')}
                  </button>
                  <button onClick={() => { setAddingToAlias(null); setSelectedModelId(''); }} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )}

            {/* Models in group */}
            {group.items.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-400">{t('serviceDetail.models.addModelPlaceholder')}</div>
            ) : (
              <div>
                {group.items.map(sm => {
                  const TypeIcon = MODEL_TYPE_ICONS[sm.model.type] || Cpu;
                  const bad = !sm.accessible;
                  return (
                    <div key={sm.id} className={`flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-b-0 transition-colors ${bad ? 'bg-red-50/60' : !sm.enabled ? 'opacity-50 bg-gray-50/50' : 'hover:bg-gray-50/50'}`}>
                      <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ${
                        bad ? 'bg-red-100 text-red-500' :
                        sm.model.type === 'CHAT' ? 'bg-blue-100 text-blue-600' :
                        sm.model.type === 'IMAGE' ? 'bg-purple-100 text-purple-600' :
                        sm.model.type === 'EMBEDDING' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {bad ? <AlertTriangle className="w-3.5 h-3.5" /> : <TypeIcon className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium truncate ${bad ? 'text-red-700 line-through' : 'text-gray-900'}`}>{sm.model.displayName}</p>
                          {bad && <span className="text-[10px] font-medium bg-red-100 text-red-600 px-1.5 py-0.5 rounded">{t('serviceDetail.models.notAccessible')}</span>}
                          {group.items.length > 1 && sm.enabled && !bad && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                              <Zap className="w-2.5 h-2.5" />RR
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono truncate">{sm.model.name}</p>
                      </div>
                      {!bad && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => changeWeight(sm, sm.weight - 1)} disabled={sm.weight <= 1 || saving}
                            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-xs font-bold">-</button>
                          <div className="w-14 text-center"><span className="text-xs font-semibold text-gray-700">{sm.weight}</span><span className="text-[10px] text-gray-400 ml-0.5">x</span></div>
                          <button onClick={() => changeWeight(sm, sm.weight + 1)} disabled={sm.weight >= 10 || saving}
                            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-xs font-bold">+</button>
                        </div>
                      )}
                      {!bad && (
                        <button onClick={() => toggleEnabled(sm)} disabled={saving} className="flex-shrink-0" title={sm.enabled ? t('serviceDetail.models.deactivate') : t('serviceDetail.models.activate')}>
                          {sm.enabled ? <ToggleRight className="w-6 h-6 text-blue-500" /> : <ToggleLeft className="w-6 h-6 text-gray-300" />}
                        </button>
                      )}
                      <button onClick={() => removeModel(sm)} disabled={saving} className="p-1 text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Round-robin summary */}
            {group.items.filter(sm => sm.enabled && sm.accessible).length > 1 && (
              <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <Zap className="w-3 h-3 text-blue-500" />
                  <span className="font-medium">{t('serviceDetail.models.roundRobinLabel')}</span>
                  {group.items.filter(sm => sm.enabled && sm.accessible).map((sm, i) => (
                    <span key={sm.id}>
                      {i > 0 && <span className="text-gray-300 mx-0.5">&rarr;</span>}
                      <span className="font-mono">{sm.model.displayName}</span>
                      <span className="text-gray-400">({sm.weight}x)</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Pending new alias */}
      {addingToAlias && !aliasGroups.some(g => g.aliasName === addingToAlias) && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden border-l-4 border-l-gray-300">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
            <Zap className="w-4 h-4 text-gray-400" />
            <div className="flex-1"><code className="text-sm font-semibold text-gray-900">{addingToAlias}</code>
              <p className="text-[11px] text-gray-400 mt-0.5">{t('serviceDetail.models.addModelToGroup')}</p>
            </div>
            <button onClick={() => setAddingToAlias(null)} className="p-1.5 text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>
          </div>
          <div className="px-5 py-3 bg-blue-50/30">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <select value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none">
                  <option value="">{t('serviceDetail.models.selectModelPlaceholder')}</option>
                  {getGroupedAvailable(addingToAlias).map(g => (
                    <optgroup key={g.type} label={`── ${g.label} (${g.models.length}) ──`}>
                      {g.models.map(m => <option key={m.id} value={m.id}>{m.displayName} ({m.name})</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <button onClick={() => addModel(addingToAlias)} disabled={!selectedModelId || saving}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">{t('common.add')}</button>
            </div>
          </div>
        </div>
      )}

      {/* New alias button */}
      {showNewForm ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('serviceDetail.models.newDisplayModel')}</h3>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <input type="text" value={newAliasName} onChange={e => setNewAliasName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newAliasName.trim()) { setShowNewForm(false); setNewAliasName(''); setAddingToAlias(newAliasName.trim()); } }}
                placeholder={t('serviceDetail.models.aliasPlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" autoFocus />
              <p className="mt-1.5 text-xs text-gray-400">{t('serviceDetail.models.aliasHint')}</p>
            </div>
            <button onClick={() => { if (newAliasName.trim()) { setShowNewForm(false); setAddingToAlias(newAliasName.trim()); setNewAliasName(''); } }}
              disabled={!newAliasName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Plus className="w-4 h-4 inline mr-1" />{t('serviceDetail.models.create')}
            </button>
            <button onClick={() => { setShowNewForm(false); setNewAliasName(''); }} className="p-2 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowNewForm(true)}
          className="w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/30 transition-all flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" />{t('serviceDetail.models.newDisplayModel')}
        </button>
      )}

      {aliasGroups.length === 0 && !showNewForm && (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900 mb-1">{t('serviceDetail.models.noModels')}</p>
          <p className="text-sm text-gray-500">{t('serviceDetail.models.noModelsHint')}</p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════
// Tab Loading Skeleton
// ════════════════════════════════════════════

function TabSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="h-3 bg-gray-200 rounded w-16 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-20 mb-2" />
            <div className="h-2 bg-gray-100 rounded w-24" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="h-5 bg-gray-200 rounded w-40 mb-6" />
        <div className="h-44 bg-gray-100 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="h-5 bg-gray-200 rounded w-48 mb-4" />
            <div className="h-64 bg-gray-100 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// TAB 5: 에러 관리
// ════════════════════════════════════════════

interface SvcErrorLog {
  id: string;
  serviceId: string | null;
  userId: string | null;
  deptname: string | null;
  modelName: string;
  resolvedModel: string | null;
  method: string;
  path: string;
  statusCode: number;
  errorMessage: string | null;
  errorDetails: {
    totalAttempts: number;
    attempts: Array<{
      endpoint: string;
      attempt: number;
      statusCode: number | null;
      errorType: 'timeout' | 'connection' | 'http_5xx' | 'http_4xx' | 'stream_error' | 'unknown';
      errorMessage: string;
      latencyMs: number;
      modelName: string;
    }>;
    timeoutMs: number;
  } | null;
  latencyMs: number | null;
  userAgent: string | null;
  ipAddress: string | null;
  stream: boolean;
  timestamp: string;
  service: { name: string; displayName: string } | null;
  ruleCause: string | null;
  ruleCategory: string | null;
  isAnalyzable: boolean;
}

const ERR_STATUS_COLORS: Record<number, string> = {
  400: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  401: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  403: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  404: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  429: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  500: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  502: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  503: 'bg-red-100 text-red-800 ring-1 ring-red-300',
};

const ERR_SEVERITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-700',
  MEDIUM: 'bg-amber-100 text-amber-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

function formatErrKST(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
}

function ServiceErrorsTab({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<SvcErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [categories, setCategories] = useState<string[]>([]);

  const [statusCode, setStatusCode] = useState('');
  const [category, setCategory] = useState('');
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [models, setModels] = useState<Array<{ id: string; name: string; displayName: string; type: string }>>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, { severity: string; cause: string; detail: string; suggestion: string; category: string; errorPattern?: string }>>(new Map());
  const [analyzeErrors, setAnalyzeErrors] = useState<Map<string, string>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page: pagination.page, limit: pagination.limit };
      if (statusCode) params.statusCode = statusCode;
      if (category) params.category = category;
      if (userId) params.userId = userId;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get(`/services/${serviceId}/error-logs`, { params });
      setLogs(res.data.logs);
      setPagination(p => ({ ...p, ...res.data.pagination }));
      if (res.data.categories) setCategories(res.data.categories);
    } catch {
      // 권한 없는 경우 등
    } finally {
      setLoading(false);
    }
  }, [serviceId, pagination.page, pagination.limit, statusCode, category, userId, startDate, endDate]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    (async () => {
      try {
        const [modelsRes, settingRes] = await Promise.all([
          api.get('/admin/models'),
          api.get('/admin/system-settings/system-llm'),
        ]);
        const chatModels = (modelsRes.data.models || []).filter((m: { type: string }) => m.type === 'CHAT');
        setModels(chatModels);
        const errSetting = (settingRes.data.settings || []).find((s: { key: string }) => s.key === 'ERROR_ANALYSIS_LLM_MODEL_ID');
        if (errSetting?.modelId) {
          setSelectedModel(errSetting.modelId);
        } else if (chatModels.length > 0) {
          setSelectedModel(chatModels[0].id);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (pagination.page === 1) loadLogs();
      else setPagination(p => ({ ...p, page: 1 }));
    }, 300);
    return () => clearTimeout(t);
  }, [userId]);

  const analyzeError = async (logId: string) => {
    if (!selectedModel) return;
    setAnalyzingId(logId);
    setAnalyzeErrors(prev => { const n = new Map(prev); n.delete(logId); return n; });
    try {
      const res = await api.post(`/admin/error-logs/${logId}/analyze`, { modelId: selectedModel });
      setAnalyses(prev => new Map(prev).set(logId, res.data.analysis));
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.detail || t('serviceDetail.errors.aiAnalysisFailed');
      setAnalyzeErrors(prev => new Map(prev).set(logId, msg));
    } finally {
      setAnalyzingId(null);
    }
  };

  const hasFilters = statusCode || category || userId || startDate || endDate;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-red-50">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-pastel-800 tracking-tight">{t('serviceDetail.errors.errorManagement')}</h2>
            <p className="text-xs text-pastel-500 mt-0.5">{t('serviceDetail.errors.errorTrackingDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg text-pastel-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 max-w-[200px]"
            title={t('serviceDetail.errors.selectLLMForAnalysis')}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <span className="text-sm font-semibold text-pastel-700">{t('serviceDetail.errors.totalCount', { count: pagination.total.toLocaleString() })}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pastel-400" />
            <input
              type="text"
              placeholder={t('serviceDetail.errors.searchUserId')}
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-400 focus:outline-none focus:ring-2 focus:ring-red-500/15 focus:border-red-500/30"
            />
          </div>
          <select
            value={statusCode}
            onChange={e => { setStatusCode(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
            className="px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700"
          >
            <option value="">{t('serviceDetail.errors.allStatusCodes')}</option>
            <option value="400">400 Bad Request</option>
            <option value="401">401 Unauthorized</option>
            <option value="403">403 Forbidden</option>
            <option value="404">404 Not Found</option>
            <option value="429">429 Rate Limit</option>
            <option value="500,502,503">5xx Server Error</option>
          </select>
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
            className="px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700"
          >
            <option value="">{t('serviceDetail.errors.allCategories')}</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200/60 text-sm text-pastel-600 hover:bg-pastel-50"
          >
            <Filter className="w-4 h-4" />{t('serviceDetail.errors.date')}
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-pastel-500 mb-1">{t('serviceDetail.errors.startDate')}</label>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
                className="w-full px-3 py-2 bg-white border border-gray-200/60 rounded-lg text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-pastel-500 mb-1">{t('serviceDetail.errors.endDate')}</label>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
                className="w-full px-3 py-2 bg-white border border-gray-200/60 rounded-lg text-sm" />
            </div>
            {hasFilters && (
              <button onClick={() => { setStatusCode(''); setCategory(''); setUserId(''); setStartDate(''); setEndDate(''); }}
                className="flex items-center gap-1 text-sm text-pastel-500 hover:text-red-500 pb-2">
                <X className="w-3.5 h-3.5" />{t('common.reset')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error Logs Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: '900px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100/80">
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[30px]"></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[155px]">{t('serviceDetail.errors.tableTime')}</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-pastel-500 uppercase w-[60px]">{t('serviceDetail.errors.tableCode')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[120px]">{t('serviceDetail.errors.tableUser')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[120px]">{t('serviceDetail.errors.tableModel')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase">{t('serviceDetail.errors.tableCause')}</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-pastel-500 uppercase w-[80px]">{t('serviceDetail.errors.tableAnalysis')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 rounded-full border-[3px] border-red-500 border-t-transparent animate-spin" />
                    <p className="text-sm text-pastel-500">{t('serviceDetail.errors.loadingErrors')}</p>
                  </div>
                </td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertTriangle className="w-8 h-8 text-pastel-300" />
                    <p className="text-sm text-pastel-600">{t('serviceDetail.errors.noErrors')}</p>
                    <p className="text-xs text-pastel-400">{t('serviceDetail.errors.noErrorsDesc')}</p>
                  </div>
                </td></tr>
              ) : logs.map(log => {
                const isExpanded = expandedId === log.id;
                const analysis = analyses.get(log.id);
                const errMsg = analyzeErrors.get(log.id);
                const isAnalyzing = analyzingId === log.id;
                const statusColor = ERR_STATUS_COLORS[log.statusCode] || 'bg-gray-50 text-gray-600 ring-1 ring-gray-200';

                const handleExpand = () => {
                  if (isExpanded) { setExpandedId(null); return; }
                  setExpandedId(log.id);
                  if (log.isAnalyzable && !analysis && !isAnalyzing && selectedModel) {
                    analyzeError(log.id);
                  }
                };

                return (
                  <Fragment key={log.id}>
                    <tr className={`group cursor-pointer ${isExpanded ? 'bg-gray-50/50' : 'hover:bg-gray-50/30'}`} onClick={handleExpand}>
                      <td className="px-3 py-2.5">
                        <div className="p-1">
                          <ChevronRight className={`w-3.5 h-3.5 text-pastel-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-pastel-400 flex-shrink-0" />
                          <span className="text-[11px] text-pastel-600 font-mono tabular-nums">{formatErrKST(log.timestamp)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold rounded-full ${statusColor}`}>
                          {log.statusCode}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-pastel-700 font-medium truncate max-w-[110px]" title={log.userId || '-'}>
                          {log.userId || '-'}
                        </div>
                        <div className="text-[10px] text-pastel-400 truncate max-w-[110px]" title={log.deptname || ''}>
                          {log.deptname || ''}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-pastel-600 truncate max-w-[110px]" title={log.modelName}>
                          {log.modelName || '-'}
                        </div>
                        <code className="text-[10px] text-pastel-400 font-mono">{log.method} {log.path.split('?')[0]}</code>
                      </td>
                      <td className="px-3 py-2.5">
                        {log.ruleCause ? (
                          <div className="flex items-start gap-1.5">
                            <Tag className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <span className="text-xs text-pastel-700">{log.ruleCause}</span>
                              {log.ruleCategory && (
                                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{log.ruleCategory}</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-pastel-400 italic">
                            {log.errorMessage ? log.errorMessage.substring(0, 80) + (log.errorMessage.length > 80 ? '...' : '') : t('serviceDetail.errors.unknownCause')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {analysis ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded ${ERR_SEVERITY_COLORS[analysis.severity] || 'bg-gray-100 text-gray-600'}`}>
                            {analysis.severity}
                          </span>
                        ) : isAnalyzing ? (
                          <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin mx-auto" />
                        ) : log.isAnalyzable ? (
                          <Sparkles className="w-3.5 h-3.5 text-violet-400 mx-auto" />
                        ) : (
                          <span className="text-[10px] text-pastel-300">-</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 animate-slide-down">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 text-xs">
                              <div><span className="text-pastel-400 block">{t('serviceDetail.errors.detailUser')}</span><span className="text-pastel-700 font-medium">{log.userId || '-'}</span></div>
                              <div><span className="text-pastel-400 block">{t('serviceDetail.errors.detailDept')}</span><span className="text-pastel-700">{log.deptname || '-'}</span></div>
                              <div><span className="text-pastel-400 block">IP</span><span className="text-pastel-700 font-mono">{log.ipAddress || '-'}</span></div>
                              <div><span className="text-pastel-400 block">Latency</span><span className="text-pastel-700">{log.latencyMs != null ? `${log.latencyMs}ms` : '-'}</span></div>
                              <div><span className="text-pastel-400 block">{t('serviceDetail.errors.detailModel')}</span><span className="text-pastel-700">{log.modelName}{log.resolvedModel && log.resolvedModel !== log.modelName ? ` -> ${log.resolvedModel}` : ''}</span></div>
                              <div><span className="text-pastel-400 block">{t('serviceDetail.errors.detailRequest')}</span><span className="text-pastel-700 font-mono">{log.method} {log.path}</span></div>
                              <div className="col-span-2"><span className="text-pastel-400 block">User-Agent</span><span className="text-pastel-700 truncate block max-w-[400px]" title={log.userAgent || ''}>{log.userAgent || '-'}</span></div>
                            </div>
                            {log.errorMessage && (
                              <div className="mb-3">
                                <pre className="p-2.5 bg-gray-900 text-gray-200 rounded-lg text-xs font-mono overflow-auto max-h-[80px] leading-relaxed">{log.errorMessage}</pre>
                              </div>
                            )}
                            {log.errorDetails && log.errorDetails.attempts && log.errorDetails.attempts.length > 0 && (
                              <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2.5">
                                  <Zap className="w-3.5 h-3.5 text-slate-600" />
                                  <span className="text-xs font-semibold text-slate-700">{t('serviceDetail.errors.endpointAttemptHistory')}</span>
                                  <span className="text-[10px] text-slate-400 ml-auto">
                                    {t('serviceDetail.errors.totalAttempts', { count: log.errorDetails.totalAttempts })} | {t('serviceDetail.errors.timeoutSetting', { seconds: (log.errorDetails.timeoutMs / 1000).toFixed(0) })}
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {log.errorDetails.attempts.map((attempt, i) => {
                                    const typeConfig: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
                                      timeout: { icon: <Timer className="w-3 h-3" />, label: 'TIMEOUT', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
                                      connection: { icon: <WifiOff className="w-3 h-3" />, label: 'CONNECTION', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
                                      http_5xx: { icon: <Server className="w-3 h-3" />, label: `HTTP ${attempt.statusCode}`, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
                                      http_4xx: { icon: <AlertTriangle className="w-3 h-3" />, label: `HTTP ${attempt.statusCode}`, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
                                      stream_error: { icon: <Wifi className="w-3 h-3" />, label: 'STREAM', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
                                      unknown: { icon: <AlertTriangle className="w-3 h-3" />, label: 'UNKNOWN', color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' },
                                    };
                                    const cfg = typeConfig[attempt.errorType] || typeConfig.unknown;
                                    return (
                                      <div key={i} className={`p-2 rounded border ${cfg.bg}`}>
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-[10px] font-bold text-slate-400 w-4">#{attempt.attempt}</span>
                                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded ${cfg.color} ${cfg.bg}`}>
                                            {cfg.icon} {cfg.label}
                                          </span>
                                          <span className="text-[10px] text-slate-500 font-mono">{(attempt.latencyMs / 1000).toFixed(1)}s</span>
                                          <span className="text-[10px] text-slate-400 truncate ml-auto max-w-[300px]" title={attempt.endpoint}>
                                            {attempt.endpoint}
                                          </span>
                                        </div>
                                        <pre className="text-[10px] font-mono text-slate-600 overflow-auto max-h-[40px] leading-relaxed whitespace-pre-wrap break-all">{attempt.errorMessage}</pre>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {analysis ? (
                              <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                                  <span className="text-xs font-semibold text-violet-800">{t('serviceDetail.errors.aiCauseAnalysis')}</span>
                                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${ERR_SEVERITY_COLORS[analysis.severity] || ''}`}>{analysis.severity}</span>
                                  {analysis.errorPattern && (
                                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                      analysis.errorPattern === 'outage' ? 'bg-red-100 text-red-700' :
                                      analysis.errorPattern === 'recurring' ? 'bg-amber-100 text-amber-700' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      {analysis.errorPattern === 'outage' ? t('serviceDetail.errors.serviceOutage') : analysis.errorPattern === 'recurring' ? t('serviceDetail.errors.recurring') : t('serviceDetail.errors.oneTime')}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-violet-500 ml-auto">{analysis.category}</span>
                                </div>
                                <div className="space-y-1.5 text-xs text-pastel-700">
                                  <div><span className="font-semibold text-violet-700">{t('serviceDetail.errors.cause')}</span> {analysis.cause}</div>
                                  <div><span className="font-semibold text-violet-700">{t('serviceDetail.errors.detail')}</span> {analysis.detail}</div>
                                  <div><span className="font-semibold text-violet-700">{t('serviceDetail.errors.resolution')}</span> {analysis.suggestion}</div>
                                </div>
                              </div>
                            ) : isAnalyzing ? (
                              <div className="flex items-center gap-2 p-3 bg-violet-50 border border-violet-100 rounded-lg">
                                <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
                                <span className="text-xs text-violet-600">{t('serviceDetail.errors.aiAnalyzing')}</span>
                              </div>
                            ) : errMsg ? (
                              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                                <span className="text-xs text-red-600">{errMsg}</span>
                                <button onClick={(e) => { e.stopPropagation(); analyzeError(log.id); }}
                                  className="ml-auto text-xs text-violet-600 hover:underline">{t('common.retry')}</button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100/80 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-pastel-500">
              <span className="font-semibold text-pastel-700">{pagination.total.toLocaleString()}</span> {t('serviceDetail.errors.ofTotal', { total: '' })}{' '}
              <span className="font-medium">{((pagination.page - 1) * pagination.limit + 1).toLocaleString()}-{Math.min(pagination.page * pagination.limit, pagination.total).toLocaleString()}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))} disabled={pagination.page <= 1}
                className="px-3 py-2 text-sm font-medium bg-white text-pastel-600 rounded-lg border border-gray-200/60 disabled:opacity-40 hover:bg-pastel-50 transition-all shadow-sm">{t('common.prev')}</button>
              <span className="px-3 py-2 text-sm text-pastel-600">{pagination.page} / {pagination.totalPages}</span>
              <button onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))} disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-2 text-sm font-medium bg-white text-pastel-600 rounded-lg border border-gray-200/60 disabled:opacity-40 hover:bg-pastel-50 transition-all shadow-sm">{t('common.next')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// TestAccountsTab — 서비스별 테스트 계정 관리 (최대 3개)
// ════════════════════════════════════════════
function TestAccountsTab({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<TestAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ loginid: '', username: '', deptname: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadAccounts = useCallback(async () => {
    try {
      const res = await testAccountApi.list(serviceId);
      setAccounts(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [serviceId]);

  useEffect(() => {
    loadAccounts();
    scopeApi.departments().then(r => setDepartments(r.data.departments || [])).catch(() => {});
  }, [loadAccounts]);

  const resetForm = () => {
    setForm({ loginid: '', username: '', deptname: '', description: '' });
    setEditingId(null);
    setShowForm(false);
    setError('');
  };

  const startEdit = (a: TestAccount) => {
    setForm({ loginid: a.loginid, username: a.username, deptname: a.deptname, description: a.description || '' });
    setEditingId(a.id);
    setShowForm(true);
    setError('');
  };

  const handleSave = async () => {
    if (!form.loginid.trim()) { setError(t('serviceDetail.testAccounts.enterLoginId')); return; }
    if (!form.deptname) { setError(t('serviceDetail.testAccounts.selectTeam')); return; }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await testAccountApi.update(serviceId, editingId, {
          loginid: form.loginid.trim(),
          username: form.username.trim() || t('serviceDetail.testAccounts.defaultUsername'),
          deptname: form.deptname,
          description: form.description.trim() || null,
        });
      } else {
        await testAccountApi.create(serviceId, {
          loginid: form.loginid.trim(),
          username: form.username.trim() || t('serviceDetail.testAccounts.defaultUsername'),
          deptname: form.deptname,
          description: form.description.trim() || undefined,
        });
      }
      resetForm();
      loadAccounts();
    } catch (err: any) {
      setError(err.response?.data?.error || t('common.saveFailed'));
    }
    setSaving(false);
  };

  const handleDelete = async (a: TestAccount) => {
    if (!confirm(t('serviceDetail.testAccounts.confirmDelete', { id: a.loginid }))) return;
    try {
      await testAccountApi.delete(serviceId, a.id);
      loadAccounts();
    } catch { /* ignore */ }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-pastel-400" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-amber-500" />
            {t('serviceDetail.testAccounts.title')}
            <span className="text-sm font-normal text-gray-400 ml-1">
              {t('serviceDetail.testAccounts.countDisplay', { current: accounts.length, max: 3 })}
            </span>
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('serviceDetail.testAccounts.description')}
          </p>
        </div>
        {accounts.length < 3 && !showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" /> {t('common.add')}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-amber-700">
            {editingId ? t('serviceDetail.testAccounts.editAccount') : t('serviceDetail.testAccounts.newAccount')}
          </h4>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('serviceDetail.testAccounts.loginId')}</label>
              <input
                type="text"
                value={form.loginid}
                onChange={e => setForm(f => ({ ...f, loginid: e.target.value }))}
                placeholder={t('serviceDetail.testAccounts.loginIdPlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('serviceDetail.testAccounts.displayName')}</label>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder={t('serviceDetail.testAccounts.displayNamePlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('serviceDetail.testAccounts.team')}</label>
              <select
                value={form.deptname}
                onChange={e => setForm(f => ({ ...f, deptname: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none bg-white"
              >
                <option value="">{t('serviceDetail.testAccounts.teamSelectPlaceholder')}</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('serviceDetail.testAccounts.descriptionLabel')}</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t('serviceDetail.testAccounts.descriptionPlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 rounded-lg transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editingId ? t('common.edit') : t('common.create')}
            </button>
            <button
              onClick={resetForm}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-all"
            >
              <X className="w-4 h-4" /> {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Account List */}
      {accounts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FlaskConical className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('serviceDetail.testAccounts.noAccounts')}</p>
          <p className="text-xs mt-1">{t('serviceDetail.testAccounts.noAccountsHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map(a => (
            <div key={a.id} className="bg-white border border-gray-200/60 rounded-xl p-4 flex items-center justify-between hover:shadow-sm transition-all">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <FlaskConical className="w-5 h-5 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{a.loginid}</span>
                    {a.username && a.username !== t('serviceDetail.testAccounts.defaultUsername') && (
                      <span className="text-xs text-gray-400">({a.username})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Building2 className="w-3 h-3" /> {a.deptname || '-'}
                    </span>
                    {a.description && (
                      <span className="text-xs text-gray-400 truncate max-w-[200px]">{a.description}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => startEdit(a)}
                  className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                  title={t('common.edit')}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(a)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  title={t('common.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

