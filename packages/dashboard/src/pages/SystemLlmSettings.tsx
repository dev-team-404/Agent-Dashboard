import { useState, useEffect, useCallback } from 'react';
import { Cpu, Check, Loader2, Play, Sparkles, AlertCircle, Image, Palette, AlertTriangle, MessageCircle } from 'lucide-react';
import { api } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

interface Model {
  id: string;
  name: string;
  displayName: string;
  type: string;
  imageProvider?: string | null;
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

  // Error analysis LLM
  const [errorLlm, setErrorLlm] = useState<CurrentSetting>({ modelId: null, model: null });
  const [errorSelectedId, setErrorSelectedId] = useState('');
  const [errorSaving, setErrorSaving] = useState(false);
  const [errorLlmSuccess, setErrorLlmSuccess] = useState(false);

  // GPU Capacity Prediction LLM
  const [gpuLlm, setGpuLlm] = useState<CurrentSetting>({ modelId: null, model: null });
  const [gpuSelectedId, setGpuSelectedId] = useState('');
  const [gpuSaving, setGpuSaving] = useState(false);
  const [gpuLlmSuccess, setGpuLlmSuccess] = useState(false);

  // Help Chatbot LLM
  const [chatbotLlm, setChatbotLlm] = useState<CurrentSetting>({ modelId: null, model: null });
  const [chatbotSelectedId, setChatbotSelectedId] = useState('');
  const [chatbotSaving, setChatbotSaving] = useState(false);
  const [chatbotSuccess, setChatbotSuccess] = useState(false);

