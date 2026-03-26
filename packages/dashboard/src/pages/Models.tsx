import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Edit2, Trash2, Check, X, Layers, Copy,
  Play, CheckCircle, XCircle, Loader2, Eye, Shield, Globe, Building2,
  Users, Lock, Search, ToggleLeft, ToggleRight, Cpu, Sparkles,
  ShieldCheck, Image, MessageSquare, Mic
} from 'lucide-react';
import { modelsApi, statsApi } from '../services/api';
import OrgTreeSelector from '../components/OrgTreeSelector';
import ModelGuide from '../components/Tour/ModelGuide';
import { BookOpen } from 'lucide-react';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface Model {
  id: string;
  name: string;
  displayName: string;
  endpointUrl: string;
  apiKey: string | null;
  extraHeaders: Record<string, string> | null;
  extraBody: Record<string, unknown> | null;
  maxTokens: number;
  enabled: boolean;
  supportsVision: boolean;
  type: 'CHAT' | 'IMAGE' | 'EMBEDDING' | 'RERANKING' | 'ASR';
  imageProvider: string | null;
  asrMethod: string | null;
  visibility: 'PUBLIC' | 'BUSINESS_UNIT' | 'TEAM' | 'ADMIN_ONLY' | 'SUPER_ADMIN_ONLY';
  visibilityScope: string[];
  adminVisible: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdByDept: string;
  createdByBusinessUnit: string;
  createdBySuperAdmin: boolean;
  createdAt: string;
}

interface HealthCheckResult {
  healthy: boolean;
  checks: {
    chatCompletion: { passed: boolean; status?: number; message: string; latencyMs: number };
    toolCallA?: { passed: boolean; status?: number; message: string; latencyMs: number };
    toolCallB?: { passed: boolean; status?: number; message: string; latencyMs: number };
    toolCallC?: { passed: boolean; status?: number; message: string; latencyMs: number };
    toolCallD?: { passed: boolean; status?: number; message: string; latencyMs: number };
  };
  toolCallPassCount?: number;
  allPassed: boolean;
  message: string;
  totalLatencyMs: number;
}

interface TestEndpointResult {
  chatCompletion: boolean;
  toolCallA: boolean;
  toolCallB: boolean;
  toolCallC: boolean;
  toolCallD: boolean;
  allPassed: boolean;
}

interface TestVisionResult {
  visionDescribe: boolean;
  visionJudge: boolean;
  passed: boolean;
}

interface TestImageResult {
  imageGen: boolean;
  passed: boolean;
}

interface ModelsProps {
  adminRole?: AdminRole;
  isAdmin?: boolean;
  user?: { id: string; loginid: string; username: string; deptname: string } | null;
}

type VisibilityType = 'PUBLIC' | 'BUSINESS_UNIT' | 'TEAM' | 'ADMIN_ONLY' | 'SUPER_ADMIN_ONLY';

