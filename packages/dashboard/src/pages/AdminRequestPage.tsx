import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Send, Loader2, Check, X, Clock, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

interface AdminRequest {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

interface SuperAdmin {
  loginid: string;
  deptname: string;
}

function formatKST(dateStr: string): string {
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

interface Props {
  isAdmin: boolean;
}

export default function AdminRequestPage({ isAdmin }: Props) {
  const [superAdmins, setSuperAdmins] = useState<SuperAdmin[]>([]);
  const [myRequests, setMyRequests] = useState<AdminRequest[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [saRes, myRes] = await Promise.all([
        api.get('/admin-requests/super-admins'),
        api.get('/admin-requests/my'),
      ]);
      setSuperAdmins(saRes.data.superAdmins || []);
      setMyRequests(myRes.data.requests || []);
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (reason.trim().length < 5) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      await api.post('/admin-requests', { reason: reason.trim() });
      setReason('');
      setSubmitResult({ ok: true, msg: '신청이 접수되었습니다. 관리자 승인을 기다려주세요.' });
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSubmitResult({ ok: false, msg: msg || '신청에 실패했습니다.' });
    } finally {
      setSubmitting(false);
    }
  };

  const hasPending = myRequests.some(r => r.status === 'PENDING');

  const statusBadge = (status: string) => {
    if (status === 'APPROVED') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80"><Check className="w-3 h-3" />승인</span>;
    if (status === 'REJECTED') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-50 text-red-700 ring-1 ring-red-200/80"><X className="w-3 h-3" />거부</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/80"><Clock className="w-3 h-3" />대기중</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-blue-50">
          <ShieldCheck className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">관리자 권한 신청</h1>
          <p className="text-sm text-pastel-500 mt-0.5">
            시스템 관리자 권한을 신청합니다
          </p>
        </div>
      </div>

      {/* 안내사항 */}
      <div className="bg-blue-50 rounded-lg border border-blue-100 p-5">
        <p className="text-sm text-blue-800 leading-relaxed">
          각 팀 AA(AI Agent) 들은 M/M 및 Saved M/M, 서비스와 LLM 관리를 위한 관리자 권한을 드리고 있습니다.
        </p>
        <div className="mt-3 pt-3 border-t border-blue-200/50">
          <p className="text-xs text-blue-600 font-medium mb-1.5">문의: Super Admin</p>
          <div className="flex flex-wrap gap-2">
            {superAdmins.map(sa => (
              <span key={sa.loginid} className="inline-flex items-center px-2.5 py-1 text-xs font-mono bg-white rounded-md border border-blue-200 text-blue-800">
                {sa.loginid}
                {sa.deptname && <span className="text-blue-400 ml-1.5 font-sans">({sa.deptname})</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 이미 관리자 */}
      {isAdmin ? (
        <div className="bg-emerald-50 rounded-lg border border-emerald-100 p-5 flex items-center gap-3">
          <Check className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-sm text-emerald-800 font-medium">이미 관리자 권한이 있습니다.</p>
        </div>
      ) : (
        /* 신청 폼 */
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
          <h2 className="text-sm font-semibold text-pastel-700 mb-4">권한 신청</h2>
          {hasPending ? (
            <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-lg border border-amber-100">
              <Clock className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800">대기 중인 신청이 있습니다. 관리자 승인을 기다려주세요.</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-xs font-medium text-pastel-500 mb-1.5">신청 사유</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="관리자 권한이 필요한 사유를 작성해주세요 (예: OO팀 AI Agent 담당으로 서비스 관리 필요)"
                  rows={3}
                  className="w-full px-4 py-3 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-500/30 resize-none"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || reason.trim().length < 5}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                신청하기
              </button>
            </>
          )}

          {submitResult && (
            <div className={`mt-4 p-3 rounded-lg border text-sm flex items-center gap-2 ${
              submitResult.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'
            }`}>
              {submitResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {submitResult.msg}
            </div>
          )}
        </div>
      )}

      {/* 내 신청 내역 */}
      {myRequests.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100/80">
            <h2 className="text-sm font-semibold text-pastel-700">신청 내역</h2>
          </div>
          <div className="divide-y divide-gray-100/60">
            {myRequests.map(r => (
              <div key={r.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {statusBadge(r.status)}
                    <span className="text-xs text-pastel-400">{formatKST(r.createdAt)}</span>
                  </div>
                </div>
                <p className="text-sm text-pastel-700">{r.reason}</p>
                {r.status === 'REJECTED' && r.reviewNote && (
                  <p className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">거부 사유: {r.reviewNote}</p>
                )}
                {r.status !== 'PENDING' && r.reviewedBy && (
                  <p className="mt-1 text-xs text-pastel-400">처리: {r.reviewedBy} ({r.reviewedAt ? formatKST(r.reviewedAt) : ''})</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
