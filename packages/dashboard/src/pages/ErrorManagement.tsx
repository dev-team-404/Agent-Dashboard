import { useState, useEffect, useCallback, Fragment } from 'react';
import { AlertTriangle, Filter, ChevronDown, ChevronRight, X, Clock, Sparkles, Loader2, Tag, User, Zap, Wifi, WifiOff, Server, Timer } from 'lucide-react';
import { api } from '../services/api';
import { TableLoadingRow } from '../components/LoadingSpinner';

interface FailoverAttempt {
  endpoint: string;
  attempt: number;
  statusCode: number | null;
  errorType: 'timeout' | 'connection' | 'http_5xx' | 'http_4xx' | 'stream_error' | 'unknown';
  errorMessage: string;
  latencyMs: number;
  modelName: string;
}

interface ErrorDetails {
  totalAttempts: number;
  attempts: FailoverAttempt[];
  timeoutMs: number;
}

interface ErrorLog {
  id: string;
  serviceId: string | null;
  userId: string | null;
  deptname: string | null;
  modelName: string;
  resolvedModel: string | null;
  method: string;
  path: string;
  statusCode: number;
  errorMessage: string | null;
  errorDetails: ErrorDetails | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  userAgent: string | null;
  ipAddress: string | null;
  stream: boolean;
  timestamp: string;
  service: { name: string; displayName: string } | null;
  ruleCause: string | null;
  ruleCategory: string | null;
  isAnalyzable: boolean;
}

interface LlmModel {
  id: string;
  name: string;
  displayName: string;
  type: string;
}

