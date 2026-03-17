import { useState, useEffect, useCallback } from 'react';
import { Key, Check, Loader2, Copy, RefreshCw, AlertCircle, ExternalLink } from 'lucide-react';
import { api } from '../services/api';

export default function ApiKeySettings() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/system-settings/api-key');
      setApiKey(res.data.apiKey || null);
      setApiKeyInput(res.data.apiKey || '');
      setUpdatedBy(res.data.updatedBy || null);
      setUpdatedAt(res.data.updatedAt || null);
    } catch (err) {
      console.error('Failed to load API key:', err);
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
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await api.put('/admin/system-settings/api-key', { apiKey: apiKeyInput.trim() });
      setApiKey(res.data.apiKey);
      setSuccess(true);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'API 비밀번호 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const generateRandomKey = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    setApiKeyInput(result);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-amber-50">
          <Key className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">통계 API 비밀번호</h1>
          <p className="text-sm text-pastel-500 mt-0.5">
            공개 통계 API (GET) 접근 시 필요한 비밀번호를 관리합니다
          </p>
        </div>
      </div>

      {/* 현재 상태 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <h2 className="text-sm font-semibold text-pastel-700 mb-3">현재 설정</h2>

        {apiKey ? (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
            <div className="flex items-center justify-between gap-3">
              <code className="text-sm font-mono text-pastel-700 break-all select-all">{apiKey}</code>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs rounded-md bg-white border border-gray-200 text-pastel-600 hover:bg-gray-50 transition-colors"
              >
                {copied ? <><Check className="w-3.5 h-3.5 text-green-500" /> 복사됨</> : <><Copy className="w-3.5 h-3.5" /> 복사</>}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-pastel-400">
              {updatedBy && <span>설정자: {updatedBy}</span>}
              {updatedAt && <span>변경일: {new Date(updatedAt).toLocaleString('ko-KR')}</span>}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 text-sm text-amber-700">
            <AlertCircle className="w-4 h-4 inline mr-1.5" />
            비밀번호가 설정되지 않았습니다. 누구나 통계 API를 조회할 수 있습니다.
          </div>
        )}
      </div>

      {/* 비밀번호 변경 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <h2 className="text-sm font-semibold text-pastel-700 mb-3">비밀번호 변경</h2>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            placeholder="새 비밀번호 입력 (최소 4자)"
            className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none font-mono"
          />
          <button
            onClick={generateRandomKey}
            title="랜덤 비밀번호 생성 (32자)"
            className="flex-shrink-0 p-2.5 rounded-lg border border-gray-200 text-pastel-500 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !apiKeyInput.trim() || apiKeyInput.trim().length < 4}
            className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
            저장
          </button>
        </div>

        {success && (
          <div className="mt-3 p-2.5 bg-green-50 rounded-lg border border-green-100 text-sm text-green-700 flex items-center gap-2">
            <Check className="w-4 h-4" /> API 비밀번호가 변경되었습니다.
          </div>
        )}
        {error && (
          <div className="mt-3 p-2.5 bg-red-50 rounded-lg border border-red-100 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}
      </div>

      {/* 사용법 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <h2 className="text-sm font-semibold text-pastel-700 mb-3">사용법</h2>
        <div className="space-y-3 text-sm text-pastel-600">
          <p>통계 API (GET) 호출 시 쿼리 파라미터로 비밀번호를 전달합니다:</p>
          <code className="block p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs font-mono text-pastel-700 break-all">
            GET /api/public/stats/services?apiKey={apiKey || 'your-api-key'}
          </code>
          <p className="text-xs text-pastel-400 mt-2">
            POST 요청 (사용량 기록)은 비밀번호가 필요하지 않습니다.
            대시보드에서는 로그인 토큰으로 자동 인증됩니다.
          </p>
        </div>
        <div className="mt-4">
          <a
            href="/api-docs/ui"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Swagger API 문서에서 테스트
          </a>
        </div>
      </div>
    </div>
  );
}
