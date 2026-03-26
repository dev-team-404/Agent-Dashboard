import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, ChevronDown, X, FileText, Clock, Wifi, WifiOff } from 'lucide-react';
import { api, serviceApi } from '../services/api';
import { TableLoadingRow } from '../components/LoadingSpinner';

interface RequestLog {
  id: string;
  serviceId: string;
  userId: string;
  deptname: string | null;
  modelName: string;
  resolvedModel: string | null;
  method: string;
  path: string;
  statusCode: number;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  stream: boolean;
  timestamp: string;
}

interface ServiceName {
  id: string;
  name: string;
  displayName: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Format date as YYYY-MM-DD HH:mm:ss in KST
function formatKST(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toLocaleString();
}

function getStatusColor(code: number): string {
  if (code >= 200 && code < 300) return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80';
  if (code >= 400 && code < 500) return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80';
  if (code >= 500) return 'bg-red-50 text-red-700 ring-1 ring-red-200/80';
  return 'bg-gray-50 text-gray-700 ring-1 ring-gray-200/80';
}

export default function RequestLogs() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [services, setServices] = useState<ServiceName[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  // Filters
  const [modelName, setModelName] = useState('');
  const [statusCode, setStatusCode] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Service name lookup
  const serviceMap = new Map(services.map(s => [s.id, s.displayName]));

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [pagination.page, statusCode, serviceId, streamFilter, startDate, endDate]);