interface Analysis {
  severity: string;
  cause: string;
  detail: string;
  suggestion: string;
  category: string;
  errorPattern?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function formatKST(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
}

const STATUS_COLORS: Record<number, string> = {
  400: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  401: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  403: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  404: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  429: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  500: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  502: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  503: 'bg-red-100 text-red-800 ring-1 ring-red-300',
};

const SEVERITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-700',
  MEDIUM: 'bg-amber-100 text-amber-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

export default function ErrorManagement() {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [categories, setCategories] = useState<string[]>([]);

  // Filters
  const [statusCode, setStatusCode] = useState('');
  const [category, setCategory] = useState('');
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Analysis
  const [models, setModels] = useState<LlmModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, Analysis>>(new Map());
  const [analyzeErrors, setAnalyzeErrors] = useState<Map<string, string>>(new Map());

  // Expanded
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { loadLogs(); }, [pagination.page, statusCode, category, startDate, endDate]);
  useEffect(() => { loadModels(); }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (pagination.page === 1) loadLogs();
      else setPagination(p => ({ ...p, page: 1 }));
    }, 300);
    return () => clearTimeout(t);
  }, [userId]);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page: pagination.page, limit: pagination.limit };
      if (statusCode) params.statusCode = statusCode;
      if (category) params.category = category;
      if (userId) params.userId = userId;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get('/admin/error-logs', { params });
      setLogs(res.data.logs);
      setPagination(p => ({ ...p, ...res.data.pagination }));
      if (res.data.categories) setCategories(res.data.categories);
    } catch (err) {
      console.error('Failed to load error logs:', err);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, statusCode, category, userId, startDate, endDate]);

  const loadModels = async () => {
    try {
      const [modelsRes, settingRes] = await Promise.all([
        api.get('/admin/models'),
        api.get('/admin/system-settings/system-llm'),
      ]);
      const chatModels = (modelsRes.data.models || []).filter((m: LlmModel) => m.type === 'CHAT');
      setModels(chatModels);
      // 시스템 설정된 에러 분석 LLM을 기본값으로
      const errSetting = (settingRes.data.settings || []).find((s: { key: string }) => s.key === 'ERROR_ANALYSIS_LLM_MODEL_ID');
      if (errSetting?.modelId) {
        setSelectedModel(errSetting.modelId);
      } else if (chatModels.length > 0 && !selectedModel) {
        setSelectedModel(chatModels[0].id);
      }
    } catch { /* ignore */ }
  };

  const analyzeError = async (logId: string) => {
    if (!selectedModel) return;
    setAnalyzingId(logId);
    setAnalyzeErrors(prev => { const n = new Map(prev); n.delete(logId); return n; });
    try {
      const res = await api.post(`/admin/error-logs/${logId}/analyze`, { modelId: selectedModel });
      setAnalyses(prev => new Map(prev).set(logId, res.data.analysis));
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.detail || 'AI 분석에 실패했습니다';
      setAnalyzeErrors(prev => new Map(prev).set(logId, msg));
    } finally {
      setAnalyzingId(null);
    }
  };

  const hasFilters = statusCode || category || userId || startDate || endDate;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-red-50">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">에러 관리</h1>
            <p className="text-sm text-pastel-500 mt-0.5">
              API 프록시 에러를 추적하고 원인을 분석합니다
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* LLM 선택 */}
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg text-pastel-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 max-w-[200px]"
            title="AI 분석에 사용할 LLM 선택"
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </select>
          <div className="flex items-center gap-2.5 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <span className="text-sm font-semibold text-pastel-700">총 {pagination.total.toLocaleString()}건</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pastel-400" />
            <input
              type="text"
              placeholder="사용자 ID 검색..."
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-400 focus:outline-none focus:ring-2 focus:ring-red-500/15 focus:border-red-500/30"
            />
          </div>
          <select
            value={statusCode}
            onChange={e => { setStatusCode(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
            className="px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700"
          >
            <option value="">전체 상태코드</option>
            <option value="400">400 Bad Request</option>
            <option value="401">401 Unauthorized</option>
            <option value="403">403 Forbidden</option>
            <option value="404">404 Not Found</option>
            <option value="429">429 Rate Limit</option>
            <option value="500,502,503">5xx Server Error</option>
          </select>
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
            className="px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700"
          >
            <option value="">전체 카테고리</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200/60 text-sm text-pastel-600 hover:bg-pastel-50"
          >
            <Filter className="w-4 h-4" />날짜
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-pastel-500 mb-1">시작일</label>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
                className="w-full px-3 py-2 bg-white border border-gray-200/60 rounded-lg text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-pastel-500 mb-1">종료일</label>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
                className="w-full px-3 py-2 bg-white border border-gray-200/60 rounded-lg text-sm" />
            </div>
            {hasFilters && (
              <button onClick={() => { setStatusCode(''); setCategory(''); setUserId(''); setStartDate(''); setEndDate(''); }}
                className="flex items-center gap-1 text-sm text-pastel-500 hover:text-red-500 pb-2">
                <X className="w-3.5 h-3.5" />초기화
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error Logs Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: '1100px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100/80">
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[30px]"></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[155px]">시각</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-pastel-500 uppercase w-[60px]">코드</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[120px]">사용자</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[130px]">서비스</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase w-[120px]">모델</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-pastel-500 uppercase">원인</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-pastel-500 uppercase w-[80px]">분석</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <TableLoadingRow colSpan={8} message="에러 로그 불러오는 중..." />
              ) : logs.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertTriangle className="w-8 h-8 text-pastel-300" />
                    <p className="text-sm text-pastel-600">에러 로그가 없습니다</p>
                  </div>
                </td></tr>
              ) : logs.map(log => {
                const isExpanded = expandedId === log.id;
                const analysis = analyses.get(log.id);
                const errMsg = analyzeErrors.get(log.id);
                const isAnalyzing = analyzingId === log.id;
                const statusColor = STATUS_COLORS[log.statusCode] || 'bg-gray-50 text-gray-600 ring-1 ring-gray-200';

                const handleExpand = () => {
                  if (isExpanded) { setExpandedId(null); return; }
                  setExpandedId(log.id);
                  // 미분류 에러 + 분석 미완료 → 자동 AI 분석 시작
                  if (log.isAnalyzable && !analysis && !isAnalyzing && selectedModel) {
                    analyzeError(log.id);
                  }
                };

                return (
                  <Fragment key={log.id}>
                    <tr className={`group cursor-pointer ${isExpanded ? 'bg-gray-50/50' : 'hover:bg-gray-50/30'}`} onClick={handleExpand}>
                      <td className="px-3 py-2.5">
                        <div className="p-1">
                          <ChevronRight className={`w-3.5 h-3.5 text-pastel-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-pastel-400 flex-shrink-0" />
                          <span className="text-[11px] text-pastel-600 font-mono tabular-nums">{formatKST(log.timestamp)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold rounded-full ${statusColor}`}>
                          {log.statusCode}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-pastel-700 font-medium truncate max-w-[110px]" title={log.userId || '-'}>
                          {log.userId || '-'}
                        </div>
                        <div className="text-[10px] text-pastel-400 truncate max-w-[110px]" title={log.deptname || ''}>
                          {log.deptname || ''}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-pastel-700 truncate max-w-[120px]" title={log.service?.displayName || '-'}>
                          {log.service?.displayName || '-'}
                        </div>
                        <code className="text-[10px] text-pastel-400 font-mono">{log.method} {log.path.split('?')[0]}</code>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-pastel-600 truncate max-w-[110px]" title={log.modelName}>
                          {log.modelName || '-'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {log.ruleCause ? (
                          <div className="flex items-start gap-1.5">
                            <Tag className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <span className="text-xs text-pastel-700">{log.ruleCause}</span>
                              {log.ruleCategory && (
                                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{log.ruleCategory}</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-pastel-400 italic">
                            {log.errorMessage ? log.errorMessage.substring(0, 80) + (log.errorMessage.length > 80 ? '...' : '') : '원인 미상'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {analysis ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded ${SEVERITY_COLORS[analysis.severity] || 'bg-gray-100 text-gray-600'}`}>
                            {analysis.severity}
                          </span>
                        ) : isAnalyzing ? (
                          <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin mx-auto" />
                        ) : log.isAnalyzable ? (
                          <Sparkles className="w-3.5 h-3.5 text-violet-400 mx-auto" />
                        ) : (
                          <span className="text-[10px] text-pastel-300">-</span>
                        )}
                      </td>
                    </tr>
                    {/* 인라인 상세 — 해당 행 바로 아래 */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 animate-slide-down">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 text-xs">
                              <div><span className="text-pastel-400 block">사용자</span><span className="text-pastel-700 font-medium">{log.userId || '-'}</span></div>
                              <div><span className="text-pastel-400 block">부서</span><span className="text-pastel-700">{log.deptname || '-'}</span></div>
                              <div><span className="text-pastel-400 block">IP</span><span className="text-pastel-700 font-mono">{log.ipAddress || '-'}</span></div>
                              <div><span className="text-pastel-400 block">Latency</span><span className="text-pastel-700">{log.latencyMs != null ? `${log.latencyMs}ms` : '-'}</span></div>
                              <div><span className="text-pastel-400 block">서비스</span><span className="text-pastel-700">{log.service?.displayName || '-'} ({log.service?.name || '-'})</span></div>
                              <div><span className="text-pastel-400 block">모델</span><span className="text-pastel-700">{log.modelName}{log.resolvedModel && log.resolvedModel !== log.modelName ? ` -> ${log.resolvedModel}` : ''}</span></div>
                              <div><span className="text-pastel-400 block">요청</span><span className="text-pastel-700 font-mono">{log.method} {log.path}</span></div>
                              <div><span className="text-pastel-400 block">User-Agent</span><span className="text-pastel-700 truncate block max-w-[200px]" title={log.userAgent || ''}>{log.userAgent || '-'}</span></div>
                            </div>
                            {log.errorMessage && (
                              <div className="mb-3">
                                <pre className="p-2.5 bg-gray-900 text-gray-200 rounded-lg text-xs font-mono overflow-auto max-h-[80px] leading-relaxed">{log.errorMessage}</pre>
                              </div>
                            )}
                            {/* Failover 시도 이력 (errorDetails) */}
                            {log.errorDetails && log.errorDetails.attempts && log.errorDetails.attempts.length > 0 && (
                              <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2.5">
                                  <Zap className="w-3.5 h-3.5 text-slate-600" />
                                  <span className="text-xs font-semibold text-slate-700">엔드포인트 시도 이력</span>
                                  <span className="text-[10px] text-slate-400 ml-auto">
                                    총 {log.errorDetails.totalAttempts}회 시도 | Timeout 설정: {(log.errorDetails.timeoutMs / 1000).toFixed(0)}초
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {log.errorDetails.attempts.map((attempt, i) => {
                                    const typeConfig: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
                                      timeout: { icon: <Timer className="w-3 h-3" />, label: 'TIMEOUT', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
                                      connection: { icon: <WifiOff className="w-3 h-3" />, label: 'CONNECTION', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
                                      http_5xx: { icon: <Server className="w-3 h-3" />, label: `HTTP ${attempt.statusCode}`, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
                                      http_4xx: { icon: <AlertTriangle className="w-3 h-3" />, label: `HTTP ${attempt.statusCode}`, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
                                      stream_error: { icon: <Wifi className="w-3 h-3" />, label: 'STREAM', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
                                      unknown: { icon: <AlertTriangle className="w-3 h-3" />, label: 'UNKNOWN', color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' },
                                    };
                                    const cfg = typeConfig[attempt.errorType] || typeConfig.unknown;
                                    return (
                                      <div key={i} className={`p-2 rounded border ${cfg.bg}`}>
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-[10px] font-bold text-slate-400 w-4">#{attempt.attempt}</span>
                                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded ${cfg.color} ${cfg.bg}`}>
                                            {cfg.icon} {cfg.label}
                                          </span>
                                          <span className="text-[10px] text-slate-500 font-mono">{(attempt.latencyMs / 1000).toFixed(1)}s</span>
                                          <span className="text-[10px] text-slate-400 truncate ml-auto max-w-[300px]" title={attempt.endpoint}>
                                            {attempt.endpoint}
                                          </span>
                                        </div>
                                        <pre className="text-[10px] font-mono text-slate-600 overflow-auto max-h-[40px] leading-relaxed whitespace-pre-wrap break-all">{attempt.errorMessage}</pre>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {/* AI 분석 결과 (인라인) */}
                            {analysis ? (
                              <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                                  <span className="text-xs font-semibold text-violet-800">AI 원인 분석</span>
                                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${SEVERITY_COLORS[analysis.severity] || ''}`}>{analysis.severity}</span>
                                  {analysis.errorPattern && (
                                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                      analysis.errorPattern === 'outage' ? 'bg-red-100 text-red-700' :
                                      analysis.errorPattern === 'recurring' ? 'bg-amber-100 text-amber-700' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      {analysis.errorPattern === 'outage' ? '서비스 장애' : analysis.errorPattern === 'recurring' ? '반복 발생' : '일회성'}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-violet-500 ml-auto">{analysis.category}</span>
                                </div>
                                <div className="space-y-1.5 text-xs text-pastel-700">
                                  <div><span className="font-semibold text-violet-700">원인:</span> {analysis.cause}</div>
                                  <div><span className="font-semibold text-violet-700">상세:</span> {analysis.detail}</div>
                                  <div><span className="font-semibold text-violet-700">해결:</span> {analysis.suggestion}</div>
                                </div>
                              </div>
                            ) : isAnalyzing ? (
                              <div className="flex items-center gap-2 p-3 bg-violet-50 border border-violet-100 rounded-lg">
                                <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
                                <span className="text-xs text-violet-600">AI 원인 분석 중...</span>
                              </div>
                            ) : errMsg ? (
                              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                                <span className="text-xs text-red-600">{errMsg}</span>
                                <button onClick={(e) => { e.stopPropagation(); analyzeError(log.id); }}
                                  className="ml-auto text-xs text-violet-600 hover:underline">재시도</button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100/80 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-pastel-500">
              <span className="font-semibold text-pastel-700">{pagination.total.toLocaleString()}</span>건 중{' '}
              <span className="font-medium">{((pagination.page - 1) * pagination.limit + 1).toLocaleString()}-{Math.min(pagination.page * pagination.limit, pagination.total).toLocaleString()}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))} disabled={pagination.page <= 1}
                className="px-3 py-2 text-sm font-medium bg-white text-pastel-600 rounded-lg border border-gray-200/60 disabled:opacity-40 hover:bg-pastel-50 transition-all shadow-sm">이전</button>
              <span className="px-3 py-2 text-sm text-pastel-600">{pagination.page} / {pagination.totalPages}</span>
              <button onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))} disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-2 text-sm font-medium bg-white text-pastel-600 rounded-lg border border-gray-200/60 disabled:opacity-40 hover:bg-pastel-50 transition-all shadow-sm">다음</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

}
