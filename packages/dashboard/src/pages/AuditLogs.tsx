import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, ChevronDown, ChevronRight, X, Shield, Clock, Globe } from 'lucide-react';
import { api } from '../services/api';
import { TableLoadingRow } from '../components/LoadingSpinner';

interface AuditLog {
  id: string;
  adminId: string | null;
  loginid: string;
  action: string;
  target: string | null;
  targetType: string | null;
  details: unknown;
  ipAddress: string | null;
  timestamp: string;
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

// ── 작업 한글 라벨 ──
const ACTION_LABELS: Record<string, string> = {
  CREATE_SERVICE: '서비스 생성',
  UPDATE_SERVICE: '서비스 수정',
  DELETE_SERVICE: '서비스 삭제',
  DEPLOY_SERVICE: '서비스 배포',
  UNDEPLOY_SERVICE: '서비스 배포 해제',
  COPY_SERVICE_MODELS: '모델 복사',
  UPDATE_SERVICE_TARGET: '서비스 목표 수정',
  RUN_AI_ESTIMATION: 'AI 추정 실행',
  CREATE_MODEL: '모델 생성',
  ADD_MODEL: '모델 추가',
  UPDATE_MODEL: '모델 수정',
  REMOVE_MODEL: '모델 제거',
  DELETE_MODEL: '모델 삭제',
  TOGGLE_MODEL: '모델 토글',
  REORDER_MODELS: '모델 순서 변경',
  ADD_SUB_MODEL: '서브 모델 추가',
  UPDATE_SUB_MODEL: '서브 모델 수정',
  REMOVE_SUB_MODEL: '서브 모델 제거',
  PROMOTE_USER: '관리자 승급',
  DEMOTE_USER: '관리자 강등',
  DEMOTE_TO_USER: '일반 사용자로 강등',
  DELETE_USER: '사용자 삭제',
  KNOX_REGISTER_ADMIN: 'Knox 관리자 등록',
  RESET_KNOX_VERIFICATION: 'Knox 인증 초기화',
  APPROVE_ADMIN_REQUEST: '관리자 요청 승인',
  REJECT_ADMIN_REQUEST: '관리자 요청 거절',
  SET_RATE_LIMIT: 'Rate Limit 설정',
  DELETE_RATE_LIMIT: 'Rate Limit 삭제',
  SET_SERVICE_RATE_LIMIT: '서비스 Rate Limit 설정',
  DELETE_SERVICE_RATE_LIMIT: '서비스 Rate Limit 삭제',
  SUBMIT_EXTERNAL_USAGE: '외부 사용량 제출',
  SUBMIT_EXTERNAL_USAGE_BY_USER: '사용자별 외부 사용량 제출',
  SUBMIT_GPU_POWER: 'GPU 전력 사용률 등록',
  SUBMIT_RATING: '모델 평점 제출',
  CREATE_HOLIDAY: '휴일 추가',
  BULK_CREATE_HOLIDAYS: '휴일 일괄 추가',
  UPDATE_HOLIDAY: '휴일 수정',
  DELETE_HOLIDAY: '휴일 삭제',
  CLEANUP_REQUEST_LOGS: '요청 로그 정리',
  UPDATE_SYSTEM_SETTING: '시스템 설정 변경',
  UPDATE_API_KEY: 'API 키 변경',
  GENERATE_MISSING_LOGOS: '누락 로고 생성',
  SET_ROLE_ADMIN: '관리자 역할 설정',
  SET_ROLE_SUPER_ADMIN: '슈퍼관리자 역할 설정',
};

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

const ACTION_OPTIONS = [
  'CREATE_SERVICE', 'UPDATE_SERVICE', 'DELETE_SERVICE', 'DEPLOY_SERVICE', 'UNDEPLOY_SERVICE', 'COPY_SERVICE_MODELS',
  'UPDATE_SERVICE_TARGET', 'RUN_AI_ESTIMATION',
  'CREATE_MODEL', 'ADD_MODEL', 'UPDATE_MODEL', 'REMOVE_MODEL', 'DELETE_MODEL', 'TOGGLE_MODEL', 'REORDER_MODELS',
  'ADD_SUB_MODEL', 'UPDATE_SUB_MODEL', 'REMOVE_SUB_MODEL',
  'PROMOTE_USER', 'DEMOTE_USER', 'DEMOTE_TO_USER', 'DELETE_USER',
  'KNOX_REGISTER_ADMIN', 'RESET_KNOX_VERIFICATION', 'APPROVE_ADMIN_REQUEST', 'REJECT_ADMIN_REQUEST',
  'SET_RATE_LIMIT', 'DELETE_RATE_LIMIT', 'SET_SERVICE_RATE_LIMIT', 'DELETE_SERVICE_RATE_LIMIT',
  'SUBMIT_EXTERNAL_USAGE', 'SUBMIT_EXTERNAL_USAGE_BY_USER', 'SUBMIT_GPU_POWER', 'SUBMIT_RATING',
  'CREATE_HOLIDAY', 'BULK_CREATE_HOLIDAYS', 'UPDATE_HOLIDAY', 'DELETE_HOLIDAY',
  'CLEANUP_REQUEST_LOGS', 'UPDATE_SYSTEM_SETTING',
];

const TARGET_TYPE_OPTIONS = ['Service', 'ServiceTarget', 'Model', 'SubModel', 'User', 'RateLimit', 'ServiceRateLimit', 'RequestLog', 'ExternalUsage', 'SystemSetting', 'GpuPowerUsage', 'Holiday', 'RatingFeedback', 'UsageLog'];

// 활동 카테고리별 탭 정의
const CATEGORY_TABS = [
  { key: 'all', label: '전체', actions: '' },
  { key: 'service', label: '서비스 관리', actions: 'CREATE_SERVICE,UPDATE_SERVICE,DELETE_SERVICE,DEPLOY_SERVICE,UNDEPLOY_SERVICE,COPY_SERVICE_MODELS' },
  { key: 'targets', label: '서비스 목표', actions: 'UPDATE_SERVICE_TARGET,RUN_AI_ESTIMATION' },
  { key: 'model', label: '모델 관리', actions: 'CREATE_MODEL,ADD_MODEL,UPDATE_MODEL,REMOVE_MODEL,DELETE_MODEL,TOGGLE_MODEL,REORDER_MODELS,ADD_SUB_MODEL,UPDATE_SUB_MODEL,REMOVE_SUB_MODEL' },
  { key: 'user', label: '사용자/권한', actions: 'PROMOTE_USER,DEMOTE_USER,DEMOTE_TO_USER,DELETE_USER,KNOX_REGISTER_ADMIN,RESET_KNOX_VERIFICATION,APPROVE_ADMIN_REQUEST,REJECT_ADMIN_REQUEST' },
  { key: 'ratelimit', label: 'Rate Limit', actions: 'SET_RATE_LIMIT,DELETE_RATE_LIMIT,SET_SERVICE_RATE_LIMIT,DELETE_SERVICE_RATE_LIMIT' },
  { key: 'external', label: '외부 API', actions: 'SUBMIT_EXTERNAL_USAGE,SUBMIT_EXTERNAL_USAGE_BY_USER,SUBMIT_GPU_POWER,SUBMIT_RATING' },
  { key: 'holiday', label: '휴일 관리', actions: 'CREATE_HOLIDAY,BULK_CREATE_HOLIDAYS,UPDATE_HOLIDAY,DELETE_HOLIDAY' },
  { key: 'system', label: '시스템', actions: 'CLEANUP_REQUEST_LOGS,UPDATE_SYSTEM_SETTING,UPDATE_API_KEY,GENERATE_MISSING_LOGOS' },
] as const;

type CategoryTab = typeof CATEGORY_TABS[number]['key'];

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  ADD: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  UPDATE: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80',
  DEPLOY: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80',
  DELETE: 'bg-red-50 text-red-700 ring-1 ring-red-200/80',
  REMOVE: 'bg-red-50 text-red-700 ring-1 ring-red-200/80',
  CLEANUP: 'bg-red-50 text-red-700 ring-1 ring-red-200/80',
  TOGGLE: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80',
  REORDER: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200/80',
  PROMOTE: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80',
  DEMOTE: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80',
  SET: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80',
  SUBMIT: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200/80',
  ENABLE: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  DISABLE: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80',
  COPY: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200/80',
  RUN: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80',
  GENERATE: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80',
  APPROVE: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  REJECT: 'bg-red-50 text-red-700 ring-1 ring-red-200/80',
  RESET: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80',
  KNOX: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80',
  UNDEPLOY: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80',
};

