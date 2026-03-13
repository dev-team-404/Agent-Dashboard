import { useState, useEffect, useRef } from 'react';
import { Users, Zap, Activity, ChevronLeft, ChevronRight, TrendingUp, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { publicStatsApi } from '../services/api';

// ── Types ──

interface ServiceData {
  serviceId: string;
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
  iconUrl?: string;
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

const METRICS: MetricConfig[] = [
  {
    key: 'dau',
    label: '영업일 평균 DAU',
    icon: Users,
    color: '#2563EB',
    gradientFrom: '#3B82F6',
    gradientTo: '#1D4ED8',
    format: (n) => n.toLocaleString(),
    unit: '명',
    description: '영업일(주말·공휴일 제외) 평균 일일 활성 사용자 수',
  },
  {
    key: 'totalTokens',
    label: '토큰 사용량',
    icon: Zap,
    color: '#7C3AED',
    gradientFrom: '#8B5CF6',
    gradientTo: '#6D28D9',
    format: formatTokens,
    unit: 'tokens',
    description: '해당 월 총 입출력 토큰 사용량',
  },
  {
    key: 'totalCallCount',
    label: 'API 호출 수',
    icon: Activity,
    color: '#059669',
    gradientFrom: '#10B981',
    gradientTo: '#047857',
    format: formatCompact,
    unit: '회',
    description: '해당 월 총 API 요청 수',
  },
];

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
        <p className="text-[11px] text-pastel-400 mb-1.5">{data.registeredByDept}</p>
      )}
      <div className="flex items-center gap-2 text-pastel-600">
        <span className="font-mono font-bold" style={{ color: metric.color }}>
          {metric.format(data[metric.key])}
        </span>
        <span className="text-pastel-400">{metric.unit}</span>
      </div>
      {data.isEstimated && (
        <p className="text-[10px] text-amber-600 mt-1">* BACKGROUND 서비스 추정값</p>
      )}
    </div>
  );
}

// ── Custom Y-axis Tick with Logo ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function YAxisTickWithLogo({ x, y, payload, chartData }: any) {
  const entry = chartData?.find((d: { displayName: string }) => d.displayName === payload?.value);
  const iconUrl = entry?.iconUrl;
  const logoSize = 16;
  const gap = 6;
  return (
    <g transform={`translate(${x},${y})`}>
      {iconUrl ? (
        <>
          <image
            href={iconUrl}
            x={-logoSize - gap - (payload?.value?.length || 0) * 5.5}
            y={-logoSize / 2}
            width={logoSize}
            height={logoSize}
            style={{ borderRadius: 3 }}
          />
          <text x={-gap} y={0} textAnchor="end" fill="#4B5563" fontSize={11} dominantBaseline="central">
            {payload?.value}
          </text>
        </>
      ) : (
        <text x={-gap} y={0} textAnchor="end" fill="#4B5563" fontSize={11} dominantBaseline="central">
          {payload?.value}
        </text>
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
        데이터가 없습니다
      </div>
    );
  }

  const chartData = sorted.map(s => {
    const dept = s.registeredByDept ? ` (${s.registeredByDept})` : '';
    const label = s.displayName + dept;
    return {
      ...s,
      displayName: label.length > 24 ? label.slice(0, 23) + '…' : label,
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
            margin={{ top: 4, right: 60, left: 8, bottom: 4 }}
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
              width={220}
              tick={<YAxisTickWithLogo chartData={chartData} />}
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
              label={{
                position: 'right',
                formatter: (v: number) => metric.format(v),
                style: { fontSize: 10, fill: '#6B7280', fontWeight: 500 },
              }}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.serviceId}
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
          <span>반투명 바: BACKGROUND 서비스 (1인당 평균 호출 수 기반 추정)</span>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export default function PublicDashboard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [services, setServices] = useState<ServiceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, [year, month]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await publicStatsApi.dauMau(year, month);
      setServices(res.data.data || []);
    } catch (err) {
      console.error('Failed to load public dashboard:', err);
      setError('데이터를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
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
  const totalDAU = enabledServices.reduce((s, d) => s + d.dau, 0);
  const totalTokens = enabledServices.reduce((s, d) => s + d.totalTokens, 0);
  const totalCalls = enabledServices.reduce((s, d) => s + d.totalCallCount, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-samsung-blue border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-pastel-500">데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto">
      {/* Header with month selector */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-lg font-bold text-pastel-800 tracking-tight">서비스 사용 현황</h1>
          <p className="text-xs text-pastel-400 mt-0.5">
            배포 완료된 서비스의 월간 사용량 통계 (DEPLOYED only)
          </p>
        </div>
        <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 shadow-soft px-1 py-1">
          <button
            onClick={() => goMonth(-1)}
            className="p-1.5 rounded-lg text-pastel-400 hover:text-pastel-700 hover:bg-pastel-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 py-1 text-sm font-semibold text-pastel-700 min-w-[100px] text-center">
            {year}년 {month}월
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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="전체 영업일 평균 DAU"
          value={totalDAU}
          icon={Users}
          gradient="from-blue-500 to-blue-700"
          delay={0}
        />
        <SummaryCard
          label="월간 토큰 사용량"
          value={totalTokens}
          icon={Zap}
          gradient="from-violet-500 to-violet-700"
          delay={60}
        />
        <SummaryCard
          label="월간 API 호출"
          value={totalCalls}
          icon={Activity}
          gradient="from-emerald-500 to-emerald-700"
          delay={120}
        />
      </div>

      {/* Bar Charts */}
      {!error && enabledServices.length > 0 && (
        <div className="space-y-5">
          {METRICS.map((metric, i) => (
            <MetricChart
              key={metric.key}
              services={enabledServices}
              metric={metric}
              rank={i}
            />
          ))}
        </div>
      )}

      {!error && enabledServices.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-card p-12 text-center">
          <p className="text-pastel-400 text-sm">해당 기간에 배포된 서비스 데이터가 없습니다.</p>
        </div>
      )}
    </div>
  );
}
