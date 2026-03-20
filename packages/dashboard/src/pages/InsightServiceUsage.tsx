import { useState, useEffect, useCallback } from 'react';
import { Zap, ChevronDown, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, TooltipProps,
  ResponsiveContainer, Legend,
} from 'recharts';

const TEAM_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ea580c', '#6366f1', '#22c55e', '#ef4444',
  '#a855f7', '#0ea5e9', '#94a3b8',
];
const SERVICE_COLORS = [
  '#6366f1', '#f97316', '#14b8a6', '#e11d48', '#8b5cf6',
  '#0891b2', '#d946ef', '#84cc16', '#fb923c', '#3b82f6',
  '#22c55e', '#ef4444', '#94a3b8',
];

type Granularity = 'daily' | 'weekly' | 'monthly';

interface TeamInfoEntry {
  deptnames: string[];
  businessUnits: string[];
  teamShort: string | null;
  institute: string | null;
}

interface TokenUsageData {
  centers: string[];
  centerName: string;
  granularity: Granularity;
  byTeam: Array<Record<string, any>>;
  byService: Array<Record<string, any>>;
  teams: string[];
  services: string[];
  teamInfo?: Record<string, TeamInfoEntry>;
}

const GRAN: Record<Granularity, { label: string; sub: string }> = {
  daily:   { label: 'Daily',   sub: '최근 30일' },
  weekly:  { label: 'Weekly',  sub: '최근 6개월' },
  monthly: { label: 'Monthly', sub: '최근 12개월' },
};

