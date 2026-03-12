import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, ChevronDown, Loader2,
  Layers, ToggleLeft, ToggleRight, RefreshCw,
  Zap, MessageSquare, Image, Cpu, Sparkles,
  AlertTriangle, X, Edit2, Check
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ──

interface ServiceModelItem {
  id: string;
  serviceId: string;
  modelId: string;
  aliasName: string;
  sortOrder: number;
  weight: number;
  enabled: boolean;
  addedBy?: string;
  addedAt: string;
  accessible: boolean;
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

interface AliasGroup {
  aliasName: string;
  items: ServiceModelItem[];
}

const MODEL_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  CHAT: MessageSquare,
  IMAGE: Image,
  EMBEDDING: Layers,
  RERANKING: Sparkles,
};

const MODEL_TYPE_LABELS: Record<string, string> = {
  CHAT: '채팅',
  IMAGE: '이미지',
  EMBEDDING: '임베딩',
  RERANKING: '리랭킹',
};

const GROUP_COLORS = [
  'border-l-blue-400',
  'border-l-emerald-400',
  'border-l-amber-400',
  'border-l-purple-400',
  'border-l-rose-400',
  'border-l-cyan-400',
  'border-l-teal-400',
  'border-l-orange-400',
];

export default function ServiceModelConfig() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();

  const [service, setService] = useState<ServiceInfo | null>(null);
  const [serviceModels, setServiceModels] = useState<ServiceModelItem[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 새 alias 그룹 추가
  const [newAliasName, setNewAliasName] = useState('');
  const [showNewAliasForm, setShowNewAliasForm] = useState(false);

  // 모델 추가 대상 alias
  const [addingToAlias, setAddingToAlias] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [addWeight, setAddWeight] = useState(1);
  const [filterType, setFilterType] = useState<string>('ALL');

  // alias 이름 수정
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [editAliasValue, setEditAliasValue] = useState('');

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    try {
      const [svcRes, modelsRes, availableRes] = await Promise.all([
        api.get(`/services/${serviceId}`),
        api.get(`/services/${serviceId}/models`),
        api.get(`/services/${serviceId}/available-models`),
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

  // ── Derived: alias groups ──
  const aliasGroups: AliasGroup[] = [];
  const aliasMap = new Map<string, ServiceModelItem[]>();

  serviceModels.forEach(sm => {
    const key = sm.aliasName;
    if (!aliasMap.has(key)) aliasMap.set(key, []);
    aliasMap.get(key)!.push(sm);
  });

  aliasMap.forEach((items, aliasName) => {
    aliasGroups.push({
      aliasName,
      items: items.sort((a, b) => a.sortOrder - b.sortOrder),
    });
  });

  // ── Available models for adding ──
  const getAvailableForAlias = (aliasName: string) => {
    const assignedIds = new Set(
      serviceModels
        .filter(sm => sm.aliasName === aliasName)
        .map(sm => sm.modelId)
    );
    const filtered = availableModels.filter(m => m.enabled && !assignedIds.has(m.id));
    return filterType === 'ALL' ? filtered : filtered.filter(m => m.type === filterType);
  };

  // ── Handlers ──
  const handleCreateAliasGroup = async () => {
    const name = newAliasName.trim();
    if (!name) return;
    // alias만 생성 (모델은 나중에 추가)
    setShowNewAliasForm(false);
    setNewAliasName('');
    setAddingToAlias(name);
  };

  const handleAddModelToAlias = async (aliasName: string) => {
    if (!serviceId || !selectedModelId) return;
    setSaving(true);
    try {
      await api.post(`/services/${serviceId}/models`, {
        modelId: selectedModelId,
        aliasName,
        weight: addWeight,
        sortOrder: serviceModels.filter(sm => sm.aliasName === aliasName).length,
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

  const handleRemoveModel = async (sm: ServiceModelItem) => {
    if (!confirm(`'${sm.model.displayName}'을(를) '${sm.aliasName}' 그룹에서 제거하시겠습니까?`)) return;
    setSaving(true);
    try {
      await api.delete(`/services/${serviceId}/service-models/${sm.id}`);
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

  const handleDeleteAliasGroup = async (aliasName: string) => {
    const items = serviceModels.filter(sm => sm.aliasName === aliasName);
    if (!confirm(`'${aliasName}' 그룹과 내부 모델 ${items.length}개를 모두 제거하시겠습니까?`)) return;
    setSaving(true);
    try {
      for (const sm of items) {
        await api.delete(`/services/${serviceId}/service-models/${sm.id}`);
      }
      if (addingToAlias === aliasName) setAddingToAlias(null);
      await loadData();
    } catch (err) {
      console.error('Failed to delete group:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleRenameAlias = async (oldAlias: string) => {
    const newAlias = editAliasValue.trim();
    if (!newAlias || newAlias === oldAlias) {
      setEditingAlias(null);
      return;
    }
    setSaving(true);
    try {
      const items = serviceModels.filter(sm => sm.aliasName === oldAlias);
      for (const sm of items) {
        // 기존 삭제 후 새 aliasName으로 재생성
        await api.delete(`/services/${serviceId}/service-models/${sm.id}`);
        await api.post(`/services/${serviceId}/models`, {
          modelId: sm.modelId,
          aliasName: newAlias,
          weight: sm.weight,
          sortOrder: sm.sortOrder,
          enabled: sm.enabled,
        });
      }
      setEditingAlias(null);
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || '이름 변경에 실패했습니다.');
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
        <p className="text-sm text-blue-800 font-medium">v1/models 가상 모델 설정</p>
        <p className="text-xs text-blue-600 mt-1 leading-relaxed">
          <strong>표시 모델명</strong>을 만들고 그 안에 실제 LLM 모델들을 배치하세요.
          v1/models API 호출 시 <strong>표시 모델명</strong>만 노출되며,
          내부적으로는 배치된 모델들이 <strong>가중치 기반 라운드로빈</strong>으로 분배됩니다.
        </p>
      </div>

      {/* Alias Groups */}
      <div className="space-y-4 mb-6">
        {aliasGroups.map((group, groupIdx) => {
          const totalWeight = group.items.filter(sm => sm.enabled).reduce((sum, sm) => sum + sm.weight, 0);
          const enabledCount = group.items.filter(sm => sm.enabled).length;
          const hasInaccessible = group.items.some(sm => !sm.accessible);
          const colorClass = GROUP_COLORS[groupIdx % GROUP_COLORS.length];
          const isEditing = editingAlias === group.aliasName;

          return (
            <div key={group.aliasName} className={`bg-white border border-gray-200 rounded-xl overflow-hidden border-l-4 ${colorClass}`}>
              {/* Group header */}
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
                <Zap className="w-4 h-4 text-blue-500 flex-shrink-0" />
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editAliasValue}
                      onChange={e => setEditAliasValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRenameAlias(group.aliasName)}
                      className="px-2 py-1 text-sm font-semibold border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 flex-1"
                      autoFocus
                    />
                    <button
                      onClick={() => handleRenameAlias(group.aliasName)}
                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingAlias(null)}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-semibold text-gray-900">{group.aliasName}</code>
                        <button
                          onClick={() => { setEditingAlias(group.aliasName); setEditAliasValue(group.aliasName); }}
                          className="p-0.5 text-gray-300 hover:text-gray-500 transition-colors"
                          title="이름 변경"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        {hasInaccessible && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-red-50 text-red-600 rounded">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            접근 불가 모델 포함
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {group.items.length}개 모델
                        {enabledCount > 1 && ` · 라운드로빈 ${totalWeight}회/사이클`}
                      </p>
                    </div>
                    <button
                      onClick={() => setAddingToAlias(addingToAlias === group.aliasName ? null : group.aliasName)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      모델 추가
                    </button>
                    <button
                      onClick={() => handleDeleteAliasGroup(group.aliasName)}
                      disabled={saving}
                      className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                      title="그룹 삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>

              {/* Add model inline form */}
              {addingToAlias === group.aliasName && (
                <div className="px-5 py-3 border-b border-gray-100 bg-blue-50/30">
                  <div className="flex items-end gap-3">
                    <div className="w-24">
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">타입</label>
                      <div className="relative">
                        <select
                          value={filterType}
                          onChange={e => setFilterType(e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none pr-6"
                        >
                          <option value="ALL">전체</option>
                          <option value="CHAT">채팅</option>
                          <option value="IMAGE">이미지</option>
                          <option value="EMBEDDING">임베딩</option>
                          <option value="RERANKING">리랭킹</option>
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">모델 선택</label>
                      <div className="relative">
                        <select
                          value={selectedModelId}
                          onChange={e => setSelectedModelId(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none pr-7"
                        >
                          <option value="">모델을 선택하세요...</option>
                          {getAvailableForAlias(group.aliasName).map(m => (
                            <option key={m.id} value={m.id}>
                              {m.displayName} ({m.name}) — {MODEL_TYPE_LABELS[m.type] || m.type}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <div className="w-20">
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">가중치</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={addWeight}
                        onChange={e => setAddWeight(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                        className="w-full px-2 py-1.5 text-xs text-center border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <button
                      onClick={() => handleAddModelToAlias(group.aliasName)}
                      disabled={!selectedModelId || saving}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      추가
                    </button>
                    <button
                      onClick={() => { setAddingToAlias(null); setSelectedModelId(''); }}
                      className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Model list within group */}
              {group.items.length === 0 ? (
                <div className="text-center py-6 text-xs text-gray-400">
                  모델을 추가하세요.
                </div>
              ) : (
                <div>
                  {group.items.map((sm) => {
                    const TypeIcon = MODEL_TYPE_ICONS[sm.model.type] || Cpu;
                    const isInaccessible = !sm.accessible;

                    return (
                      <div
                        key={sm.id}
                        className={`flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-b-0 transition-colors
                          ${isInaccessible ? 'bg-red-50/60' : !sm.enabled ? 'opacity-50 bg-gray-50/50' : 'hover:bg-gray-50/50'}`}
                      >
                        {/* Type icon */}
                        <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ${
                          isInaccessible ? 'bg-red-100 text-red-500' :
                          sm.model.type === 'CHAT' ? 'bg-blue-100 text-blue-600' :
                          sm.model.type === 'IMAGE' ? 'bg-purple-100 text-purple-600' :
                          sm.model.type === 'EMBEDDING' ? 'bg-green-100 text-green-600' :
                          'bg-amber-100 text-amber-600'
                        }`}>
                          {isInaccessible ? <AlertTriangle className="w-3.5 h-3.5" /> : <TypeIcon className="w-3.5 h-3.5" />}
                        </div>

                        {/* Model info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium truncate ${isInaccessible ? 'text-red-700 line-through' : 'text-gray-900'}`}>
                              {sm.model.displayName}
                            </p>
                            {isInaccessible && (
                              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 rounded">
                                접근 불가
                              </span>
                            )}
                            {group.items.length > 1 && sm.enabled && !isInaccessible && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                                <Zap className="w-2.5 h-2.5" />
                                RR
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 font-mono truncate">{sm.model.name}</p>
                        </div>

                        {/* Weight control */}
                        {!isInaccessible && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleWeightChange(sm, sm.weight - 1)}
                              disabled={sm.weight <= 1 || saving}
                              className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-xs font-bold transition-colors"
                            >
                              -
                            </button>
                            <div className="w-14 text-center">
                              <span className="text-xs font-semibold text-gray-700">{sm.weight}</span>
                              <span className="text-[10px] text-gray-400 ml-0.5">x</span>
                            </div>
                            <button
                              onClick={() => handleWeightChange(sm, sm.weight + 1)}
                              disabled={sm.weight >= 10 || saving}
                              className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-xs font-bold transition-colors"
                            >
                              +
                            </button>
                          </div>
                        )}

                        {/* Enable/disable toggle */}
                        {!isInaccessible && (
                          <button
                            onClick={() => handleToggleEnabled(sm)}
                            disabled={saving}
                            className="flex-shrink-0 transition-colors"
                            title={sm.enabled ? '비활성화' : '활성화'}
                          >
                            {sm.enabled ? (
                              <ToggleRight className="w-6 h-6 text-blue-500" />
                            ) : (
                              <ToggleLeft className="w-6 h-6 text-gray-300" />
                            )}
                          </button>
                        )}

                        {/* Remove */}
                        <button
                          onClick={() => handleRemoveModel(sm)}
                          disabled={saving}
                          className="p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                          title="제거"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Round-robin summary for this group */}
              {group.items.filter(sm => sm.enabled && sm.accessible).length > 1 && (
                <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                    <Zap className="w-3 h-3 text-blue-500" />
                    <span className="font-medium">라운드로빈:</span>
                    {group.items.filter(sm => sm.enabled && sm.accessible).map((sm, i) => (
                      <span key={sm.id}>
                        {i > 0 && <span className="text-gray-300 mx-0.5">&rarr;</span>}
                        <span className="font-mono">{sm.model.displayName}</span>
                        <span className="text-gray-400">({sm.weight}x)</span>
                      </span>
                    ))}
                    <span className="text-gray-400 ml-1">
                      = 총 {group.items.filter(sm => sm.enabled && sm.accessible).reduce((s, sm) => s + sm.weight, 0)}회/사이클
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pending new alias group (not yet in DB) */}
      {addingToAlias && !aliasGroups.some(g => g.aliasName === addingToAlias) && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden border-l-4 border-l-gray-300 mb-4">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
            <Zap className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <code className="text-sm font-semibold text-gray-900">{addingToAlias}</code>
              <p className="text-[11px] text-gray-400 mt-0.5">0개 모델 — 실제 모델을 추가하면 그룹이 생성됩니다.</p>
            </div>
            <button
              onClick={() => { setAddingToAlias(null); setSelectedModelId(''); }}
              className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
              title="취소"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-5 py-3 bg-blue-50/30">
            <div className="flex items-end gap-3">
              <div className="w-24">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">타입</label>
                <div className="relative">
                  <select
                    value={filterType}
                    onChange={e => setFilterType(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none pr-6"
                  >
                    <option value="ALL">전체</option>
                    <option value="CHAT">채팅</option>
                    <option value="IMAGE">이미지</option>
                    <option value="EMBEDDING">임베딩</option>
                    <option value="RERANKING">리랭킹</option>
                  </select>
                  <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">모델 선택</label>
                <div className="relative">
                  <select
                    value={selectedModelId}
                    onChange={e => setSelectedModelId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none pr-7"
                  >
                    <option value="">모델을 선택하세요...</option>
                    {getAvailableForAlias(addingToAlias).map(m => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.name}) — {MODEL_TYPE_LABELS[m.type] || m.type}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="w-20">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">가중치</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={addWeight}
                  onChange={e => setAddWeight(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="w-full px-2 py-1.5 text-xs text-center border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <button
                onClick={() => handleAddModelToAlias(addingToAlias)}
                disabled={!selectedModelId || saving}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New alias group button */}
      {showNewAliasForm ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">새 표시 모델 추가</h3>
          <p className="text-xs text-gray-400 mb-3">
            v1/models API 응답에 노출될 모델 이름을 입력하세요. 실제 LLM 모델은 이후에 추가합니다.
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-500 mb-1">표시 모델명</label>
              <input
                type="text"
                value={newAliasName}
                onChange={e => setNewAliasName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateAliasGroup()}
                placeholder="예: gpt-4o, claude-sonnet, my-custom-model"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
                autoFocus
              />
            </div>
            <button
              onClick={handleCreateAliasGroup}
              disabled={!newAliasName.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
              만들기
            </button>
            <button
              onClick={() => { setShowNewAliasForm(false); setNewAliasName(''); }}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewAliasForm(true)}
          className="w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/30 transition-all flex items-center justify-center gap-2 mb-6"
        >
          <Plus className="w-4 h-4" />
          새 표시 모델 추가
        </button>
      )}

      {/* Empty state */}
      {aliasGroups.length === 0 && !showNewAliasForm && (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900 mb-1">등록된 모델이 없습니다</p>
          <p className="text-sm text-gray-500 mb-4">
            "새 표시 모델 추가"를 눌러 v1/models에 노출될 모델을 만드세요.
          </p>
        </div>
      )}

      {/* How it works */}
      <div className="px-4 py-3 bg-white border border-gray-100 rounded-xl">
        <p className="text-xs text-gray-400 leading-relaxed">
          <span className="font-medium text-gray-500">작동 방식:</span>{' '}
          "표시 모델명"이 v1/models 응답에 노출됩니다.
          클라이언트가 해당 이름으로 요청하면, 그 그룹 안의 실제 모델들이 가중치 기반으로 라운드로빈 분배됩니다.
          예: "gpt-4o" 그룹에 모델A(2x), 모델B(1x)를 배치하면 → A, A, B, A, A, B ... 순서로 호출됩니다.
        </p>
      </div>
    </div>
  );
}
