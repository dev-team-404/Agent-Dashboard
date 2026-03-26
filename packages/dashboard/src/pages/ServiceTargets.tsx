import { useState, useEffect, useCallback } from 'react';
import { Target, Search, Sparkles, BookOpen } from 'lucide-react';
import { api } from '../services/api';
import DeptSavedMM from './DeptSavedMM';
import SavedMMGuide from '../components/Tour/SavedMMGuide';

interface DeptBreakdown {
  deptname: string;
  savedMM: number;
  updatedBy: string | null;
}

interface AiDeptBreakdown {
  deptname: string;
  aiEstimatedMM: number;
}

interface ServiceTarget {
  id: string;
  name: string;
  displayName: string;
  type: 'STANDARD' | 'BACKGROUND';
  status: 'DEVELOPMENT' | 'DEPLOYED';
  enabled: boolean;
  targetMM: number | null;
  aggregatedSavedMM: number | null;
  savedMMBreakdown: DeptBreakdown[];
  aggregatedAiEstimatedMM: number | null;
  aiEstimatedMMBreakdown: AiDeptBreakdown[];
  totalMauLastMonth: number | null;
  totalMauCurrentMonth: number | null;
  totalDauAvgLastMonth: number | null;
  totalLlmCallCountLastMonth: number | null;
  myDeptMauLastMonth: number | null;
  myDeptCallsLastMonth: number | null;
  registeredBy: string | null;
  registeredByDept: string | null;
  team?: string | null;
  center2Name?: string | null;
  center1Name?: string | null;
  createdAt: string;
}

interface AiEstimation {
  serviceId: string;
  date: string;
  estimatedMM: number;
  confidence: string;
  reasoning: string;
  dauUsed: number;
  isEstimatedDau: boolean;
  totalCalls: number;
  createdAt: string;
}

type TabKey = 'targets' | 'dept-saved';

