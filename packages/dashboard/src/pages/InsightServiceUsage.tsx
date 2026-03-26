import { useState, useEffect, useCallback } from 'react';
import { Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const TOKEN_COLORS = {
  input: '#3b82f6',
  output: '#f59e0b',
  total: '#8b5cf6',
};

const SERVICE_COLORS = [
  '#6366f1', '#f97316', '#14b8a6', '#e11d48', '#8b5cf6',
  '#0891b2', '#d946ef', '#84cc16', '#fb923c', '#3b82f6',
  '#22c55e', '#ef4444', '#94a3b8',
];

interface DailyTokenRow {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ServiceDailyRow {
  date: string;
  services: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>;
}

function fmtTokens(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

function fmtDay(d: string): string {
  const [, m, day] = d.split('-');
  return `${m}/${day}`;
}

export default function InsightServiceUsage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tokenData, setTokenData] = useState<DailyTokenRow[]>([]);
  const [serviceData, setServiceData] = useState<ServiceDailyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (y: number, m: number) => {
    try {
      setLoading(true);
      const [tokenRes, svcRes] = await Promise.all([
        api.get('/public/stats/dtgpt/token-usage', { params: { year: y, month: m } }),
        api.get('/public/stats/dtgpt/service-usage', { params: { year: y, month: m } }),
      ]);
      setTokenData(tokenRes.data.data || []);
      setServiceData(svcRes.data.data || []);
    } catch (err) {
      console.error('Failed to load DTGPT usage:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year, month); }, [year, month, load]);

  const goMonth = (delta: number) => {
    let y = year, m = month + delta;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setYear(y); setMonth(m);
  };

  // 서비스별 차트 데이터 변환: 일별 → { date, [serviceName]: totalTokens }
  const serviceNames = [...new Set(serviceData.flatMap(d => Object.keys(d.services)))];
  const svcChartData = serviceData.map(d => {
    const entry: Record<string, any> = { date: d.date };
    for (const name of serviceNames) {
      entry[name] = d.services[name]?.totalTokens ?? 0;
    }
    return entry;
  });

  // 합계 계산
  const totalInput = tokenData.reduce((s, d) => s + d.inputTokens, 0);
  const totalOutput = tokenData.reduce((s, d) => s + d.outputTokens, 0);
  const totalAll = tokenData.reduce((s, d) => s + d.totalTokens, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader />
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <span className="text-sm font-semibold text-gray-700 min-w-[100px] text-center">{year}년 {month}월</span>
          <button onClick={() => goMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={year === now.getFullYear() && month === now.getMonth() + 1}>
            <ChevronRight className={`w-4 h-4 ${year === now.getFullYear() && month === now.getMonth() + 1 ? 'text-gray-300' : 'text-gray-500'}`} />
          </button>
          {loading && <div className="w-4 h-4 border-2 border-samsung-blue border-t-transparent rounded-full animate-spin ml-2" />}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-[10px] font-medium text-blue-500 uppercase tracking-wider">Input Tokens</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{fmtTokens(totalInput)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-[10px] font-medium text-amber-500 uppercase tracking-wider">Output Tokens</p>
          <p className="text-xl font-bold text-amber-700 mt-1">{fmtTokens(totalOutput)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-[10px] font-medium text-violet-500 uppercase tracking-wider">Total Tokens</p>
          <p className="text-xl font-bold text-violet-700 mt-1">{fmtTokens(totalAll)}</p>
        </div>
      </div>

      {/* Daily total token chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">일별 토큰 사용량</h3>
        <p className="text-xs text-gray-500 mt-0.5 mb-5">{year}년 {month}월 일자별 Input / Output 토큰</p>
        {tokenData.length > 0 ? (
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={tokenData} margin={{ top: 10, right: 16, left: 4, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }}
                tickFormatter={fmtDay} interval={tokenData.length > 20 ? 1 : 0}
                angle={tokenData.length > 20 ? -45 : 0} textAnchor={tokenData.length > 20 ? 'end' : 'middle'} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={fmtTokens} width={56} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload as DailyTokenRow;
                  return (
                    <div className="bg-white/95 backdrop-blur rounded-xl border border-gray-200 shadow-xl p-4 min-w-[180px]">
                      <p className="text-[11px] font-medium text-gray-400 mb-2">{label}</p>
                      <div className="space-y-1.5 text-[12px]">
                        <div className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />Input</span>
                          <span className="font-semibold text-gray-800 tabular-nums">{fmtTokens(d.inputTokens)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />Output</span>
                          <span className="font-semibold text-gray-800 tabular-nums">{fmtTokens(d.outputTokens)}</span>
                        </div>
                        <div className="pt-1.5 border-t border-gray-100 flex items-center justify-between gap-4 font-bold">
                          <span>Total</span>
                          <span className="text-violet-700 tabular-nums">{fmtTokens(d.totalTokens)}</span>
                        </div>
                      </div>
                    </div>
                  );
                }}
                cursor={{ fill: 'rgba(0,0,0,0.04)', radius: 4 }}
              />
              <Legend wrapperStyle={{ paddingTop: 12, fontSize: 12 }} iconType="square" iconSize={10}
                formatter={(v: string) => <span className="text-[11px] text-gray-600 ml-1">{v}</span>} />
              <Bar dataKey="inputTokens" name="Input" stackId="s" fill={TOKEN_COLORS.input} />
              <Bar dataKey="outputTokens" name="Output" stackId="s" fill={TOKEN_COLORS.output} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-52 text-gray-400 text-sm">해당 기간의 데이터가 없습니다</div>
        )}
      </div>

      {/* Service-level chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">서비스별 토큰 사용량</h3>
        <p className="text-xs text-gray-500 mt-0.5 mb-5">{year}년 {month}월 서비스별 총 토큰 사용량 추이</p>
        {svcChartData.length > 0 && serviceNames.length > 0 ? (
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={svcChartData} margin={{ top: 10, right: 16, left: 4, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }}
                tickFormatter={fmtDay} interval={svcChartData.length > 20 ? 1 : 0}
                angle={svcChartData.length > 20 ? -45 : 0} textAnchor={svcChartData.length > 20 ? 'end' : 'middle'} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={fmtTokens} width={56} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const total = payload.reduce((s, p) => s + (p.value as number ?? 0), 0);
                  const visible = payload.filter(p => (p.value as number ?? 0) > 0).reverse();
                  return (
                    <div className="bg-white/95 backdrop-blur rounded-xl border border-gray-200 shadow-xl p-4 min-w-[200px] max-w-[300px]">
                      <p className="text-[11px] font-medium text-gray-400 mb-1">{label}</p>
                      <p className="text-sm font-bold text-gray-900 mb-3">Total <span className="text-violet-600">{fmtTokens(total)}</span></p>
                      <div className="space-y-1.5">
                        {visible.map(p => (
                          <div key={p.dataKey} className="flex items-center justify-between gap-3 text-[11px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }} />
                              <span className="text-gray-600 truncate">{p.dataKey}</span>
                            </div>
                            <span className="font-semibold text-gray-800 tabular-nums flex-shrink-0">{fmtTokens(p.value as number ?? 0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }}
                cursor={{ fill: 'rgba(0,0,0,0.04)', radius: 4 }}
                wrapperStyle={{ pointerEvents: 'auto' }}
                allowEscapeViewBox={{ x: true, y: true }}
              />
              <Legend wrapperStyle={{ paddingTop: 12, fontSize: 12 }} iconType="square" iconSize={10}
                formatter={(v: string) => <span className="text-[11px] text-gray-600 ml-1">{v}</span>} />
              {serviceNames.map((name, i) => (
                <Bar key={name} dataKey={name} stackId="s" fill={SERVICE_COLORS[i % SERVICE_COLORS.length]}
                  radius={i === serviceNames.length - 1 ? [3, 3, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-52 text-gray-400 text-sm">해당 기간의 데이터가 없습니다</div>
        )}
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
        <p className="text-sm text-pastel-500 mt-0.5">DTGPT 서버 토큰 사용량을 일별/서비스별로 분석합니다</p>
      </div>
    </div>
  );
}
