import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [perModelData, setPerModelData] = useState<Map<string, { heatmap: HeatmapCell[]; daily: DailySummary[]; displayName: string }>>(new Map());
  const [viewMode, setViewMode] = useState<'merge' | 'compare'>('merge');
  const [loading, setLoading] = useState(true);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [hmTab, setHmTab] = useState<HeatmapTab>('callCount');
  const [modelSearch, setModelSearch] = useState('');
  const prefetchCache = useRef<Map<string, any>>(new Map());

  const toggleModel = (modelId: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  // Load model list
  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      // 1회 batch 호출로 모델 목록 + 전 모델 히트맵 일괄 로드
      const res = await api.get('/admin/stats/model-heatmap/all', { params: { days: 30 } });
      const list: ModelEntry[] = res.data.models || [];
      setModels(list);
      // 전 모델 프리페치 캐시 채우기 (API 추가 호출 0회)
      const heatmaps = res.data.heatmaps || {};
      for (const [id, data] of Object.entries(heatmaps)) {
        prefetchCache.current.set(id, data);
      }
    } catch (err) {
      console.error('Failed to load models:', err);
      // fallback: 기존 개별 API
      try {
        const res = await api.get('/admin/stats/model-heatmap/models');
        setModels(res.data.models || []);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  // selectedModels를 stable key로 변환 (useEffect dep용)
  const selectedKey = useMemo(() => [...selectedModels].sort().join(','), [selectedModels]);

  // Load & merge heatmap data for all selected models
  const loadHeatmap = useCallback(async () => {
    const ids = selectedKey.split(',').filter(Boolean);
    if (ids.length === 0) { setHeatmap([]); setDaily([]); return; }
    try {
      setHeatmapLoading(true);
      setHeatmapError(null);

      const results = await Promise.all(
        ids.map(id => {
          // 프리페치 캐시 히트 시 API 호출 생략 (days=30일 때만)
          const cached = days === 30 ? prefetchCache.current.get(id) : null;
          if (cached) return Promise.resolve(cached);
          return api.get('/admin/stats/model-heatmap', { params: { modelId: id, days } }).then(r => r.data);
        })
      );

      // 개별 모델 데이터 저장 (비교 모드용)
      const perModel = new Map<string, { heatmap: HeatmapCell[]; daily: DailySummary[]; displayName: string }>();
      for (let i = 0; i < ids.length; i++) {
        perModel.set(ids[i], {
          heatmap: results[i].heatmap || [],
          daily: results[i].daily || [],
          displayName: results[i].displayName || models.find(m => m.modelId === ids[i])?.displayName || ids[i],
        });
      }
      setPerModelData(perModel);

      // 히트맵 병합 (date|hour 기준 합산)
      const hm = new Map<string, HeatmapCell>();
      for (const r of results) {
        for (const cell of (r.heatmap || []) as HeatmapCell[]) {
          const key = `${cell.date}|${cell.hour}`;
          const existing = hm.get(key);
          if (existing) {
            // latency: 가중 평균 (callCount 기준)
            const eW = existing.successCount, cW = cell.successCount;
            existing.avgLatency = eW + cW > 0
              ? Math.round(((existing.avgLatency || 0) * eW + (cell.avgLatency || 0) * cW) / (eW + cW))
              : null;
            existing.p95Latency = Math.max(existing.p95Latency || 0, cell.p95Latency || 0) || null;
            existing.callCount += cell.callCount;
            existing.successCount += cell.successCount;
            existing.timeoutCount += cell.timeoutCount;
            existing.errorCount += cell.errorCount;
            // HC: 가중 평균
            const ehW = existing.hcSuccess, chW = cell.hcSuccess;
            existing.hcAvgLatency = ehW + chW > 0
              ? Math.round(((existing.hcAvgLatency || 0) * ehW + (cell.hcAvgLatency || 0) * chW) / (ehW + chW))
              : null;
            existing.hcP95Latency = Math.max(existing.hcP95Latency || 0, cell.hcP95Latency || 0) || null;
            existing.hcCount += cell.hcCount;
            existing.hcSuccess += cell.hcSuccess;
            existing.hcFail += cell.hcFail;
          } else {
            hm.set(key, { ...cell });
          }
        }
      }

      // 일별 병합
      const dm = new Map<string, DailySummary>();
      for (const r of results) {
        for (const d of (r.daily || []) as DailySummary[]) {
          const existing = dm.get(d.date);
          if (existing) {
            const eW = existing.callCount - existing.errorCount, cW = d.callCount - d.errorCount;
            existing.avgLatency = eW + cW > 0
              ? Math.round(((existing.avgLatency || 0) * eW + (d.avgLatency || 0) * cW) / (eW + cW))
              : null;
            existing.callCount += d.callCount;
            existing.timeoutCount += d.timeoutCount;
            existing.errorCount += d.errorCount;
            existing.uniqueUsers = Math.max(existing.uniqueUsers, d.uniqueUsers);
            const ehW = existing.hcSuccess || 0, chW = d.hcSuccess || 0;
            existing.hcAvgLatency = ehW + chW > 0
              ? Math.round(((existing.hcAvgLatency || 0) * ehW + (d.hcAvgLatency || 0) * chW) / (ehW + chW))
              : null;
            existing.hcCount = (existing.hcCount || 0) + (d.hcCount || 0);
            existing.hcSuccess = (existing.hcSuccess || 0) + (d.hcSuccess || 0);
          } else {
            dm.set(d.date, { ...d });
          }
        }
      }

      setHeatmap([...hm.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour));
      setDaily([...dm.values()].sort((a, b) => a.date.localeCompare(b.date)));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string }; status?: number } })?.response?.data?.error
        || (err as { response?: { status?: number } })?.response?.status
        || (err as Error)?.message || 'Unknown error';
      setHeatmapError(String(msg));
      console.error('Failed to load heatmap:', err);
    } finally {
      setHeatmapLoading(false);
    }
  }, [selectedKey, days]);

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
      key: 'callCount', label: t('llmHeatmap.tabCallCount'), desc: t('llmHeatmap.tabCallCountDesc'),
      icon: BarChart3,
      getValue: c => c.callCount,
      getColor: v => callCountColor(v, maxCalls),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v),
    },
    {
      key: 'latency', label: t('llmHeatmap.tabAvgLatency'), desc: t('llmHeatmap.tabAvgLatencyDesc'),
      icon: Clock,
      getValue: c => c.avgLatency ?? 0,
      getColor: v => latencyColor(v || null),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`,
    },
    {
      key: 'p95', label: t('llmHeatmap.tabP95Latency'), desc: t('llmHeatmap.tabP95LatencyDesc'),
      icon: TrendingUp,
      getValue: c => c.p95Latency ?? 0,
      getColor: v => latencyColor(v || null),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`,
    },
    {
      key: 'timeout', label: t('llmHeatmap.tabTimeout'), desc: t('llmHeatmap.tabTimeoutDesc'),
      icon: AlertTriangle,
      getValue: c => c.timeoutCount,
      getColor: v => timeoutColor(v),
      format: v => String(v),
    },
    {
      key: 'errorRate', label: t('llmHeatmap.tabErrorRate'), desc: t('llmHeatmap.tabErrorRateDesc'),
      icon: XCircle,
      getValue: c => c.callCount > 0 ? Math.round(c.errorCount / c.callCount * 100) : -1,
      getColor: v => v < 0 ? '#f8fafc' : errorRateColor(v),
      format: v => v < 0 ? '' : `${v}%`,
    },
    {
      key: 'successRate', label: t('llmHeatmap.tabSuccessRate'), desc: t('llmHeatmap.tabSuccessRateDesc'),
      icon: CheckCircle2,
      getValue: c => c.callCount > 0 ? Math.round(c.successCount / c.callCount * 100) : -1,
      getColor: v => v < 0 ? '#f8fafc' : successRateColor(v),
      format: v => v < 0 ? '' : `${v}%`,
    },
    {
      key: 'hcLatency', label: t('llmHeatmap.tabHcLatency'), desc: t('llmHeatmap.tabHcLatencyDesc'),
      icon: HeartPulse,
      getValue: c => c.hcAvgLatency ?? 0,
      getColor: v => latencyColor(v || null),
      format: v => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`,
    },
    {
      key: 'hcSuccess', label: t('llmHeatmap.tabHcSuccess'), desc: t('llmHeatmap.tabHcSuccessDesc'),
      icon: ShieldCheck,
      getValue: c => c.hcCount > 0 ? Math.round(c.hcSuccess / c.hcCount * 100) : 0,
      getColor: v => successRateColor(v),
      format: v => `${v}%`,
    },
  ];

  const activeTab = tabs.find(t => t.key === hmTab) || tabs[0];

  if (loading) return <LoadingSpinner message={t('llmHeatmap.loadingModels')} />;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-purple-200">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('llmHeatmap.title')}</h1>
          <p className="text-sm text-gray-500">{t('llmHeatmap.description')}</p>
        </div>
      </div>

      {/* ── Model Selector (Fancy Cards) ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{t('llmHeatmap.modelSelection')}</p>
              {selectedModels.size > 0 && (
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-full">{selectedModels.size}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedModels.size >= 2 && (
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setViewMode('merge')} className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${viewMode === 'merge' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}>{t('llmHeatmap.merge')}</button>
                  <button onClick={() => setViewMode('compare')} className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${viewMode === 'compare' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}>{t('llmHeatmap.compare')}</button>
                </div>
              )}
              <button
                onClick={() => setSelectedModels(prev => prev.size === models.length ? new Set() : new Set(models.map(m => m.modelId)))}
                className="text-[10px] text-purple-600 hover:text-purple-800 font-medium"
              >
                {selectedModels.size === models.length ? t('llmHeatmap.deselectAll') : t('llmHeatmap.selectAll')}
              </button>
              <span className="text-xs text-gray-400">{t('llmHeatmap.modelCount', { count: models.length })}</span>
              <select
                value={days}
                onChange={e => setDays(Number(e.target.value))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-gray-50"
              >
                <option value={7}>{t('llmHeatmap.daysSuffix', { count: 7 })}</option>
                <option value={14}>{t('llmHeatmap.daysSuffix', { count: 14 })}</option>
                <option value={30}>{t('llmHeatmap.daysSuffix', { count: 30 })}</option>
                <option value={60}>{t('llmHeatmap.daysSuffix', { count: 60 })}</option>
                <option value={90}>{t('llmHeatmap.daysSuffix', { count: 90 })}</option>
              </select>
            </div>
          </div>
          {models.length > 8 && (
            <input
              type="text"
              placeholder={t('llmHeatmap.searchModel')}
              value={modelSearch}
              onChange={e => setModelSearch(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />
          )}
        </div>
        <div className="p-3 max-h-60 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {filteredModels.map(m => {
              const isActive = selectedModels.has(m.modelId);
              const callRatio = m.totalCalls / maxModelCalls;

              return (
                <button
                  key={m.modelId}
                  onClick={() => toggleModel(m.modelId)}
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
                      {t('llmHeatmap.callsSuffix', { count: m.totalCalls.toLocaleString() })}
                    </span>
                    <span className="text-[10px] text-gray-400">{m.modelType}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredModels.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">{t('llmHeatmap.noSearchResults')}</p>
          )}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {selectedModels.size > 0 && !heatmapLoading && heatmap.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <SummaryCard icon={BarChart3} label={t('llmHeatmap.summaryTotalCalls')} value={totals.totalCalls.toLocaleString()} sub={t('llmHeatmap.unitCalls')} color="purple" />
          <SummaryCard icon={Clock} label={t('llmHeatmap.summaryAvgResponse')} value={totals.avgLatency !== null ? `${totals.avgLatency}` : '-'} sub={t('llmHeatmap.unitMs')} color="blue" />
          <SummaryCard icon={AlertTriangle} label={t('llmHeatmap.summaryTimeout')} value={totals.totalTimeouts.toLocaleString()} sub={t('llmHeatmap.unitCalls')} color="red" />
          <SummaryCard icon={XCircle} label={t('llmHeatmap.summaryError')} value={totals.totalErrors.toLocaleString()} sub={t('llmHeatmap.unitCalls')} color="amber" />
          <SummaryCard icon={Users} label={t('llmHeatmap.summaryMaxDAU')} value={String(totals.maxUsers)} sub={t('llmHeatmap.unitPeople')} color="green" />
          <SummaryCard icon={HeartPulse} label={t('llmHeatmap.summaryHcProbing')} value={totals.totalHc.toLocaleString()} sub={t('llmHeatmap.unitTimes')} color="blue" />
          <SummaryCard icon={ShieldCheck} label={t('llmHeatmap.summaryHcSuccessRate')} value={totals.hcSuccessRate !== null ? `${totals.hcSuccessRate}` : '-'} sub={t('llmHeatmap.unitPercent')} color="green" />
          <SummaryCard icon={Clock} label={t('llmHeatmap.summaryHcAvg')} value={totals.hcAvgLatency !== null ? `${totals.hcAvgLatency}` : '-'} sub={t('llmHeatmap.unitMs')} color="purple" />
        </div>
      )}

      {/* ── Heatmap ── */}
      {selectedModels.size > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          {heatmapLoading ? (
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner message={t('llmHeatmap.loadingData', { count: selectedModels.size })} />
            </div>
          ) : heatmapError ? (
            <div className="text-center py-16">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-400" />
              <p className="text-sm font-medium text-red-600 mb-1">{t('llmHeatmap.dataLoadFailed')}</p>
              <p className="text-xs text-red-400 font-mono">{heatmapError}</p>
            </div>
          ) : heatmap.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('llmHeatmap.noCallRecords')}</p>
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

              {/* ── 피크/비피크/전체 평균 카드 ── */}
              {(() => {
                const peak = heatmap.filter(c => c.hour >= 14 && c.hour <= 16);
                const offPeak = heatmap.filter(c => c.hour >= 20 || c.hour < 6);
                const all = heatmap;

                const calcAvg = (cells: HeatmapCell[]): { avg: string; count: number } => {
                  const vals = cells.map(c => activeTab.getValue(c)).filter(v => v > 0);
                  if (vals.length === 0) return { avg: '-', count: cells.length };
                  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
                  return { avg: activeTab.format(Math.round(mean * 10) / 10), count: vals.length };
                };

                const peakStats = calcAvg(peak);
                const offStats = calcAvg(offPeak);
                const allStats = calcAvg(all);

                return (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-red-50 border border-red-100 rounded-lg p-2.5">
                      <p className="text-[9px] font-semibold text-red-600 mb-0.5">{t('llmHeatmap.peakTime')}</p>
                      <p className="text-lg font-black text-red-700 tabular-nums">{peakStats.avg}</p>
                      <p className="text-[9px] text-red-400">{t('llmHeatmap.avgOfCount', { count: peakStats.count })}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-2.5">
                      <p className="text-[9px] font-semibold text-gray-500 mb-0.5">{t('llmHeatmap.offHours')}</p>
                      <p className="text-lg font-black text-gray-700 tabular-nums">{offStats.avg}</p>
                      <p className="text-[9px] text-gray-400">{t('llmHeatmap.avgOfCount', { count: offStats.count })}</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                      <p className="text-[9px] font-semibold text-blue-600 mb-0.5">{t('llmHeatmap.allDay')}</p>
                      <p className="text-lg font-black text-blue-700 tabular-nums">{allStats.avg}</p>
                      <p className="text-[9px] text-blue-400">{t('llmHeatmap.avgOfCount', { count: allStats.count })}</p>
                    </div>
                  </div>
                );
              })()}

              {/* ── 합산 모드: 히트맵 1개 ── */}
              {(viewMode === 'merge' || selectedModels.size === 1) && (
                <HeatmapGrid dates={dates} cellMap={heatmapMap} activeTab={activeTab} hmTab={hmTab} />
              )}

              {/* ── 비교 모드: 모델별 히트맵 ── */}
              {viewMode === 'compare' && selectedModels.size >= 2 && (
                <div className="space-y-4">
                  {[...perModelData.entries()].map(([modelId, data]) => {
                    const modelDates = [...new Set(data.heatmap.map(h => h.date))].sort();
                    const modelCellMap = new Map<string, HeatmapCell>();
                    for (const c of data.heatmap) modelCellMap.set(`${c.date}|${c.hour}`, c);
                    return (
                      <div key={modelId} className="border border-gray-100 rounded-lg p-3">
                        <p className="text-[11px] font-bold text-gray-800 mb-2">{data.displayName}</p>
                        <HeatmapGrid dates={modelDates} cellMap={modelCellMap} activeTab={activeTab} hmTab={hmTab} compact />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Daily Trend Mini Chart ── */}
              {daily.length > 1 && (viewMode === 'merge' || selectedModels.size === 1) && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-600 mb-2">{t('llmHeatmap.dailyTrend')}</p>
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
                          title={[
                            d.date,
                            t('llmHeatmap.dailyTooltipCalls', { count: d.callCount.toLocaleString() }),
                            t('llmHeatmap.dailyTooltipAvg', { latency: d.avgLatency ?? '-' }),
                            t('llmHeatmap.dailyTooltipTimeout', { count: d.timeoutCount }),
                            t('llmHeatmap.dailyTooltipError', { count: d.errorCount }),
                            t('llmHeatmap.dailyTooltipUsers', { count: d.uniqueUsers }),
                          ].join('\n')}
                        />
                      );
                    });
                    })()}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[8px] text-gray-400">{daily[0]?.date.slice(5)}</span>
                    <div className="flex items-center gap-3 text-[8px] text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-500 inline-block" /> {t('llmHeatmap.weekday')}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-300 inline-block" /> {t('llmHeatmap.weekendLabel')}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> {t('llmHeatmap.timeoutOccurred')}</span>
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
function HeatmapGrid({ dates, cellMap, activeTab, hmTab, compact }: {
  dates: string[];
  cellMap: Map<string, HeatmapCell>;
  activeTab: { key: string; getValue: (c: HeatmapCell) => number; getColor: (v: number) => string; format: (v: number) => string };
  hmTab: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const cellH = compact ? 'h-5' : 'h-7';
  const fontSize = compact ? 'text-[6px]' : 'text-[8px]';
  return (
    <>
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          <div className="flex">
            <div className="w-20 shrink-0" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className={`flex-1 text-center ${fontSize} text-gray-400 font-semibold pb-1`}>{h}</div>
            ))}
          </div>
          {dates.map(dt => {
            const dayIdx = new Date(dt + 'T00:00:00+09:00').getDay();
            const dayOfWeek = t(`llmHeatmap.weekdays.${weekdayKeys[dayIdx]}`);
            const isWeekend = dayIdx === 0 || dayIdx === 6;
            return (
              <div key={dt} className="flex items-center">
                <div className={`w-20 shrink-0 text-[9px] pr-1.5 text-right tabular-nums ${isWeekend ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>
                  {dt.slice(5)} {dayOfWeek}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const cell = cellMap.get(`${dt}|${h}`);
                  const val = cell ? activeTab.getValue(cell) : 0;
                  const bg = cell ? activeTab.getColor(val) : '#f8fafc';
                  const textColor = val > 0
                    ? (['#7f1d1d', '#dc2626', '#7c3aed', '#15803d'].includes(bg) ? '#fff' : ['#f59e0b', '#fb923c', '#8b5cf6'].includes(bg) ? '#fff' : '#1e293b')
                    : '#d1d5db';
                  return (
                    <div
                      key={h}
                      className={`flex-1 ${cellH} border border-white/60 cursor-help flex items-center justify-center ${fontSize} font-bold`}
                      style={{ backgroundColor: bg, color: textColor }}
                      title={[
                        t('llmHeatmap.tooltipDate', { date: dt, hour: h }),
                        t('llmHeatmap.tooltipCalls', { count: cell?.callCount ?? 0, success: cell?.successCount ?? 0 }),
                        t('llmHeatmap.tooltipLatency', { avg: cell?.avgLatency ?? '-', p95: cell?.p95Latency ?? '-' }),
                        t('llmHeatmap.tooltipErrors', { timeout: cell?.timeoutCount ?? 0, error: cell?.errorCount ?? 0 }),
                        t('llmHeatmap.tooltipHc', { count: cell?.hcCount ?? 0, latency: cell?.hcAvgLatency ?? '-' }),
                      ].join('\n')}
                    >
                      {val > 0 ? activeTab.format(val) : val === 0 && (hmTab === 'errorRate' || hmTab === 'successRate' || hmTab === 'hcSuccess') && cell && (hmTab.startsWith('hc') ? cell.hcCount > 0 : cell.callCount > 0) ? activeTab.format(val) : ''}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {!compact && (
        <div className="mt-3 flex items-center gap-2 text-[9px] text-gray-500">
          <span>{t('llmHeatmap.legendLow')}</span>
          {activeTab.key === 'callCount' && ['#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed'].map((c, i) => <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />)}
          {(activeTab.key === 'latency' || activeTab.key === 'p95' || activeTab.key === 'hcLatency') && ['#f0fdf4', '#22d3ee', '#3b82f6', '#f59e0b', '#dc2626', '#7f1d1d'].map((c, i) => <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />)}
          {activeTab.key === 'timeout' && ['#f0fdf4', '#fb923c', '#f59e0b', '#dc2626', '#7f1d1d'].map((c, i) => <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />)}
          {activeTab.key === 'errorRate' && ['#f0fdf4', '#fde68a', '#fb923c', '#f59e0b', '#dc2626', '#7f1d1d'].map((c, i) => <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />)}
          {(activeTab.key === 'successRate' || activeTab.key === 'hcSuccess') && ['#dc2626', '#f59e0b', '#86efac', '#22c55e', '#15803d'].map((c, i) => <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />)}
          <span>{t('llmHeatmap.legendHigh')}</span>
        </div>
      )}
    </>
  );
}

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
