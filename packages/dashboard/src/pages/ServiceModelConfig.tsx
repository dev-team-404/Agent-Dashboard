import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, Loader2,
  Layers, ToggleLeft, ToggleRight, RefreshCw,
  Zap, MessageSquare, Image, Cpu, ArrowUpDown
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ──

interface ServiceModelItem {
  id: string;
  serviceId: string;
  modelId: string;
  sortOrder: number;
  weight: number;
  enabled: boolean;
  addedBy?: string;
  addedAt: string;
  model: {
    id: string;
    name: string;
    displayName: string;
    type: string;
    enabled: boolean;
    visibility?: string;
    maxTokens?: number;
    supportsVision?: boolean;
  };
}

interface AvailableModel {
  id: string;
  name: string;
  displayName: string;
  type: string;
  enabled: boolean;
  visibility?: string;
}

interface ServiceInfo {
  id: string;
  name: string;
  displayName: string;
  type: 'STANDARD' | 'BACKGROUND';
  status: 'DEVELOPMENT' | 'DEPLOYED';
}

const MODEL_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  CHAT: MessageSquare,
  IMAGE: Image,
  EMBEDDING: Cpu,
  RERANKING: ArrowUpDown,
};

const MODEL_TYPE_LABELS: Record<string, string> = {
  CHAT: '채팅',
  IMAGE: '이미지',
  EMBEDDING: '임베딩',
  RERANKING: '리랭킹',
};

