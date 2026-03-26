import { useState, useEffect, useCallback } from 'react';
import { Search, Save, Loader2, AlertCircle, Check, Sparkles, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { api } from '../services/api';

interface ServiceEntry {
  id: string;
  name: string;
  displayName: string;
  type: 'STANDARD' | 'BACKGROUND';
  status: string;
  deptUserCount: number;
  lastMonth: { avgDau: number; mau: number };
  currentMonth: { avgDau: number; mau: number };
  savedMM: number | null;
  reason: string | null;
  aiEstimatedMM: number | null;
  aiConfidence: string | null;
  aiReasoning: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface DeptSavedMMData {
  deptname: string;
  currentMonth: string;
  lastMonth: string;
  currentMonthBizDays: { elapsed: number; total: number };
  lastMonthBizDays: { total: number };
  services: ServiceEntry[];
}

interface EditState {
  savedMM: string;
  reason: string;
}

type SortKey = 'savedMM' | 'mau' | 'deptUserCount';

export default function DeptSavedMM() {
  const [data, setData] = useState<DeptSavedMMData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ savedMM: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedAi, setExpandedAi] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('savedMM');
  const [sortAsc, setSortAsc] = useState(false);

  const loadData = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const res = await api.get('/admin/dept-saved-mm');
      setData(res.data);
    } catch (err) {
      console.error('Failed to load dept saved MM:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (saveSuccess) {
      const t = setTimeout(() => setSaveSuccess(null), 2000);
      return () => clearTimeout(t);
    }
  }, [saveSuccess]);

  useEffect(() => {
    if (!expandedAi) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-ai-popover]')) setExpandedAi(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [expandedAi]);

  const services = data?.services || [];

  const filtered = services.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.displayName.toLowerCase().includes(q) ||
           s.name.toLowerCase().includes(q);
  });

  // 한번도 입력 안 한 서비스: savedMM=null + updatedBy=null → AI 추정치 폴백
  const effectiveMM = (s: ServiceEntry): number | null =>
    s.savedMM ?? (s.updatedBy == null ? s.aiEstimatedMM : null);
  const isAiFallback = (s: ServiceEntry): boolean =>
    s.savedMM == null && s.updatedBy == null && s.aiEstimatedMM != null;

  const sorted = [...filtered].sort((a, b) => {
    let valA: number, valB: number;
    switch (sortKey) {
      case 'savedMM':
        valA = effectiveMM(a) ?? -Infinity;
        valB = effectiveMM(b) ?? -Infinity;
        break;
      case 'mau':
        valA = a.lastMonth.mau;
        valB = b.lastMonth.mau;
        break;
      case 'deptUserCount':
        valA = a.deptUserCount;
        valB = b.deptUserCount;
        break;
      default:
        valA = 0; valB = 0;
    }
    return sortAsc ? valA - valB : valB - valA;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return <ChevronDown className="w-3 h-3 text-pastel-300 inline ml-0.5" />;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 text-indigo-500 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 text-indigo-500 inline ml-0.5" />;
  };

  const startEdit = (s: ServiceEntry) => {
    setEditingId(s.id);
    const eff = effectiveMM(s);
    setEditState({
      savedMM: eff != null ? String(eff) : '',
      reason: s.reason || '',
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const handleSave = async (serviceId: string) => {
    setSaving(true);
    setError(null);
    try {
      const newSavedMM = editState.savedMM.trim() ? parseFloat(editState.savedMM) : null;

      if (newSavedMM !== null && isNaN(newSavedMM)) {
        setError('Saved M/M에 올바른 숫자를 입력해주세요.');
        setSaving(false);
        return;
      }

      await api.put(`/admin/dept-saved-mm/${serviceId}`, {
        savedMM: newSavedMM,
        reason: editState.reason.trim() || null,
      });
      await loadData(false);
      setEditingId(null);
      setSaveSuccess(serviceId);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // Summary calculations
  const totalServiceCount = services.length;
  const totalDeptUsers = services.reduce((sum, s) => sum + s.deptUserCount, 0);
  const totalEffectiveMM = services.reduce((sum, s) => sum + (effectiveMM(s) || 0), 0);
  const totalManualMM = services.reduce((sum, s) => sum + (s.savedMM || 0), 0);
  const totalAiEstimated = services.reduce((sum, s) => sum + (s.aiEstimatedMM || 0), 0);
  const totalDeptUserCount = services.reduce((sum, s) => sum + s.deptUserCount, 0);
  const hasAnyAiFallback = services.some(s => isAiFallback(s));

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-[3px] border-pastel-200"></div>
          <div className="absolute inset-0 w-12 h-12 rounded-full border-[3px] border-indigo-500 border-t-transparent animate-spin"></div>
        </div>
        <p className="text-sm font-medium text-pastel-500 mt-4">데이터를 불러오는 중...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
        <div className="p-4 rounded-lg bg-red-50">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <p className="text-sm font-semibold text-pastel-600 mt-3">데이터를 불러올 수 없습니다</p>
        <button onClick={() => loadData()} className="mt-3 px-4 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header with department info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-50">
            <Users className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-pastel-800">우리팀 Saved M/M 관리</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80">
                {data.deptname}
              </span>
              <span className="text-xs text-pastel-400">
                {data.currentMonth} ({data.currentMonthBizDays.elapsed}/{data.currentMonthBizDays.total}영업일)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">사용 서비스 수</p>
          <p className="text-2xl font-bold text-pastel-800 mt-1">{totalServiceCount}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">총 부서원 활용</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{totalDeptUserCount || totalDeptUsers}명</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">
            총 Saved M/M
            {hasAnyAiFallback && <span className="ml-1 text-[9px] text-amber-600 font-normal normal-case">(AI 포함)</span>}
          </p>
          <p className={`text-2xl font-bold mt-1 ${hasAnyAiFallback ? 'text-amber-600' : 'text-emerald-600'}`}>{totalEffectiveMM.toFixed(1)}</p>
          {hasAnyAiFallback && totalManualMM > 0 && (
            <p className="text-[10px] text-pastel-400 mt-0.5">수기 {totalManualMM.toFixed(1)}</p>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">총 AI 추정</p>
          <p className="text-2xl font-bold text-violet-600 mt-1">{totalAiEstimated.toFixed(1)}</p>
        </div>
      </div>

      {/* AI fallback info banner */}
      {hasAnyAiFallback && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200/60 rounded-lg">
          <Sparkles className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-700 leading-relaxed">
            사용자가 입력한 Saved M/M 값이 없는 서비스에는 <span className="font-semibold">AI 추정치가 자동 적용</span>되어 있습니다.
            수정 버튼을 눌러 직접 입력하면 AI 추정치 대신 입력값이 반영됩니다.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
          <input
            type="text"
            placeholder="서비스명으로 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500/30 transition-all duration-200"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: '1200px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100/80">
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[180px]">서비스</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[80px]">타입</th>
                <th className="px-3 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[80px] cursor-pointer select-none" onClick={() => toggleSort('deptUserCount')}>
                  부서 사용자 <SortIcon columnKey="deptUserCount" />
                </th>
                <th className="px-3 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">지난달 DAU</th>
                <th className="px-3 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">이번달 DAU</th>
                <th className="px-3 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[70px] cursor-pointer select-none" onClick={() => toggleSort('mau')}>
                  MAU <SortIcon columnKey="mau" />
                </th>
                <th className="px-3 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[110px] cursor-pointer select-none" onClick={() => toggleSort('savedMM')}>
                  Saved M/M <SortIcon columnKey="savedMM" />
                </th>
                <th className="px-3 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[150px]">사유</th>
                <th className="px-3 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[110px]">AI 추정</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 rounded-lg bg-pastel-50">
                        <Search className="w-8 h-8 text-pastel-300" />
                      </div>
                      <p className="text-sm font-semibold text-pastel-600">
                        {search ? '검색 결과가 없습니다' : '사용 중인 서비스가 없습니다'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map(s => {
                  const isEditing = editingId === s.id;
                  const justSaved = saveSuccess === s.id;

                  return (
                    <tr key={s.id} className={`group transition-colors ${isEditing ? 'bg-indigo-50/30' : 'hover:bg-gray-50/50'}`}>
                      <td className="px-4 py-3">
                        <div className="max-w-[180px]">
                          <p className="text-sm font-medium text-pastel-800 truncate" title={s.displayName}>{s.displayName}</p>
                          <p className="text-xs text-pastel-400 font-mono truncate">{s.name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                          s.type === 'STANDARD' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80' : 'bg-purple-50 text-purple-700 ring-1 ring-purple-200/80'
                        }`}>
                          {s.type === 'STANDARD' ? '표준' : '백그라운드'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-sm font-medium text-pastel-700">{s.deptUserCount}명</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-sm text-pastel-700">{s.lastMonth.avgDau.toFixed(1)}</span>
                        <span className="block text-[10px] text-pastel-400">{data.lastMonthBizDays.total}영업일 평균</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-sm text-pastel-700">{s.currentMonth.avgDau.toFixed(1)}</span>
                        <span className="block text-[10px] text-pastel-400">{data.currentMonthBizDays.elapsed}/{data.currentMonthBizDays.total}영업일</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-sm font-medium text-pastel-700">{s.lastMonth.mau}</span>
                      </td>
                      {/* Saved M/M */}
                      <td className="px-3 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={editState.savedMM}
                            onChange={e => setEditState({ ...editState, savedMM: e.target.value })}
                            className="w-20 px-2 py-1.5 text-sm text-center bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="-"
                          />
                        ) : isAiFallback(s) ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-sm font-medium text-amber-600 tabular-nums">
                              {s.aiEstimatedMM!.toFixed(1)}
                              <span className="ml-1 text-[10px] text-amber-500 font-normal">AI</span>
                            </span>
                            <span className="text-[9px] text-amber-500/80 leading-tight">추정치 적용 중</span>
                          </div>
                        ) : (
                          <span className={`text-sm font-medium ${s.savedMM != null ? 'text-emerald-700' : 'text-pastel-300'}`}>
                            {s.savedMM != null ? s.savedMM.toFixed(1) : '-'}
                          </span>
                        )}
                      </td>
                      {/* Reason */}
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editState.reason}
                            onChange={e => setEditState({ ...editState, reason: e.target.value })}
                            className="w-full px-2 py-1.5 text-xs bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="사유 입력"
                          />
                        ) : (
                          <span className="text-xs text-pastel-500 truncate block max-w-[140px]" title={s.reason || ''}>
                            {s.reason || <span className="text-pastel-300">-</span>}
                          </span>
                        )}
                      </td>
                      {/* AI Estimated */}
                      <td className="px-3 py-3 text-center">
                        {(() => {
                          if (s.aiEstimatedMM == null) return <span className="text-xs text-pastel-300">-</span>;
                          const isExpanded = expandedAi === s.id;
                          const conf = s.aiConfidence || 'LOW';
                          const confDot = conf === 'HIGH' ? 'bg-emerald-500' : conf === 'MEDIUM' ? 'bg-blue-500' : 'bg-amber-500';
                          return (
                            <div className="relative" data-ai-popover>
                              <button
                                onClick={() => setExpandedAi(isExpanded ? null : s.id)}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-violet-50 transition-colors"
                                title={s.aiReasoning || ''}
                              >
                                <Sparkles className="w-3 h-3 text-violet-500 flex-shrink-0" />
                                <span className="text-sm font-bold text-violet-700 tabular-nums whitespace-nowrap">{s.aiEstimatedMM.toFixed(1)}</span>
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${confDot}`} title={conf} />
                              </button>
                              {isExpanded && s.aiReasoning && (
                                <div className="absolute z-20 right-0 top-full mt-1 w-72 p-3 bg-white rounded-lg shadow-lg border border-gray-200 text-left animate-fade-in">
                                  <div className="flex items-center gap-1.5 mb-2">
                                    <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                                    <span className="text-xs font-semibold text-violet-700">AI 추정 {s.aiEstimatedMM.toFixed(1)} M/M</span>
                                  </div>
                                  <p className="text-xs text-pastel-600 leading-relaxed">{s.aiReasoning}</p>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleSave(s.id)}
                              disabled={saving}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              저장
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="px-2.5 py-1.5 text-xs font-medium text-pastel-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              취소
                            </button>
                          </div>
                        ) : justSaved ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                            <Check className="w-3.5 h-3.5" /> 저장됨
                          </span>
                        ) : (
                          <button
                            onClick={() => startEdit(s)}
                            disabled={saving}
                            className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            수정
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {error && (
          <div className="px-6 py-3 border-t border-gray-100/80 bg-red-50">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
