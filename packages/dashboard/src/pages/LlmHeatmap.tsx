import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, Clock, AlertTriangle, BarChart3, TrendingUp, Users, CheckCircle2, XCircle, HeartPulse, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

// ── Types ──
interface ModelEntry {
  modelId: string;
  modelName: string;
  displayName: string;
  modelType: string;
  enabled: boolean;
  totalCalls: number;
}

interface HeatmapCell {
  date: string;
  hour: number;
  avgLatency: number | null;
  p95Latency: number | null;
  timeoutCount: number;
  errorCount: number;
  callCount: number;
  successCount: number;
  hcAvgLatency: number | null;
  hcP95Latency: number | null;
  hcCount: number;
  hcSuccess: number;
  hcFail: number;
}

interface DailySummary {
  date: string;
  avgLatency: number | null;
  callCount: number;
  timeoutCount: number;
  errorCount: number;
  uniqueUsers: number;
  hcAvgLatency: number | null;
  hcCount: number;
  hcSuccess: number;
}

type HeatmapTab = 'callCount' | 'latency' | 'p95' | 'timeout' | 'errorRate' | 'successRate' | 'hcLatency' | 'hcSuccess';

// ── Color Functions ──
const latencyColor = (v: number | null): string => {
  if (v === null) return '#f8fafc';
  if (v >= 10000) return '#7f1d1d';
  if (v >= 5000) return '#dc2626';
  if (v >= 3000) return '#f59e0b';
  if (v >= 1000) return '#3b82f6';
  if (v > 0) return '#22d3ee';
  return '#f0fdf4';
};

const callCountColor = (v: number, max: number): string => {
  if (v === 0) return '#f8fafc';
  const ratio = max > 0 ? v / max : 0;
  if (ratio >= 0.8) return '#7c3aed';
  if (ratio >= 0.6) return '#8b5cf6';
  if (ratio >= 0.4) return '#a78bfa';
  if (ratio >= 0.2) return '#c4b5fd';
  return '#ddd6fe';
};

const timeoutColor = (v: number): string => {
  if (v === 0) return '#f0fdf4';
  if (v >= 10) return '#7f1d1d';
  if (v >= 5) return '#dc2626';
  if (v >= 3) return '#f59e0b';
  if (v >= 1) return '#fb923c';
  return '#f0fdf4';
};

const errorRateColor = (v: number): string => {
  if (v >= 50) return '#7f1d1d';
  if (v >= 30) return '#dc2626';
  if (v >= 15) return '#f59e0b';
  if (v >= 5) return '#fb923c';
  if (v > 0) return '#fde68a';
  return '#f0fdf4';
};

const successRateColor = (v: number): string => {
  if (v >= 99) return '#15803d';
  if (v >= 95) return '#22c55e';
  if (v >= 90) return '#86efac';
  if (v >= 80) return '#f59e0b';
  if (v > 0) return '#dc2626';
  return '#f8fafc';
};