  // Debounced model name search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page === 1) {
        loadLogs();
      } else {
        setPagination(prev => ({ ...prev, page: 1 }));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [modelName]);

  const loadServices = async () => {
    try {
      const res = await serviceApi.listNames();
      setServices(res.data.services || res.data || []);
    } catch (error) {
      console.error('Failed to load services:', error);
    }
  };

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {
        page: pagination.page,
        limit: pagination.limit,
      };
      if (modelName) params.modelName = modelName;
      if (statusCode) params.statusCode = statusCode;
      if (serviceId) params.serviceId = serviceId;
      if (streamFilter) params.stream = streamFilter;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get('/admin/logs', { params });
      setLogs(res.data.logs);
      setUserMap(prev => ({ ...prev, ...res.data.userMap }));
      setPagination(prev => ({ ...prev, ...res.data.pagination }));
    } catch (error) {
      console.error('Failed to load request logs:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, modelName, statusCode, serviceId, streamFilter, startDate, endDate]);

  const clearFilters = () => {
    setModelName('');
    setStatusCode('');
    setServiceId('');
    setStartDate('');
    setEndDate('');
    setStreamFilter('');
  };

  const hasActiveFilters = modelName || statusCode || serviceId || startDate || endDate || streamFilter;

  // Pagination helpers
  const getPageNumbers = (): (number | string)[] => {
    const total = pagination.totalPages;
    const current = pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: (number | string)[] = [1];
    if (current > 3) pages.push('...');

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);

    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50">
            <FileText className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">요청 로그</h1>
            <p className="text-sm text-pastel-500 mt-0.5">
              프록시 서버를 통한 모든 API 요청 기록을 조회합니다
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-accent-emerald opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-emerald"></span>
          </span>
          <span className="text-sm font-semibold text-pastel-700">총 {pagination.total.toLocaleString()}건</span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Model name search */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
            <input
              type="text"
              placeholder="모델명 검색..."
              value={modelName}
              onChange={e => setModelName(e.target.value)}
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
                {[statusCode, serviceId, startDate, endDate, streamFilter].filter(Boolean).length}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Filter Options */}
        {showFilters && (
          <div className="mt-5 pt-5 border-t border-gray-100/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 animate-slide-down">
            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">상태코드</label>
              <select
                value={statusCode}
                onChange={e => { setStatusCode(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                <option value="200">200</option>
                <option value="400">400</option>
                <option value="401">401</option>
                <option value="403">403</option>
                <option value="429">429</option>
                <option value="500">500</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">서비스</label>
              <select
                value={serviceId}
                onChange={e => { setServiceId(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.displayName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">스트림</label>
              <select
                value={streamFilter}
                onChange={e => { setStreamFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              >
                <option value="">전체</option>
                <option value="true">Stream</option>
                <option value="false">Non-stream</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">종료일</label>
              <input
                type="date"
                value={endDate}
                onChange={e => { setEndDate(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
              />
            </div>

            {hasActiveFilters && (
              <div className="sm:col-span-2 lg:col-span-5">
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

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: '1050px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100/80">
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[170px]">시각</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[120px]">서비스</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[130px]">사용자</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">모델</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[70px]">상태</th>
                <th className="px-4 py-4 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">입력 토큰</th>
                <th className="px-4 py-4 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">출력 토큰</th>
                <th className="px-4 py-4 text-right text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[80px]">지연</th>
                <th className="px-4 py-4 text-center text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[70px]">스트림</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <TableLoadingRow colSpan={9} />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-20 text-center">
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
                logs.map(log => (
                  <tr
                    key={log.id}
                    className="hover:bg-pastel-50/30 transition-colors duration-150"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-pastel-400 flex-shrink-0" />
                        <span className="text-xs text-pastel-600 font-mono tabular-nums">{formatKST(log.timestamp)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-pastel-700 font-medium truncate block max-w-[120px]" title={serviceMap.get(log.serviceId) || log.serviceId}>
                        {serviceMap.get(log.serviceId) || log.serviceId}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-pastel-700 font-medium truncate block max-w-[130px]" title={log.userId}>
                        {log.userId ? (userMap[log.userId] || log.userId) : '-'}
                      </span>
                      {log.userId && userMap[log.userId] && (
                        <span className="text-xs text-pastel-400 truncate block max-w-[130px]" title={log.userId}>
                          {log.userId}
                        </span>
                      )}
                      {log.deptname && (
                        <span className="text-xs text-pastel-400 truncate block max-w-[130px]" title={log.deptname}>
                          {log.deptname}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-pastel-800 font-medium truncate block" title={log.modelName}>
                        {log.modelName}
                      </span>
                      {log.resolvedModel && log.resolvedModel !== log.modelName && (
                        <span className="text-xs text-pastel-400 truncate block" title={log.resolvedModel}>
                          &rarr; {log.resolvedModel}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(log.statusCode)}`}>
                        {log.statusCode}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-pastel-700 tabular-nums">{formatNumber(log.inputTokens)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-pastel-700 tabular-nums">{formatNumber(log.outputTokens)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-pastel-700 tabular-nums">
                        {log.latencyMs != null ? `${log.latencyMs.toLocaleString()}ms` : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.stream ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200/80">
                          <Wifi className="w-3 h-3" />
                          SSE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-50 text-gray-500 ring-1 ring-gray-200/80">
                          <WifiOff className="w-3 h-3" />
                          일반
                        </span>
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
              <span className="font-semibold text-pastel-700">{pagination.total.toLocaleString()}</span>건 중{' '}
              <span className="font-medium text-pastel-600">
                {((pagination.page - 1) * pagination.limit + 1).toLocaleString()}-
                {Math.min(pagination.page * pagination.limit, pagination.total).toLocaleString()}
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page <= 1}
                className="px-3.5 py-2 text-sm font-medium bg-white text-pastel-600 rounded-xl border border-gray-200/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pastel-50 hover:border-pastel-300 transition-all duration-200 shadow-sm"
              >
                이전
              </button>
              {getPageNumbers().map((p, idx) =>
                typeof p === 'string' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 py-2 text-sm text-pastel-400">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPagination(prev => ({ ...prev, page: p as number }))}
                    className={`min-w-[36px] px-2 py-2 text-sm font-medium rounded-xl border transition-all duration-200 shadow-sm tabular-nums ${
                      p === pagination.page
                        ? 'bg-samsung-blue text-white border-samsung-blue'
                        : 'bg-white text-pastel-600 border-gray-200/60 hover:bg-pastel-50 hover:border-pastel-300'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3.5 py-2 text-sm font-medium bg-white text-pastel-600 rounded-xl border border-gray-200/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pastel-50 hover:border-pastel-300 transition-all duration-200 shadow-sm"
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