function fmtTokens(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

function fmtPeriod(p: string, g: Granularity): string {
  if (g === 'monthly') { const [y, m] = p.split('-'); return `${y.slice(2)}/${m}`; }
  const [, m, d] = p.split('-');
  return `${m}/${d}`;
}

function ChartTooltip({ active, payload, label, teamInfo }: TooltipProps<number, string> & { colors: string[]; teamInfo?: Record<string, TeamInfoEntry> }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  const visible = payload.filter(p => (p.value ?? 0) > 0).reverse();
  return (
    <div className="bg-white/95 backdrop-blur rounded-xl border border-gray-200 shadow-xl p-4 min-w-[220px] max-w-[320px] pointer-events-auto">
      <p className="text-[11px] font-medium text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-bold text-gray-900 mb-3">Total <span className="text-violet-600">{fmtTokens(total)}</span> tokens</p>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1 overscroll-contain">
        {visible.map((p) => {
          const info = teamInfo?.[p.dataKey as string];
          return (
            <div key={p.dataKey}>
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-gray-600 truncate">{p.dataKey}</span>
                </div>
                <span className="font-semibold text-gray-800 tabular-nums flex-shrink-0">{fmtTokens(p.value ?? 0)}</span>
              </div>
              {info && (
                <div className="ml-4 mt-0.5 text-[10px] text-gray-400 space-y-0.5">
                  {info.teamShort && <div>팀: {info.teamShort}</div>}
                  {info.institute && <div>연구소: {info.institute}</div>}
                  {info.deptnames.map(d => <div key={d}>부서: {d}</div>)}
                  {info.businessUnits.length > 0 && <div>사업부: {info.businessUnits.join(', ')}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StackedChart({ title, subtitle, data, keys, colors, granularity, teamInfo }: {
  title: string; subtitle: string; data: Array<Record<string, any>>; keys: string[]; colors: string[]; granularity: Granularity; teamInfo?: Record<string, TeamInfoEntry>;
}) {
  if (data.length === 0 || keys.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5 mb-4">{subtitle}</p>
        <div className="flex items-center justify-center h-52 text-gray-400 text-sm">해당 기간의 데이터가 없습니다</div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-base font-semibold text-gray-800 mb-1">{title}</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-5">{subtitle}</p>
      <ResponsiveContainer width="100%" height={420}>
        <BarChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: granularity === 'daily' ? 50 : 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }}
            tickFormatter={(v: string) => fmtPeriod(v, granularity)}
            angle={granularity === 'daily' ? -45 : 0} textAnchor={granularity === 'daily' ? 'end' : 'middle'}
            interval={granularity === 'daily' ? 1 : 0} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={fmtTokens} width={56} />
          <Tooltip content={<ChartTooltip colors={colors} teamInfo={teamInfo} />} cursor={{ fill: 'rgba(0,0,0,0.04)', radius: 4 }} wrapperStyle={{ pointerEvents: 'auto' }} allowEscapeViewBox={{ x: true, y: true }} />
          <Legend wrapperStyle={{ paddingTop: 12, fontSize: 12 }} iconType="square" iconSize={10}
            formatter={(v: string) => <span className="text-[11px] text-gray-600 ml-1">{v}</span>} />
          {keys.map((key, i) => (
            <Bar key={key} dataKey={key} stackId="s" fill={colors[i % colors.length]}
              radius={i === keys.length - 1 ? [3, 3, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function InsightServiceUsage() {
  const [data, setData] = useState<TokenUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState('');
  const [gran, setGran] = useState<Granularity>('monthly');
  const [ddOpen, setDdOpen] = useState(false);

  const load = useCallback(async (c?: string, g?: Granularity) => {
    try {
      setLoading(true);
      const params: Record<string, string> = { granularity: g || gran };
      if (c) params.centerName = c;
      const res = await api.get('/public/stats/dtgpt/token-usage', { params });
      setData(res.data);
      if (!c && res.data.centerName) setCenter(res.data.centerName);
    } catch (err) {
      console.error('Failed to load DTGPT token usage:', err);
    } finally {
      setLoading(false);
    }
  }, [gran]);

  useEffect(() => { load(); }, []);

  const pickCenter = (c: string) => { setCenter(c); setDdOpen(false); load(c, gran); };
  const pickGran = (g: Granularity) => { setGran(g); load(center, g); };

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader />
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 text-violet-500 animate-spin" /></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader />
        <div className="flex flex-col items-center justify-center py-24">
          <Zap className="w-12 h-12 text-gray-300 mb-4" />
          <p className="text-sm font-medium text-gray-500">데이터를 불러올 수 없습니다</p>
          <button onClick={() => load()} className="mt-3 px-4 py-2 text-xs font-medium text-violet-600 bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors">다시 시도</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader />
        <div className="flex items-center gap-3 flex-wrap">
          {data.centers.length > 0 && (
            <div className="relative">
              <button onClick={() => setDdOpen(v => !v)}
                className="flex items-center gap-2 pl-4 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:border-violet-300 transition-colors shadow-sm min-w-[160px]">
                <span className="truncate max-w-[180px]">{center || 'Center 선택'}</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${ddOpen ? 'rotate-180' : ''}`} />
              </button>
              {ddOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDdOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 w-72 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-20 py-1">
                    {data.centers.map(c => (
                      <button key={c} onClick={() => pickCenter(c)}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${c === center ? 'bg-violet-50 text-violet-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 shadow-inner">
            {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
              <button key={g} onClick={() => pickGran(g)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${gran === g ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {GRAN[g].label}
              </button>
            ))}
          </div>
          {loading && <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="inline-flex items-center px-3 py-1 bg-violet-50 text-violet-700 rounded-full text-xs font-medium">{GRAN[gran].sub}</span>
        {center && <span className="inline-flex items-center px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">{center}</span>}
      </div>

      <div className="space-y-6">
        <StackedChart title="팀별 토큰 사용량" subtitle={`${center} 내부 팀별 총 토큰 사용량 추이`}
          data={data.byTeam} keys={data.teams} colors={TEAM_COLORS} granularity={gran} teamInfo={data.teamInfo} />
        <StackedChart title="서비스별 토큰 사용량" subtitle={`${center} 내부 서비스별 총 토큰 사용량 추이`}
          data={data.byService} keys={data.services} colors={SERVICE_COLORS} granularity={gran} />
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="flex items-center gap-4">
      <div className="p-3 rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 shadow-sm">
        <Zap className="w-6 h-6 text-violet-600" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">서비스 사용량 인사이트</h1>
        <p className="text-sm text-pastel-500 mt-0.5">DTGPT 서버 토큰 사용량을 팀/서비스 단위로 분석합니다</p>
      </div>
    </div>
  );
}
