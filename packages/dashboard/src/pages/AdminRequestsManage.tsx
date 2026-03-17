import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Check, X, Clock, Loader2, Search } from 'lucide-react';
import { api } from '../services/api';

interface AdminRequest {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
  businessUnit: string | null;
  titleName: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

function formatKST(dateStr: string): string {
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

export default function AdminRequestsManage() {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/admin/admin-requests', { params });
      setRequests(res.data.requests || []);
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    setProcessing(id);
    try {
      await api.put(`/admin/admin-requests/${id}`, {
        action,
        reviewNote: action === 'REJECTED' ? rejectNote[id] || '' : undefined,
      });
      setShowRejectInput(null);
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || '처리에 실패했습니다.');
    } finally {
      setProcessing(null);
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'APPROVED') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80"><Check className="w-3 h-3" />승인</span>;
    if (status === 'REJECTED') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-50 text-red-700 ring-1 ring-red-200/80"><X className="w-3 h-3" />거부</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/80"><Clock className="w-3 h-3" />대기중</span>;
  };

  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">권한 신청 관리</h1>
            <p className="text-sm text-pastel-500 mt-0.5">관리자 권한 신청을 승인하거나 거부합니다</p>
          </div>
        </div>
        {statusFilter === '' && pendingCount > 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2 bg-amber-50 rounded-lg border border-amber-200">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">대기 {pendingCount}건</span>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-1 bg-white rounded-lg shadow-sm border border-gray-100/80 p-1">
        {[
          { key: 'PENDING', label: '대기중' },
          { key: '', label: '전체' },
          { key: 'APPROVED', label: '승인' },
          { key: 'REJECTED', label: '거부' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
              statusFilter === key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-pastel-600 hover:bg-pastel-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Request List */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-lg border border-gray-100/80">
            <Search className="w-8 h-8 text-pastel-300 mx-auto mb-3" />
            <p className="text-sm text-pastel-500">신청 내역이 없습니다</p>
          </div>
        ) : (
          requests.map(r => (
            <div key={r.id} className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
              <div className="p-5">
                {/* 상단: 사원 정보 + 상태 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-blue-600">{(r.username || r.loginid).charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-pastel-800">{r.username || r.loginid}</span>
                        <span className="text-xs text-pastel-400 font-mono">{r.loginid}</span>
                        {r.titleName && <span className="text-xs text-pastel-400">| {r.titleName}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-pastel-500 mt-0.5">
                        <span>{r.deptname}</span>
                        {r.businessUnit && <span className="text-pastel-300">({r.businessUnit})</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(r.status)}
                    <span className="text-xs text-pastel-400">{formatKST(r.createdAt)}</span>
                  </div>
                </div>

                {/* 사유 */}
                <div className="p-3 bg-pastel-50/50 rounded-lg mb-3">
                  <p className="text-xs font-medium text-pastel-500 mb-1">신청 사유</p>
                  <p className="text-sm text-pastel-700 leading-relaxed whitespace-pre-wrap">{r.reason}</p>
                </div>

                {/* 처리 결과 */}
                {r.status !== 'PENDING' && (
                  <div className={`p-3 rounded-lg ${r.status === 'APPROVED' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                    <p className="text-xs text-pastel-500">
                      {r.reviewedBy}이(가) {r.reviewedAt ? formatKST(r.reviewedAt) : ''}에 {r.status === 'APPROVED' ? '승인' : '거부'}
                    </p>
                    {r.reviewNote && <p className="text-xs mt-1 text-pastel-600">{r.reviewNote}</p>}
                  </div>
                )}

                {/* 승인/거부 버튼 (PENDING만) */}
                {r.status === 'PENDING' && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => handleAction(r.id, 'APPROVED')}
                      disabled={processing === r.id}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {processing === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      승인
                    </button>

                    {showRejectInput === r.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={rejectNote[r.id] || ''}
                          onChange={e => setRejectNote({ ...rejectNote, [r.id]: e.target.value })}
                          placeholder="거부 사유 (선택)"
                          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/15 focus:border-red-500/30"
                        />
                        <button
                          onClick={() => handleAction(r.id, 'REJECTED')}
                          disabled={processing === r.id}
                          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {processing === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                          거부
                        </button>
                        <button
                          onClick={() => setShowRejectInput(null)}
                          className="px-2 py-2 text-xs text-pastel-500 hover:text-pastel-700"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowRejectInput(r.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <X className="w-4 h-4" />
                        거부
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