// ── Component ──
export default function LlmHeatmap() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [hmTab, setHmTab] = useState<HeatmapTab>('callCount');
  const [modelSearch, setModelSearch] = useState('');

  // Load model list
  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/stats/model-heatmap/models');
      const list: ModelEntry[] = res.data.models || [];
      setModels(list);
      if (list.length > 0 && !selectedModel) {
        setSelectedModel(list[0].modelId);
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load heatmap data for selected model
  const loadHeatmap = useCallback(async () => {
    if (!selectedModel) return;
    try {
      setHeatmapLoading(true);
      setHeatmapError(null);
      const res = await api.get('/admin/stats/model-heatmap', {
        params: { modelId: selectedModel, days },
      });
      setHeatmap(res.data.heatmap || []);
      setDaily(res.data.daily || []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string }; status?: number } })?.response?.data?.error
        || (err as { response?: { status?: number } })?.response?.status
        || (err as Error)?.message || 'Unknown error';
      setHeatmapError(String(msg));
      console.error('Failed to load heatmap:', err);
    } finally {
      setHeatmapLoading(false);
    }
  }, [selectedModel, days]);

  useEffect(() => { loadModels(); }, [loadModels]);
  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);

  // Computed
  const maxCalls = useMemo(() => Math.max(...heatmap.map(h => h.callCount), 1), [heatmap]);
  const dates = useMemo(() => [...new Set(heatmap.map(h => h.date))].sort(), [heatmap]);

  // O(1) lookup map for heatmap cells: "YYYY-MM-DD|hour" → cell
  const heatmapMap = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const cell of heatmap) {
      m.set(`${cell.date}|${cell.hour}`, cell);
    }
    return m;
  }, [heatmap]);

  const totals = useMemo(() => {
    const totalCalls = daily.reduce((s, d) => s + d.callCount, 0);
    const totalTimeouts = daily.reduce((s, d) => s + d.timeoutCount, 0);
    const totalErrors = daily.reduce((s, d) => s + d.errorCount, 0);
    const withLatency = daily.filter(d => d.avgLatency !== null);
    const avgLatency = withLatency.length > 0
      ? Math.round(withLatency.reduce((s, d) => s + (d.avgLatency || 0), 0) / withLatency.length)
      : null;
    const maxUsers = Math.max(...daily.map(d => d.uniqueUsers), 0);
    const totalHc = daily.reduce((s, d) => s + (d.hcCount || 0), 0);
    const totalHcSuccess = daily.reduce((s, d) => s + (d.hcSuccess || 0), 0);
    const hcSuccessRate = totalHc > 0 ? Math.round(totalHcSuccess / totalHc * 100) : null;
    const hcWithLatency = daily.filter(d => d.hcAvgLatency !== null);
    const hcAvgLatency = hcWithLatency.length > 0
      ? Math.round(hcWithLatency.reduce((s, d) => s + (d.hcAvgLatency || 0), 0) / hcWithLatency.length)
      : null;
    return { totalCalls, totalTimeouts, totalErrors, avgLatency, maxUsers, totalHc, hcSuccessRate, hcAvgLatency };
  }, [daily]);

  const filteredModels = useMemo(() => {
    if (!modelSearch) return models;
    const q = modelSearch.toLowerCase();
    return models.filter(m =>
      m.displayName.toLowerCase().includes(q) ||
      m.modelName.toLowerCase().includes(q)
    );
  }, [models, modelSearch]);

  const maxModelCalls = useMemo(() => Math.max(...models.map(m => m.totalCalls), 1), [models]);

  // Tabs config
  const tabs: Array<{
    key: HeatmapTab;
    label: string;
    desc: string;
    icon: React.ElementType;
    getValue: (c: HeatmapCell) => number;
    getColor: (v: number) => string;
    format: (v: number) => string;
  }> = [
    {
      key: 'callCount', label: '호출 수', desc: '시간대별 총 API 호출 건수 — 사용 패턴과 피크 타임을 파악합니다.',
      icon: BarChart3,
      getValue: c => c.callCount,
      getColor: v => callCountColor(v, maxCalls),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v),
    },
    {
      key: 'latency', label: '평균 응답시간', desc: '성공 요청의 평균 응답 지연(ms). 빨간색은 5초 이상으로 사용자 체감 지연 심각.',
      icon: Clock,
      getValue: c => c.avgLatency ?? 0,
      getColor: v => latencyColor(v || null),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`,
    },
    {
      key: 'p95', label: 'P95 응답시간', desc: '상위 5% 요청의 응답 지연(ms). 꼬리 지연이 길면 일부 사용자가 매우 느린 응답을 경험합니다.',
      icon: TrendingUp,
      getValue: c => c.p95Latency ?? 0,
      getColor: v => latencyColor(v || null),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`,
    },
    {
      key: 'timeout', label: '타임아웃', desc: '504 응답 또는 120초 초과 요청 수. 1건 이상이면 주의, 5건 이상이면 긴급.',
      icon: AlertTriangle,
      getValue: c => c.timeoutCount,
      getColor: v => timeoutColor(v),
      format: v => String(v),
    },
    {
      key: 'errorRate', label: '에러율 %', desc: '400 이상 응답 비율. 15% 이상이면 해당 시간대에 문제가 있을 수 있습니다.',
      icon: XCircle,
      getValue: c => c.callCount > 0 ? Math.round(c.errorCount / c.callCount * 100) : 0,
      getColor: v => errorRateColor(v),
      format: v => `${v}%`,
    },
    {
      key: 'successRate', label: '성공률 %', desc: '2xx/3xx 응답 비율. 95% 이상 녹색, 80% 미만 빨간색.',
      icon: CheckCircle2,
      getValue: c => c.callCount > 0 ? Math.round(c.successCount / c.callCount * 100) : 0,
      getColor: v => successRateColor(v),
      format: v => `${v}%`,
    },
    {
      key: 'hcLatency', label: 'HC 응답시간', desc: '헬스체크 프로빙(10분 간격) 평균 응답시간(ms). 실제 사용과 별개로 엔드포인트 상태를 모니터링합니다.',
      icon: HeartPulse,
      getValue: c => c.hcAvgLatency ?? 0,
      getColor: v => latencyColor(v || null),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`,
    },
    {
      key: 'hcSuccess', label: 'HC 성공률 %', desc: '헬스체크 성공률. 100% = 해당 시간대에 모든 프로빙 성공. 90% 미만이면 엔드포인트 불안정.',
      icon: ShieldCheck,
      getValue: c => c.hcCount > 0 ? Math.round(c.hcSuccess / c.hcCount * 100) : 0,
      getColor: v => successRateColor(v),
      format: v => `${v}%`,
    },
  ];

  const activeTab = tabs.find(t => t.key === hmTab) || tabs[0];

  if (loading) return <LoadingSpinner message="모델 목록 로딩 중..." />;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-purple-200">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LLM 모델 히트맵</h1>
          <p className="text-sm text-gray-500">등록된 모델별 날짜×시간 호출 패턴 · 응답시간 · 에러 분석</p>
        </div>
      </div>

      {/* ── Model Selector (Fancy Cards) ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">모델 선택</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{models.length}개 모델</span>
              <select
                value={days}
                onChange={e => setDays(Number(e.target.value))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-gray-50"
              >
                <option value={7}>7일</option>
                <option value={14}>14일</option>
                <option value={30}>30일</option>
                <option value={60}>60일</option>
                <option value={90}>90일</option>
              </select>
            </div>
          </div>
          {models.length > 8 && (
            <input
              type="text"
              placeholder="모델 검색..."
              value={modelSearch}
              onChange={e => setModelSearch(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />
          )}
        </div>
        <div className="p-3 max-h-60 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {filteredModels.map(m => {
              const isActive = m.modelId === selectedModel;
              const callRatio = m.totalCalls / maxModelCalls;

              return (
                <button
                  key={m.modelId}
                  onClick={() => setSelectedModel(m.modelId)}
                  className={`relative text-left p-3 rounded-lg border-2 transition-all duration-200 group overflow-hidden ${
                    isActive
                      ? 'border-purple-500 bg-purple-50/80 shadow-md shadow-purple-100 ring-1 ring-purple-200'
                      : m.enabled
                        ? 'border-gray-100 bg-white hover:border-gray-300 hover:shadow-sm'
                        : 'border-gray-100 bg-gray-50 opacity-60 hover:opacity-80'
                  }`}
                >
                  {/* Activity bar background */}
                  <div
                    className={`absolute bottom-0 left-0 h-1 transition-all duration-500 rounded-b ${
                      isActive ? 'bg-purple-400' : 'bg-gray-200 group-hover:bg-gray-300'
                    }`}
                    style={{ width: `${Math.max(callRatio * 100, 4)}%` }}
                  />

                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className={`text-xs font-bold truncate leading-tight ${isActive ? 'text-purple-800' : 'text-gray-800'}`}>
                      {m.displayName}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!m.enabled && <span className="text-[8px] text-red-400 font-medium">OFF</span>}
                      <span className={`w-2 h-2 rounded-full mt-0.5 ${m.enabled ? 'bg-green-400' : 'bg-red-300'}`} />
                    </div>
                  </div>

                  <p className="text-[10px] text-gray-400 truncate mb-1">{m.modelName}</p>

                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold tabular-nums ${isActive ? 'text-purple-600' : 'text-gray-600'}`}>
                      {m.totalCalls.toLocaleString()}회
                    </span>
                    <span className="text-[10px] text-gray-400">{m.modelType}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredModels.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">검색 결과 없음</p>
          )}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {selectedModel && !heatmapLoading && heatmap.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <SummaryCard icon={BarChart3} label="총 호출" value={totals.totalCalls.toLocaleString()} sub="건" color="purple" />
          <SummaryCard icon={Clock} label="평균 응답" value={totals.avgLatency !== null ? `${totals.avgLatency}` : '-'} sub="ms" color="blue" />
          <SummaryCard icon={AlertTriangle} label="타임아웃" value={totals.totalTimeouts.toLocaleString()} sub="건" color="red" />
          <SummaryCard icon={XCircle} label="에러" value={totals.totalErrors.toLocaleString()} sub="건" color="amber" />
          <SummaryCard icon={Users} label="최대 DAU" value={String(totals.maxUsers)} sub="명" color="green" />
          <SummaryCard icon={HeartPulse} label="HC 프로빙" value={totals.totalHc.toLocaleString()} sub="회" color="blue" />
          <SummaryCard icon={ShieldCheck} label="HC 성공률" value={totals.hcSuccessRate !== null ? `${totals.hcSuccessRate}` : '-'} sub="%" color="green" />
          <SummaryCard icon={Clock} label="HC 평균" value={totals.hcAvgLatency !== null ? `${totals.hcAvgLatency}` : '-'} sub="ms" color="purple" />
        </div>
      )}

      {/* ── Heatmap ── */}
      {selectedModel && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          {heatmapLoading ? (
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner message={`${models.find(m => m.modelId === selectedModel)?.displayName || ''} 데이터 로딩 중...`} />
            </div>
          ) : heatmapError ? (
            <div className="text-center py-16">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-400" />
              <p className="text-sm font-medium text-red-600 mb-1">데이터 로딩 실패</p>
              <p className="text-xs text-red-400 font-mono">{heatmapError}</p>
            </div>
          ) : heatmap.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">선택 기간 내 호출 기록이 없습니다.</p>
            </div>
          ) : (
            <>
              {/* Tab Selector */}
              <div className="mb-3">
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 mb-2">
                  {tabs.map(t => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setHmTab(t.key)}
                        className={`flex items-center justify-center gap-1.5 py-2 px-2 text-[11px] rounded-lg font-medium transition-all ${
                          hmTab === t.key
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-500">{activeTab.desc}</p>
              </div>

              {/* Heatmap Grid */}
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  {/* Hour header */}
                  <div className="flex">
                    <div className="w-20 shrink-0" />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="flex-1 text-center text-[8px] text-gray-400 font-semibold pb-1">{h}</div>
                    ))}
                  </div>
                  {/* Date rows */}
                  {dates.map(dt => {
                    const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][new Date(dt + 'T00:00:00+09:00').getDay()];
                    const isWeekend = dayOfWeek === '토' || dayOfWeek === '일';
                    return (
                      <div key={dt} className="flex items-center">
                        <div className={`w-20 shrink-0 text-[9px] pr-1.5 text-right tabular-nums ${isWeekend ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>
                          {dt.slice(5)} {dayOfWeek}
                        </div>
                        {Array.from({ length: 24 }, (_, h) => {
                          const cell = heatmapMap.get(`${dt}|${h}`);
                          const val = cell ? activeTab.getValue(cell) : 0;
                          const bg = cell ? activeTab.getColor(val) : '#f8fafc';
                          const textColor = val > 0
                            ? (['#7f1d1d', '#dc2626', '#7c3aed', '#15803d'].includes(bg) ? '#fff' : ['#f59e0b', '#fb923c', '#8b5cf6'].includes(bg) ? '#fff' : '#1e293b')
                            : '#d1d5db';

                          return (
                            <div
                              key={h}
                              className="flex-1 h-7 border border-white/60 cursor-help flex items-center justify-center text-[8px] font-bold transition-colors"
                              style={{ backgroundColor: bg, color: textColor }}
                              title={[
                                `${dt} ${h}시`,
                                `── 실제 사용 ──`,
                                `호출: ${cell?.callCount ?? 0}건 (성공 ${cell?.successCount ?? 0})`,
                                `평균: ${cell?.avgLatency ?? '-'}ms · P95: ${cell?.p95Latency ?? '-'}ms`,
                                `타임아웃: ${cell?.timeoutCount ?? 0} · 에러: ${cell?.errorCount ?? 0}`,
                                cell && cell.callCount > 0 ? `성공률: ${Math.round(cell.successCount / cell.callCount * 100)}%` : '',
                                `── 헬스체크 ──`,
                                `프로빙: ${cell?.hcCount ?? 0}회 (성공 ${cell?.hcSuccess ?? 0} / 실패 ${cell?.hcFail ?? 0})`,
                                `HC 평균: ${cell?.hcAvgLatency ?? '-'}ms`,
                                cell && cell.hcCount > 0 ? `HC 성공률: ${Math.round(cell.hcSuccess / cell.hcCount * 100)}%` : '',
                              ].filter(Boolean).join('\n')}
                            >
                              {val > 0 ? activeTab.format(val) : ''}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Legend */}
              <div className="mt-3 flex items-center gap-2 text-[9px] text-gray-500">
                <span>낮음</span>
                {activeTab.key === 'callCount' && (
                  <>
                    {['#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed'].map((c, i) => (
                      <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                  </>
                )}
                {(activeTab.key === 'latency' || activeTab.key === 'p95') && (
                  <>
                    {['#f0fdf4', '#22d3ee', '#3b82f6', '#f59e0b', '#dc2626', '#7f1d1d'].map((c, i) => (
                      <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                  </>
                )}
                {activeTab.key === 'timeout' && (
                  <>
                    {['#f0fdf4', '#fb923c', '#f59e0b', '#dc2626', '#7f1d1d'].map((c, i) => (
                      <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                  </>
                )}
                {activeTab.key === 'errorRate' && (
                  <>
                    {['#f0fdf4', '#fde68a', '#fb923c', '#f59e0b', '#dc2626', '#7f1d1d'].map((c, i) => (
                      <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                  </>
                )}
                {(activeTab.key === 'successRate' || activeTab.key === 'hcSuccess') && (
                  <>
                    {['#dc2626', '#f59e0b', '#86efac', '#22c55e', '#15803d'].map((c, i) => (
                      <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                  </>
                )}
                {activeTab.key === 'hcLatency' && (
                  <>
                    {['#f0fdf4', '#22d3ee', '#3b82f6', '#f59e0b', '#dc2626', '#7f1d1d'].map((c, i) => (
                      <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                  </>
                )}
                <span>높음</span>
              </div>

              {/* ── Daily Trend Mini Chart ── */}
              {daily.length > 1 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-600 mb-2">일별 추이</p>
                  <div className="flex items-end gap-[2px] h-16">
                    {(() => {
                      const maxDaily = Math.max(...daily.map(x => x.callCount), 1);
                      return daily.map((d, i) => {
                      const h = Math.max((d.callCount / maxDaily) * 100, 2);
                      const hasTimeout = d.timeoutCount > 0;
                      const dayOfWeek = new Date(d.date + 'T00:00:00+09:00').getDay();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-t cursor-help transition-all hover:opacity-80"
                          style={{
                            height: `${h}%`,
                            backgroundColor: hasTimeout ? '#f59e0b' : isWeekend ? '#c4b5fd' : '#8b5cf6',
                            minWidth: '3px',
                          }}
                          title={`${d.date}\n호출: ${d.callCount.toLocaleString()}\n평균: ${d.avgLatency ?? '-'}ms\n타임아웃: ${d.timeoutCount}\n에러: ${d.errorCount}\n사용자: ${d.uniqueUsers}명`}
                        />
                      );
                    });
                    })()}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[8px] text-gray-400">{daily[0]?.date.slice(5)}</span>
                    <div className="flex items-center gap-3 text-[8px] text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-500 inline-block" /> 평일</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-300 inline-block" /> 주말</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> 타임아웃 발생</span>
                    </div>
                    <span className="text-[8px] text-gray-400">{daily[daily.length - 1]?.date.slice(5)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──
function SummaryCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub: string; color: string;
}) {
  const colors: Record<string, string> = {
    purple: 'from-purple-500 to-violet-600',
    blue: 'from-blue-500 to-cyan-600',
    red: 'from-red-500 to-rose-600',
    amber: 'from-amber-500 to-orange-600',
    green: 'from-green-500 to-emerald-600',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-lg bg-gradient-to-br ${colors[color] || colors.purple} shadow-sm`}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-[10px] font-medium text-gray-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold text-gray-900 tabular-nums">{value}</span>
        <span className="text-[10px] text-gray-400">{sub}</span>
      </div>
    </div>
  );
}
