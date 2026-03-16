import { useState, useEffect, useCallback } from 'react';
import { Target, Search, Save, Loader2, TrendingUp, AlertCircle, Check } from 'lucide-react';
import { api } from '../services/api';

interface ServiceTarget {
  id: string;
  name: string;
  displayName: string;
  type: 'STANDARD' | 'BACKGROUND';
  status: 'DEVELOPMENT' | 'DEPLOYED';
  enabled: boolean;
  targetMM: number | null;
  savedMM: number | null;
  registeredBy: string | null;
  registeredByDept: string | null;
  team?: string | null;
  center2Name?: string | null;
  center1Name?: string | null;
  createdAt: string;
}

interface EditState {
  targetMM: string;
  savedMM: string;
}

export default function ServiceTargets() {
  const [services, setServices] = useState<ServiceTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ targetMM: '', savedMM: '' });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadServices = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const res = await api.get('/admin/service-targets');
      setServices(res.data.services || []);
    } catch (err) {
      console.error('Failed to load service targets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadServices(); }, [loadServices]);

  // Clear success message after 2s
  useEffect(() => {
    if (saveSuccess) {
      const t = setTimeout(() => setSaveSuccess(null), 2000);
      return () => clearTimeout(t);
    }
  }, [saveSuccess]);

  const filtered = services.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.displayName.toLowerCase().includes(q) ||
           s.name.toLowerCase().includes(q) ||
           (s.registeredByDept || '').toLowerCase().includes(q);
  });

  const startEdit = (s: ServiceTarget) => {
    setEditingId(s.id);
    setEditState({
      targetMM: s.targetMM != null ? String(s.targetMM) : '',
      savedMM: s.savedMM != null ? String(s.savedMM) : '',
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const handleSave = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, number | null> = {};
      const service = services.find(s => s.id === id);
      if (!service) { setSaving(false); return; }

      const newTargetMM = editState.targetMM.trim() ? parseFloat(editState.targetMM) : null;
      const newSavedMM = editState.savedMM.trim() ? parseFloat(editState.savedMM) : null;

      // NaN 검증
      if (newTargetMM !== null && isNaN(newTargetMM)) {
        setError('목표 M/M에 올바른 숫자를 입력해주세요.');
        setSaving(false);
        return;
      }
      if (newSavedMM !== null && isNaN(newSavedMM)) {
        setError('Saved M/M에 올바른 숫자를 입력해주세요.');
        setSaving(false);
        return;
      }

      // Only send changed values
      if (newTargetMM !== service.targetMM) payload.targetMM = newTargetMM;
      if (newSavedMM !== service.savedMM) payload.savedMM = newSavedMM;

      if (Object.keys(payload).length === 0) {
        setEditingId(null);
        setSaving(false);
        return;
      }

      await api.put(`/admin/service-targets/${id}`, payload);
      await loadServices(false);
      setEditingId(null);
      setSaveSuccess(id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const getAchievementPercent = (target: number | null, saved: number | null): number | null => {
    if (target == null || target === 0 || saved == null) return null;
    return Math.round((saved / target) * 100);
  };

  const getAchievementColor = (pct: number | null): string => {
    if (pct == null) return 'text-gray-400';
    if (pct >= 100) return 'text-emerald-600';
    if (pct >= 70) return 'text-blue-600';
    if (pct >= 40) return 'text-amber-600';
    return 'text-red-500';
  };

  const getAchievementBg = (pct: number | null): string => {
    if (pct == null) return 'bg-gray-100';
    if (pct >= 100) return 'bg-emerald-50 ring-1 ring-emerald-200/80';
    if (pct >= 70) return 'bg-blue-50 ring-1 ring-blue-200/80';
    if (pct >= 40) return 'bg-amber-50 ring-1 ring-amber-200/80';
    return 'bg-red-50 ring-1 ring-red-200/80';
  };

  // Summary stats
  const totalServices = services.length;
  const withTargets = services.filter(s => s.targetMM != null).length;
  const withSaved = services.filter(s => s.savedMM != null).length;
  const totalTarget = services.reduce((sum, s) => sum + (s.targetMM || 0), 0);
  const totalSaved = services.reduce((sum, s) => sum + (s.savedMM || 0), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-indigo-50">
            <Target className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">서비스 목표 관리</h1>
            <p className="text-sm text-pastel-500 mt-0.5">
              서비스별 목표 M/M과 절감 실적(Saved M/M)을 관리합니다
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">전체 서비스</p>
          <p className="text-2xl font-bold text-pastel-800 mt-1">{totalServices}</p>
          <p className="text-xs text-pastel-400 mt-0.5">목표 설정: {withTargets}건</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">총 목표 M/M</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{totalTarget.toFixed(1)}</p>
          <p className="text-xs text-pastel-400 mt-0.5">{withTargets}개 서비스 합산</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">총 Saved M/M</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{totalSaved.toFixed(1)}</p>
          <p className="text-xs text-pastel-400 mt-0.5">{withSaved}개 서비스 합산</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">전체 달성률</p>
          <p className={`text-2xl font-bold mt-1 ${getAchievementColor(overallPct)}`}>
            {overallPct != null ? `${overallPct}%` : '-'}
          </p>
          <p className="text-xs text-pastel-400 mt-0.5">목표 대비 실적</p>
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
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">서비스</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">타입</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">상태</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[130px]">등록 부서</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[130px]">목표 M/M</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[130px]">Saved M/M</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">달성률</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-20 text-center">
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
                  <td colSpan={8} className="px-5 py-20 text-center">
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
                  const isEditing = editingId === s.id;
                  const pct = getAchievementPercent(s.targetMM, s.savedMM);
                  const justSaved = saveSuccess === s.id;

                  return (
                    <tr key={s.id} className={`group transition-colors ${isEditing ? 'bg-indigo-50/30' : 'hover:bg-gray-50/50'}`}>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-pastel-800">{s.displayName}</p>
                          <p className="text-xs text-pastel-400 font-mono">{s.name}</p>
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
                        {s.team && (
                          <span className="text-[10px] text-gray-400 truncate block max-w-[160px]" title={[s.center1Name, s.center2Name, s.team].filter(Boolean).join(' > ')}>
                            {[s.center1Name, s.center2Name, s.team].filter(Boolean).join(' > ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={editState.targetMM}
                            onChange={e => setEditState({ ...editState, targetMM: e.target.value })}
                            className="w-24 px-2 py-1.5 text-sm text-center bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="-"
                          />
                        ) : (
                          <span className="text-sm font-medium text-pastel-700">
                            {s.targetMM != null ? s.targetMM.toFixed(1) : <span className="text-pastel-300">-</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={editState.savedMM}
                            onChange={e => setEditState({ ...editState, savedMM: e.target.value })}
                            className="w-24 px-2 py-1.5 text-sm text-center bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="-"
                          />
                        ) : (
                          <span className="text-sm font-medium text-pastel-700">
                            {s.savedMM != null ? s.savedMM.toFixed(1) : <span className="text-pastel-300">-</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <span className="text-xs text-pastel-400">-</span>
                        ) : (
                          <span className={`inline-flex items-center px-2.5 py-1 text-xs font-bold rounded-full ${getAchievementBg(pct)} ${getAchievementColor(pct)}`}>
                            {pct != null ? (
                              <><TrendingUp className="w-3 h-3 mr-1" />{pct}%</>
                            ) : '-'}
                          </span>
                        )}
                      </td>
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