  // Logo model states
  const [logoModel, setLogoModel] = useState<CurrentSetting>({ modelId: null, model: null });
  const [imageModels, setImageModels] = useState<Model[]>([]);
  const [logoSelectedId, setLogoSelectedId] = useState<string>('');
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoSuccess, setLogoSuccess] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [settingRes, modelsRes, logoRes] = await Promise.all([
        api.get('/admin/system-settings/system-llm'),
        api.get('/models'),
        api.get('/admin/system-settings/logo-model'),
      ]);
      // 하위호환: modelId는 M/M 추적용
      setCurrent(settingRes.data);
      setSelectedId(settingRes.data.modelId || '');
      // 에러 분석 LLM (settings 배열에서 추출)
      const allSettings = settingRes.data.settings || [];
      const errSetting = allSettings.find((s: { key: string }) => s.key === 'ERROR_ANALYSIS_LLM_MODEL_ID');
      if (errSetting) {
        setErrorLlm({ modelId: errSetting.modelId, model: errSetting.model, updatedBy: errSetting.updatedBy });
        setErrorSelectedId(errSetting.modelId || '');
      }
      const gpuSetting = allSettings.find((s: { key: string }) => s.key === 'GPU_CAPACITY_LLM_MODEL_ID');
      if (gpuSetting) {
        setGpuLlm({ modelId: gpuSetting.modelId, model: gpuSetting.model, updatedBy: gpuSetting.updatedBy });
        setGpuSelectedId(gpuSetting.modelId || '');
      }
      const chatbotSetting = allSettings.find((s: { key: string }) => s.key === 'HELP_CHATBOT_LLM_MODEL_ID');
      if (chatbotSetting) {
        setChatbotLlm({ modelId: chatbotSetting.modelId, model: chatbotSetting.model, updatedBy: chatbotSetting.updatedBy });
        setChatbotSelectedId(chatbotSetting.modelId || '');
      }

      const allModels = modelsRes.data.models || [];
      // CHAT 타입 + enabled 모델만
      const chatModels = allModels.filter(
        (m: Model) => m.type === 'CHAT' && m.enabled
      );
      setModels(chatModels);

      // IMAGE 타입 + enabled 모델
      const imgModels = allModels.filter(
        (m: Model) => m.type === 'IMAGE' && m.enabled
      );
      setImageModels(imgModels);

      setLogoModel(logoRes.data);
      setLogoSelectedId(logoRes.data.modelId || '');
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

  useEffect(() => {
    if (errorLlmSuccess) {
      const t = setTimeout(() => setErrorLlmSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [errorLlmSuccess]);

  useEffect(() => {
    if (logoSuccess) {
      const t = setTimeout(() => setLogoSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [logoSuccess]);

  useEffect(() => {
    if (gpuLlmSuccess) {
      const t = setTimeout(() => setGpuLlmSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [gpuLlmSuccess]);

  useEffect(() => {
    if (chatbotSuccess) {
      const t = setTimeout(() => setChatbotSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [chatbotSuccess]);

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

  const handleErrorLlmSave = async () => {
    if (!errorSelectedId) return;
    setErrorSaving(true);
    setError(null);
    try {
      const res = await api.put('/admin/system-settings/system-llm', { key: 'ERROR_ANALYSIS_LLM_MODEL_ID', modelId: errorSelectedId });
      setErrorLlm({ modelId: errorSelectedId, model: res.data.model, updatedBy: res.data.updatedBy });
      setErrorLlmSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || '저장에 실패했습니다.');
    } finally {
      setErrorSaving(false);
    }
  };

  const handleGpuLlmSave = async () => {
    if (!gpuSelectedId) return;
    setGpuSaving(true);
    setError(null);
    try {
      const res = await api.put('/admin/system-settings/system-llm', { key: 'GPU_CAPACITY_LLM_MODEL_ID', modelId: gpuSelectedId });
      setGpuLlm({ modelId: gpuSelectedId, model: res.data.model, updatedBy: res.data.updatedBy });
      setGpuLlmSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || '저장에 실패했습니다.');
    } finally {
      setGpuSaving(false);
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

  const handleChatbotLlmSave = async () => {
    if (!chatbotSelectedId) return;
    setChatbotSaving(true);
    setError(null);
    try {
      const res = await api.put('/admin/system-settings/system-llm', { key: 'HELP_CHATBOT_LLM_MODEL_ID', modelId: chatbotSelectedId });
      setChatbotLlm({ modelId: chatbotSelectedId, model: res.data.model, updatedBy: res.data.updatedBy });
      setChatbotSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || '저장에 실패했습니다.');
    } finally {
      setChatbotSaving(false);
    }
  };

  const handleLogoSave = async () => {
    if (!logoSelectedId) return;
    setLogoSaving(true);
    setLogoError(null);
    try {
      const res = await api.put('/admin/system-settings/logo-model', { modelId: logoSelectedId });
      setLogoModel({ modelId: logoSelectedId, model: res.data.model, updatedBy: res.data.updatedBy });
      setLogoSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setLogoError(msg || '저장에 실패했습니다.');
    } finally {
      setLogoSaving(false);
    }
  };

  const handleBatchGenerate = async () => {
    setBatchRunning(true);
    setBatchDone(false);
    setLogoError(null);
    try {
      await api.post('/admin/system-settings/generate-missing-logos');
      setBatchDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setLogoError(msg || '로고 일괄 생성에 실패했습니다.');
    } finally {
      setBatchRunning(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 animate-fade-in" data-tour="system-llm-settings">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-violet-50">
          <Sparkles className="w-6 h-6 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">레지스트리 LLM 관리</h1>
          <p className="text-sm text-pastel-500 mt-0.5">
            AI 서비스 목표 추정 및 로고 자동 생성에 사용할 모델을 선택합니다
          </p>
        </div>
      </div>

      {/* M/M 추적용 LLM */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <h2 className="text-sm font-semibold text-pastel-700">M/M 추적용 LLM</h2>
        </div>

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
            <Check className="w-4 h-4" /> M/M 추적 LLM이 변경되었습니다.
          </div>
        )}

        {/* AI 추정 수동 실행 — M/M 추적 카드 안 */}
        {current.modelId && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-pastel-600">AI 추정 수동 실행</p>
                <p className="text-xs text-pastel-400 mt-0.5">
                  매일 자정(KST) 자동 실행. 전일 사용량 기반 서비스별 M/M 추정
                </p>
              </div>
              <button
                onClick={handleRun}
                disabled={running}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {running ? '실행 중...' : '지금 실행'}
              </button>
            </div>
            {runResult && (
              <div className="mt-3 p-2.5 bg-blue-50 rounded-lg border border-blue-100 text-xs text-blue-700">
                처리: {runResult.processed}건 | 오류: {runResult.errors}건
              </div>
            )}
          </div>
        )}
      </div>

      {/* 에러 초도분석 LLM */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <h2 className="text-sm font-semibold text-pastel-700">에러 초도분석용 LLM</h2>
        </div>
        <p className="text-xs text-pastel-400 mb-4">
          에러 관리 페이지에서 미분류 에러의 AI 원인 분석에 사용할 CHAT 모델을 선택합니다.
        </p>

        {errorLlm.model && (
          <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-100">
            <div className="flex items-center gap-2 text-sm">
              <Cpu className="w-4 h-4 text-red-600" />
              <span className="font-medium text-red-800">현재 설정:</span>
              <span className="text-red-700">{errorLlm.model.displayName}</span>
              <span className="text-red-400 font-mono text-xs">({errorLlm.model.name})</span>
            </div>
            {errorLlm.updatedBy && (
              <p className="text-xs text-red-400 mt-1 ml-6">{errorLlm.updatedBy} 설정</p>
            )}
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-pastel-500 mb-1.5">CHAT 모델 선택</label>
            <select
              value={errorSelectedId}
              onChange={e => setErrorSelectedId(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-red-500/15 focus:border-red-500/30"
            >
              <option value="">모델을 선택하세요</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.displayName} ({m.name})</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleErrorLlmSave}
            disabled={errorSaving || !errorSelectedId || errorSelectedId === errorLlm.modelId}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {errorSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            저장
          </button>
        </div>
        {errorLlmSuccess && (
          <div className="mt-3 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100 text-sm text-emerald-700 flex items-center gap-2">
            <Check className="w-4 h-4" /> 에러 분석 LLM이 변경되었습니다.
          </div>
        )}
      </div>

      {/* GPU 수요 예측 LLM */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="w-4 h-4 text-indigo-500" />
          <h2 className="text-sm font-semibold text-pastel-700">GPU 수요 예측용 LLM</h2>
        </div>
        <p className="text-xs text-pastel-400 mb-4">
          리소스 모니터링에서 GPU 수요 예측 분석 리포트를 생성할 CHAT 모델을 선택합니다. 미설정 시 M/M 추적 LLM을 사용합니다.
        </p>
        {gpuLlm.model && (
          <div className="mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <div className="flex items-center gap-2 text-sm">
              <Cpu className="w-4 h-4 text-indigo-600" />
              <span className="font-medium text-indigo-800">현재 설정:</span>
              <span className="text-indigo-700">{gpuLlm.model.displayName}</span>
              <span className="text-indigo-400 font-mono text-xs">({gpuLlm.model.name})</span>
            </div>
            {gpuLlm.updatedBy && <p className="text-xs text-indigo-400 mt-1 ml-6">{gpuLlm.updatedBy} 설정</p>}
          </div>
        )}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-pastel-500 mb-1.5">CHAT 모델 선택</label>
            <select value={gpuSelectedId} onChange={e => setGpuSelectedId(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500/30">
              <option value="">모델을 선택하세요 (미설정 시 M/M 추적 LLM 사용)</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.displayName} ({m.name})</option>)}
            </select>
          </div>
          <button onClick={handleGpuLlmSave} disabled={gpuSaving || !gpuSelectedId || gpuSelectedId === gpuLlm.modelId}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {gpuSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} 저장
          </button>
        </div>
        {gpuLlmSuccess && <div className="mt-3 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100 text-sm text-emerald-700 flex items-center gap-2"><Check className="w-4 h-4" /> GPU 예측 LLM이 변경되었습니다.</div>}
      </div>

      {/* AI 도우미 챗봇 LLM */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle className="w-4 h-4 text-cyan-500" />
          <h2 className="text-sm font-semibold text-pastel-700">AI 도우미 챗봇 LLM</h2>
        </div>
        <p className="text-xs text-pastel-400 mb-4">
          플랫폼 사용법/기능 안내 AI 챗봇이 사용할 CHAT 모델을 선택합니다. 우하단 도우미 아이콘에서 접근할 수 있습니다.
        </p>
        {chatbotLlm.model && (
          <div className="mb-4 p-3 bg-cyan-50 rounded-lg border border-cyan-100">
            <div className="flex items-center gap-2 text-sm">
              <Cpu className="w-4 h-4 text-cyan-600" />
              <span className="font-medium text-cyan-800">현재 설정:</span>
              <span className="text-cyan-700">{chatbotLlm.model.displayName}</span>
              <span className="text-cyan-400 font-mono text-xs">({chatbotLlm.model.name})</span>
            </div>
            {chatbotLlm.updatedBy && <p className="text-xs text-cyan-400 mt-1 ml-6">{chatbotLlm.updatedBy} 설정</p>}
          </div>
        )}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-pastel-500 mb-1.5">CHAT 모델 선택</label>
            <select value={chatbotSelectedId} onChange={e => setChatbotSelectedId(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/15 focus:border-cyan-500/30">
              <option value="">모델을 선택하세요</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.displayName} ({m.name})</option>)}
            </select>
          </div>
          <button onClick={handleChatbotLlmSave} disabled={chatbotSaving || !chatbotSelectedId || chatbotSelectedId === chatbotLlm.modelId}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-cyan-600 rounded-lg hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {chatbotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} 저장
          </button>
        </div>
        {chatbotSuccess && <div className="mt-3 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100 text-sm text-emerald-700 flex items-center gap-2"><Check className="w-4 h-4" /> AI 도우미 챗봇 LLM이 변경되었습니다.</div>}
      </div>

      {/* Logo Generation Model Setting */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-4 h-4 text-pink-500" />
          <h2 className="text-sm font-semibold text-pastel-700">로고 자동 생성 모델</h2>
        </div>
        <p className="text-xs text-pastel-400 mb-4">
          서비스 등록 시 로고 URL이 없으면 선택된 IMAGE 모델로 2D 로고를 자동 생성합니다.
          서비스의 설명(description)을 기반으로 간단한 화이트 배경 아이콘을 만듭니다.
        </p>

        {logoModel.modelId && !logoModel.model && (
          <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <AlertCircle className="w-4 h-4" />
              <span className="font-medium">설정된 모델이 삭제되었거나 비활성화되었습니다. 새 모델을 선택해주세요.</span>
            </div>
          </div>
        )}
        {logoModel.model && (
          <div className="mb-4 p-3 bg-pink-50 rounded-lg border border-pink-100">
            <div className="flex items-center gap-2 text-sm">
              <Image className="w-4 h-4 text-pink-600" />
              <span className="font-medium text-pink-800">현재 설정:</span>
              <span className="text-pink-700">{logoModel.model.displayName}</span>
              <span className="text-pink-400 font-mono text-xs">({logoModel.model.name})</span>
              {logoModel.model.imageProvider && (
                <span className="text-xs text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded">
                  {logoModel.model.imageProvider}
                </span>
              )}
              {!logoModel.model.enabled && <span className="text-xs text-amber-600 font-medium">(비활성)</span>}
            </div>
            {logoModel.updatedBy && (
              <p className="text-xs text-pink-400 mt-1 ml-6">
                {logoModel.updatedBy}이(가) 설정
              </p>
            )}
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-pastel-500 mb-1.5">IMAGE 모델 선택</label>
            <select
              value={logoSelectedId}
              onChange={e => setLogoSelectedId(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-pink-500/15 focus:border-pink-500/30"
            >
              <option value="">모델을 선택하세요</option>
              {imageModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.name}) {m.imageProvider ? `[${m.imageProvider}]` : ''}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleLogoSave}
            disabled={logoSaving || !logoSelectedId || logoSelectedId === logoModel.modelId}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {logoSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            저장
          </button>
        </div>

        {logoSuccess && (
          <div className="mt-3 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100 text-sm text-emerald-700 flex items-center gap-2">
            <Check className="w-4 h-4" /> 로고 생성 모델이 변경되었습니다.
          </div>
        )}

        {imageModels.length === 0 && (
          <div className="mt-3 p-2.5 bg-gray-50 rounded-lg border border-gray-100 text-sm text-pastel-400">
            등록된 IMAGE 타입 모델이 없습니다. 먼저 LLM 관리에서 IMAGE 타입 모델을 추가해주세요.
          </div>
        )}

        {/* Batch Generate */}
        {logoModel.modelId && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-pastel-600">기존 서비스 로고 일괄 생성</p>
                <p className="text-xs text-pastel-400 mt-0.5">
                  로고가 없는 기존 서비스들에 대해 로고를 일괄로 자동 생성합니다
                </p>
              </div>
              <button
                onClick={handleBatchGenerate}
                disabled={batchRunning}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-pink-500 rounded-lg hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {batchRunning ? '생성 중...' : '일괄 생성 실행'}
              </button>
            </div>
            {batchDone && (
              <div className="mt-3 p-2.5 bg-blue-50 rounded-lg border border-blue-100 text-sm text-blue-700 flex items-center gap-2">
                <Check className="w-4 h-4" /> 로고 일괄 생성이 백그라운드에서 시작되었습니다. 완료까지 시간이 걸릴 수 있습니다.
              </div>
            )}
          </div>
        )}

        {logoError && (
          <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {logoError}
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