function getActionColor(action: string): string {
  const prefix = action.split('_')[0];
  return ACTION_COLORS[prefix] || 'bg-gray-50 text-gray-700 ring-1 ring-gray-200/80';
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [userMap, setUserMap] = useState<Record<string, { username: string; deptname: string }>>({});
  const [targetMap, setTargetMap] = useState<Record<string, string>>({});

  // Category tab
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('all');

  // Filters
  const [loginid, setLoginid] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadLogs();
  }, [pagination.page, action, targetType, startDate, endDate, categoryTab]);

  // Debounced loginid search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page === 1) {
        loadLogs();
      } else {
        setPagination(prev => ({ ...prev, page: 1 }));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [loginid]);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {
        page: pagination.page,
        limit: pagination.limit,
      };
      if (loginid) params.loginid = loginid;

      // categoryTab에 해당하는 action 필터 적용
      const tabDef = CATEGORY_TABS.find(t => t.key === categoryTab);
      if (tabDef && tabDef.actions) {
        params.action = tabDef.actions;
      } else {
        if (action) params.action = action;
      }
      if (targetType) params.targetType = targetType;

      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get('/admin/audit', { params });
      setLogs(res.data.logs);
      setUserMap(prev => ({ ...prev, ...res.data.userMap }));
      setTargetMap(prev => ({ ...prev, ...res.data.targetMap }));
      setPagination(prev => ({ ...prev, ...res.data.pagination }));
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, loginid, action, targetType, startDate, endDate, categoryTab]);

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

  const clearFilters = () => {
    setCategoryTab('all');
    setLoginid('');
    setAction('');
    setTargetType('');
    setStartDate('');
    setEndDate('');
  };

  const hasActiveFilters = loginid || action || targetType || startDate || endDate;

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

  const formatDetails = (details: unknown): string => {
    if (!details) return '-';
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  };

  const getDetailsSummary = (details: unknown): string => {
    if (!details) return '-';
    if (typeof details === 'string') return details.length > 60 ? details.slice(0, 60) + '...' : details;
    try {
      const str = JSON.stringify(details);
      return str.length > 60 ? str.slice(0, 60) + '...' : str;
    } catch {
      return '-';
    }
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
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">감사 로그</h1>
            <p className="text-sm text-pastel-500 mt-0.5">
              관리자의 모든 설정 변경 이력을 추적합니다
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

      {/* Category Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-lg shadow-sm border border-gray-100/80 p-1 overflow-x-auto">
        {CATEGORY_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setCategoryTab(key);
              if (key !== 'all') {
                setAction('');
                setTargetType('');
              }
              setPagination(prev => ({ ...prev, page: 1 }));
            }}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap ${
              categoryTab === key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-pastel-600 hover:bg-pastel-50 hover:text-pastel-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Login ID search */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-pastel-400" />
            <input
              type="text"
              placeholder="관리자 아이디 검색..."
              value={loginid}
              onChange={e => setLoginid(e.target.value)}
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
                {[action, targetType, startDate, endDate].filter(Boolean).length}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Filter Options */}
        {showFilters && (
          <div className="mt-5 pt-5 border-t border-gray-100/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 animate-slide-down">
            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">작업</label>
              <select
                value={categoryTab !== 'all' ? '' : action}
                onChange={e => { setAction(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                disabled={categoryTab !== 'all'}
                className={`w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200 ${categoryTab !== 'all' ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <option value="">전체</option>
                {ACTION_OPTIONS.map(a => (
                  <option key={a} value={a}>{getActionLabel(a)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-pastel-500 uppercase tracking-wider mb-2">대상 유형</label>
              <select
                value={categoryTab !== 'all' ? '' : targetType}
                onChange={e => { setTargetType(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                disabled={categoryTab !== 'all'}
                className={`w-full px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200 ${categoryTab !== 'all' ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <option value="">전체</option>
                {TARGET_TYPE_OPTIONS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
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

      {/* Audit Logs Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: '1000px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100/80">
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[30px]"></th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[170px]">시각</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[160px]">관리자</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[160px]">작업</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider">대상</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[100px]">유형</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[200px]">상세</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-pastel-500 uppercase tracking-wider w-[120px]">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/60">
              {loading ? (
                <TableLoadingRow colSpan={8} />
              ) : logs.length === 0 ? (
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
                logs.map(log => {
                  const isExpanded = expandedRows.has(log.id);
                  const hasDetails = log.details && (typeof log.details === 'object' ? Object.keys(log.details as object).length > 0 : true);
                  const userInfo = userMap[log.loginid];

                  return (
                    <tr key={log.id} className="group">
                      {/* Main row */}
                      <td className="px-4 py-3">
                        {hasDetails ? (
                          <button
                            onClick={() => toggleExpanded(log.id)}
                            className="p-1 hover:bg-pastel-100 rounded-lg transition-colors duration-200"
                          >
                            <ChevronRight
                              className={`w-4 h-4 text-pastel-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                            />
                          </button>
                        ) : (
                          <div className="w-6" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-pastel-400 flex-shrink-0" />
                          <span className="text-xs text-pastel-600 font-mono tabular-nums">{formatKST(log.timestamp)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-pastel-100 to-pastel-200 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-pastel-600">
                              {(userInfo?.username || log.loginid).charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm text-pastel-700 font-medium truncate block" title={log.loginid}>
                              {userInfo?.username || log.loginid}
                            </span>
                            {userInfo && (
                              <span className="text-xs text-pastel-400 truncate block" title={`${log.loginid} · ${userInfo.deptname}`}>
                                {log.loginid}{userInfo.deptname ? ` · ${userInfo.deptname}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full ${getActionColor(log.action)}`}
                          title={log.action}
                        >
                          {getActionLabel(log.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-pastel-700 font-medium truncate block" title={log.target || '-'}>
                          {log.target ? (targetMap[log.target] || log.target) : '-'}
                        </span>
                        {log.target && targetMap[log.target] && (
                          <span className="text-xs text-pastel-400 truncate block font-mono" title={log.target}>
                            {log.target.length > 20 ? log.target.slice(0, 8) + '...' : log.target}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.targetType ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-pastel-50 text-pastel-600 ring-1 ring-pastel-200/80">
                            {log.targetType}
                          </span>
                        ) : (
                          <span className="text-sm text-pastel-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-pastel-500 font-mono truncate block max-w-[200px]" title={typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}>
                          {getDetailsSummary(log.details)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {log.ipAddress ? (
                          <div className="flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-pastel-400 flex-shrink-0" />
                            <span className="text-xs text-pastel-600 font-mono">{log.ipAddress}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-pastel-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Expanded detail rows - rendered outside table for proper layout */}
        {logs.some(log => expandedRows.has(log.id)) && (
          <div className="border-t border-gray-100/80">
            {logs.filter(log => expandedRows.has(log.id)).map(log => (
              <div key={`detail-${log.id}`} className="px-6 py-4 bg-gray-50/50 border-b border-gray-100/60 animate-slide-down">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-pastel-500 uppercase tracking-wider">상세 정보</span>
                  <span className="text-xs text-pastel-400">-</span>
                  <span className="text-xs text-pastel-400 font-mono">{getActionLabel(log.action)} / {userMap[log.loginid]?.username || log.loginid}</span>
                  <button
                    onClick={() => toggleExpanded(log.id)}
                    className="ml-auto p-1 hover:bg-pastel-100 rounded-lg transition-colors duration-200"
                  >
                    <X className="w-3.5 h-3.5 text-pastel-400" />
                  </button>
                </div>
                <pre className="p-4 bg-gray-900 text-gray-100 rounded-xl text-xs font-mono overflow-auto max-h-[300px] leading-relaxed">
                  {formatDetails(log.details)}
                </pre>
              </div>
            ))}
          </div>
        )}

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