export default function ServiceModelConfig() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();

  const [service, setService] = useState<ServiceInfo | null>(null);
  const [serviceModels, setServiceModels] = useState<ServiceModelItem[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [addWeight, setAddWeight] = useState(1);
  const [filterType, setFilterType] = useState<string>('ALL');

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    try {
      const [svcRes, modelsRes, availableRes] = await Promise.all([
        api.get(`/services/${serviceId}`),
        api.get(`/services/${serviceId}/models`),
        api.get('/models'),
      ]);
      setService(svcRes.data.service);
      setServiceModels(modelsRes.data.serviceModels || []);
      setAvailableModels(availableRes.data.models || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived: unassigned models ──
  const assignedModelIds = new Set(serviceModels.map(sm => sm.modelId));
  const unassignedModels = availableModels.filter(m => m.enabled && !assignedModelIds.has(m.id));
  const filteredUnassigned = filterType === 'ALL'
    ? unassignedModels
    : unassignedModels.filter(m => m.type === filterType);

  // ── Derived: group models by name for round-robin visualization ──
  const modelNameCounts: Record<string, number> = {};
  serviceModels.forEach(sm => {
    const name = sm.model.name;
    modelNameCounts[name] = (modelNameCounts[name] || 0) + 1;
  });

  // Colors for round-robin groups
  const RR_COLORS = [
    'border-blue-300 bg-blue-50',
    'border-emerald-300 bg-emerald-50',
    'border-amber-300 bg-amber-50',
    'border-purple-300 bg-purple-50',
    'border-rose-300 bg-rose-50',
    'border-cyan-300 bg-cyan-50',
  ];
  const rrGroupColorMap: Record<string, string> = {};
  let colorIdx = 0;
  Object.entries(modelNameCounts).forEach(([name, count]) => {
    if (count > 1) {
      rrGroupColorMap[name] = RR_COLORS[colorIdx % RR_COLORS.length]!;
      colorIdx++;
    }
  });

  // ── Handlers ──
  const handleAddModel = async () => {
    if (!serviceId || !selectedModelId) return;
    setSaving(true);
    try {
      await api.post(`/services/${serviceId}/models`, {
        modelId: selectedModelId,
        weight: addWeight,
        sortOrder: serviceModels.length,
      });
      setSelectedModelId('');
      setAddWeight(1);
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || '모델 추가에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (sm: ServiceModelItem) => {
    if (!confirm(`'${sm.model.displayName}' 모델을 제거하시겠습니까?`)) return;
    setSaving(true);
    try {
      await api.delete(`/services/${serviceId}/models/${sm.modelId}`);
      await loadData();
    } catch (err) {
      console.error('Failed to remove:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (sm: ServiceModelItem) => {
    setSaving(true);
    try {
      await api.put(`/services/${serviceId}/models/${sm.id}`, {
        enabled: !sm.enabled,
      });
      await loadData();
    } catch (err) {
      console.error('Failed to toggle:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleWeightChange = async (sm: ServiceModelItem, newWeight: number) => {
    const w = Math.max(1, Math.min(10, newWeight));
    setSaving(true);
    try {
      await api.put(`/services/${serviceId}/models/${sm.id}`, { weight: w });
      await loadData();
    } catch (err) {
      console.error('Failed to update weight:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const sorted = [...serviceModels].sort((a, b) => a.sortOrder - b.sortOrder);
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;

    // Swap sort orders
    const items = sorted.map((sm, i) => ({ id: sm.id, sortOrder: i }));
    const temp = items[index]!.sortOrder;
    items[index]!.sortOrder = items[targetIdx]!.sortOrder;
    items[targetIdx]!.sortOrder = temp;

    setSaving(true);
    try {
      await api.put(`/services/${serviceId}/models/reorder`, { items });
      await loadData();
    } catch (err) {
      console.error('Failed to reorder:', err);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">서비스를 찾을 수 없습니다.</p>
        <button onClick={() => navigate('/my-services')} className="mt-3 text-sm text-blue-600 hover:text-blue-700">
          돌아가기
        </button>
      </div>
    );
  }

  const sortedModels = [...serviceModels].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/my-services')}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-500" />
            모델 설정
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {service.displayName}
            <span className="text-gray-300 mx-1.5">&middot;</span>
            <code className="text-xs font-mono text-gray-400">{service.name}</code>
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={saving}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          title="새로고침"
        >
          <RefreshCw className={`w-4.5 h-4.5 ${saving ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl px-5 py-4 mb-6">
        <p className="text-sm text-blue-800 font-medium">라운드로빈 설정</p>
        <p className="text-xs text-blue-600 mt-1 leading-relaxed">
          같은 모델 ID를 가진 여러 모델을 등록하면 자동으로 라운드로빈이 적용됩니다.
          <strong className="font-semibold"> 호출 횟수</strong>를 설정하면 해당 모델이 N번 호출된 후 다음 모델로 넘어갑니다.
          순서는 위에서 아래로 적용됩니다.
        </p>
      </div>

      {/* Add model section */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">모델 추가</h2>
        <div className="flex items-end gap-3">
          {/* Type filter */}
          <div className="w-28">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">타입</label>
            <div className="relative">
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="w-full px-2.5 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 appearance-none pr-7 transition-colors"
              >
                <option value="ALL">전체</option>
                <option value="CHAT">채팅</option>
                <option value="IMAGE">이미지</option>
                <option value="EMBEDDING">임베딩</option>
                <option value="RERANKING">리랭킹</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Model select */}
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">모델 선택</label>
            <div className="relative">
              <select
                value={selectedModelId}
                onChange={e => setSelectedModelId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 appearance-none pr-8 transition-colors"
              >
                <option value="">모델을 선택하세요...</option>
                {filteredUnassigned.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.name}) — {MODEL_TYPE_LABELS[m.type] || m.type}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Weight */}
          <div className="w-28">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">호출 횟수</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={10}
                value={addWeight}
                onChange={e => setAddWeight(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                className="w-14 px-2 py-2 text-sm text-center border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
              />
              <span className="text-xs text-gray-400">회</span>
            </div>
          </div>

          {/* Add button */}
          <button
            onClick={handleAddModel}
            disabled={!selectedModelId || saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            추가
          </button>
        </div>

        {filteredUnassigned.length === 0 && (
          <p className="text-xs text-gray-400 mt-2">
            {unassignedModels.length === 0 ? '추가 가능한 모델이 없습니다.' : '해당 타입의 모델이 없습니다.'}
          </p>
        )}
      </div>

      {/* Model list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            등록된 모델 ({serviceModels.length})
          </h2>
          {serviceModels.length > 1 && (
            <span className="text-[11px] text-gray-400">
              위에서 아래 순서로 라운드로빈 적용
            </span>
          )}
        </div>

        {sortedModels.length === 0 ? (
          <div className="text-center py-12">
            <Layers className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">등록된 모델이 없습니다.</p>
            <p className="text-xs text-gray-300 mt-1">위에서 모델을 추가하세요.</p>
          </div>
        ) : (
          <div>
            {sortedModels.map((sm, idx) => {
              const isRRGroup = (modelNameCounts[sm.model.name] || 0) > 1;
              const rrColor = rrGroupColorMap[sm.model.name] || '';
              const TypeIcon = MODEL_TYPE_ICONS[sm.model.type] || Cpu;

              return (
                <div
                  key={sm.id}
                  className={`flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 last:border-b-0 transition-colors
                    ${!sm.enabled ? 'opacity-50 bg-gray-50/50' : 'hover:bg-gray-50/50'}
                    ${isRRGroup ? `border-l-4 ${rrColor}` : 'border-l-4 border-l-transparent'}`}
                >
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => handleMove(idx, 'up')}
                      disabled={idx === 0 || saving}
                      className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'down')}
                      disabled={idx === sortedModels.length - 1 || saving}
                      className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Order number */}
                  <div className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 text-[11px] font-semibold text-gray-500">
                    {idx + 1}
                  </div>

                  {/* Type icon */}
                  <div className={`w-7 h-7 flex items-center justify-center rounded-lg ${
                    sm.model.type === 'CHAT' ? 'bg-blue-100 text-blue-600' :
                    sm.model.type === 'IMAGE' ? 'bg-purple-100 text-purple-600' :
                    sm.model.type === 'EMBEDDING' ? 'bg-green-100 text-green-600' :
                    'bg-amber-100 text-amber-600'
                  }`}>
                    <TypeIcon className="w-3.5 h-3.5" />
                  </div>

                  {/* Model info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{sm.model.displayName}</p>
                      {isRRGroup && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                          <Zap className="w-2.5 h-2.5" />
                          RR
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 font-mono truncate">{sm.model.name}</p>
                  </div>

                  {/* Weight control */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleWeightChange(sm, sm.weight - 1)}
                      disabled={sm.weight <= 1 || saving}
                      className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold transition-colors"
                    >
                      −
                    </button>
                    <div className="w-16 text-center">
                      <span className="text-sm font-semibold text-gray-700">{sm.weight}</span>
                      <span className="text-[10px] text-gray-400 ml-0.5">회 호출</span>
                    </div>
                    <button
                      onClick={() => handleWeightChange(sm, sm.weight + 1)}
                      disabled={sm.weight >= 10 || saving}
                      className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold transition-colors"
                    >
                      +
                    </button>
                  </div>

                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => handleToggleEnabled(sm)}
                    disabled={saving}
                    className="flex-shrink-0 transition-colors"
                    title={sm.enabled ? '비활성화' : '활성화'}
                  >
                    {sm.enabled ? (
                      <ToggleRight className="w-7 h-7 text-blue-500" />
                    ) : (
                      <ToggleLeft className="w-7 h-7 text-gray-300" />
                    )}
                  </button>

                  {/* Remove */}
                  <button
                    onClick={() => handleRemove(sm)}
                    disabled={saving}
                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    title="제거"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Usage example */}
      <div className="mt-4 px-4 py-3 bg-white border border-gray-100 rounded-xl">
        <p className="text-xs text-gray-400 leading-relaxed">
          <span className="font-medium text-gray-500">사용법 예시:</span> 같은 모델 ID 'gpt-4o'를 3개 등록하고 각각 호출 횟수를 2, 1, 1로 설정하면, 첫 번째 모델이 2번 호출 후 두 번째가 1번, 세 번째가 1번 호출됩니다 (총 4회/사이클). 비활성화된 모델은 라운드로빈에서 제외됩니다.
        </p>
      </div>

      {/* Round-robin explanation */}
      {Object.keys(rrGroupColorMap).length > 0 && (
        <div className="mt-4 px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl">
          <p className="text-xs font-medium text-gray-600 mb-2">라운드로빈 그룹</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(rrGroupColorMap).map(([name, color]) => {
              const models = sortedModels.filter(sm => sm.model.name === name && sm.enabled);
              const totalWeight = models.reduce((sum, m) => sum + m.weight, 0);
              return (
                <div key={name} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${color}`}>
                  <code className="text-xs font-mono font-semibold">{name}</code>
                  <span className="text-[10px] text-gray-500">
                    {models.length}개 모델 · 총 {totalWeight}회/사이클
                  </span>
                  <div className="flex gap-0.5">
                    {models.map((m, i) => (
                      <span key={m.id} className="text-[10px] text-gray-400">
                        {i > 0 && '→'} {m.model.displayName}({m.weight}회)
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
