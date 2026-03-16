import { useState, useEffect, useCallback } from 'react';
import { Cpu, Check, Loader2, Play, Sparkles, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

interface Model {
  id: string;
  name: string;
  displayName: string;
  type: string;
  enabled: boolean;
  endpointUrl: string;
}

interface CurrentSetting {
  modelId: string | null;
  model: Model | null;
  updatedAt?: string;
  updatedBy?: string;
}

export default function SystemLlmSettings() {
  const [current, setCurrent] = useState<CurrentSetting>({ modelId: null, model: null });
  const [models, setModels] = useState<Model[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ processed: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [settingRes, modelsRes] = await Promise.all([
        api.get('/admin/system-settings/system-llm'),
        api.get('/models'),
      ]);
      setCurrent(settingRes.data);
      setSelectedId(settingRes.data.modelId || '');
      // CHAT 타입 + enabled 모델만
      const chatModels = (modelsRes.data.models || []).filter(
        (m: Model) => m.type === 'CHAT' && m.enabled
      );
      setModels(chatModels);
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put('/admin/system-settings/system-llm', { modelId: selectedId });
      setCurrent({ modelId: selectedId, model: res.data.model, updatedBy: res.data.updatedBy });
      setSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setRunResult(null);
    setError(null);
    try {
      const res = await api.post('/admin/ai-estimations/run');
      setRunResult(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'AI 추정 실행에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-violet-50">
          <Sparkles className="w-6 h-6 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">레지스트리 LLM 관리</h1>
          <p className="text-sm text-pastel-500 mt-0.5">
            AI 서비스 목표 추정에 사용할 LLM 모델을 선택합니다
          </p>
        </div>
      </div>

      {/* Current Setting */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <h2 className="text-sm font-semibold text-pastel-700 mb-4">시스템 LLM 선택</h2>

        {current.modelId && !current.model && (
          <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <AlertCircle className="w-4 h-4" />
              <span className="font-medium">설정된 모델이 삭제되었거나 비활성화되었습니다. 새 모델을 선택해주세요.</span>
            </div>
          </div>
        )}
        {current.model && (
          <div className="mb-4 p-3 bg-violet-50 rounded-lg border border-violet-100">
            <div className="flex items-center gap-2 text-sm">
              <Cpu className="w-4 h-4 text-violet-600" />
              <span className="font-medium text-violet-800">현재 설정:</span>
              <span className="text-violet-700">{current.model.displayName}</span>
              <span className="text-violet-400 font-mono text-xs">({current.model.name})</span>
              {!current.model.enabled && <span className="text-xs text-amber-600 font-medium">(비활성)</span>}
            </div>
            {current.updatedBy && (
              <p className="text-xs text-violet-400 mt-1 ml-6">
                {current.updatedBy}이(가) 설정
              </p>
            )}
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-pastel-500 mb-1.5">CHAT 모델 선택</label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-violet-500/15 focus:border-violet-500/30"
            >
              <option value="">모델을 선택하세요</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.name})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !selectedId || selectedId === current.modelId}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            저장
          </button>
        </div>

        {success && (
          <div className="mt-3 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100 text-sm text-emerald-700 flex items-center gap-2">
            <Check className="w-4 h-4" /> 시스템 LLM이 변경되었습니다.
          </div>
        )}
      </div>

      {/* Manual Run */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <h2 className="text-sm font-semibold text-pastel-700 mb-2">AI 추정 수동 실행</h2>
        <p className="text-xs text-pastel-400 mb-4">
          매일 자정(KST)에 자동 실행되지만, 즉시 실행할 수도 있습니다.
          전일 사용량 데이터를 기반으로 서비스별 M/M 절감 효과를 추정합니다.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRun}
            disabled={running || !current.modelId}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? '추정 실행 중...' : '지금 실행'}
          </button>

          {!current.modelId && (
            <span className="text-xs text-amber-600">시스템 LLM을 먼저 설정해주세요</span>
          )}
        </div>

        {runResult && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-sm text-blue-800 font-medium">실행 완료</p>
            <p className="text-xs text-blue-600 mt-1">
              처리: {runResult.processed}건 | 오류: {runResult.errors}건
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-100 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