export default function ServiceTargets() {
  const [activeTab, setActiveTab] = useState<TabKey>('dept-saved');
  const [services, setServices] = useState<ServiceTarget[]>([]);
  const [aiMap, setAiMap] = useState<Map<string, AiEstimation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedAi, setExpandedAi] = useState<string | null>(null);
  const [hoveredSavedMM, setHoveredSavedMM] = useState<string | null>(null);
  const [hoveredAiMM, setHoveredAiMM] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const loadServices = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const [svcRes, aiRes] = await Promise.all([
        api.get('/admin/service-targets'),
        api.get('/admin/ai-estimations').catch(() => ({ data: { estimations: [] } })),
      ]);
      setServices(svcRes.data.services || []);
      const map = new Map<string, AiEstimation>();
      for (const e of (aiRes.data.estimations || []) as AiEstimation[]) {
        map.set(e.serviceId, e);
      }
      setAiMap(map);
    } catch (err) {
      console.error('Failed to load service targets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'targets') loadServices();
  }, [loadServices, activeTab]);

  useEffect(() => {
    if (!expandedAi) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-ai-popover]')) setExpandedAi(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [expandedAi]);

  const filtered = services.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.displayName.toLowerCase().includes(q) ||
           s.name.toLowerCase().includes(q) ||
           (s.registeredByDept || '').toLowerCase().includes(q);
  });

  const totalServices = services.length;
  const withSaved = services.filter(s => s.aggregatedSavedMM != null && s.aggregatedSavedMM > 0).length;
  const totalSaved = services.reduce((sum, s) => sum + (s.aggregatedSavedMM || 0), 0);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'dept-saved', label: 'Saved M/M 관리' },
    { key: 'targets', label: '서비스 현황' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-indigo-50">
              <Target className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">Saved M/M 관리</h1>
              <p className="text-sm text-pastel-500 mt-0.5">
                서비스별 절감 실적(Saved M/M)을 관리합니다
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowGuide(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-indigo-600 bg-indigo-50 border border-indigo-200 text-sm font-medium rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            관리 가이드
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80">
        <div className="flex border-b border-gray-100/80">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-6 py-3.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-indigo-700'
                  : 'text-pastel-500 hover:text-pastel-700'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'targets' ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
              <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">전체 서비스</p>
              <p className="text-2xl font-bold text-pastel-800 mt-1">{totalServices}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
              <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">총 Saved M/M</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{totalSaved.toFixed(1)}</p>
              <p className="text-xs text-pastel-400 mt-0.5">{withSaved}개 서비스 합산</p>
            </div>
          </div>

          {/* Search */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
              <input
                type="text"
                placeholder="서비스명, 코드, 부서로 검색..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500/30 transition-all duration-200"
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: '900px' }}>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100/80">
                    <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[300px]">서비스</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[80px]">타입</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[80px]">상태</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[130px]">등록 부서</th>
                    <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[130px]">Saved M/M</th>
                    <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[130px]" title="부서별 AI 추정 합산">AI 추정</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100/60">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-20 text-center">
                        <div className="flex flex-col items-center gap-4">
                          <div className="relative">
                            <div className="w-12 h-12 rounded-full border-[3px] border-pastel-200"></div>
                            <div className="absolute inset-0 w-12 h-12 rounded-full border-[3px] border-indigo-500 border-t-transparent animate-spin"></div>
                          </div>
                          <p className="text-sm font-medium text-pastel-500">데이터를 불러오는 중...</p>
                        </div>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="p-4 rounded-lg bg-pastel-50">
                            <Search className="w-8 h-8 text-pastel-300" />
                          </div>
                          <p className="text-sm font-semibold text-pastel-600">검색 결과가 없습니다</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map(s => {
                      const savedVal = s.aggregatedSavedMM;
                      const ai = aiMap.get(s.id);

                      return (
                        <tr key={s.id} className="group transition-colors hover:bg-gray-50/50">
                          {/* Service name + DAU/MAU info */}
                          <td className="px-4 py-3">
                            <div className="max-w-[280px]">
                              <p className="text-sm font-medium text-pastel-800 truncate" title={s.displayName}>{s.displayName}</p>
                              <p className="text-xs text-pastel-400 font-mono truncate">{s.name}</p>
                              {(s.totalMauLastMonth != null || s.totalMauCurrentMonth != null || s.totalLlmCallCountLastMonth != null) && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span className="text-[10px] text-pastel-400">
                                    {'\u{1F4CA}'} 지난달 MAU {s.totalMauLastMonth != null ? s.totalMauLastMonth.toLocaleString() : '-'}
                                    {' / 이번달 MAU '}
                                    {s.totalMauCurrentMonth != null ? s.totalMauCurrentMonth.toLocaleString() : '-'}
                                    {s.totalLlmCallCountLastMonth != null && ` | LLM Calls ${s.totalLlmCallCountLastMonth.toLocaleString()}`}
                                  </span>
                                </div>
                              )}
                              {(s.myDeptMauLastMonth != null || s.myDeptCallsLastMonth != null) && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] text-pastel-400">
                                    {'\u{1F465}'} 우리팀: MAU {s.myDeptMauLastMonth != null ? s.myDeptMauLastMonth.toLocaleString() : '-'}
                                    {' / Calls '}
                                    {s.myDeptCallsLastMonth != null ? s.myDeptCallsLastMonth.toLocaleString() : '-'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                              s.type === 'STANDARD' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80' : 'bg-purple-50 text-purple-700 ring-1 ring-purple-200/80'
                            }`}>
                              {s.type === 'STANDARD' ? '표준' : '백그라운드'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                              s.status === 'DEPLOYED' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80' : 'bg-gray-50 text-gray-600 ring-1 ring-gray-200/80'
                            }`}>
                              {s.status === 'DEPLOYED' ? '배포됨' : '개발중'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-pastel-600 truncate block max-w-[120px]" title={s.registeredByDept || '-'}>
                              {s.registeredByDept || '-'}
                            </span>
                            {(() => {
                              const parts = [s.center1Name, s.center2Name, s.team].filter(v => v && v !== 'none');
                              return parts.length > 0 ? (
                                <span className="text-[10px] text-gray-400 truncate block max-w-[160px]" title={parts.join(' > ')}>
                                  {parts.join(' > ')}
                                </span>
                              ) : null;
                            })()}
                          </td>
                          {/* Saved M/M (aggregated, hover breakdown) */}
                          <td className="px-4 py-3 text-center">
                            <div
                              className="relative inline-block"
                              onMouseEnter={() => setHoveredSavedMM(s.id)}
                              onMouseLeave={() => setHoveredSavedMM(null)}
                            >
                              <span className={`text-sm font-medium cursor-default ${savedVal != null ? 'text-emerald-700' : 'text-pastel-300'}`}>
                                {savedVal != null ? savedVal.toFixed(1) : '-'}
                              </span>
                              {savedVal != null && s.savedMMBreakdown && s.savedMMBreakdown.length > 0 && (
                                <span className="ml-1 text-[10px] text-pastel-400">({s.savedMMBreakdown.length}팀)</span>
                              )}
                              {/* Hover tooltip */}
                              {hoveredSavedMM === s.id && s.savedMMBreakdown && s.savedMMBreakdown.length > 0 && (
                                <div className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 p-3 animate-fade-in">
                                  <p className="text-xs font-semibold text-pastel-700 mb-2">부서별 Saved M/M 내역</p>
                                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {s.savedMMBreakdown.map((bd, idx) => (
                                      <div key={idx} className="flex items-center justify-between text-xs">
                                        <span className="text-pastel-600 truncate max-w-[140px]" title={bd.deptname}>{bd.deptname}</span>
                                        <span className="font-medium text-emerald-700 tabular-nums">{(bd.savedMM ?? 0).toFixed(1)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-xs font-semibold">
                                    <span className="text-pastel-600">합계</span>
                                    <span className="text-emerald-700">{savedVal?.toFixed(1)}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                          {/* AI Estimated M/M (aggregated, hover breakdown) */}
                          <td className="px-4 py-3 text-center">
                            {(() => {
                              const aggAi = s.aggregatedAiEstimatedMM;
                              const aiBreakdown = s.aiEstimatedMMBreakdown;
                              const fallbackAi = ai;

                              if (aggAi != null) {
                                return (
                                  <div
                                    className="relative inline-block"
                                    onMouseEnter={() => setHoveredAiMM(s.id)}
                                    onMouseLeave={() => setHoveredAiMM(null)}
                                    data-ai-popover
                                  >
                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-violet-50 transition-colors cursor-default">
                                      <Sparkles className="w-3 h-3 text-violet-500 flex-shrink-0" />
                                      <span className="text-sm font-bold text-violet-700 tabular-nums whitespace-nowrap">{aggAi.toFixed(1)}</span>
                                    </span>
                                    {aiBreakdown && aiBreakdown.length > 0 && (
                                      <span className="text-[10px] text-pastel-400 block">({aiBreakdown.length}팀)</span>
                                    )}
                                    {hoveredAiMM === s.id && aiBreakdown && aiBreakdown.length > 0 && (
                                      <div className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-2 w-60 bg-white rounded-lg shadow-lg border border-gray-200 p-3 animate-fade-in">
                                        <div className="flex items-center gap-1.5 mb-2">
                                          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                                          <span className="text-xs font-semibold text-violet-700">부서별 AI 추정 내역</span>
                                        </div>
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                          {aiBreakdown.map((bd, idx) => (
                                            <div key={idx} className="flex items-center justify-between text-xs">
                                              <span className="text-pastel-600 truncate max-w-[120px]" title={bd.deptname}>{bd.deptname}</span>
                                              <span className="font-medium text-violet-700 tabular-nums">{(bd.aiEstimatedMM ?? 0).toFixed(1)}</span>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-xs font-semibold">
                                          <span className="text-pastel-600">합계</span>
                                          <span className="text-violet-700">{aggAi.toFixed(1)}</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }

                              // Fallback: legacy AI estimation
                              if (!fallbackAi) return <span className="text-xs text-pastel-300">-</span>;
                              const isExpanded = expandedAi === s.id;
                              const confDot = fallbackAi.confidence === 'HIGH' ? 'bg-emerald-500' : fallbackAi.confidence === 'MEDIUM' ? 'bg-blue-500' : 'bg-amber-500';
                              const confColor = fallbackAi.confidence === 'HIGH' ? 'text-emerald-600' : fallbackAi.confidence === 'MEDIUM' ? 'text-blue-600' : 'text-amber-600';
                              return (
                                <div className="relative" data-ai-popover>
                                  <button
                                    onClick={() => setExpandedAi(isExpanded ? null : s.id)}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-violet-50 transition-colors"
                                    title={fallbackAi.reasoning}
                                  >
                                    <Sparkles className="w-3 h-3 text-violet-500 flex-shrink-0" />
                                    <span className="text-sm font-bold text-violet-700 tabular-nums whitespace-nowrap">{(fallbackAi.estimatedMM ?? 0).toFixed(1)}</span>
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${confDot}`} title={fallbackAi.confidence} />
                                  </button>
                                  {isExpanded && (
                                    <div className="absolute z-20 right-0 top-full mt-1 w-72 p-3 bg-white rounded-lg shadow-lg border border-gray-200 text-left animate-fade-in">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                                        <span className="text-xs font-semibold text-violet-700">AI 추정 {(fallbackAi.estimatedMM ?? 0).toFixed(1)} M/M</span>
                                        <span className={`text-[10px] font-bold ml-auto ${confColor}`}>{fallbackAi.confidence}</span>
                                      </div>
                                      <p className="text-xs text-pastel-600 leading-relaxed">{fallbackAi.reasoning}</p>
                                      <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-pastel-400 space-y-0.5">
                                        <div className="flex items-center gap-3">
                                          <span>5영업일 평균 DAU {fallbackAi.dauUsed}{fallbackAi.isEstimatedDau ? ' (추정)' : ''}</span>
                                          <span>호출 {fallbackAi.totalCalls.toLocaleString()}/일</span>
                                        </div>
                                        <div>매일 자정(KST) 갱신 | {new Date(fallbackAi.createdAt).toLocaleDateString('ko-KR')}</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <DeptSavedMM />
      )}

      {showGuide && <SavedMMGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
