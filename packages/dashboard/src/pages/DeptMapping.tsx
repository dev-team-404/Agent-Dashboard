import { useState, useEffect, useCallback } from 'react';
import { Search, Save, Loader2, AlertCircle, Check, RefreshCw, MapPin } from 'lucide-react';
import { api } from '../services/api';

interface DeptMappingEntry {
  id: string;
  departmentCode: string;
  departmentName: string;
  team: string;
  center2Name: string;
  center1Name: string;
  updatedAt: string;
}

interface EditState {
  team: string;
  center2Name: string;
  center1Name: string;
}

// Distinct colors for center1Name groups
const CENTER_COLORS: Record<string, string> = {};
const COLOR_PALETTE = [
  'bg-blue-50/40',
  'bg-emerald-50/40',
  'bg-violet-50/40',
  'bg-amber-50/40',
  'bg-rose-50/40',
  'bg-cyan-50/40',
  'bg-orange-50/40',
  'bg-lime-50/40',
  'bg-fuchsia-50/40',
  'bg-teal-50/40',
];

function getCenterColor(center1Name: string): string {
  if (!center1Name || center1Name === 'none') return '';
  if (!CENTER_COLORS[center1Name]) {
    const idx = Object.keys(CENTER_COLORS).length;
    CENTER_COLORS[center1Name] = COLOR_PALETTE[idx % COLOR_PALETTE.length];
  }
  return CENTER_COLORS[center1Name];
}

export default function DeptMapping() {
  const [mappings, setMappings] = useState<DeptMappingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ team: '', center2Name: '', center1Name: '' });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const loadData = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const res = await api.get('/admin/dept-mapping');
      setMappings(res.data.mappings || []);
      // Reset color map on fresh load
      Object.keys(CENTER_COLORS).forEach(k => delete CENTER_COLORS[k]);
    } catch (err) {
      console.error('Failed to load dept mappings:', err);
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
    if (syncResult) {
      const t = setTimeout(() => setSyncResult(null), 4000);
      return () => clearTimeout(t);
    }
  }, [syncResult]);

  const filtered = mappings.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.departmentCode.toLowerCase().includes(q) ||
           m.departmentName.toLowerCase().includes(q) ||
           m.team.toLowerCase().includes(q) ||
           m.center2Name.toLowerCase().includes(q) ||
           m.center1Name.toLowerCase().includes(q);
  });

  const startEdit = (m: DeptMappingEntry) => {
    setEditingId(m.id);
    setEditState({
      team: m.team || '',
      center2Name: m.center2Name || '',
      center1Name: m.center1Name || '',
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
      const mapping = mappings.find(m => m.id === id);
      if (!mapping) { setSaving(false); return; }

      const payload: Record<string, string> = {};
      if (editState.team !== mapping.team) payload.team = editState.team;
      if (editState.center2Name !== mapping.center2Name) payload.center2Name = editState.center2Name;
      if (editState.center1Name !== mapping.center1Name) payload.center1Name = editState.center1Name;

      if (Object.keys(payload).length === 0) {
        setEditingId(null);
        setSaving(false);
        return;
      }

      await api.put(`/admin/dept-mapping/${id}`, payload);
      await loadData(false);
      setEditingId(null);
      setSaveSuccess(id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.post('/admin/dept-mapping/sync');
      const d = res.data;
      const msg = d.created > 0
        ? `${d.totalMissing}개 미등록 부서 중 ${d.created}개 동기화 완료${d.errors ? ` (${d.errors}개 실패)` : ''}`
        : d.totalMissing === 0
          ? '모든 부서가 이미 등록되어 있습니다'
          : `동기화 실패 (${d.errors || 0}개 에러)`;
      setSyncResult(msg);
      await loadData(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSyncResult(msg || '동기화에 실패했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-teal-50">
            <MapPin className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">부서 매핑 관리</h1>
            <p className="text-sm text-pastel-500 mt-0.5">부서코드를 Team, Center 매핑으로 관리합니다</p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '동기화 중...' : '부서 동기화'}
        </button>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className="flex items-center gap-2 px-5 py-3 rounded-lg bg-teal-50 border border-teal-100 text-sm text-teal-700 animate-fade-in">
          <Check className="w-4 h-4 flex-shrink-0" />
          {syncResult}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">전체 매핑</p>
          <p className="text-2xl font-bold text-pastel-800 mt-1">{mappings.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">Center 1</p>
          <p className="text-2xl font-bold text-teal-600 mt-1">{new Set(mappings.map(m => m.center1Name).filter(Boolean)).size}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">Center 2</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{new Set(mappings.map(m => m.center2Name).filter(Boolean)).size}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
          <p className="text-xs font-medium text-pastel-500 uppercase tracking-wider">Team</p>
          <p className="text-2xl font-bold text-violet-600 mt-1">{new Set(mappings.map(m => m.team).filter(Boolean)).size}</p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
          <input
            type="text"
            placeholder="부서코드, 부서명, Team, Center로 검색..."
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
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[120px]">부서코드</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[180px]">한글 부서명</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[160px]">Team (영문)</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[160px]">Center 2 (영문)</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[160px]">Center 1 (영문)</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">갱신일</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative">
                        <div className="w-12 h-12 rounded-full border-[3px] border-pastel-200"></div>
                        <div className="absolute inset-0 w-12 h-12 rounded-full border-[3px] border-teal-500 border-t-transparent animate-spin"></div>
                      </div>
                      <p className="text-sm font-medium text-pastel-500">데이터를 불러오는 중...</p>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 rounded-lg bg-pastel-50">
                        <Search className="w-8 h-8 text-pastel-300" />
                      </div>
                      <p className="text-sm font-semibold text-pastel-600">
                        {search ? '검색 결과가 없습니다' : '매핑 데이터가 없습니다'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(m => {
                  const isEditing = editingId === m.id;
                  const justSaved = saveSuccess === m.id;
                  const rowColor = getCenterColor(m.center1Name);

                  return (
                    <tr key={m.id} className={`group transition-colors ${isEditing ? 'bg-indigo-50/30' : rowColor || 'hover:bg-gray-50/50'}`}>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-pastel-600">{m.departmentCode}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-pastel-800">{m.departmentName}</span>
                      </td>
                      {/* Team - editable */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editState.team}
                            onChange={e => setEditState({ ...editState, team: e.target.value })}
                            className="w-full px-2 py-1.5 text-sm bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="Team name"
                          />
                        ) : (
                          <span className="text-sm text-pastel-700">{m.team || <span className="text-pastel-300">-</span>}</span>
                        )}
                      </td>
                      {/* Center 2 - editable */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editState.center2Name}
                            onChange={e => setEditState({ ...editState, center2Name: e.target.value })}
                            className="w-full px-2 py-1.5 text-sm bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="Center 2"
                          />
                        ) : (
                          <span className="text-sm text-pastel-700">{m.center2Name || <span className="text-pastel-300">-</span>}</span>
                        )}
                      </td>
                      {/* Center 1 - editable */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editState.center1Name}
                            onChange={e => setEditState({ ...editState, center1Name: e.target.value })}
                            className="w-full px-2 py-1.5 text-sm bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            placeholder="Center 1"
                          />
                        ) : (
                          <span className="text-sm text-pastel-700">{m.center1Name || <span className="text-pastel-300">-</span>}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs text-pastel-400">
                          {m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('ko-KR') : '-'}
                        </span>
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleSave(m.id)}
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
                            onClick={() => startEdit(m)}
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
