import { useState, useEffect } from 'react';
import { Search, Filter, ChevronDown, CheckCircle, XCircle, Shield, Monitor, UserPlus, X } from 'lucide-react';
import { knoxApi } from '../services/api';

interface VerificationRecord {
  id: string;
  loginid: string;
  username: string;
  knoxDeptName: string;
  claimedDeptName: string;
  method: string;
  endpoint: string | null;
  success: boolean;
  errorMessage: string | null;
  ipAddress: string | null;
  timestamp: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Stats {
  total: number;
  success: number;
  fail: number;
}

const methodConfig: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  PROXY: {
    label: 'PROXY',
    color: 'bg-samsung-blue/10 text-samsung-blue ring-1 ring-samsung-blue/20',
    icon: Shield,
  },
  DASHBOARD: {
    label: 'DASHBOARD',
    color: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200/80',
    icon: Monitor,
  },
  ADMIN_REGISTER: {
    label: 'ADMIN_REGISTER',
    color: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80',
    icon: UserPlus,
  },
};

export default function KnoxVerifications() {
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [stats, setStats] = useState<Stats>({ total: 0, success: 0, fail: 0 });

  // Filters
  const [search, setSearch] = useState('');
  const [successFilter, setSuccessFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Expanded error message row
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadRecords();
  }, [pagination.page, successFilter, methodFilter, startDate, endDate]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page === 1) {
        loadRecords();
      } else {
        setPagination(prev => ({ ...prev, page: 1 }));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadRecords = async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number | boolean | undefined> = {
        page: pagination.page,
        limit: pagination.limit,
        search: search || undefined,
        method: methodFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      if (successFilter === 'true') params.success = true;
      if (successFilter === 'false') params.success = false;

      const res = await knoxApi.listVerifications(params);
      setRecords(res.data.records);
      setPagination(prev => ({ ...prev, ...res.data.pagination }));
      setStats(res.data.stats);
    } catch (error) {
      console.error('Failed to load verification records:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const clearFilters = () => {
    setSearch('');
    setSuccessFilter('');
    setMethodFilter('');
    setStartDate('');
    setEndDate('');
  };

  const hasActiveFilters = search || successFilter || methodFilter || startDate || endDate;

  const toggleExpanded = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getMethodBadge = (method: string) => {
    const config = methodConfig[method];
    if (!config) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600 ring-1 ring-gray-200/80">
          {method}
        </span>
      );
    }
    const Icon = config.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full ${config.color}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50">
            <Shield className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">인증 기록</h1>
            <p className="text-sm text-pastel-500 mt-0.5">
              Knox 직원 인증 요청 및 결과를 확인합니다
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2.5 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-accent-emerald opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-emerald"></span>
            </span>
            <span className="text-sm font-semibold text-pastel-700">전체 {stats.total.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <CheckCircle className="w-4 h-4 text-accent-emerald" />
            <span className="text-sm font-semibold text-accent-emerald">{stats.success.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-500">{stats.fail.toLocaleString()}</span>
          </div>
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
                {[successFilter, methodFilter, startDate, endDate].filter(Boolean).length}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Filter Options */}
        {showFilters && (
          <div className="mt-5 pt-5 border-t border-gray-100/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 animate-slide-down">
            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">결과</label>
              <select
                value={successFilter}
                onChange={e => setSuccessFilter(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                <option value="true">성공</option>
                <option value="false">실패</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">방법</label>
              <select
                value={methodFilter}
                onChange={e => setMethodFilter(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                <option value="PROXY">PROXY</option>
                <option value="DASHBOARD">DASHBOARD</option>
                <option value="ADMIN_REGISTER">ADMIN_REGISTER</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">종료일</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              />
            </div>

            {hasActiveFilters && (
              <div className="sm:col-span-2 lg:col-span-4">
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

      {/* Records Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: '1000px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100/80">
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">시간</th>
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">사용자</th>
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">요청 부서</th>
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">Knox 부서</th>
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">방법</th>
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">접근 경로</th>
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">결과</th>
                <th className="px-5 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">상세</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative">
                        <div className="w-12 h-12 rounded-full border-[3px] border-pastel-200"></div>
                        <div className="absolute inset-0 w-12 h-12 rounded-full border-[3px] border-samsung-blue border-t-transparent animate-spin"></div>
                      </div>
                      <p className="text-sm font-medium text-pastel-500">데이터를 불러오는 중...</p>
                    </div>
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-20 text-center">
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
                records.map(record => (
                  <tr key={record.id} className="hover:bg-pastel-50/30 transition-colors duration-150 group">
                    {/* 시간 */}
                    <td className="px-5 py-4">
                      <span className="text-sm text-pastel-700 whitespace-nowrap tabular-nums">
                        {formatDateTime(record.timestamp)}
                      </span>
                    </td>

                    {/* 사용자 */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pastel-100 to-pastel-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-pastel-600">
                            {record.username ? record.username.charAt(0) : record.loginid.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-pastel-800 truncate">{record.loginid}</p>
                          {record.username && (
                            <p className="text-xs text-pastel-400 truncate">{record.username}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 요청 부서 */}
                    <td className="px-5 py-4">
                      <span className="text-sm text-pastel-700 truncate block max-w-[160px]" title={record.claimedDeptName || '-'}>
                        {record.claimedDeptName || '-'}
                      </span>
                    </td>

                    {/* Knox 부서 */}
                    <td className="px-5 py-4">
                      <span
                        className={`text-sm truncate block max-w-[160px] ${
                          record.knoxDeptName && record.claimedDeptName && record.knoxDeptName !== record.claimedDeptName
                            ? 'text-amber-600 font-semibold'
                            : 'text-pastel-700'
                        }`}
                        title={record.knoxDeptName || '-'}
                      >
                        {record.knoxDeptName || '-'}
                      </span>
                    </td>

                    {/* 방법 */}
                    <td className="px-5 py-4">
                      {getMethodBadge(record.method)}
                    </td>

                    {/* 접근 경로 */}
                    <td className="px-5 py-4">
                      <span
                        className="text-xs text-pastel-500 font-mono truncate block max-w-[180px]"
                        title={record.endpoint || '-'}
                      >
                        {record.endpoint || '-'}
                      </span>
                    </td>

                    {/* 결과 */}
                    <td className="px-5 py-4">
                      {record.success ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-accent-emerald/10 text-accent-emerald">
                          <CheckCircle className="w-3 h-3" />
                          성공
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-red-50 text-red-600">
                          <XCircle className="w-3 h-3" />
                          실패
                        </span>
                      )}
                    </td>

                    {/* 상세 */}
                    <td className="px-5 py-4">
                      {record.errorMessage ? (
                        <div className="relative">
                          <button
                            onClick={() => toggleExpanded(record.id)}
                            className="text-xs text-red-500 hover:text-red-700 font-medium truncate max-w-[140px] block transition-colors duration-200"
                            title={record.errorMessage}
                          >
                            {expandedRows.has(record.id) ? '접기' : record.errorMessage}
                          </button>
                          {expandedRows.has(record.id) && (
                            <div className="absolute z-10 top-full left-0 mt-2 p-3 bg-white rounded-xl border border-red-200/60 shadow-lg max-w-sm animate-slide-down">
                              <p className="text-xs text-red-600 leading-relaxed break-words">{record.errorMessage}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-pastel-300">-</span>
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
    </div>
  );
}