const VISIBILITY_CONFIG: Record<VisibilityType, { label: string; icon: typeof Globe; color: string; bg: string; desc: string }> = {
  PUBLIC: { label: '전체 공개', icon: Globe, color: 'text-green-600', bg: 'bg-green-50 border-green-200', desc: '모든 서비스에서 사용 가능' },
  BUSINESS_UNIT: { label: '부서 선택', icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', desc: '조직도에서 허용할 부서를 선택합니다' },
  TEAM: { label: '부서 선택', icon: Users, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200', desc: '조직도에서 허용할 부서를 선택합니다' },
  ADMIN_ONLY: { label: '시스템 관리자', icon: Lock, color: 'text-red-600', bg: 'bg-red-50 border-red-200', desc: '시스템 관리자 + 슈퍼관리자 접근 가능' },
  SUPER_ADMIN_ONLY: { label: '슈퍼관리자만', icon: ShieldCheck, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', desc: '슈퍼관리자만 접근 가능' },
};

const emptyForm = {
  name: '',
  displayName: '',
  endpointUrl: '',
  apiKey: '',
  extraHeaders: '',
  extraBody: '',
  maxTokens: 128000,
  enabled: true,
  supportsVision: false,
  type: 'CHAT' as 'CHAT' | 'IMAGE' | 'EMBEDDING' | 'RERANKING' | 'ASR',
  imageProvider: '' as string,
  asrMethod: '' as string,
  visibility: 'PUBLIC' as VisibilityType,
  visibilityScope: [] as string[],
  adminVisible: false,
  sortOrder: 0,
};

/* ──────────────────────────────────────────────
   Main Component
   ────────────────────────────────────────────── */
export default function Models({ adminRole, isAdmin, user }: ModelsProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityType | ''>('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Model | null>(null);

  // Health check state
  const [healthChecks, setHealthChecks] = useState<Record<string, HealthCheckResult | 'loading'>>({});

  // Cron-based health status (10분 간격 자동 프로빙 결과)
  const [cronHealth, setCronHealth] = useState<Record<string, { success: boolean; latencyMs: number | null; checkedAt: string; errorMessage: string | null }>>({});

  // Test states (in-form)
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestEndpointResult | null>(null);
  const [visionTestRunning, setVisionTestRunning] = useState(false);
  const [visionTestResult, setVisionTestResult] = useState<TestVisionResult | null>(null);
  const [imageTestRunning, setImageTestRunning] = useState(false);
  const [imageTestResult, setImageTestResult] = useState<TestImageResult | null>(null);
  const [embeddingTestRunning, setEmbeddingTestRunning] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ passed: boolean; message?: string } | null>(null);
  const [rerankTestRunning, setRerankTestRunning] = useState(false);
  const [rerankTestResult, setRerankTestResult] = useState<{ passed: boolean; message?: string } | null>(null);
  const [asrTestRunning, setAsrTestRunning] = useState(false);
  const [asrTestResult, setAsrTestResult] = useState<{ passed: boolean; message?: string } | null>(null);

  // Auto-refresh every 30s (with jitter)
  useEffect(() => {
    loadModels();
    loadCronHealth();
    const jitter = Math.floor(Math.random() * 10000);
    const interval = setInterval(loadModels, 30000 + jitter);
    return () => clearInterval(interval);
  }, []);

  const loadCronHealth = async () => {
    try {
      const res = await statsApi.healthStatus();
      setCronHealth(res.data.statuses || {});
    } catch {
      // 비관리자 등 접근 불가 시 무시
    }
  };

  const loadModels = useCallback(async () => {
    try {
      const res = isAdmin ? await modelsApi.list() : await modelsApi.browse();
      setModels(res.data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  const resetTestStates = () => {
    setTestResult(null);
    setVisionTestResult(null);
    setImageTestResult(null);
    setEmbeddingTestResult(null);
    setRerankTestResult(null);
    setAsrTestResult(null);
  };

  const openCreateModal = () => {
    setEditingModel(null);
    setForm(emptyForm);
    setFormError('');
    resetTestStates();
    setShowModal(true);
  };

  const openEditModal = (model: Model) => {
    setEditingModel(model);
    setForm({
      name: model.name,
      displayName: model.displayName,
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey || '',
      extraHeaders: model.extraHeaders ? JSON.stringify(model.extraHeaders, null, 2) : '',
      extraBody: model.extraBody ? JSON.stringify(model.extraBody, null, 2) : '',
      maxTokens: model.maxTokens,
      enabled: model.enabled,
      supportsVision: model.supportsVision,
      type: model.type || 'CHAT',
      imageProvider: model.imageProvider || '',
      asrMethod: model.asrMethod || '',
      visibility: model.visibility,
      visibilityScope: model.visibilityScope || [],
      adminVisible: model.adminVisible ?? false,
      sortOrder: model.sortOrder,
    });
    setFormError('');
    resetTestStates();
    setShowModal(true);
  };

  const openCopyModal = (model: Model) => {
    setEditingModel(null);
    setForm({
      name: model.name,
      displayName: `${model.displayName} (복사)`,
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey || '',
      extraHeaders: model.extraHeaders ? JSON.stringify(model.extraHeaders, null, 2) : '',
      extraBody: model.extraBody ? JSON.stringify(model.extraBody, null, 2) : '',
      maxTokens: model.maxTokens,
      enabled: true,
      supportsVision: model.supportsVision,
      type: model.type || 'CHAT',
      imageProvider: model.imageProvider || '',
      asrMethod: model.asrMethod || '',
      visibility: model.visibility,
      visibilityScope: model.visibilityScope || [],
      adminVisible: model.adminVisible ?? false,
      sortOrder: model.sortOrder,
    });
    setFormError('');
    resetTestStates();
    setShowModal(true);
  };

  const buildTestPayload = () => {
    let extraHeaders: Record<string, string> | undefined;
    if (form.extraHeaders.trim()) {
      try { extraHeaders = JSON.parse(form.extraHeaders); } catch { /* ignore */ }
    }
    let extraBody: Record<string, unknown> | undefined;
    if (form.extraBody.trim()) {
      try { extraBody = JSON.parse(form.extraBody); } catch { /* ignore */ }
    }
    return {
      endpointUrl: form.endpointUrl,
      modelName: form.name,
      apiKey: form.apiKey || undefined,
      extraHeaders,
      extraBody,
      imageProvider: form.imageProvider || undefined,
    };
  };

  const runFormTest = async () => {
    if (!form.endpointUrl || !form.name) {
      setFormError('테스트를 실행하려면 모델 ID와 엔드포인트 URL이 필요합니다.');
      return;
    }
    setTestRunning(true);
    setTestResult(null);
    setFormError('');
    try {
      const res = await modelsApi.testEndpoint(buildTestPayload());
      const hc = res.data.healthCheck || res.data;
      setTestResult({
        chatCompletion: hc.checks?.chatCompletion?.passed ?? hc.chatCompletion ?? false,
        toolCallA: hc.checks?.toolCallA?.passed ?? hc.toolCallA ?? false,
        toolCallB: hc.checks?.toolCallB?.passed ?? hc.toolCallB ?? false,
        toolCallC: hc.checks?.toolCallC?.passed ?? hc.toolCallC ?? false,
        toolCallD: hc.checks?.toolCallD?.passed ?? hc.toolCallD ?? false,
        allPassed: hc.allPassed ?? false,
      });
    } catch (error: any) {
      setTestResult({
        chatCompletion: false,
        toolCallA: false,
        toolCallB: false,
        toolCallC: false,
        toolCallD: false,
        allPassed: false,
      });
      setFormError(error.response?.data?.error || '테스트 실행에 실패했습니다.');
    } finally {
      setTestRunning(false);
    }
  };

  const runVisionTest = async () => {
    if (!form.endpointUrl || !form.name) {
      setFormError('테스트를 실행하려면 모델 ID와 엔드포인트 URL이 필요합니다.');
      return;
    }
    setVisionTestRunning(true);
    setVisionTestResult(null);
    setFormError('');
    try {
      const res = await modelsApi.testVision(buildTestPayload());
      const d = res.data;
      setVisionTestResult({
        visionDescribe: d.visionDescribe?.passed ?? d.visionDescribe ?? false,
        visionJudge: d.visionJudge?.passed ?? d.visionJudge ?? false,
        passed: d.passed ?? false,
      });
    } catch (error: any) {
      setVisionTestResult({ visionDescribe: false, visionJudge: false, passed: false });
      setFormError(error.response?.data?.error || 'Vision 테스트 실행에 실패했습니다.');
    } finally {
      setVisionTestRunning(false);
    }
  };

  const runImageTest = async () => {
    if (!form.endpointUrl || !form.name) {
      setFormError('테스트를 실행하려면 모델 ID와 엔드포인트 URL이 필요합니다.');
      return;
    }
    setImageTestRunning(true);
    setImageTestResult(null);
    setFormError('');
    try {
      const res = await modelsApi.testImage(buildTestPayload());
      const d = res.data;
      setImageTestResult({
        imageGen: d.imageGen?.passed ?? d.imageGen ?? false,
        passed: d.passed ?? false,
      });
    } catch (error: any) {
      setImageTestResult({ imageGen: false, passed: false });
      setFormError(error.response?.data?.error || '이미지 생성 테스트 실행에 실패했습니다.');
    } finally {
      setImageTestRunning(false);
    }
  };

  const runEmbeddingTest = async () => {
    if (!form.endpointUrl || !form.name) {
      setFormError('테스트를 실행하려면 모델 ID와 엔드포인트 URL이 필요합니다.');
      return;
    }
    setEmbeddingTestRunning(true);
    setEmbeddingTestResult(null);
    setFormError('');
    try {
      const res = await modelsApi.testEmbedding(buildTestPayload());
      setEmbeddingTestResult({ passed: res.data.passed, message: res.data.embedding?.message });
    } catch (error: any) {
      setEmbeddingTestResult({ passed: false, message: error.response?.data?.error || '임베딩 테스트 실패' });
      setFormError(error.response?.data?.error || '임베딩 테스트 실행에 실패했습니다.');
    } finally {
      setEmbeddingTestRunning(false);
    }
  };

  const runRerankTest = async () => {
    if (!form.endpointUrl || !form.name) {
      setFormError('테스트를 실행하려면 모델 ID와 엔드포인트 URL이 필요합니다.');
      return;
    }
    setRerankTestRunning(true);
    setRerankTestResult(null);
    setFormError('');
    try {
      const res = await modelsApi.testRerank(buildTestPayload());
      setRerankTestResult({ passed: res.data.passed, message: res.data.rerank?.message });
    } catch (error: any) {
      setRerankTestResult({ passed: false, message: error.response?.data?.error || '리랭킹 테스트 실패' });
      setFormError(error.response?.data?.error || '리랭킹 테스트 실행에 실패했습니다.');
    } finally {
      setRerankTestRunning(false);
    }
  };

  const runAsrTest = async () => {
    if (!form.endpointUrl || !form.name) {
      setFormError('테스트를 실행하려면 모델 ID와 엔드포인트 URL이 필요합니다.');
      return;
    }
    setAsrTestRunning(true);
    setAsrTestResult(null);
    setFormError('');
    try {
      const res = await modelsApi.testAsr({
        ...buildTestPayload(),
        asrMethod: form.asrMethod || undefined,
      });
      setAsrTestResult({ passed: res.data.passed, message: res.data.asr?.message });
    } catch (error: any) {
      setAsrTestResult({ passed: false, message: error.response?.data?.error || 'ASR 테스트 실패' });
      setFormError(error.response?.data?.error || 'ASR 테스트 실행에 실패했습니다.');
    } finally {
      setAsrTestRunning(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.displayName || !form.endpointUrl) {
      setFormError('이름, 표시 이름, 엔드포인트 URL은 필수입니다.');
      return;
    }

    // Parse extra headers
    let extraHeaders: Record<string, string> | undefined;
    if (form.extraHeaders.trim()) {
      try {
        extraHeaders = JSON.parse(form.extraHeaders);
      } catch {
        setFormError('Extra Headers는 유효한 JSON이어야 합니다.');
        return;
      }
    }

    // Parse extra body
    let extraBody: Record<string, unknown> | undefined;
    if (form.extraBody.trim()) {
      try {
        extraBody = JSON.parse(form.extraBody);
      } catch {
        setFormError('Extra Body는 유효한 JSON이어야 합니다.');
        return;
      }
    }

    // CHAT type: require tool call test (at least 2 passed)
    if (form.type === 'CHAT') {
      if (!testResult) {
        setFormError('CHAT 모델은 저장 전에 Tool Call 테스트를 실행해야 합니다. "테스트 실행" 버튼을 클릭하세요.');
        return;
      }
      const toolCallsPassed = [testResult.toolCallA, testResult.toolCallB, testResult.toolCallC, testResult.toolCallD].filter(Boolean).length;
      if (toolCallsPassed < 2) {
        setFormError('최소 2개 이상의 Tool Call 테스트를 통과해야 합니다.');
        return;
      }

      // Vision test required if supportsVision is checked
      if (form.supportsVision) {
        if (!visionTestResult) {
          setFormError('Vision 모델은 저장 전에 Vision 테스트를 실행해야 합니다. "Vision 테스트" 버튼을 클릭하세요.');
          return;
        }
        if (!visionTestResult.passed) {
          setFormError('Vision 인식 테스트를 통과해야 Vision 모델로 등록할 수 있습니다.');
          return;
        }
      }
    }

    // IMAGE type: require image gen test
    if (form.type === 'IMAGE') {
      if (!imageTestResult) {
        setFormError('IMAGE 모델은 저장 전에 이미지 생성 테스트를 실행해야 합니다. "이미지 생성 테스트" 버튼을 클릭하세요.');
        return;
      }
      if (!imageTestResult.passed) {
        setFormError('이미지 생성 테스트를 통과해야 IMAGE 모델로 등록할 수 있습니다.');
        return;
      }
    }

    // EMBEDDING type: require embedding test
    if (form.type === 'EMBEDDING') {
      if (!embeddingTestResult) {
        setFormError('EMBEDDING 모델은 저장 전에 임베딩 테스트를 실행해야 합니다.');
        return;
      }
      if (!embeddingTestResult.passed) {
        setFormError('임베딩 테스트를 통과해야 EMBEDDING 모델로 등록할 수 있습니다.');
        return;
      }
    }

    // RERANKING type: require rerank test
    if (form.type === 'RERANKING') {
      if (!rerankTestResult) {
        setFormError('RERANKING 모델은 저장 전에 리랭킹 테스트를 실행해야 합니다.');
        return;
      }
      if (!rerankTestResult.passed) {
        setFormError('리랭킹 테스트를 통과해야 RERANKING 모델로 등록할 수 있습니다.');
        return;
      }
    }

    // ASR type: require ASR test
    if (form.type === 'ASR') {
      if (!asrTestResult) {
        setFormError('ASR 모델은 저장 전에 ASR 테스트를 실행해야 합니다.');
        return;
      }
      if (!asrTestResult.passed) {
        setFormError('ASR 테스트를 통과해야 ASR 모델로 등록할 수 있습니다.');
        return;
      }
    }

    setSaving(true);
    setFormError('');

    try {
      const data = {
        name: form.name,
        displayName: form.displayName,
        endpointUrl: form.endpointUrl,
        apiKey: form.apiKey || undefined,
        extraHeaders,
        extraBody,
        maxTokens: form.maxTokens,
        enabled: form.enabled,
        supportsVision: form.type === 'CHAT' ? form.supportsVision : false,
        type: form.type,
        imageProvider: form.type === 'IMAGE' ? (form.imageProvider || undefined) : undefined,
        asrMethod: form.type === 'ASR' ? (form.asrMethod || undefined) : undefined,
        visibility: form.visibility,
        visibilityScope: form.visibilityScope.length > 0 ? form.visibilityScope : [],
        adminVisible: (form.visibility === 'BUSINESS_UNIT' || form.visibility === 'TEAM') ? form.adminVisible : false,
        sortOrder: form.sortOrder,
      };

      if (editingModel) {
        await modelsApi.update(editingModel.id, data);
      } else {
        await modelsApi.create(data);
      }

      window.dispatchEvent(new CustomEvent('model-guide-success', {
        detail: { name: form.name, displayName: form.displayName, endpointUrl: form.endpointUrl, type: form.type },
      }));
      setShowModal(false);
      loadModels();
    } catch (error: any) {
      const errMsg = error.response?.data?.error || '저장에 실패했습니다.';
      window.dispatchEvent(new CustomEvent('model-guide-error', { detail: { error: errMsg } }));
      setFormError(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (model: Model) => {
    try {
      await modelsApi.delete(model.id, true);
      setDeleteTarget(null);
      loadModels();
    } catch (error: any) {
      alert(error.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

  const handleToggle = async (model: Model) => {
    try {
      await modelsApi.toggle(model.id);
      loadModels();
    } catch (error: any) {
      alert(error.response?.data?.error || '토글에 실패했습니다.');
    }
  };

  const runHealthCheck = async (model: Model) => {
    setHealthChecks(prev => ({ ...prev, [model.id]: 'loading' }));
    const basePayload = {
      endpointUrl: model.endpointUrl,
      modelName: model.name,
      apiKey: model.apiKey || undefined,
      extraHeaders: model.extraHeaders || undefined,
      extraBody: model.extraBody || undefined,
    };
    try {
      let result: HealthCheckResult;

      if (model.type === 'IMAGE') {
        const res = await modelsApi.testImage({ ...basePayload, imageProvider: model.imageProvider || undefined });
        const d = res.data;
        result = {
          healthy: d.passed,
          checks: { chatCompletion: { passed: d.imageGen?.passed ?? false, message: d.imageGen?.message || '', latencyMs: d.imageGen?.latencyMs || 0 } },
          allPassed: d.passed,
          message: d.passed ? 'Image generation OK' : (d.imageGen?.message || 'Image test failed'),
          totalLatencyMs: d.imageGen?.latencyMs || 0,
        };
      } else if (model.type === 'EMBEDDING') {
        const res = await modelsApi.testEmbedding(basePayload);
        const d = res.data;
        result = {
          healthy: d.passed,
          checks: { chatCompletion: { passed: d.embedding?.passed ?? false, message: d.embedding?.message || '', latencyMs: d.embedding?.latencyMs || 0 } },
          allPassed: d.passed,
          message: d.passed ? 'Embedding OK' : (d.embedding?.message || 'Embedding test failed'),
          totalLatencyMs: d.embedding?.latencyMs || 0,
        };
      } else if (model.type === 'RERANKING') {
        const res = await modelsApi.testRerank(basePayload);
        const d = res.data;
        result = {
          healthy: d.passed,
          checks: { chatCompletion: { passed: d.rerank?.passed ?? false, message: d.rerank?.message || '', latencyMs: d.rerank?.latencyMs || 0 } },
          allPassed: d.passed,
          message: d.passed ? 'Reranking OK' : (d.rerank?.message || 'Rerank test failed'),
          totalLatencyMs: d.rerank?.latencyMs || 0,
        };
      } else if (model.type === 'ASR') {
        const res = await modelsApi.testAsr({ ...basePayload, asrMethod: model.asrMethod || undefined });
        const d = res.data;
        result = {
          healthy: d.passed,
          checks: { chatCompletion: { passed: d.asr?.passed ?? false, message: d.asr?.message || '', latencyMs: d.asr?.latencyMs || 0 } },
          allPassed: d.passed,
          message: d.passed ? 'ASR OK' : (d.asr?.message || 'ASR test failed'),
          totalLatencyMs: d.asr?.latencyMs || 0,
        };
      } else {
        // CHAT (default)
        const res = await modelsApi.testEndpoint(basePayload);
        result = res.data.healthCheck || res.data;
      }

      setHealthChecks(prev => ({ ...prev, [model.id]: result }));
    } catch (error: any) {
      setHealthChecks(prev => ({
        ...prev,
        [model.id]: {
          healthy: false,
          checks: {
            chatCompletion: { passed: false, message: error.response?.data?.error || error.message || 'Failed', latencyMs: 0 },
          },
          allPassed: false,
          message: error.response?.data?.error || 'Health check failed',
          totalLatencyMs: 0,
        },
      }));
    }
  };

  // Admin can modify?
  const canModify = (model: Model) => {
    if (!isAdmin) return false;
    if (adminRole === 'SUPER_ADMIN') return true;
    if (model.createdBySuperAdmin) return false;
    return true;
  };

  // Filters
  const filteredModels = models.filter(m => {
    const matchesSearch = !searchQuery ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.displayName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesVisibility = !visibilityFilter || m.visibility === visibilityFilter
      || (visibilityFilter === 'TEAM' && m.visibility === 'BUSINESS_UNIT');
    return matchesSearch && matchesVisibility;
  });

  const getVisibilityBadge = (visibility: VisibilityType) => {
    const config = VISIBILITY_CONFIG[visibility] || VISIBILITY_CONFIG.PUBLIC;
    const Icon = config.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${config.bg} ${config.color}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    );
  };

  // Tool call count helper
  const getToolCallPassCount = (result: TestEndpointResult) =>
    [result.toolCallA, result.toolCallB, result.toolCallC, result.toolCallD].filter(Boolean).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-samsung-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pastel-800">{isAdmin ? 'LLM 모델 관리' : 'LLM 모델'}</h1>
          <p className="text-sm text-pastel-500 mt-1">
            {models.length}개 모델 | 서비스와 독립적으로 관리됩니다
          </p>
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
            LLM 모델을 등록하고 관리합니다. 같은 모델 ID로 여러 개 등록하면 서비스별 라운드로빈에 사용할 수 있습니다.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGuide(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 text-samsung-blue bg-blue-50 border border-blue-200 rounded-ios font-medium text-sm hover:bg-blue-100 transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              등록 가이드
            </button>
            <button
              onClick={openCreateModal}
              data-tour="models-add-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-samsung-blue text-white rounded-ios font-medium text-sm
                         hover:bg-samsung-blue-dark shadow-ios hover:shadow-ios-lg
                         transform active:scale-[0.97] transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              새 모델 추가
            </button>
          </div>
        )}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pastel-400" />
          <input
            type="text"
            placeholder="모델 검색..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-pastel-200 rounded-ios text-sm
                       focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue
                       transition-all duration-200"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setVisibilityFilter('')}
            className={`px-3 py-2 rounded-ios text-xs font-medium transition-all duration-200
              ${!visibilityFilter ? 'bg-samsung-blue text-white shadow-ios' : 'bg-white text-pastel-600 border border-pastel-200 hover:bg-pastel-50'}`}
          >
            전체
          </button>
          {(['PUBLIC', 'TEAM', 'ADMIN_ONLY', 'SUPER_ADMIN_ONLY'] as VisibilityType[]).map(v => {
            const cfg = VISIBILITY_CONFIG[v];
            const Icon = cfg.icon;
            return (
              <button
                key={v}
                onClick={() => setVisibilityFilter(visibilityFilter === v ? '' : v)}
                className={`inline-flex items-center gap-1 px-3 py-2 rounded-ios text-xs font-medium transition-all duration-200
                  ${visibilityFilter === v ? 'bg-samsung-blue text-white shadow-ios' : 'bg-white text-pastel-600 border border-pastel-200 hover:bg-pastel-50'}`}
              >
                <Icon className="w-3 h-3" />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Models Grid */}
      {filteredModels.length === 0 ? (
        <div className="text-center py-16">
          <Cpu className="w-12 h-12 text-pastel-300 mx-auto" />
          <p className="mt-4 text-pastel-500">
            {searchQuery || visibilityFilter ? '검색 결과가 없습니다' : '등록된 모델이 없습니다'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredModels.map((model) => {
            const healthCheck = healthChecks[model.id];

            return (
              <div
                key={model.id}
                data-model-name={model.name}
                className="bg-white rounded-ios-lg border border-pastel-100 shadow-card hover:shadow-card-hover
                           transition-all duration-300 overflow-hidden"
              >
                {/* Main Row */}
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Model Icon */}
                    {(() => {
                      const iconConfig = {
                        CHAT: { icon: MessageSquare, enabledBg: model.supportsVision ? 'bg-violet-100' : 'bg-samsung-blue/10', enabledText: model.supportsVision ? 'text-violet-600' : 'text-samsung-blue' },
                        IMAGE: { icon: Image, enabledBg: 'bg-pink-100', enabledText: 'text-pink-600' },
                        EMBEDDING: { icon: Layers, enabledBg: 'bg-emerald-100', enabledText: 'text-emerald-600' },
                        RERANKING: { icon: Sparkles, enabledBg: 'bg-amber-100', enabledText: 'text-amber-600' },
                        ASR: { icon: Mic, enabledBg: 'bg-sky-100', enabledText: 'text-sky-600' },
                      }[model.type] || { icon: Cpu, enabledBg: 'bg-samsung-blue/10', enabledText: 'text-samsung-blue' };
                      const IconComp = iconConfig.icon;
                      return (
                        <div className={`w-11 h-11 rounded-ios flex items-center justify-center flex-shrink-0 ${
                          model.enabled ? iconConfig.enabledBg : 'bg-gray-100'
                        }`}>
                          <IconComp className={`w-5 h-5 ${model.enabled ? iconConfig.enabledText : 'text-gray-400'}`} />
                        </div>
                      );
                    })()}

                    {/* Model Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-semibold text-base ${model.enabled ? 'text-pastel-800' : 'text-gray-400'} flex items-center gap-1.5`}>
                          {/* Cron health status dot */}
                          {(() => {
                            const ch = cronHealth[model.id];
                            if (!model.enabled || !ch) {
                              return <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" title="상태 미확인" />;
                            }
                            const ago = Math.round((Date.now() - new Date(ch.checkedAt).getTime()) / 60000);
                            const stale = ago > 20;
                            if (ch.success) {
                              return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stale ? 'bg-yellow-400' : 'bg-green-500'}`} title={`정상 | ${ch.latencyMs}ms | ${ago}분 전`} />;
                            }
                            return <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title={`장애 | ${ch.errorMessage || 'Unknown'} | ${ago}분 전`} />;
                          })()}
                          {model.displayName}
                        </h3>
                        {!model.enabled && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded-full">
                            비활성
                          </span>
                        )}
                        {model.type !== 'CHAT' && (() => {
                          const typeBadge = {
                            IMAGE: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200', icon: Image, label: 'IMAGE' },
                            EMBEDDING: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', icon: Layers, label: 'EMBEDDING' },
                            RERANKING: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', icon: Sparkles, label: 'RERANKING' },
                            ASR: { bg: 'bg-sky-50', text: 'text-sky-600', border: 'border-sky-200', icon: Mic, label: 'ASR' },
                          }[model.type];
                          if (!typeBadge) return null;
                          const BadgeIcon = typeBadge.icon;
                          return (
                            <span className={`px-2 py-0.5 text-[10px] font-medium ${typeBadge.bg} ${typeBadge.text} rounded-full border ${typeBadge.border}`}>
                              <BadgeIcon className="w-2.5 h-2.5 inline mr-0.5" />{typeBadge.label}
                            </span>
                          );
                        })()}
                        {model.supportsVision && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-600 rounded-full border border-violet-200">
                            <Eye className="w-2.5 h-2.5 inline mr-0.5" />Vision
                          </span>
                        )}
                        {model.createdBySuperAdmin && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-600 rounded-full border border-amber-200">
                            <Shield className="w-2.5 h-2.5 inline mr-0.5" />Super
                          </span>
                        )}
                        {model.createdByBusinessUnit && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 rounded-full">
                            {model.createdByBusinessUnit}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-pastel-500 flex-wrap">
                        <code className="px-1.5 py-0.5 bg-pastel-50 rounded text-[11px] font-mono">{model.name}</code>
                        {getVisibilityBadge(model.visibility)}
                        {model.imageProvider && (
                          <span className="px-1.5 py-0.5 bg-pink-50 text-pink-600 rounded text-[11px] font-mono">{model.imageProvider}</span>
                        )}
                        {model.asrMethod && (
                          <span className="px-1.5 py-0.5 bg-sky-50 text-sky-600 rounded text-[11px] font-mono">{model.asrMethod}</span>
                        )}
                        {model.createdByDept && (
                          <span className="hidden sm:inline">{model.createdByDept}</span>
                        )}
                      </div>
                      <p className="text-xs text-pastel-400 mt-1.5 truncate max-w-lg font-mono">
                        {model.endpointUrl}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => runHealthCheck(model)}
                        disabled={healthCheck === 'loading'}
                        className="p-2 rounded-ios text-pastel-500 hover:bg-pastel-50 hover:text-samsung-blue
                                   transition-all duration-200 disabled:opacity-50"
                        title="Health Check"
                      >
                        {healthCheck === 'loading' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : healthCheck && typeof healthCheck !== 'string' ? (
                          healthCheck.healthy ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                          )
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>

                      {canModify(model) && (
                        <button
                          onClick={() => handleToggle(model)}
                          className="p-2 rounded-ios hover:bg-pastel-50 transition-all duration-200"
                          title={model.enabled ? '비활성화' : '활성화'}
                        >
                          {model.enabled ? (
                            <ToggleRight className="w-5 h-5 text-green-500" />
                          ) : (
                            <ToggleLeft className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      )}

                      {canModify(model) && (
                        <button
                          onClick={() => openEditModal(model)}
                          className="p-2 rounded-ios text-pastel-500 hover:bg-pastel-50 hover:text-samsung-blue
                                     transition-all duration-200"
                          title="수정"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}

                      {isAdmin && (
                        <button
                          onClick={() => openCopyModal(model)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-ios text-xs font-medium
                                     text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200
                                     transition-all duration-200"
                          title="복제"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          복제
                        </button>
                      )}

                      {canModify(model) && (
                        <button
                          onClick={() => setDeleteTarget(model)}
                          className="p-2 rounded-ios text-pastel-500 hover:bg-red-50 hover:text-red-500
                                     transition-all duration-200"
                          title="삭제"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                    </div>
                  </div>

                  {/* Health Check Result */}
                  {healthCheck && typeof healthCheck !== 'string' && (
                    <div className={`mt-3 p-3 rounded-ios text-xs ${
                      healthCheck.healthy ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                    }`}>
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className={healthCheck.allPassed ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                          {healthCheck.allPassed ? 'Healthy' : 'Unhealthy'}
                        </span>
                        <span className="text-gray-500">Chat: {healthCheck.checks.chatCompletion.latencyMs}ms</span>
                        {healthCheck.toolCallPassCount !== undefined && (
                          <span className="text-gray-500">Tool: {healthCheck.toolCallPassCount}/4</span>
                        )}
                        <span className="text-gray-500">Total: {healthCheck.totalLatencyMs}ms</span>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          Create / Edit Modal
          ═══════════════════════════════════════════════ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="sticky top-0 bg-white border-b border-pastel-100 px-6 py-4 z-10 rounded-t-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-ios bg-samsung-blue/10 flex items-center justify-center">
                    {editingModel ? <Edit2 className="w-4 h-4 text-samsung-blue" /> : <Sparkles className="w-4 h-4 text-samsung-blue" />}
                  </div>
                  <h2 className="text-lg font-semibold text-pastel-800">
                    {editingModel ? '모델 수정' : '새 모델 추가'}
                  </h2>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-ios text-pastel-400 hover:bg-pastel-50 hover:text-pastel-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-ios text-sm text-red-600 animate-slide-down">
                  {formError}
                </div>
              )}

              <div className="space-y-4">
                {/* ── Model Type Selection ── */}
                <div>
                  <label className="block text-sm font-medium text-pastel-700 mb-2">모델 타입</label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { value: 'CHAT' as const, label: '채팅', desc: 'LLM 채팅 모델', icon: MessageSquare },
                      { value: 'IMAGE' as const, label: '이미지 생성', desc: '이미지 생성 모델', icon: Image },
                      { value: 'EMBEDDING' as const, label: '임베딩', desc: '텍스트 임베딩 모델', icon: Layers },
                      { value: 'RERANKING' as const, label: '리랭킹', desc: '문서 리랭킹 모델', icon: Sparkles },
                      { value: 'ASR' as const, label: '음성 인식', desc: 'STT/ASR 모델', icon: Mic },
                    ]).map(opt => {
                      const isSelected = form.type === opt.value;
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setForm({ ...form, type: opt.value, supportsVision: opt.value === 'IMAGE' ? false : form.supportsVision });
                            resetTestStates();
                          }}
                          className={`flex items-center gap-3 p-3.5 rounded-lg border-2 transition-all duration-200
                            ${isSelected
                              ? 'border-samsung-blue bg-samsung-blue/5 shadow-card'
                              : 'border-pastel-100 hover:border-pastel-300 bg-white'}`}
                        >
                          <div className={`w-10 h-10 rounded-ios flex items-center justify-center
                            ${isSelected ? 'bg-samsung-blue/10' : 'bg-pastel-50'}`}>
                            <Icon className={`w-5 h-5 ${isSelected ? 'text-samsung-blue' : 'text-pastel-400'}`} />
                          </div>
                          <div className="text-left">
                            <p className={`text-sm font-semibold ${isSelected ? 'text-samsung-blue' : 'text-pastel-700'}`}>{opt.label}</p>
                            <p className="text-xs text-pastel-400">{opt.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Image Provider (only for IMAGE type) */}
                {form.type === 'IMAGE' && (
                  <div className="animate-slide-down">
                    <label className="block text-sm font-medium text-pastel-700 mb-1.5">이미지 Provider</label>
                    <select
                      value={form.imageProvider}
                      onChange={e => setForm({ ...form, imageProvider: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm bg-white
                                 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all"
                    >
                      <option value="">선택하세요</option>
                      <option value="OPENAI">OPENAI</option>
                      <option value="COMFYUI">COMFYUI</option>
                    </select>
                  </div>
                )}

                {/* ASR Method (only for ASR type) */}
                {form.type === 'ASR' && (
                  <div className="animate-slide-down">
                    <label className="block text-sm font-medium text-pastel-700 mb-1.5">ASR Method</label>
                    <select
                      value={form.asrMethod}
                      onChange={e => setForm({ ...form, asrMethod: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm bg-white
                                 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all"
                    >
                      <option value="">선택하세요</option>
                      <option value="AUDIO_URL">AUDIO_URL (vLLM chat/completions)</option>
                      <option value="OPENAI_TRANSCRIBE">OPENAI_TRANSCRIBE (Whisper multipart)</option>
                    </select>
                    <p className="mt-1 text-xs text-pastel-400">
                      AUDIO_URL: base64 오디오를 JSON body로 전송 (VibeVoice-ASR, Qwen3-ASR)<br/>
                      OPENAI_TRANSCRIBE: 오디오 파일을 multipart로 전송 (Whisper)
                    </p>
                  </div>
                )}

                {/* ── Name / Display Name ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-pastel-700 mb-1.5">모델 ID *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="gpt-4o, claude-3.5-sonnet"
                      disabled={!!editingModel}
                      className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm
                                 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue
                                 disabled:bg-pastel-50 disabled:text-pastel-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-pastel-700 mb-1.5">표시 이름 *</label>
                    <input
                      type="text"
                      value={form.displayName}
                      onChange={e => setForm({ ...form, displayName: e.target.value })}
                      placeholder="GPT-4o, Claude 3.5 Sonnet"
                      className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm
                                 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all"
                    />
                  </div>
                </div>

                {/* ── Endpoint URL ── */}
                <div>
                  <label className="block text-sm font-medium text-pastel-700 mb-1.5">엔드포인트 URL * <span className="text-pastel-400 font-normal">(/v1 까지만 입력)</span></label>
                  <input
                    type="text"
                    value={form.endpointUrl}
                    onChange={e => setForm({ ...form, endpointUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm font-mono
                               focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all"
                  />
                  <p className="mt-1 text-xs text-pastel-400">/chat/completions, /embeddings, /rerank, /images/generations 경로는 프록시가 자동으로 분기합니다</p>
                </div>

                {/* ── API Key / Max Tokens ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-pastel-700 mb-1.5">API Key</label>
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={e => setForm({ ...form, apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm
                                 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-pastel-700 mb-1.5">Max Tokens</label>
                    <input
                      type="number"
                      value={form.maxTokens}
                      onChange={e => setForm({ ...form, maxTokens: parseInt(e.target.value) || 128000 })}
                      className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm
                                 focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all"
                    />
                  </div>
                </div>

                {/* ── Extra Headers (JSON) ── */}
                <div>
                  <label className="block text-sm font-medium text-pastel-700 mb-1.5">Extra Headers (JSON)</label>
                  <textarea
                    value={form.extraHeaders}
                    onChange={e => setForm({ ...form, extraHeaders: e.target.value })}
                    placeholder='{"X-Custom-Header": "value"}'
                    rows={2}
                    className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm font-mono
                               focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all resize-none"
                  />
                </div>

                {/* ── Extra Body (JSON) ── */}
                <div>
                  <label className="block text-sm font-medium text-pastel-700 mb-1.5">Extra Body (JSON)</label>
                  <textarea
                    value={form.extraBody}
                    onChange={e => setForm({ ...form, extraBody: e.target.value })}
                    placeholder='{"key": "value"}'
                    rows={2}
                    className="w-full px-3.5 py-2.5 border border-pastel-200 rounded-ios text-sm font-mono
                               focus:outline-none focus:ring-2 focus:ring-samsung-blue/20 focus:border-samsung-blue transition-all resize-none"
                  />
                </div>
              </div>

              {/* ── Visibility ── */}
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-2">접근 범위</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['PUBLIC', 'TEAM', 'ADMIN_ONLY', 'SUPER_ADMIN_ONLY'] as VisibilityType[]).map(v => {
                    const cfg = VISIBILITY_CONFIG[v];
                    const Icon = cfg.icon;
                    // BUSINESS_UNIT 기존 데이터도 TEAM 버튼에 active로 표시
                    const isSelected = form.visibility === v || (v === 'TEAM' && form.visibility === 'BUSINESS_UNIT');
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setForm({ ...form, visibility: v === 'TEAM' ? 'TEAM' : v, visibilityScope: v === 'TEAM' ? form.visibilityScope : [], adminVisible: false })}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-ios border-2 transition-all duration-200
                          ${isSelected
                            ? 'border-samsung-blue bg-samsung-blue/5'
                            : 'border-pastel-100 hover:border-pastel-300 bg-white'}`}
                      >
                        <Icon className={`w-5 h-5 ${isSelected ? 'text-samsung-blue' : 'text-pastel-400'}`} />
                        <span className={`text-xs font-medium text-center leading-tight ${isSelected ? 'text-samsung-blue' : 'text-pastel-600'}`}>
                          {cfg.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-pastel-400 mt-1.5">
                  {VISIBILITY_CONFIG[form.visibility === 'BUSINESS_UNIT' ? 'TEAM' : form.visibility].desc}
                </p>

                {/* OrgTree selector for TEAM / BUSINESS_UNIT (기존 BU 데이터 호환) */}
                {(form.visibility === 'TEAM' || form.visibility === 'BUSINESS_UNIT') && (
                  <OrgTreeSelector
                    selected={form.visibilityScope}
                    onChange={next => setForm({ ...form, visibility: 'TEAM', visibilityScope: next })}
                  />
                )}

                {/* Admin Visible toggle — only for BU / TEAM scoped models */}
                {(form.visibility === 'BUSINESS_UNIT' || form.visibility === 'TEAM') && (
                  <div className="mt-3 flex items-start gap-3 p-3 bg-pastel-50 rounded-ios">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={form.adminVisible}
                          onChange={e => setForm({ ...form, adminVisible: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full
                                        after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full
                                        after:h-5 after:w-5 after:transition-all peer-checked:bg-samsung-blue" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-pastel-700">시스템 관리자 공개</span>
                        <p className="text-xs text-pastel-400 mt-0.5">활성화 시 다른 팀/사업부의 시스템 관리자도 이 모델을 사용할 수 있습니다</p>
                      </div>
                    </label>
                  </div>
                )}
              </div>

              {/* ── Options (toggles) ── */}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-3 p-3 bg-pastel-50 rounded-ios cursor-pointer hover:bg-pastel-100 transition-colors">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={e => setForm({ ...form, enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full
                                    after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full
                                    after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                  </div>
                  <span className="text-sm text-pastel-700">활성화</span>
                </label>

                {/* Vision toggle — hidden for IMAGE type */}
                {form.type === 'CHAT' && (
                  <label className="flex items-center gap-3 p-3 bg-pastel-50 rounded-ios cursor-pointer hover:bg-pastel-100 transition-colors">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={form.supportsVision}
                        onChange={e => {
                          setForm({ ...form, supportsVision: e.target.checked });
                          if (!e.target.checked) setVisionTestResult(null);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full
                                      after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full
                                      after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500" />
                    </div>
                    <span className="text-sm text-pastel-700">Vision 지원</span>
                  </label>
                )}

                <div className="flex items-center gap-2 p-3 bg-pastel-50 rounded-ios">
                  <label className="text-sm text-pastel-700">정렬 순서</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={e => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                    className="w-20 px-2 py-1 text-sm border border-pastel-200 rounded-ios text-center
                               focus:outline-none focus:ring-2 focus:ring-samsung-blue/20"
                  />
                </div>
              </div>

              {/* ═══════════════════════════════════════
                  Test Section (CHAT)
                  ═══════════════════════════════════════ */}
              {form.type === 'CHAT' && (
                <div className="space-y-4">
                  <div className="border-t border-pastel-100 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-pastel-700 flex items-center gap-2">
                        <Play className="w-4 h-4" />
                        Tool Call 테스트
                        <span className="text-xs font-normal text-pastel-400">(최소 2개 통과 필요)</span>
                      </h3>
                      <button
                        type="button"
                        onClick={runFormTest}
                        disabled={testRunning || !form.endpointUrl || !form.name}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg
                                   bg-blue-600
                                   hover:bg-blue-700 transition-all duration-200
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   transform active:scale-[0.97]"
                      >
                        {testRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        테스트 실행
                      </button>
                    </div>

                    {testResult && (
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 animate-slide-down">
                        {/* Chat Completion */}
                        <div className={`p-3 rounded-lg border text-center transition-all ${
                          testResult.chatCompletion
                            ? 'bg-green-50 border-green-200'
                            : 'bg-red-50 border-red-200'
                        }`}>
                          {testResult.chatCompletion
                            ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                            : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                          <p className={`text-xs font-medium ${testResult.chatCompletion ? 'text-green-700' : 'text-red-700'}`}>Chat</p>
                        </div>
                        {/* Tool A */}
                        <div className={`p-3 rounded-lg border text-center transition-all ${
                          testResult.toolCallA ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                        }`}>
                          {testResult.toolCallA
                            ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                            : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                          <p className={`text-xs font-medium ${testResult.toolCallA ? 'text-green-700' : 'text-red-700'}`}>Tool A</p>
                        </div>
                        {/* Tool B */}
                        <div className={`p-3 rounded-lg border text-center transition-all ${
                          testResult.toolCallB ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                        }`}>
                          {testResult.toolCallB
                            ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                            : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                          <p className={`text-xs font-medium ${testResult.toolCallB ? 'text-green-700' : 'text-red-700'}`}>Tool B</p>
                        </div>
                        {/* Tool C */}
                        <div className={`p-3 rounded-lg border text-center transition-all ${
                          testResult.toolCallC ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                        }`}>
                          {testResult.toolCallC
                            ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                            : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                          <p className={`text-xs font-medium ${testResult.toolCallC ? 'text-green-700' : 'text-red-700'}`}>Tool C</p>
                        </div>
                        {/* Tool D */}
                        <div className={`p-3 rounded-lg border text-center transition-all ${
                          testResult.toolCallD ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                        }`}>
                          {testResult.toolCallD
                            ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                            : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                          <p className={`text-xs font-medium ${testResult.toolCallD ? 'text-green-700' : 'text-red-700'}`}>Tool D</p>
                        </div>
                      </div>
                    )}

                    {testResult && (
                      <div className={`mt-2 px-3 py-2 rounded-ios text-xs font-medium animate-slide-down ${
                        getToolCallPassCount(testResult) >= 2
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        Tool Call 통과: {getToolCallPassCount(testResult)} / 4
                        {getToolCallPassCount(testResult) >= 2 ? ' — 통과' : ' — 최소 2개 이상 통과 필요'}
                      </div>
                    )}
                  </div>

                  {/* Vision Test */}
                  {form.supportsVision && (
                    <div className="border-t border-pastel-100 pt-4 animate-slide-down">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-pastel-700 flex items-center gap-2">
                          <Eye className="w-4 h-4" />
                          Vision 테스트
                        </h3>
                        <button
                          type="button"
                          onClick={runVisionTest}
                          disabled={visionTestRunning || !form.endpointUrl || !form.name}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg
                                     bg-blue-600
                                     hover:bg-blue-700 transition-all duration-200
                                     disabled:opacity-50 disabled:cursor-not-allowed
                                     transform active:scale-[0.97]"
                        >
                          {visionTestRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                          Vision 테스트
                        </button>
                      </div>

                      {visionTestResult && (
                        <div className="space-y-2 animate-slide-down">
                          <div className="grid grid-cols-2 gap-2">
                            <div className={`p-3 rounded-lg border text-center ${
                              visionTestResult.visionDescribe ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                            }`}>
                              {visionTestResult.visionDescribe
                                ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                                : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                              <p className={`text-xs font-medium ${visionTestResult.visionDescribe ? 'text-green-700' : 'text-red-700'}`}>
                                Vision Describe
                              </p>
                            </div>
                            <div className={`p-3 rounded-lg border text-center ${
                              visionTestResult.visionJudge ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                            }`}>
                              {visionTestResult.visionJudge
                                ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                                : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                              <p className={`text-xs font-medium ${visionTestResult.visionJudge ? 'text-green-700' : 'text-red-700'}`}>
                                Vision Judge
                              </p>
                            </div>
                          </div>
                          <div className={`px-3 py-2 rounded-ios text-xs font-medium ${
                            visionTestResult.passed
                              ? 'bg-green-50 text-green-700 border border-green-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {visionTestResult.passed ? 'Vision 테스트 통과' : 'Vision 인식 테스트를 통과해야 Vision 모델로 등록할 수 있습니다'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ═══════════════════════════════════════
                  Test Section (IMAGE)
                  ═══════════════════════════════════════ */}
              {form.type === 'IMAGE' && (
                <div className="border-t border-pastel-100 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-pastel-700 flex items-center gap-2">
                      <Image className="w-4 h-4" />
                      이미지 생성 테스트
                    </h3>
                    <button
                      type="button"
                      onClick={runImageTest}
                      disabled={imageTestRunning || !form.endpointUrl || !form.name}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg
                                 bg-blue-600
                                 hover:bg-blue-700 transition-all duration-200
                                 disabled:opacity-50 disabled:cursor-not-allowed
                                 transform active:scale-[0.97]"
                    >
                      {imageTestRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Image className="w-4 h-4" />}
                      이미지 생성 테스트
                    </button>
                  </div>

                  {imageTestResult && (
                    <div className="space-y-2 animate-slide-down">
                      <div className={`p-3 rounded-lg border text-center ${
                        imageTestResult.imageGen ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                      }`}>
                        {imageTestResult.imageGen
                          ? <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                          : <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />}
                        <p className={`text-xs font-medium ${imageTestResult.imageGen ? 'text-green-700' : 'text-red-700'}`}>
                          Image Generation
                        </p>
                      </div>
                      <div className={`px-3 py-2 rounded-ios text-xs font-medium ${
                        imageTestResult.passed
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {imageTestResult.passed ? '이미지 생성 테스트 통과' : '이미지 생성 테스트를 통과해야 IMAGE 모델로 등록할 수 있습니다'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Embedding Test (EMBEDDING type) ── */}
              {form.type === 'EMBEDDING' && (
                <div className="border-t border-pastel-100 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-pastel-700 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-samsung-blue" />
                      임베딩 테스트 <span className="text-pastel-400 font-normal text-xs">(통과 필요)</span>
                    </h3>
                    <button
                      type="button"
                      onClick={runEmbeddingTest}
                      disabled={embeddingTestRunning || !form.endpointUrl || !form.name}
                      className="px-4 py-2 rounded-ios text-xs font-medium bg-samsung-blue text-white
                                 hover:bg-samsung-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                 flex items-center gap-1.5"
                    >
                      {embeddingTestRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                      임베딩 테스트
                    </button>
                  </div>
                  {embeddingTestResult && (
                    <div className="space-y-2">
                      <div className={`flex items-center gap-2 p-2 rounded-ios border ${
                        embeddingTestResult.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                      }`}>
                        {embeddingTestResult.passed
                          ? <CheckCircle className="w-4 h-4 text-green-600" />
                          : <XCircle className="w-4 h-4 text-red-600" />}
                        <p className={`text-xs font-medium ${embeddingTestResult.passed ? 'text-green-700' : 'text-red-700'}`}>
                          {embeddingTestResult.message || (embeddingTestResult.passed ? '임베딩 테스트 통과' : '임베딩 테스트 실패')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Rerank Test (RERANKING type) ── */}
              {form.type === 'RERANKING' && (
                <div className="border-t border-pastel-100 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-pastel-700 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-samsung-blue" />
                      리랭킹 테스트 <span className="text-pastel-400 font-normal text-xs">(통과 필요)</span>
                    </h3>
                    <button
                      type="button"
                      onClick={runRerankTest}
                      disabled={rerankTestRunning || !form.endpointUrl || !form.name}
                      className="px-4 py-2 rounded-ios text-xs font-medium bg-samsung-blue text-white
                                 hover:bg-samsung-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                 flex items-center gap-1.5"
                    >
                      {rerankTestRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      리랭킹 테스트
                    </button>
                  </div>
                  {rerankTestResult && (
                    <div className="space-y-2">
                      <div className={`flex items-center gap-2 p-2 rounded-ios border ${
                        rerankTestResult.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                      }`}>
                        {rerankTestResult.passed
                          ? <CheckCircle className="w-4 h-4 text-green-600" />
                          : <XCircle className="w-4 h-4 text-red-600" />}
                        <p className={`text-xs font-medium ${rerankTestResult.passed ? 'text-green-700' : 'text-red-700'}`}>
                          {rerankTestResult.message || (rerankTestResult.passed ? '리랭킹 테스트 통과' : '리랭킹 테스트 실패')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── ASR Test (ASR type) ── */}
              {form.type === 'ASR' && (
                <div className="border-t border-pastel-100 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-pastel-700 flex items-center gap-2">
                      <Mic className="w-4 h-4 text-samsung-blue" />
                      ASR 테스트 <span className="text-pastel-400 font-normal text-xs">(통과 필요)</span>
                    </h3>
                    <button
                      type="button"
                      onClick={runAsrTest}
                      disabled={asrTestRunning || !form.endpointUrl || !form.name}
                      className="px-4 py-2 rounded-ios text-xs font-medium bg-samsung-blue text-white
                                 hover:bg-samsung-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                 flex items-center gap-1.5"
                    >
                      {asrTestRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                      ASR 테스트
                    </button>
                  </div>
                  {asrTestResult && (
                    <div className="space-y-2">
                      <div className={`flex items-center gap-2 p-2 rounded-ios border ${
                        asrTestResult.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                      }`}>
                        {asrTestResult.passed
                          ? <CheckCircle className="w-4 h-4 text-green-600" />
                          : <XCircle className="w-4 h-4 text-red-600" />}
                        <p className={`text-xs font-medium ${asrTestResult.passed ? 'text-green-700' : 'text-red-700'}`}>
                          {asrTestResult.message || (asrTestResult.passed ? 'ASR 테스트 통과' : 'ASR 테스트 실패')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Modal Footer ── */}
            <div className="sticky bottom-0 bg-white border-t border-pastel-100 px-6 py-4 rounded-b-xl">
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 text-sm font-medium text-pastel-600 hover:bg-pastel-50 rounded-ios transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-medium bg-samsung-blue text-white rounded-ios
                             hover:bg-samsung-blue-dark shadow-ios transition-all duration-200
                             disabled:opacity-50 disabled:cursor-not-allowed
                             transform active:scale-[0.97]"
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      저장 중...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      {editingModel ? '수정' : '생성'}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-modal w-full max-w-md animate-scale-in">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-pastel-800 text-center">모델 삭제</h3>
              <p className="text-sm text-pastel-500 text-center mt-2">
                <span className="font-medium text-pastel-700">{deleteTarget.displayName}</span>을(를) 삭제하시겠습니까?
                <br />이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-pastel-600 bg-pastel-50 rounded-ios
                           hover:bg-pastel-100 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 rounded-ios
                           hover:bg-red-600 transition-colors transform active:scale-[0.97]"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
      {showGuide && (
        <ModelGuide
          onClose={() => setShowGuide(false)}
          onOpenCreateModal={openCreateModal}
          userId={user?.loginid}
          deptName={user?.deptname}
        />
      )}
    </div>
  );
}
