import { useState, useEffect } from 'react';
import { User, Search, ChevronLeft, ChevronRight, Shield, ShieldCheck, Gauge, X, Infinity } from 'lucide-react';
import { usersApi, serviceApi, rateLimitApi } from '../services/api';

/**
 * URL 인코딩된 사용자 이름을 디코딩
 */
function decodeUsername(name: string | undefined | null): string {
  if (!name) return '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

interface UserData {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
  firstSeen: string;
  lastActive: string;
  isActive: boolean;
  _count: {
    usageLogs: number;
  };
}

interface AdminStatus {
  isAdmin: boolean;
  adminRole: 'SUPER_ADMIN' | 'ADMIN' | null;
  canModify: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ServiceInfo {
  id: string;
  name: string;
  displayName: string;
}

interface RateLimitData {
  userId: string;
  serviceId: string;
  maxTokens: number;
  window: 'FIVE_HOURS' | 'DAY';
  enabled: boolean;
}

interface UsersProps {
  serviceId?: string;
}

export default function Users({ serviceId }: UsersProps) {
  const [users, setUsers] = useState<UserData[]>([]);
  const [adminStatuses, setAdminStatuses] = useState<Record<string, AdminStatus>>({});
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Rate limit state
  const [rateLimits, setRateLimits] = useState<Record<string, RateLimitData>>({});
  const [rateLimitTarget, setRateLimitTarget] = useState<UserData | null>(null);
  const [rateLimitForm, setRateLimitForm] = useState({
    maxTokens: 1000000,
    window: 'DAY' as 'FIVE_HOURS' | 'DAY',
    enabled: true,
  });
  const [savingRateLimit, setSavingRateLimit] = useState(false);

  useEffect(() => {
    loadData(1);
  }, [serviceId]);

  const loadData = async (page: number) => {
    setLoading(true);
    try {
      const response = await usersApi.list(page, 50, serviceId);
      setUsers(response.data.users);
      setPagination(response.data.pagination);

      // Load admin status for each user
      const statuses: Record<string, AdminStatus> = {};
      await Promise.all(
        response.data.users.map(async (user: UserData) => {
          try {
            const statusResponse = await usersApi.getAdminStatus(user.id);
            statuses[user.id] = statusResponse.data;
          } catch {
            statuses[user.id] = { isAdmin: false, adminRole: null, canModify: true };
          }
        })
      );
      setAdminStatuses(statuses);

      // Load service info and rate limits if serviceId is provided
      if (serviceId) {
        const [serviceRes, rateLimitRes] = await Promise.all([
          serviceApi.get(serviceId),
          rateLimitApi.listByService(serviceId).catch(() => ({ data: { rateLimits: [] } })),
        ]);
        setServiceInfo(serviceRes.data.service);

        const rlMap: Record<string, RateLimitData> = {};
        for (const rl of rateLimitRes.data.rateLimits) {
          rlMap[rl.userId] = rl;
        }
        setRateLimits(rlMap);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const filteredUsers = users.filter(
    (user) =>
      user.loginid.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.deptname.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getRoleBadge = (status: AdminStatus | undefined) => {
    if (!status) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
          사용자
        </span>
      );
    }

    if (status.adminRole === 'SUPER_ADMIN') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
          <ShieldCheck className="w-3 h-3" />
          슈퍼관리자
        </span>
      );
    }

    if (status.adminRole === 'ADMIN') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
          <Shield className="w-3 h-3" />
          관리자
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
        사용자
      </span>
    );
  };

  const openRateLimitModal = (user: UserData) => {
    const existing = rateLimits[user.id];
    if (existing) {
      setRateLimitForm({
        maxTokens: existing.maxTokens,
        window: existing.window,
        enabled: existing.enabled,
      });
    } else {
      setRateLimitForm({ maxTokens: 1000000, window: 'DAY', enabled: true });
    }
    setRateLimitTarget(user);
  };

  const handleSaveRateLimit = async () => {
    if (!rateLimitTarget || !serviceId) return;
    setSavingRateLimit(true);
    try {
      await usersApi.setRateLimit(rateLimitTarget.id, {
        serviceId,
        maxTokens: rateLimitForm.maxTokens,
        window: rateLimitForm.window,
        enabled: rateLimitForm.enabled,
      });
      setRateLimitTarget(null);
      loadData(pagination.page);
    } catch {
      alert('Rate limit 설정에 실패했습니다.');
    } finally {
      setSavingRateLimit(false);
    }
  };

  const handleDeleteRateLimit = async () => {
    if (!rateLimitTarget || !serviceId) return;
    setSavingRateLimit(true);
    try {
      await usersApi.deleteRateLimit(rateLimitTarget.id, serviceId);
      setRateLimitTarget(null);
      loadData(pagination.page);
    } catch {
      alert('Rate limit 삭제에 실패했습니다.');
    } finally {
      setSavingRateLimit(false);
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-samsung-blue"></div>
      </div>
    );
  }

  return (
    <div>
      {/* Service Info Banner */}
      {serviceInfo && (
        <div className="bg-gradient-to-r from-samsung-blue to-blue-600 rounded-2xl p-6 text-white mb-8">
          <h1 className="text-2xl font-bold">{serviceInfo.displayName} - 사용자 관리</h1>
          <p className="text-blue-200 text-sm mt-1">서비스 ID: {serviceInfo.name}</p>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">사용자 관리</h1>
        <p className="text-gray-500 mt-1">
          {serviceInfo ? `${serviceInfo.displayName} 서비스의 사용자 목록` : '등록된 사용자 목록 및 권한 관리'}
        </p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름, ID, 부서로 검색..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-samsung-blue focus:border-transparent"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  사용자
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  부서
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  권한
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  마지막 활동
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  요청 수
                </th>
                {serviceId && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rate Limit
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredUsers.map((user) => {
                const status = adminStatuses[user.id];

                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-samsung-blue/10 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-samsung-blue" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{decodeUsername(user.username)}</p>
                          <p className="text-sm text-gray-500">{user.loginid}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-600">{decodeUsername(user.deptname)}</p>
                    </td>
                    <td className="px-6 py-4">
                      {getRoleBadge(status)}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-600">{formatDate(user.lastActive)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-600">{user._count.usageLogs.toLocaleString()}</p>
                    </td>
                    {serviceId && (
                      <td className="px-6 py-4">
                        {rateLimits[user.id] ? (
                          <button
                            onClick={() => openRateLimitModal(user)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                          >
                            <Gauge className="w-3 h-3" />
                            {formatTokens(rateLimits[user.id].maxTokens)} / {rateLimits[user.id].window === 'FIVE_HOURS' ? '5h' : 'day'}
                          </button>
                        ) : (
                          <button
                            onClick={() => openRateLimitModal(user)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                          >
                            <Infinity className="w-3 h-3" />
                            무제한
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={serviceId ? 6 : 5} className="px-6 py-12 text-center text-gray-500">
                    {searchQuery ? '검색 결과가 없습니다.' : '사용자가 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {(pagination.page - 1) * pagination.limit + 1} -{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} / 총 {pagination.total}명
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadData(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm text-gray-600">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => loadData(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages}
                className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Rate Limit Modal */}
      {rateLimitTarget && serviceId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Token Rate Limit</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {decodeUsername(rateLimitTarget.username)} ({rateLimitTarget.loginid})
                </p>
              </div>
              <button onClick={() => setRateLimitTarget(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Window selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">윈도우</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['FIVE_HOURS', 'DAY'] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => setRateLimitForm(f => ({ ...f, window: w }))}
                      className={`py-2.5 px-4 rounded-xl text-sm font-medium border-2 transition-all ${
                        rateLimitForm.window === w
                          ? 'border-samsung-blue bg-samsung-blue/5 text-samsung-blue'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {w === 'FIVE_HOURS' ? '5시간' : '24시간 (1일)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max tokens */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  최대 토큰 수
                </label>
                <input
                  type="number"
                  value={rateLimitForm.maxTokens}
                  onChange={(e) => setRateLimitForm(f => ({ ...f, maxTokens: parseInt(e.target.value) || 0 }))}
                  min={1}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-samsung-blue focus:border-transparent"
                  placeholder="예: 1000000"
                />
                <div className="flex gap-2 mt-2">
                  {[100000, 500000, 1000000, 5000000].map((v) => (
                    <button
                      key={v}
                      onClick={() => setRateLimitForm(f => ({ ...f, maxTokens: v }))}
                      className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
                    >
                      {formatTokens(v)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">활성화</span>
                <button
                  onClick={() => setRateLimitForm(f => ({ ...f, enabled: !f.enabled }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    rateLimitForm.enabled ? 'bg-samsung-blue' : 'bg-gray-300'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    rateLimitForm.enabled ? 'translate-x-5' : ''
                  }`} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 p-6 border-t bg-gray-50 rounded-b-2xl">
              {rateLimits[rateLimitTarget.id] && (
                <button
                  onClick={handleDeleteRateLimit}
                  disabled={savingRateLimit}
                  className="px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50"
                >
                  제한 해제
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setRateLimitTarget(null)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveRateLimit}
                disabled={savingRateLimit || rateLimitForm.maxTokens < 1}
                className="px-6 py-2.5 text-sm font-medium bg-samsung-blue text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {savingRateLimit ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
