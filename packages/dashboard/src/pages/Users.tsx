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
      } else {
        setServiceInfo(null);
        setRateLimits({});
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
        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-gray-100/80 text-gray-500 rounded-full ring-1 ring-gray-200/60">
          사용자
        </span>
      );
    }

    if (status.adminRole === 'SUPER_ADMIN') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-red-50 text-red-600 rounded-full ring-1 ring-red-200/60">
          <ShieldCheck className="w-3.5 h-3.5" />
          슈퍼관리자
        </span>
      );
    }

    if (status.adminRole === 'ADMIN') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-samsung-blue/8 text-samsung-blue rounded-full ring-1 ring-samsung-blue/20">
          <Shield className="w-3.5 h-3.5" />
          관리자
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-gray-100/80 text-gray-500 rounded-full ring-1 ring-gray-200/60">
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
      <div className="flex flex-col items-center justify-center h-64 gap-4 animate-fade-in">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-[3px] border-pastel-200 border-t-samsung-blue animate-spin" />
          <div className="absolute inset-0 w-12 h-12 rounded-full border-[3px] border-transparent border-t-samsung-blue/30 animate-ping" />
        </div>
        <p className="text-sm font-medium text-pastel-400">사용자 목록을 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Service Info Banner */}
      {serviceInfo && (
        <div className="relative overflow-hidden rounded-2xl mb-8 animate-stagger-1">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-samsung-blue via-pastel-500 to-accent-indigo" />
          {/* Mesh pattern overlay */}
          <div className="absolute inset-0 bg-mesh-1 opacity-40" />
          {/* Decorative orbs */}
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-white/10 rounded-full blur-2xl animate-float" />
          <div className="absolute -bottom-16 -left-16 w-56 h-56 bg-accent-violet/15 rounded-full blur-3xl" />
          <div className="absolute top-1/2 right-1/4 w-24 h-24 bg-accent-emerald/10 rounded-full blur-xl" />
          {/* Content */}
          <div className="relative z-10 px-8 py-7">
            <h1 className="text-2xl font-bold text-white tracking-tight">{serviceInfo.displayName} - 사용자 관리</h1>
            <p className="text-white/60 text-sm mt-1.5 font-medium">서비스 ID: {serviceInfo.name}</p>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="mb-8 animate-stagger-2">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-samsung-blue to-accent-indigo rounded-ios-lg flex items-center justify-center shadow-glow-blue">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-900 tracking-tight">사용자 관리</h1>
            <p className="text-pastel-400 text-sm mt-0.5">
              {serviceInfo ? `${serviceInfo.displayName} 서비스의 사용자 목록` : '등록된 사용자 목록 및 권한 관리'}
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6 animate-stagger-3">
        <div className="relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-300" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름, ID, 부서로 검색..."
            className="w-full pl-14 pr-6 py-3.5 bg-white border border-gray-100/80 rounded-2xl shadow-depth text-sm text-pastel-800 placeholder:text-pastel-300 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-300 ease-ios-spring"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-gray-100/80 shadow-card overflow-hidden animate-stagger-4">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-pastel-50/80">
                <th className="px-6 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                  사용자
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                  부서
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                  권한
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                  마지막 활동
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                  요청 수
                </th>
                {serviceId && (
                  <th className="px-6 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">
                    Rate Limit
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/80">
              {filteredUsers.map((user) => {
                const status = adminStatuses[user.id];

                return (
                  <tr key={user.id} className="hover:bg-pastel-50/50 transition-all duration-300 ease-ios-spring group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 bg-gradient-to-br from-pastel-300 to-samsung-blue rounded-full flex items-center justify-center shadow-soft ring-2 ring-white">
                          <User className="w-4.5 h-4.5 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-pastel-800 group-hover:text-samsung-blue transition-colors duration-300">{decodeUsername(user.username)}</p>
                          <p className="text-xs text-pastel-400 mt-0.5 font-medium">{user.loginid}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-pastel-600">{decodeUsername(user.deptname)}</p>
                    </td>
                    <td className="px-6 py-4">
                      {getRoleBadge(status)}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-pastel-500 tabular-nums">{formatDate(user.lastActive)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-semibold text-pastel-700 tabular-nums">{user._count.usageLogs.toLocaleString()}</span>
                    </td>
                    {serviceId && (
                      <td className="px-6 py-4">
                        {rateLimits[user.id] ? (
                          <button
                            onClick={() => openRateLimitModal(user)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-accent-amber/10 text-amber-700 ring-1 ring-accent-amber/20 hover:bg-accent-amber/20 hover:shadow-sm transition-all duration-300 ease-ios-spring"
                          >
                            <Gauge className="w-3.5 h-3.5" />
                            {formatTokens(rateLimits[user.id].maxTokens)} / {rateLimits[user.id].window === 'FIVE_HOURS' ? '5h' : 'day'}
                          </button>
                        ) : (
                          <button
                            onClick={() => openRateLimitModal(user)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-pastel-50 text-pastel-400 ring-1 ring-pastel-200/60 hover:bg-pastel-100 hover:text-pastel-500 hover:shadow-sm transition-all duration-300 ease-ios-spring"
                          >
                            <Infinity className="w-3.5 h-3.5" />
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
                  <td colSpan={serviceId ? 6 : 5} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-pastel-50 rounded-full flex items-center justify-center">
                        <Search className="w-5 h-5 text-pastel-300" />
                      </div>
                      <p className="text-sm font-medium text-pastel-400">
                        {searchQuery ? '검색 결과가 없습니다.' : '사용자가 없습니다.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100/80 flex items-center justify-between bg-pastel-50/30">
            <p className="text-sm text-pastel-400 font-medium tabular-nums">
              {(pagination.page - 1) * pagination.limit + 1} -{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} / 총 {pagination.total}명
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => loadData(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="p-2 text-pastel-400 hover:text-samsung-blue hover:bg-samsung-blue/5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 ease-ios-spring"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="px-3 py-1.5 text-sm font-semibold text-pastel-600 bg-white rounded-xl shadow-depth tabular-nums">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => loadData(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages}
                className="p-2 text-pastel-400 hover:text-samsung-blue hover:bg-samsung-blue/5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 ease-ios-spring"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Rate Limit Modal */}
      {rateLimitTarget && serviceId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-modal max-w-md w-full animate-scale-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-100/80">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 bg-gradient-to-br from-accent-amber/20 to-accent-amber/5 rounded-ios flex items-center justify-center ring-1 ring-accent-amber/20">
                  <Gauge className="w-5 h-5 text-accent-amber" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-pastel-900 tracking-tight">Token Rate Limit</h3>
                  <p className="text-xs text-pastel-400 mt-0.5 font-medium">
                    {decodeUsername(rateLimitTarget.username)} ({rateLimitTarget.loginid})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRateLimitTarget(null)}
                className="p-2 hover:bg-pastel-50 rounded-ios transition-all duration-300 ease-ios-spring group"
              >
                <X className="w-5 h-5 text-pastel-300 group-hover:text-pastel-500 transition-colors" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Window selection */}
              <div>
                <label className="block text-sm font-semibold text-pastel-700 mb-3">윈도우</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['FIVE_HOURS', 'DAY'] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => setRateLimitForm(f => ({ ...f, window: w }))}
                      className={`py-3 px-4 rounded-ios-lg text-sm font-semibold border-2 transition-all duration-300 ease-ios-spring ${
                        rateLimitForm.window === w
                          ? 'border-samsung-blue bg-samsung-blue/5 text-samsung-blue shadow-glow-blue'
                          : 'border-gray-100 text-pastel-500 hover:border-pastel-200 hover:bg-pastel-50/50'
                      }`}
                    >
                      {w === 'FIVE_HOURS' ? '5시간' : '24시간 (1일)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max tokens */}
              <div>
                <label className="block text-sm font-semibold text-pastel-700 mb-3">
                  최대 토큰 수
                </label>
                <input
                  type="number"
                  value={rateLimitForm.maxTokens}
                  onChange={(e) => setRateLimitForm(f => ({ ...f, maxTokens: parseInt(e.target.value) || 0 }))}
                  min={1}
                  className="w-full px-4 py-3 bg-pastel-50/50 border border-gray-100/80 rounded-ios-lg text-sm text-pastel-800 placeholder:text-pastel-300 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 focus:bg-white transition-all duration-300 ease-ios-spring"
                  placeholder="예: 1000000"
                />
                <div className="flex gap-2 mt-3">
                  {[100000, 500000, 1000000, 5000000].map((v) => (
                    <button
                      key={v}
                      onClick={() => setRateLimitForm(f => ({ ...f, maxTokens: v }))}
                      className="px-3 py-1.5 text-xs font-semibold bg-pastel-50 hover:bg-pastel-100 rounded-ios text-pastel-500 hover:text-pastel-600 ring-1 ring-pastel-200/60 transition-all duration-300 ease-ios-spring"
                    >
                      {formatTokens(v)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm font-semibold text-pastel-700">활성화</span>
                <button
                  onClick={() => setRateLimitForm(f => ({ ...f, enabled: !f.enabled }))}
                  className={`relative w-12 h-7 rounded-full transition-all duration-300 ease-ios-spring ${
                    rateLimitForm.enabled ? 'bg-samsung-blue shadow-glow-blue' : 'bg-pastel-200'
                  }`}
                >
                  <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow-elevated transition-transform duration-300 ease-ios-spring ${
                    rateLimitForm.enabled ? 'translate-x-5' : ''
                  }`} />
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center gap-3 p-6 border-t border-gray-100/80 bg-pastel-50/40 rounded-b-3xl">
              {rateLimits[rateLimitTarget.id] && (
                <button
                  onClick={handleDeleteRateLimit}
                  disabled={savingRateLimit}
                  className="px-4 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50 rounded-ios-lg transition-all duration-300 ease-ios-spring disabled:opacity-40"
                >
                  제한 해제
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setRateLimitTarget(null)}
                className="px-5 py-2.5 text-sm font-semibold text-pastel-500 hover:bg-pastel-100 rounded-ios-lg transition-all duration-300 ease-ios-spring"
              >
                취소
              </button>
              <button
                onClick={handleSaveRateLimit}
                disabled={savingRateLimit || rateLimitForm.maxTokens < 1}
                className="px-6 py-2.5 text-sm font-semibold bg-gradient-to-r from-samsung-blue to-pastel-500 text-white rounded-ios-lg hover:shadow-glow-blue transition-all duration-300 ease-ios-spring disabled:opacity-40 disabled:hover:shadow-none"
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
