import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Filter, ChevronDown, Shield, ShieldCheck, Clock, Activity, Users, Building2, X } from 'lucide-react';
import { unifiedUsersApi } from '../services/api';

interface ServiceStat {
  serviceId: string;
  serviceName: string;
  firstSeen: string;
  lastActive: string;
  requestCount: number;
}

interface UnifiedUser {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
  businessUnit: string | null;
  globalRole: string | null;
  serviceStats: ServiceStat[];
  totalRequests: number;
  firstSeen: string;
  lastActive: string;
}

interface FilterOptions {
  services: { id: string; name: string; displayName: string }[];
  businessUnits: string[];
  deptnames: string[];
  roles: string[];
}

const roleColors: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-50 text-red-700 ring-1 ring-red-200/80',
  ADMIN: 'bg-samsung-blue/10 text-samsung-blue ring-1 ring-samsung-blue/20',
  USER: 'bg-pastel-100 text-pastel-600 ring-1 ring-pastel-200/80',
};

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: '슈퍼관리자',
  ADMIN: '관리자',
  USER: '사용자',
};

export default function UnifiedUsers() {
  const [users, setUsers] = useState<UnifiedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  // Filters
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [businessUnitFilter, setBusinessUnitFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Permission edit modal
  const [editingUser, setEditingUser] = useState<UnifiedUser | null>(null);
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  // Column resize state
  const [columnWidths, setColumnWidths] = useState({
    user: 180,
    dept: 160,
    role: 200,
    activity: 220,
    requests: 150,
    manage: 100,
  });
  const [resizing, setResizing] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Expanded rows for service details
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadUsers();
  }, [pagination.page, serviceFilter, businessUnitFilter, roleFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page === 1) {
        loadUsers();
      } else {
        setPagination(prev => ({ ...prev, page: 1 }));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await unifiedUsersApi.list({
        page: pagination.page,
        limit: pagination.limit,
        search: search || undefined,
        serviceId: serviceFilter || undefined,
        businessUnit: businessUnitFilter || undefined,
        role: roleFilter || undefined,
      });
      setUsers(res.data.users);
      setPagination(prev => ({ ...prev, ...res.data.pagination }));
      setFilterOptions(res.data.filterOptions);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (user: UnifiedUser) => {
    setEditingUser(user);
    setEditIsAdmin(user.globalRole === 'ADMIN');
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setEditIsAdmin(false);
  };

  const savePermissions = async () => {
    if (!editingUser) return;

    try {
      setSaving(true);
      await unifiedUsersApi.updatePermissions(editingUser.id, {
        globalRole: editIsAdmin ? 'ADMIN' : undefined,
      });
      closeEditModal();
      loadUsers();
    } catch (error) {
      console.error('Failed to update permissions:', error);
      alert('권한 변경에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const clearFilters = () => {
    setSearch('');
    setServiceFilter('');
    setBusinessUnitFilter('');
    setRoleFilter('');
  };

  const hasActiveFilters = search || serviceFilter || businessUnitFilter || roleFilter;

  // Column resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent, column: string) => {
    e.preventDefault();
    setResizing(column);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[column as keyof typeof columnWidths];
  }, [columnWidths]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizing) return;
    const diff = e.clientX - resizeStartX.current;
    const newWidth = Math.max(80, resizeStartWidth.current + diff);
    setColumnWidths(prev => ({ ...prev, [resizing]: newWidth }));
  }, [resizing]);

  const handleResizeEnd = useCallback(() => {
    setResizing(null);
  }, []);

  useEffect(() => {
    if (resizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [resizing, handleResizeMove, handleResizeEnd]);

  const toggleExpanded = (userId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const getRoleFilterOptions = () => {
    return [
      { value: 'SUPER_ADMIN', label: '슈퍼관리자' },
      { value: 'ADMIN', label: '관리자' },
      { value: 'USER', label: '사용자' },
    ];
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">통합 사용자 관리</h1>
            <p className="text-sm text-pastel-500 mt-0.5">
              전체 서비스의 사용자 권한 및 활동 현황을 관리합니다
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-accent-emerald opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-emerald"></span>
          </span>
          <span className="text-sm font-semibold text-pastel-700">총 {pagination.total.toLocaleString()}명</span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
            <input
              type="text"
              placeholder="사용자명, 아이디, 부서 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-400 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
            />
          </div>

          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-lg border font-medium text-sm transition-all duration-200 ${
              hasActiveFilters
                ? 'bg-blue-600 text-white border-transparent'
                : 'bg-white text-pastel-600 border-gray-200/60 hover:bg-pastel-50 hover:border-pastel-300'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span>필터</span>
            {hasActiveFilters && (
              <span className="bg-white/25 text-xs font-bold px-2 py-0.5 rounded-full">
                {[serviceFilter, businessUnitFilter, roleFilter].filter(Boolean).length}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Filter Options */}
        {showFilters && (
          <div className="mt-5 pt-5 border-t border-gray-100/80 grid grid-cols-1 sm:grid-cols-3 gap-5 animate-slide-down">
            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">서비스</label>
              <select
                value={serviceFilter}
                onChange={e => setServiceFilter(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                {filterOptions?.services.map(s => (
                  <option key={s.id} value={s.id}>{s.displayName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">사업부</label>
              <select
                value={businessUnitFilter}
                onChange={e => setBusinessUnitFilter(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                {filterOptions?.businessUnits.map(bu => (
                  <option key={bu} value={bu}>{bu}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">권한</label>
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                {getRoleFilterOptions().map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {hasActiveFilters && (
              <div className="sm:col-span-3">
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 text-sm text-pastel-500 hover:text-red-500 transition-colors duration-200"
                >
                  <X className="w-3.5 h-3.5" />
                  필터 초기화
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed" style={{ minWidth: Object.values(columnWidths).reduce((a, b) => a + b, 0) }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100/80">
                <th
                  className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider relative select-none"
                  style={{ width: columnWidths.user }}
                >
                  사용자
                  <div
                    className="absolute right-0 top-2 bottom-2 w-px bg-pastel-200/60 cursor-col-resize hover:bg-samsung-blue/40 hover:w-0.5 transition-all"
                    onMouseDown={(e) => handleResizeStart(e, 'user')}
                  />
                </th>
                <th
                  className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider relative select-none"
                  style={{ width: columnWidths.dept }}
                >
                  부서/사업부
                  <div
                    className="absolute right-0 top-2 bottom-2 w-px bg-pastel-200/60 cursor-col-resize hover:bg-samsung-blue/40 hover:w-0.5 transition-all"
                    onMouseDown={(e) => handleResizeStart(e, 'dept')}
                  />
                </th>
                <th
                  className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider relative select-none"
                  style={{ width: columnWidths.role }}
                >
                  권한
                  <div
                    className="absolute right-0 top-2 bottom-2 w-px bg-pastel-200/60 cursor-col-resize hover:bg-samsung-blue/40 hover:w-0.5 transition-all"
                    onMouseDown={(e) => handleResizeStart(e, 'role')}
                  />
                </th>
                <th
                  className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider relative select-none"
                  style={{ width: columnWidths.activity }}
                >
                  활동
                  <div
                    className="absolute right-0 top-2 bottom-2 w-px bg-pastel-200/60 cursor-col-resize hover:bg-samsung-blue/40 hover:w-0.5 transition-all"
                    onMouseDown={(e) => handleResizeStart(e, 'activity')}
                  />
                </th>
                <th
                  className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider relative select-none"
                  style={{ width: columnWidths.requests }}
                >
                  요청수
                  <div
                    className="absolute right-0 top-2 bottom-2 w-px bg-pastel-200/60 cursor-col-resize hover:bg-samsung-blue/40 hover:w-0.5 transition-all"
                    onMouseDown={(e) => handleResizeStart(e, 'requests')}
                  />
                </th>
                <th
                  className="px-5 py-4 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider"
                  style={{ width: columnWidths.manage }}
                >
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative">
                        <div className="w-12 h-12 rounded-full border-[3px] border-pastel-200"></div>
                        <div className="absolute inset-0 w-12 h-12 rounded-full border-[3px] border-samsung-blue border-t-transparent animate-spin"></div>
                      </div>
                      <p className="text-sm font-medium text-pastel-500">데이터를 불러오는 중...</p>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 rounded-lg bg-pastel-50">
                        <Search className="w-8 h-8 text-pastel-300" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-pastel-600">검색 결과가 없습니다</p>
                        <p className="text-xs text-pastel-400 mt-1">다른 검색어나 필터 조건을 시도해 보세요</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user.id} className="hover:bg-pastel-50/30 transition-colors duration-150 group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pastel-100 to-pastel-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-pastel-600">{user.username.charAt(0)}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-pastel-800 truncate">{user.username}</p>
                          <p className="text-xs text-pastel-400 truncate">{user.loginid}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-pastel-50 flex-shrink-0">
                          <Building2 className="w-3.5 h-3.5 text-pastel-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-pastel-700 truncate">{user.deptname || '-'}</p>
                          {user.businessUnit && (
                            <p className="text-xs text-pastel-400 truncate">{user.businessUnit}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {user.globalRole === 'SUPER_ADMIN' ? (
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${roleColors.SUPER_ADMIN}`}>
                            <ShieldCheck className="w-3.5 h-3.5" />
                            {roleLabels.SUPER_ADMIN}
                          </span>
                        ) : user.globalRole === 'ADMIN' ? (
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${roleColors.ADMIN}`}>
                            <Shield className="w-3.5 h-3.5" />
                            {roleLabels.ADMIN}
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${roleColors.USER}`}>
                            {roleLabels.USER}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs text-pastel-600">
                          <div className="p-1 rounded bg-accent-emerald/10 flex-shrink-0">
                            <Clock className="w-3 h-3 text-accent-emerald" />
                          </div>
                          <span className="truncate">최근: {formatDateTime(user.lastActive)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-pastel-400">
                          <div className="p-1 rounded bg-pastel-100 flex-shrink-0">
                            <Activity className="w-3 h-3 text-pastel-400" />
                          </div>
                          <span className="truncate">가입: {formatDate(user.firstSeen)}</span>
                        </div>
                        {user.serviceStats.length > 1 && (
                          <button
                            onClick={() => toggleExpanded(user.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-samsung-blue hover:text-accent-indigo transition-colors mt-1"
                          >
                            {expandedRows.has(user.id) ? '접기 ▲' : `서비스별 보기 (${user.serviceStats.length}) ▼`}
                          </button>
                        )}
                        {expandedRows.has(user.id) && (
                          <div className="mt-2.5 pt-2.5 border-t border-pastel-100/80 space-y-2 animate-slide-down">
                            {user.serviceStats.map(ss => (
                              <div key={ss.serviceId} className="text-xs bg-pastel-50/50 p-3 rounded-xl border border-pastel-100/60">
                                <p className="font-semibold text-pastel-700 mb-1">{ss.serviceName}</p>
                                <div className="flex items-center gap-1.5 text-pastel-500">
                                  <Clock className="w-3 h-3 text-pastel-400" />
                                  <span>가입: {formatDate(ss.firstSeen)}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-pastel-500 mt-0.5">
                                  <Activity className="w-3 h-3 text-pastel-400" />
                                  <span>최근: {formatDateTime(ss.lastActive)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-sm font-bold text-pastel-800">
                        {user.totalRequests.toLocaleString()}
                        <span className="text-xs font-normal text-pastel-400 ml-0.5">회</span>
                      </div>
                      {/* 서비스별 요청 수 항상 표시 */}
                      {user.serviceStats.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {user.serviceStats.map(ss => (
                            <div key={ss.serviceId} className="text-xs text-pastel-500 flex justify-between items-center gap-2">
                              <span className="truncate">{ss.serviceName}</span>
                              <span className="font-semibold text-pastel-600 whitespace-nowrap tabular-nums">{ss.requestCount.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {user.serviceStats.length === 0 && (
                        <div className="text-xs text-pastel-300 mt-1">-</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {user.globalRole !== 'SUPER_ADMIN' && (
                        <button
                          onClick={() => openEditModal(user)}
                          className="px-3.5 py-1.5 text-xs font-semibold bg-pastel-50 text-pastel-600 hover:bg-samsung-blue hover:text-white rounded-xl border border-pastel-200/60 hover:border-transparent transition-all duration-200 shadow-sm hover:shadow-depth"
                        >
                          권한 변경
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100/80 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-pastel-500">
              <span className="font-semibold text-pastel-700">{pagination.total.toLocaleString()}</span>개 중{' '}
              <span className="font-medium text-pastel-600">
                {((pagination.page - 1) * pagination.limit + 1).toLocaleString()}-
                {Math.min(pagination.page * pagination.limit, pagination.total).toLocaleString()}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page <= 1}
                className="px-4 py-2 text-sm font-medium bg-white text-pastel-600 rounded-xl border border-gray-200/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pastel-50 hover:border-pastel-300 transition-all duration-200 shadow-sm"
              >
                이전
              </button>
              <span className="px-4 py-2 text-sm font-semibold text-pastel-700 bg-white rounded-xl border border-gray-200/60 shadow-sm tabular-nums">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page >= pagination.totalPages}
                className="px-4 py-2 text-sm font-medium bg-white text-pastel-600 rounded-xl border border-gray-200/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pastel-50 hover:border-pastel-300 transition-all duration-200 shadow-sm"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Permission Modal - Simplified: toggle ADMIN on/off */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-modal animate-scale-in">
            <div className="p-6 border-b border-gray-100/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-50">
                  <Shield className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-pastel-800">권한 변경</h2>
                  <p className="text-sm text-pastel-500">{editingUser.username} ({editingUser.loginid})</p>
                </div>
              </div>
              <button
                onClick={closeEditModal}
                className="p-2 text-pastel-400 hover:text-pastel-600 hover:bg-pastel-50 rounded-xl transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <label className="flex items-center justify-between p-5 bg-gray-50 rounded-lg border border-gray-200/60 cursor-pointer hover:border-samsung-blue/20 transition-all duration-200">
                <div className="flex items-center gap-3.5">
                  <div className="p-2 rounded-xl bg-samsung-blue/10">
                    <Shield className="w-5 h-5 text-samsung-blue" />
                  </div>
                  <div>
                    <p className="font-semibold text-pastel-800">관리자 권한</p>
                    <p className="text-sm text-pastel-500 mt-0.5">대시보드 및 사용자 관리 기능에 접근할 수 있습니다</p>
                  </div>
                </div>
                <div className="relative flex-shrink-0 ml-4">
                  <input
                    type="checkbox"
                    checked={editIsAdmin}
                    onChange={e => setEditIsAdmin(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-7 bg-pastel-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-samsung-blue/15 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-pastel-200 after:border after:rounded-full after:h-6 after:w-6 after:shadow-sm after:transition-all peer-checked:bg-samsung-blue transition-colors duration-200"></div>
                </div>
              </label>

              <div className="mt-4 px-4 py-3 rounded-xl bg-pastel-50/50 border border-pastel-100/60">
                <p className="text-xs text-pastel-500 leading-relaxed">
                  {editIsAdmin
                    ? '이 사용자는 관리자로 설정됩니다. 대시보드 접근 및 서비스 관리가 가능합니다.'
                    : '이 사용자는 일반 사용자입니다. 자신의 사용 현황만 확인할 수 있습니다.'}
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100/80 flex justify-end gap-3">
              <button
                onClick={closeEditModal}
                className="px-5 py-2.5 text-sm font-medium text-pastel-600 hover:bg-pastel-50 rounded-xl transition-all duration-200"
              >
                취소
              </button>
              <button
                onClick={savePermissions}
                disabled={saving}
                className="px-6 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
