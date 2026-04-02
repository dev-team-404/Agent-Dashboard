import { useState, useEffect, useRef, useMemo } from 'react';
import { Users, Zap, Activity, ChevronLeft, ChevronRight, TrendingUp, Info, Building2, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import LoadingSpinner from '../components/LoadingSpinner';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import { publicStatsApi } from '../services/api';
import { useHolidayDates } from '../hooks/useHolidayDates';
import { filterBusinessDays } from '../utils/businessDayFilter';
import { useBusinessDayToggle } from '../hooks/useBusinessDayToggle';
import BusinessDayToggle from '../components/BusinessDayToggle';

// ── Types ──

interface ServiceData {
  name: string;
  displayName: string;
  type: 'STANDARD' | 'BACKGROUND';
  dau: number;
  mau: number;
  totalCallCount: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  isEstimated: boolean;
  enabled: boolean;
  registeredByDept: string;
  team?: string;
  center2Name?: string;
  center1Name?: string;
  iconUrl?: string;
}

interface TeamUsageRow {
  deptname: string;
  businessUnit: string;
  serviceName: string;
  serviceDisplayName: string;
  totalTokens: number;
  requestCount: number;
  uniqueUsers: number;
}

interface AggregatedTeamUsage {
  deptname: string;
  totalTokens: number;
  requestCount: number;
}

interface TeamServiceGroup {
  deptname: string;
  serviceCount: number;
  serviceNames: string[];
}

type MetricKey = 'dau' | 'totalTokens' | 'totalCallCount';

interface MetricConfig {
  key: MetricKey;
  label: string;
  icon: React.ElementType;
  color: string;
  gradientFrom: string;
  gradientTo: string;
  format: (n: number) => string;
  unit: string;
  description: string;
}

// ── Helpers ──

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function getMetrics(t: (key: string) => string): MetricConfig[] {
  return [
    {
      key: 'dau',
      label: t('publicDashboard.businessDayAvgDAU'),
      icon: Users,
      color: '#2563EB',
      gradientFrom: '#3B82F6',
      gradientTo: '#1D4ED8',
      format: (n) => n.toLocaleString(),
      unit: t('publicDashboard.dauUnit'),
      description: t('publicDashboard.dauDescription'),
    },
    {
      key: 'totalTokens',
      label: t('publicDashboard.tokenUsage'),
      icon: Zap,
      color: '#7C3AED',
      gradientFrom: '#8B5CF6',
      gradientTo: '#6D28D9',
      format: formatTokens,
      unit: 'tokens',
      description: t('publicDashboard.tokenDescription'),
    },
    {
      key: 'totalCallCount',
      label: t('publicDashboard.apiCallCount'),
      icon: Activity,
      color: '#059669',
      gradientFrom: '#10B981',
      gradientTo: '#047857',
      format: formatCompact,
      unit: t('publicDashboard.callUnit'),
      description: t('publicDashboard.apiCallDescription'),
    },
  ];
}

const TOP_N = 20;
const BAR_COLORS = [
  '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD',
  '#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD',
  '#059669', '#10B981', '#34D399', '#6EE7B7',
  '#D97706', '#F59E0B', '#FBBF24', '#FCD34D',
  '#E11D48', '#F43F5E', '#FB7185', '#FDA4AF',
];

// ── Animated Counter ──

function useAnimatedCounter(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

// ── Summary Card ──

function SummaryCard({ label, value, icon: Icon, gradient, delay }: {
  label: string;
  value: number;
  icon: React.ElementType;
  gradient: string;
  delay: number;
}) {
  const animated = useAnimatedCounter(value);
  return (
    <div
      className="relative overflow-hidden rounded-xl bg-white border border-gray-100 shadow-card animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${gradient}`} />
      <div className="p-5 flex items-center gap-4">
        <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient} shadow-lg flex-shrink-0`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs font-medium text-pastel-400 uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-pastel-800 tracking-tight">
            {formatCompact(animated)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Custom Tooltip ──

function ChartTooltip({ active, payload, metric }: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  metric: MetricConfig;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-elevated px-4 py-3 text-sm">
      <p className="font-semibold text-pastel-800 mb-0.5">{data.fullName || data.displayName}</p>
      {data.registeredByDept && (
        <p className="text-[11px] text-pastel-400 mb-0.5">{data.registeredByDept}</p>
      )}
      {(() => {
        const parts = [data.center1Name, data.center2Name, data.team].filter((v: string) => v && v !== 'none');
        return parts.length > 0 ? (
          <p className="text-[10px] text-pastel-300 mb-1.5">{parts.join(' > ')}</p>
        ) : null;
      })()}
      <div className="flex items-center gap-2 text-pastel-600">
        <span className="font-mono font-bold" style={{ color: metric.color }}>
          {metric.format(data[metric.key])}
        </span>
        <span className="text-pastel-400">{metric.unit}</span>
      </div>
      {data.isEstimated && (
        <p className="text-[10px] text-amber-600 mt-1">* {i18n.t('publicDashboard.bgEstimated')}</p>
      )}
    </div>
  );
}

// ── Custom Bar Label with Logo ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarLabelWithLogo({ x, y, width, height, value, index, chartData, metric }: any) {
  const entry = chartData?.[index];
  const iconUrl = entry?.iconUrl;
  const formatted = metric.format(value);
  const logoSize = 16;
  const gap = 5;
  const textX = (x || 0) + (width || 0) + 6;
  const centerY = (y || 0) + (height || 0) / 2;
  const logoX = textX + formatted.length * 6 + gap;
  const logoY = centerY - logoSize / 2;
  const clipId = `logo-clip-${metric.key}-${entry?.name || index}`;

  return (
    <g>
      <text x={textX} y={centerY} fill="#6B7280" fontSize={10} fontWeight={500} dominantBaseline="central">
        {formatted}
      </text>
      {iconUrl && (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle cx={logoX + logoSize / 2} cy={logoY + logoSize / 2} r={logoSize / 2} />
            </clipPath>
          </defs>
          <circle cx={logoX + logoSize / 2} cy={logoY + logoSize / 2} r={logoSize / 2} fill="#FFFFFF" stroke="#E5E7EB" strokeWidth={0.5} />
          <image
            href={iconUrl}
            x={logoX}
            y={logoY}
            width={logoSize}
            height={logoSize}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      )}
    </g>
  );
}

// ── Bar Chart Section ──

function MetricChart({ services, metric, rank }: {
  services: ServiceData[];
  metric: MetricConfig;
  rank: number;
}) {
  const sorted = [...services]
    .sort((a, b) => b[metric.key] - a[metric.key])
    .slice(0, TOP_N)
    .filter(s => s[metric.key] > 0);

  if (sorted.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-card p-8 text-center text-pastel-400">
        {i18n.t('publicDashboard.noData')}
      </div>
    );
  }

  const chartData = sorted.map(s => {
    const dept = s.registeredByDept ? ` (${s.registeredByDept})` : '';
    const label = s.displayName + dept;
    return {
      ...s,
      displayName: label,
      fullName: s.displayName,
    };
  });

  const Icon = metric.icon;

  return (
    <div
      className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden animate-slide-up"
      style={{ animationDelay: `${rank * 80}ms` }}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: `${metric.color}10` }}
          >
            <Icon className="w-4 h-4" style={{ color: metric.color }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-pastel-800">{metric.label}</h3>
            <p className="text-[11px] text-pastel-400">{metric.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-pastel-400">
          <TrendingUp className="w-3 h-3" />
          <span>Top {sorted.length}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="px-4 py-4" style={{ height: Math.max(300, sorted.length * 36 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 90, left: 8, bottom: 4 }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={metric.format}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              width={280}
              tick={{ fontSize: 11, fill: '#4B5563' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<ChartTooltip metric={metric} />}
              cursor={{ fill: '#F9FAFB' }}
            />
            <Bar
              dataKey={metric.key}
              radius={[0, 6, 6, 0]}
              maxBarSize={28}
              label={<BarLabelWithLogo chartData={chartData} metric={metric} />}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.name}
                  fill={entry.isEstimated ? `${BAR_COLORS[i % BAR_COLORS.length]}88` : BAR_COLORS[i % BAR_COLORS.length]}
                  stroke={entry.isEstimated ? BAR_COLORS[i % BAR_COLORS.length] : 'none'}
                  strokeWidth={entry.isEstimated ? 1.5 : 0}
                  strokeDasharray={entry.isEstimated ? '4 2' : 'none'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      {sorted.some(s => s.isEstimated) && (
        <div className="px-6 pb-3 flex items-center gap-1.5 text-[10px] text-amber-600">
          <Info className="w-3 h-3" />
          <span>{i18n.t('publicDashboard.transparentBarLegend')}</span>
        </div>
      )}
    </div>
  );
}

// ── Daily DAU Line Chart ──

const LINE_COLORS = [
  '#EF4444', // 전체 (중복제거) — red
  '#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#EA580C', '#6366F1', '#22C55E', '#0EA5E9',
  '#A855F7', '#F97316', '#84CC16', '#F43F5E', '#14B8A6',
];

function DailyDauLineChart({ data }: { data: Record<string, unknown>[] }) {
  if (data.length === 0) return null;

  // 키 추출: "전체 (중복제거)"를 첫 번째로, 나머지는 합계 기준 정렬
  const allKeys = new Set<string>();
  data.forEach(row => Object.keys(row).forEach(k => { if (k !== 'date') allKeys.add(k); }));

  const overallKey = '전체 (중복제거)';
  const serviceKeys = Array.from(allKeys)
    .filter(k => k !== overallKey)
    .sort((a, b) => {
      const sumA = data.reduce((s, r) => s + ((r[a] as number) || 0), 0);
      const sumB = data.reduce((s, r) => s + ((r[b] as number) || 0), 0);
      return sumB - sumA;
    });

  const topKeys = serviceKeys.slice(0, 10);
  const chartKeys = allKeys.has(overallKey) ? [overallKey, ...topKeys] : topKeys;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50">
            <TrendingUp className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-pastel-800">{i18n.t('publicDashboard.dailyDauTrend')}</h3>
            <p className="text-[11px] text-pastel-400">{i18n.t('publicDashboard.dailyDauDesc')}</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-4" style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              labelFormatter={(l: string) => l}
              formatter={(value: number, name: string) => [
                i18n.t('publicDashboard.personUnit', { count: value }),
                name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {chartKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={key === overallKey ? 3 : 1.5}
                strokeDasharray={key === overallKey ? undefined : undefined}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {serviceKeys.length > 10 && (
        <div className="px-6 pb-3 text-[10px] text-pastel-400">
          * {i18n.t('publicDashboard.topNNote', { count: serviceKeys.length })}
        </div>
      )}
    </div>
  );
}

// ── Team Token + Call Bar Chart ──

const TEAM_COLORS = [
  '#2563EB', '#7C3AED', '#059669', '#D97706', '#E11D48',
  '#0891B2', '#4F46E5', '#15803D', '#B45309', '#BE123C',
  '#0E7490', '#6D28D9', '#047857', '#A16207', '#9F1239',
  '#155E75', '#5B21B6', '#065F46', '#92400E', '#881337',
];

function TeamUsageChart({ data }: { data: AggregatedTeamUsage[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-card p-8 text-center text-pastel-400">
        {i18n.t('publicDashboard.noTeamUsageData')}
      </div>
    );
  }

  const sorted = [...data]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 20);

  const chartData = sorted.map(d => ({
    ...d,
    displayName: d.deptname.length > 20 ? d.deptname.slice(0, 18) + '…' : d.deptname,
    fullName: d.deptname,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-50">
            <Building2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-pastel-800">{i18n.t('publicDashboard.teamTokenUsage')}</h3>
            <p className="text-[11px] text-pastel-400">{i18n.t('publicDashboard.allServicesBasis')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-pastel-400">
          <TrendingUp className="w-3 h-3" />
          <span>Top {sorted.length}</span>
        </div>
      </div>

      <div className="px-4 py-4" style={{ height: Math.max(360, sorted.length * 36 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 60, left: 8, bottom: 4 }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
            <XAxis
              type="number"
              xAxisId="tokens"
              orientation="bottom"
              tickFormatter={formatTokens}
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />
            <XAxis
              type="number"
              xAxisId="calls"
              orientation="top"
              tickFormatter={formatCompact}
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              hide
            />
            <YAxis
              type="category"
              dataKey="displayName"
              width={200}
              tick={{ fontSize: 11, fill: '#4B5563' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-elevated px-4 py-3 text-sm">
                    <p className="font-semibold text-pastel-800 mb-1">{d.fullName}</p>
                    <div className="space-y-0.5 text-pastel-600">
                      <p>{i18n.t('publicDashboard.tokenLabel')}: <span className="font-mono font-bold text-indigo-600">{formatTokens(d.totalTokens)}</span></p>
                      <p>{i18n.t('publicDashboard.callCountLabel')}: <span className="font-mono font-bold text-emerald-600">{formatCompact(d.requestCount)}</span></p>
                    </div>
                  </div>
                );
              }}
              cursor={{ fill: '#F9FAFB' }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value: string) => value === 'totalTokens' ? i18n.t('publicDashboard.tokenUsageLabel') : i18n.t('publicDashboard.llmCallCount')}
            />
            <Bar
              dataKey="totalTokens"
              xAxisId="tokens"
              name="totalTokens"
              radius={[0, 6, 6, 0]}
              maxBarSize={18}
              fill="#6366F1"
            />
            <Bar
              dataKey="requestCount"
              xAxisId="calls"
              name="requestCount"
              radius={[0, 6, 6, 0]}
              maxBarSize={18}
              fill="#10B981"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Team Registered Services Chart ──

function TeamServicesChart({ services }: { services: ServiceData[] }) {
  // registeredByDept 기준으로 그룹핑 (실제 등록한 팀 기준)
  const grouped = new Map<string, TeamServiceGroup>();
  for (const s of services) {
    const dept = s.registeredByDept;
    if (!dept) continue;
    const existing = grouped.get(dept);
    if (existing) {
      existing.serviceCount++;
      existing.serviceNames.push(s.displayName);
    } else {
      grouped.set(dept, {
        deptname: dept,
        serviceCount: 1,
        serviceNames: [s.displayName],
      });
    }
  }

  const data = Array.from(grouped.values());
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-card p-8 text-center text-pastel-400">
        {i18n.t('publicDashboard.noTeamServiceData')}
      </div>
    );
  }

  const sorted = [...data]
    .sort((a, b) => b.serviceCount - a.serviceCount)
    .slice(0, 20);

  const chartData = sorted.map(d => ({
    ...d,
    displayName: d.deptname.length > 20 ? d.deptname.slice(0, 18) + '…' : d.deptname,
    fullName: d.deptname,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-50">
            <Package className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-pastel-800">{i18n.t('publicDashboard.teamRegisteredServices')}</h3>
            <p className="text-[11px] text-pastel-400">{i18n.t('publicDashboard.teamRegisteredDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-pastel-400">
          <TrendingUp className="w-3 h-3" />
          <span>Top {sorted.length}</span>
        </div>
      </div>

      <div className="px-4 py-4" style={{ height: Math.max(360, sorted.length * 36 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 60, left: 8, bottom: 4 }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              width={200}
              tick={{ fontSize: 11, fill: '#4B5563' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as TeamServiceGroup & { fullName: string };
                return (
                  <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-elevated px-4 py-3 text-sm max-w-xs">
                    <p className="font-semibold text-pastel-800 mb-1.5">{d.fullName}</p>
                    <p className="text-pastel-600 mb-1">
                      {i18n.t('publicDashboard.serviceCountLabel', { count: d.serviceCount })}
                    </p>
                    <div className="text-[11px] text-pastel-400 space-y-0.5">
                      {d.serviceNames.map(name => (
                        <p key={name}>• {name}</p>
                      ))}
                    </div>
                  </div>
                );
              }}
              cursor={{ fill: '#F9FAFB' }}
            />
            <Bar
              dataKey="serviceCount"
              radius={[0, 6, 6, 0]}
              maxBarSize={28}
              label={{
                position: 'right',
                fontSize: 11,
                fill: '#6B7280',
                formatter: (v: number) => i18n.t('publicDashboard.countUnit', { count: v }),
              }}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={TEAM_COLORS[i % TEAM_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function PublicDashboard() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [services, setServices] = useState<ServiceData[]>([]);
  const [overallDAU, setOverallDAU] = useState(0);
  const [dailyDauChart, setDailyDauChart] = useState<Record<string, unknown>[]>([]);
  const [teamUsage, setTeamUsage] = useState<AggregatedTeamUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const holidayDates = useHolidayDates();
  const { exclude } = useBusinessDayToggle();
  const [error, setError] = useState('');

  // 주말/휴일 제외된 일별 DAU 차트 데이터 (토글 연동)
  const filteredDailyDauChart = useMemo(() =>
    exclude ? filterBusinessDays(dailyDauChart, (d) => String(d.date), holidayDates) : dailyDauChart,
  [dailyDauChart, holidayDates, exclude]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData(true);
    }, 5 * 60 * 1000); // 5분마다 자동 갱신
    return () => clearInterval(interval);
  }, [year, month]);

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError('');

      // 날짜 범위 계산
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // dau-mau는 필수, team-usage-all은 실패해도 기존 대시보드에 영향 없도록 분리
      const dauRes = await publicStatsApi.dauMau(year, month);
      setServices(dauRes.data.data || []);
      setOverallDAU(dauRes.data.overallAvgDailyDAU || 0);
      setDailyDauChart(dauRes.data.dailyDauChart || []);

      // 팀별 사용량 (실패 시 빈 배열로 graceful fallback)
      try {
        const teamRes = await publicStatsApi.teamUsageAll(startDate, endDate);
        const rows: TeamUsageRow[] = teamRes.data.data || [];
        const grouped = new Map<string, AggregatedTeamUsage>();
        for (const r of rows) {
          const existing = grouped.get(r.deptname);
          if (existing) {
            existing.totalTokens += r.totalTokens;
            existing.requestCount += r.requestCount;
          } else {
            grouped.set(r.deptname, {
              deptname: r.deptname,
              totalTokens: r.totalTokens,
              requestCount: r.requestCount,
            });
          }
        }
        setTeamUsage(Array.from(grouped.values()));
      } catch {
        console.error('Failed to load team usage data');
        setTeamUsage([]);
      }
    } catch (err) {
      console.error('Failed to load public dashboard:', err);
      if (!silent) setError(t('publicDashboard.loadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setYear(y);
    setMonth(m);
  };

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  // Aggregated totals
  const enabledServices = services.filter(s => s.enabled);
  const totalDAU = overallDAU; // API에서 교차 서비스 중복제거된 값 사용
  const totalTokens = enabledServices.reduce((s, d) => s + d.totalTokens, 0);
  const totalCalls = enabledServices.reduce((s, d) => s + d.totalCallCount, 0);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto">
      {/* Header with month selector */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-lg font-bold text-pastel-800 tracking-tight">{t('publicDashboard.serviceUsageStatus')}</h1>
          <p className="text-xs text-pastel-400 mt-0.5">
            {t('publicDashboard.serviceUsageDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BusinessDayToggle />
          <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 shadow-soft px-1 py-1">
          <button
            onClick={() => goMonth(-1)}
            className="p-1.5 rounded-lg text-pastel-400 hover:text-pastel-700 hover:bg-pastel-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 py-1 text-sm font-semibold text-pastel-700 min-w-[100px] text-center">
            {t('publicDashboard.yearMonth', { year, month })}
          </span>
          <button
            onClick={() => goMonth(1)}
            disabled={isCurrentMonth}
            className="p-1.5 rounded-lg text-pastel-400 hover:text-pastel-700 hover:bg-pastel-50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label={t('publicDashboard.overallAvgDAU')}
          value={totalDAU}
          icon={Users}
          gradient="from-blue-500 to-blue-700"
          delay={0}
        />
        <SummaryCard
          label={t('publicDashboard.monthlyTokenUsage')}
          value={totalTokens}
          icon={Zap}
          gradient="from-violet-500 to-violet-700"
          delay={60}
        />
        <SummaryCard
          label={t('publicDashboard.monthlyApiCalls')}
          value={totalCalls}
          icon={Activity}
          gradient="from-emerald-500 to-emerald-700"
          delay={120}
        />
      </div>

      {/* Daily DAU Line Chart */}
      {!error && filteredDailyDauChart.length > 0 && (
        <DailyDauLineChart data={filteredDailyDauChart} />
      )}

      {/* Bar Charts */}
      {!error && enabledServices.length > 0 && (
        <div className="space-y-5">
          {getMetrics(t).map((metric, i) => (
            <MetricChart
              key={metric.key}
              services={enabledServices}
              metric={metric}
              rank={i}
            />
          ))}
        </div>
      )}

      {/* Team Usage Charts */}
      {!error && (
        <div className="space-y-5">
          {teamUsage.length > 0 && <TeamUsageChart data={teamUsage} />}
          {enabledServices.length > 0 && <TeamServicesChart services={enabledServices} />}
        </div>
      )}

      {!error && enabledServices.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-card p-12 text-center">
          <p className="text-pastel-400 text-sm">{t('publicDashboard.noServiceData')}</p>
        </div>
      )}
    </div>
  );
}
