import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Filter, ChevronDown, Shield, ShieldCheck, Clock, Activity, Users, Building2, X, Trash2, AlertTriangle, UserPlus, RefreshCw, CheckCircle, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { unifiedUsersApi, usersApi, knoxApi } from '../services/api';
import { TableLoadingRow } from '../components/LoadingSpinner';

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
  knoxVerified: boolean;
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
  ADMIN: '시스템 관리자',
  USER: '사용자',
};

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

export default function UnifiedUsers({ adminRole }: { adminRole?: AdminRole }) {
  const isSuperAdmin = adminRole === 'SUPER_ADMIN';
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
  const [editRole, setEditRole] = useState<'USER' | 'ADMIN' | 'SUPER_ADMIN'>('USER');
  const [saving, setSaving] = useState(false);

  // Delete user modal
  const [deletingUser, setDeletingUser] = useState<UnifiedUser | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Knox registration modal
  const [showKnoxModal, setShowKnoxModal] = useState(false);
  const [knoxSearchId, setKnoxSearchId] = useState('');
  const [knoxSearching, setKnoxSearching] = useState(false);
  const [knoxResult, setKnoxResult] = useState<{
    employee: { loginid: string; fullName: string; enFullName: string; departmentName: string; titleName: string; gradeName: string; emailAddress: string; employeeStatus: string };
    existingUser: { id: string; loginid: string; username: string; deptname: string; knoxVerified: boolean } | null;
    existingAdmin: { role: string; designatedBy: string } | null;
  } | null>(null);
  const [knoxSearchError, setKnoxSearchError] = useState('');
  const [knoxRegisterRole, setKnoxRegisterRole] = useState<'ADMIN' | 'SUPER_ADMIN'>('ADMIN');
  const [knoxRegistering, setKnoxRegistering] = useState(false);
  const [knoxRegisterSuccess, setKnoxRegisterSuccess] = useState('');

  // Excel export state
  const [exporting, setExporting] = useState(false);

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
    setEditRole(user.globalRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : user.globalRole === 'ADMIN' ? 'ADMIN' : 'USER');
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setEditRole('USER');
  };

  const savePermissions = async () => {
    if (!editingUser) return;

    try {
      setSaving(true);
      await unifiedUsersApi.updatePermissions(editingUser.id, {
        globalRole: editRole !== 'USER' ? editRole : undefined,
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

  const openDeleteModal = (user: UnifiedUser) => {
    setDeletingUser(user);
    setDeleteConfirmInput('');
  };

  const closeDeleteModal = () => {
    setDeletingUser(null);
    setDeleteConfirmInput('');
  };

  const handleDeleteUser = async () => {
    if (!deletingUser || deleteConfirmInput !== deletingUser.loginid) return;

    try {
      setDeleting(true);
      await usersApi.deleteUser(deletingUser.id);
      closeDeleteModal();
      loadUsers();
    } catch (error) {
      console.error('Failed to delete user:', error);
      alert('사용자 삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
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
      { value: 'ADMIN', label: '시스템 관리자' },
      { value: 'USER', label: '사용자' },
    ];
  };

  // Knox 임직원 검색
  const handleKnoxSearch = async () => {
    if (!knoxSearchId.trim()) return;
    setKnoxSearching(true);
    setKnoxResult(null);
    setKnoxSearchError('');
    setKnoxRegisterSuccess('');
    try {
      const res = await knoxApi.search(knoxSearchId.trim());
      setKnoxResult(res.data);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setKnoxSearchError(err.response?.data?.error || '검색에 실패했습니다.');
    } finally {
      setKnoxSearching(false);
    }
  };

  // Knox 관리자 등록
  const handleKnoxRegister = async () => {
    if (!knoxResult?.employee) return;
    setKnoxRegistering(true);
    setKnoxRegisterSuccess('');
    try {
      const res = await knoxApi.register(knoxResult.employee.loginid, knoxRegisterRole);
      setKnoxRegisterSuccess(res.data.message);
      setKnoxResult(null);
      loadUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setKnoxSearchError(err.response?.data?.error || '등록에 실패했습니다.');
    } finally {
      setKnoxRegistering(false);
    }
  };

  const closeKnoxModal = () => {
    setShowKnoxModal(false);
    setKnoxSearchId('');
    setKnoxResult(null);
    setKnoxRegisterRole('ADMIN');
    setKnoxSearchError('');
    setKnoxRegisterSuccess('');
  };

  // Excel 전체 내보내기 (월별 탭 + 외부 서비스 포함)
  const handleExportExcel = async () => {
    try {
      setExporting(true);
      const res = await unifiedUsersApi.exportAll({
        search: search || undefined,
        serviceId: serviceFilter || undefined,
        businessUnit: businessUnitFilter || undefined,
        role: roleFilter || undefined,
      });
      const exportUsers: UnifiedUser[] = res.data.users;
      const monthly: Record<string, Record<string, Record<string, number>>> = res.data.monthly || {};
      const serviceMapRaw: Record<string, string> = res.data.serviceMap || {};
      // 외부 API 데이터: { "2026-03": { "username": { count, dept, lwrDept } } }
      const externalRoo: Record<string, Record<string, { count: number; dept: string; lwrDept: string }>> = res.data.externalRoo || {};
      const externalCodemate: Record<string, Record<string, { count: number; dept: string; lwrDept: string }>> = res.data.externalCodemate || {};

      if (exportUsers.length === 0 && Object.keys(externalRoo).length === 0 && Object.keys(externalCodemate).length === 0) {
        alert('내보낼 사용자가 없습니다.');
        return;
      }

      // 유저 맵 (id → user), loginid → user
      const userMap = new Map(exportUsers.map(u => [u.id, u]));
      const loginMap = new Map(exportUsers.map(u => [u.loginid, u]));

      // 전체 서비스 이름 목록 수집
      const serviceNameSet = new Set<string>();
      exportUsers.forEach(u => u.serviceStats.forEach(s => serviceNameSet.add(s.serviceName)));
      const serviceNames = [...serviceNameSet].sort();

      // 서비스 ID → 이름 맵
      const svcIdToName = new Map(Object.entries(serviceMapRaw));

      // 시트 생성 헬퍼
      const createSheet = (rows: Record<string, string | number>[]) => {
        const ws = XLSX.utils.json_to_sheet(rows);
        if (rows.length > 0) {
          ws['!cols'] = Object.keys(rows[0]).map(key => {
            const maxLen = Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length));
            return { wch: Math.min(maxLen + 2, 30) };
          });
        }
        return ws;
      };

      const wb = XLSX.utils.book_new();

      // 외부 데이터 전체 합산 (loginid → { roo: total, codemate: total })
      const externalTotals = new Map<string, { roo: number; codemate: number; dept: string; lwrDept: string }>();
      for (const monthData of Object.values(externalRoo)) {
        for (const [uname, info] of Object.entries(monthData)) {
          const prev = externalTotals.get(uname) || { roo: 0, codemate: 0, dept: info.dept, lwrDept: info.lwrDept };
          prev.roo += info.count;
          if (info.dept) prev.dept = info.dept;
          if (info.lwrDept) prev.lwrDept = info.lwrDept;
          externalTotals.set(uname, prev);
        }
      }
      for (const monthData of Object.values(externalCodemate)) {
        for (const [uname, info] of Object.entries(monthData)) {
          const prev = externalTotals.get(uname) || { roo: 0, codemate: 0, dept: info.dept, lwrDept: info.lwrDept };
          prev.codemate += info.count;
          if (info.dept) prev.dept = info.dept;
          if (info.lwrDept) prev.lwrDept = info.lwrDept;
          externalTotals.set(uname, prev);
        }
      }

      // 외부에만 존재하는 사용자 수집
      const externalOnlyUsers = new Set<string>();
      externalTotals.forEach((_, uname) => {
        if (!loginMap.has(uname)) externalOnlyUsers.add(uname);
      });

      // 1) 전체 합산 시트
      const totalRows: Record<string, string | number>[] = [];
      let no = 0;
      // 내부 사용자
      exportUsers.forEach(u => {
        no++;
        const row: Record<string, string | number> = {
          'No': no,
          '이름': decodeURIComponent(u.username),
          'ID': u.loginid,
          '부서': u.deptname,
          '사업부': u.businessUnit || '',
          '권한': u.globalRole === 'SUPER_ADMIN' ? '슈퍼관리자' : u.globalRole === 'ADMIN' ? '시스템 관리자' : '사용자',
          '총 요청수': u.totalRequests,
        };
        serviceNames.forEach(name => {
          const stat = u.serviceStats.find(s => s.serviceName === name);
          row[name] = stat ? stat.requestCount : 0;
        });
        const ext = externalTotals.get(u.loginid);
        row['Codemate with Roo'] = ext?.roo || 0;
        row['Codemate'] = ext?.codemate || 0;
        totalRows.push(row);
      });
      // 외부에만 존재하는 사용자
      externalOnlyUsers.forEach(uname => {
        no++;
        const ext = externalTotals.get(uname)!;
        const row: Record<string, string | number> = {
          'No': no,
          '이름': uname,
          'ID': uname,
          '부서': ext.lwrDept || ext.dept || '',
          '사업부': ext.dept || '',
          '권한': '-',
          '총 요청수': 0,
        };
        serviceNames.forEach(name => { row[name] = 0; });
        row['Codemate with Roo'] = ext.roo;
        row['Codemate'] = ext.codemate;
        totalRows.push(row);
      });
      XLSX.utils.book_append_sheet(wb, createSheet(totalRows), '전체');

      // 2) 월별 시트 (모든 월 통합: 내부 + 외부)
      const allMonthsSet = new Set([
        ...Object.keys(monthly),
        ...Object.keys(externalRoo),
        ...Object.keys(externalCodemate),
      ]);
      const months = [...allMonthsSet].sort().reverse();

      for (const month of months) {
        const monthData = monthly[month] || {};
        const rooMonth = externalRoo[month] || {};
        const cmMonth = externalCodemate[month] || {};

        // 해당 월 활동 사용자 수집 (loginid 기준)
        const monthLoginIds = new Set<string>();

        // 내부 유저 (userId → loginid 변환)
        Object.keys(monthData).forEach(uid => {
          const user = userMap.get(uid);
          if (user) monthLoginIds.add(user.loginid);
        });
        // 외부 유저
        Object.keys(rooMonth).forEach(u => monthLoginIds.add(u));
        Object.keys(cmMonth).forEach(u => monthLoginIds.add(u));

        if (monthLoginIds.size === 0) continue;

        // 해당 월 내부 서비스 이름 수집
        const monthServiceIds = new Set<string>();
        Object.keys(monthData).forEach(uid => {
          Object.keys(monthData[uid]).forEach(sid => monthServiceIds.add(sid));
        });
        const monthServiceNames = [...monthServiceIds]
          .map(sid => svcIdToName.get(sid) || sid)
          .sort();

        const rows: Record<string, string | number>[] = [];
        monthLoginIds.forEach(loginid => {
          const user = loginMap.get(loginid);
          const row: Record<string, string | number> = {
            'No': 0,
            '이름': user ? decodeURIComponent(user.username) : loginid,
            'ID': loginid,
            '부서': user?.deptname || rooMonth[loginid]?.lwrDept || cmMonth[loginid]?.lwrDept || '',
            '사업부': user?.businessUnit || rooMonth[loginid]?.dept || cmMonth[loginid]?.dept || '',
          };

          let monthTotal = 0;
          // 내부 서비스 수치
          if (user) {
            const uid = user.id;
            monthServiceNames.forEach(svcName => {
              const svcId = [...svcIdToName.entries()].find(([, n]) => n === svcName)?.[0] || '';
              const count = monthData[uid]?.[svcId] || 0;
              row[svcName] = count;
              monthTotal += count;
            });
          } else {
            monthServiceNames.forEach(svcName => { row[svcName] = 0; });
          }

          const rooCount = rooMonth[loginid]?.count || 0;
          const cmCount = cmMonth[loginid]?.count || 0;
          row['Codemate with Roo'] = rooCount;
          row['Codemate'] = cmCount;
          monthTotal += rooCount + cmCount;
          row['월 합계'] = monthTotal;
          rows.push(row);
        });

        // 월 합계 내림차순 정렬 + No 재부여
        rows.sort((a, b) => (b['월 합계'] as number) - (a['월 합계'] as number));
        rows.forEach((r, i) => { r['No'] = i + 1; });

        XLSX.utils.book_append_sheet(wb, createSheet(rows), month);
      }

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `사용자_관리_${today}.xlsx`);
    } catch (error) {
      console.error('Excel export failed:', error);
      alert('Excel 내보내기에 실패했습니다.');
    } finally {
      setExporting(false);
    }
  };

  // Knox 인증 초기화
  const handleResetVerification = async (userId: string) => {
    if (!confirm('Knox 인증을 초기화하시겠습니까? 다음 접근 시 재인증됩니다.')) return;
    try {
      await knoxApi.resetVerification(userId);
      loadUsers();
    } catch {
      alert('Knox 인증 초기화에 실패했습니다.');
    }
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
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm font-semibold"
          >
            <Download className="w-4 h-4" />
            {exporting ? '내보내는 중...' : 'Excel 저장'}
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => setShowKnoxModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-samsung-blue text-white rounded-lg shadow-sm hover:bg-samsung-blue/90 transition-all duration-200 text-sm font-semibold"
            >
              <UserPlus className="w-4 h-4" />
              관리자 사전 등록
            </button>
          )}
          <div className="flex items-center gap-2.5 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-accent-emerald opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-emerald"></span>
            </span>
            <span className="text-sm font-semibold text-pastel-700">총 {pagination.total.toLocaleString()}명</span>
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
                <TableLoadingRow colSpan={6} />
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
                          <div className="flex items-center gap-1 mt-0.5">
                            <p className="text-xs text-pastel-400 truncate">{user.loginid}</p>
                            {user.knoxVerified ? (
                              <span title="Knox 인증 완료">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                              </span>
                            ) : (
                              <span title="Knox 미인증">
                                <Shield className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                              </span>
                            )}
                          </div>
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
                      {(isSuperAdmin || user.globalRole !== 'SUPER_ADMIN') && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(user)}
                            className="px-3.5 py-1.5 text-xs font-semibold bg-pastel-50 text-pastel-600 hover:bg-samsung-blue hover:text-white rounded-xl border border-pastel-200/60 hover:border-transparent transition-all duration-200 shadow-sm hover:shadow-depth"
                          >
                            권한 변경
                          </button>
                          {isSuperAdmin && (
                            <button
                              onClick={() => handleResetVerification(user.id)}
                              className="p-1.5 text-pastel-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg border border-transparent hover:border-amber-200/60 transition-all duration-200"
                              title="Knox 인증 초기화"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openDeleteModal(user)}
                            className="p-1.5 text-pastel-400 hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200/60 transition-all duration-200"
                            title="사용자 삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
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

      {/* Delete User Confirmation Modal */}
      {deletingUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-modal animate-scale-in">
            <div className="p-6 border-b border-gray-100/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-red-50">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-pastel-800">사용자 삭제</h2>
                  <p className="text-sm text-pastel-500">{deletingUser.username} ({deletingUser.loginid})</p>
                </div>
              </div>
              <button
                onClick={closeDeleteModal}
                className="p-2 text-pastel-400 hover:text-pastel-600 hover:bg-pastel-50 rounded-xl transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="p-4 rounded-xl bg-red-50 border border-red-200/60 mb-5">
                <p className="text-sm text-red-700 font-medium leading-relaxed">
                  이 사용자의 <span className="font-bold">모든 기록</span>(사용 로그, 통계, 토큰 제한 설정)이
                  영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-pastel-700 mb-2">
                  확인을 위해 <span className="text-red-600 font-bold">{deletingUser.loginid}</span>를 입력하세요
                </label>
                <input
                  type="text"
                  value={deleteConfirmInput}
                  onChange={e => setDeleteConfirmInput(e.target.value)}
                  placeholder={deletingUser.loginid}
                  className="w-full px-4 py-3 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-300 focus:outline-none focus:ring-2 focus:ring-red-500/15 focus:border-red-300 transition-all duration-200"
                  autoFocus
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-100/80 flex justify-end gap-3">
              <button
                onClick={closeDeleteModal}
                className="px-5 py-2.5 text-sm font-medium text-pastel-600 hover:bg-pastel-50 rounded-xl transition-all duration-200"
              >
                취소
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={deleting || deleteConfirmInput !== deletingUser.loginid}
                className="px-6 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Knox Registration Modal */}
      {showKnoxModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-modal animate-scale-in">
            <div className="p-6 border-b border-gray-100/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-samsung-blue/10">
                  <UserPlus className="w-5 h-5 text-samsung-blue" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-pastel-800">관리자 사전 등록</h2>
                  <p className="text-sm text-pastel-500">Knox ID로 임직원을 검색하여 관리자로 등록합니다</p>
                </div>
              </div>
              <button onClick={closeKnoxModal} className="p-2 text-pastel-400 hover:text-pastel-600 hover:bg-pastel-50 rounded-xl transition-all duration-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {/* Search */}
              <div className="flex gap-3 mb-5">
                <input
                  type="text"
                  placeholder="Knox ID 입력 (예: syngha.han)"
                  value={knoxSearchId}
                  onChange={e => setKnoxSearchId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleKnoxSearch()}
                  className="flex-1 px-4 py-3 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-800 placeholder:text-pastel-400 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
                  autoFocus
                />
                <button
                  onClick={handleKnoxSearch}
                  disabled={knoxSearching || !knoxSearchId.trim()}
                  className="px-5 py-3 bg-samsung-blue text-white rounded-lg text-sm font-semibold hover:bg-samsung-blue/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {knoxSearching ? '검색 중...' : '검색'}
                </button>
              </div>

              {/* Error */}
              {knoxSearchError && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200/60 mb-5">
                  <p className="text-sm text-red-700 font-medium">{knoxSearchError}</p>
                </div>
              )}

              {/* Success */}
              {knoxRegisterSuccess && (
                <div className="p-4 rounded-xl bg-accent-emerald/10 border border-accent-emerald/20 mb-5 flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-accent-emerald flex-shrink-0" />
                  <p className="text-sm text-accent-emerald font-medium">{knoxRegisterSuccess}</p>
                </div>
              )}

              {/* Result */}
              {knoxResult && (
                <div className="space-y-5">
                  <div className="p-5 rounded-xl bg-pastel-50 border border-pastel-100/80">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-samsung-blue/20 to-samsung-blue/5 flex items-center justify-center">
                        <span className="text-base font-bold text-samsung-blue">{knoxResult.employee.fullName.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="font-bold text-pastel-800">{knoxResult.employee.fullName}</p>
                        <p className="text-xs text-pastel-500">{knoxResult.employee.loginid} · {knoxResult.employee.enFullName}</p>
                      </div>
                      <span className="ml-auto px-2.5 py-1 text-xs font-semibold bg-accent-emerald/10 text-accent-emerald rounded-full">{knoxResult.employee.employeeStatus}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-pastel-500">부서</span><p className="font-medium text-pastel-800">{knoxResult.employee.departmentName}</p></div>
                      <div><span className="text-pastel-500">직급</span><p className="font-medium text-pastel-800">{knoxResult.employee.titleName} ({knoxResult.employee.gradeName})</p></div>
                      <div className="col-span-2"><span className="text-pastel-500">이메일</span><p className="font-medium text-pastel-800">{knoxResult.employee.emailAddress}</p></div>
                    </div>

                    {knoxResult.existingUser && (
                      <div className="mt-4 pt-4 border-t border-pastel-200/60">
                        <p className="text-xs font-semibold text-pastel-500 mb-1">기존 등록 정보</p>
                        <p className="text-sm text-pastel-700">
                          {knoxResult.existingUser.username} · {knoxResult.existingUser.deptname}
                          {knoxResult.existingUser.knoxVerified && <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-accent-emerald/10 text-accent-emerald rounded">인증완료</span>}
                          {!knoxResult.existingUser.knoxVerified && <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-600 rounded">미인증</span>}
                        </p>
                        {knoxResult.existingAdmin && (
                          <p className="text-xs text-pastel-500 mt-1">
                            현재 역할: <span className="font-semibold">{knoxResult.existingAdmin.role}</span>
                            {knoxResult.existingAdmin.designatedBy && <span> (지정: {knoxResult.existingAdmin.designatedBy})</span>}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Role selection + Register */}
                  <div className="flex items-center gap-3">
                    <select
                      value={knoxRegisterRole}
                      onChange={e => setKnoxRegisterRole(e.target.value as 'ADMIN' | 'SUPER_ADMIN')}
                      className="flex-1 px-4 py-2.5 bg-white border border-gray-200/60 rounded-lg text-sm text-pastel-700 focus:outline-none focus:ring-2 focus:ring-samsung-blue/15 focus:border-samsung-blue/30 transition-all duration-200"
                    >
                      <option value="ADMIN">시스템 관리자 (ADMIN)</option>
                      <option value="SUPER_ADMIN">슈퍼 관리자 (SUPER_ADMIN)</option>
                    </select>
                    <button
                      onClick={handleKnoxRegister}
                      disabled={knoxRegistering}
                      className="px-6 py-2.5 bg-samsung-blue text-white rounded-lg text-sm font-semibold hover:bg-samsung-blue/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {knoxRegistering ? '등록 중...' : '등록'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

            <div className="p-6 space-y-3">
              {([
                { value: 'USER' as const, label: '일반 사용자', desc: '자신의 사용 현황만 확인할 수 있습니다.', color: 'bg-gray-100 text-gray-600' },
                { value: 'ADMIN' as const, label: '시스템 관리자', desc: '통합 대시보드, LLM 모델 관리, 서비스 관리 등에 접근할 수 있습니다.', color: 'bg-blue-50 text-blue-700' },
                ...(isSuperAdmin ? [{ value: 'SUPER_ADMIN' as const, label: '슈퍼 관리자', desc: '모든 권한 + 사용자 관리, 요청/감사 로그, 휴일 관리 등 전체 시스템 권한을 갖습니다.', color: 'bg-red-50 text-red-700' }] : []),
              ]).map(({ value, label, desc, color }) => (
                <label
                  key={value}
                  className={`flex items-center gap-3.5 p-4 rounded-lg border cursor-pointer transition-all duration-200 ${
                    editRole === value
                      ? 'border-samsung-blue bg-blue-50/30 ring-1 ring-samsung-blue/20'
                      : 'border-gray-200/60 hover:border-samsung-blue/20'
                  }`}
                >
                  <input
                    type="radio"
                    name="editRole"
                    value={value}
                    checked={editRole === value}
                    onChange={() => setEditRole(value)}
                    className="sr-only"
                  />
                  <div className={`p-2 rounded-xl ${editRole === value ? 'bg-samsung-blue/10' : 'bg-gray-100'}`}>
                    <Shield className={`w-4 h-4 ${editRole === value ? 'text-samsung-blue' : 'text-gray-400'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-pastel-800 text-sm">{label}</p>
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${color}`}>{value}</span>
                    </div>
                    <p className="text-xs text-pastel-500 mt-0.5">{desc}</p>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    editRole === value ? 'border-samsung-blue' : 'border-gray-300'
                  }`}>
                    {editRole === value && <div className="w-2 h-2 rounded-full bg-samsung-blue" />}
                  </div>
                </label>
              ))}
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
