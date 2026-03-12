import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Edit2, Rocket, Server, Cpu, X, Loader2,
  Layers, Search, Trash2, UserPlus, Users, ChevronDown,
  Crown, Shield, User, Gauge
} from 'lucide-react';
import { api, serviceRateLimitScopedApi } from '../services/api';

// ── Types ──

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface MyServicesProps {
  user: { id: string; loginid: string; username: string; deptname: string };
  adminRole: AdminRole;
}

interface Service {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  type: 'STANDARD' | 'BACKGROUND';
  status: 'DEVELOPMENT' | 'DEPLOYED';
  enabled: boolean;
  registeredBy?: string;
  registeredByDept?: string;
  registeredByBusinessUnit?: string;
  deployScope?: 'ALL' | 'BUSINESS_UNIT' | 'TEAM';
  deployScopeValue?: string[];
  createdAt: string;
  _count?: { usageLogs: number };
  _isServiceAdmin?: boolean;
  _isCreator?: boolean;
  serviceModels?: Array<{
    id: string;
    modelId: string;
    sortOrder: number;
    weight: number;
    enabled: boolean;
    model: { id: string; name: string; displayName: string; type: string; enabled: boolean };
  }>;
}

type ServiceTab = 'all' | 'created' | 'team' | 'service-admin';

interface ServiceMember {
  id: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'USER';
  user: {
    id: string;
    loginid: string;
    username: string;
    deptname: string;
  };
}

interface SearchUser {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
}

interface ServiceFormData {
  name: string;
  displayName: string;
  description: string;
  type: 'STANDARD' | 'BACKGROUND';
}

const EMPTY_FORM: ServiceFormData = {
  name: '',
  displayName: '',
  description: '',
  type: 'STANDARD',
};

// ── Helpers ──

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// ── Skeleton ──

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-28 bg-gray-100 animate-pulse rounded" />
          <div className="h-3 w-20 bg-gray-50 animate-pulse rounded" />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="h-3.5 w-full bg-gray-50 animate-pulse rounded" />
        <div className="h-3.5 w-3/5 bg-gray-50 animate-pulse rounded" />
      </div>
      <div className="h-px bg-gray-100" />
      <div className="flex gap-2">
        <div className="h-8 w-20 bg-gray-50 animate-pulse rounded" />
        <div className="h-8 w-20 bg-gray-50 animate-pulse rounded" />
      </div>
    </div>
  );
}

// ── Modal Backdrop ──

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ── Main Component ──

export default function MyServices({ user, adminRole }: MyServicesProps) {
  const navigate = useNavigate();
  const isSystemAdmin = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ServiceTab>('all');

  // Modal states
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formData, setFormData] = useState<ServiceFormData>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Deploy modal
  const [deployTarget, setDeployTarget] = useState<Service | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployScope, setDeployScope] = useState<'ALL' | 'BUSINESS_UNIT' | 'TEAM'>('ALL');
  const [deployScopeValue, setDeployScopeValue] = useState('');

  // Member management modal
  const [memberTarget, setMemberTarget] = useState<Service | null>(null);
  const [members, setMembers] = useState<ServiceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberActionLoading, setMemberActionLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Rate Limit modal
  const [rateLimitTarget, setRateLimitTarget] = useState<Service | null>(null);
  const [rateLimitLoading, setRateLimitLoading] = useState(false);
  const [rateLimitSaving, setRateLimitSaving] = useState(false);
  const [commonRateLimit, setCommonRateLimit] = useState<{ maxTokens: number; window: 'FIVE_HOURS' | 'DAY'; enabled: boolean } | null>(null);
  const [userRateLimits, setUserRateLimits] = useState<Array<{ userId: string; maxTokens: number; window: 'FIVE_HOURS' | 'DAY'; enabled: boolean; user: { id: string; loginid: string; username: string; deptname: string } }>>([]);
  const [rlForm, setRlForm] = useState<{ maxTokens: string; window: 'FIVE_HOURS' | 'DAY' }>({ maxTokens: '100000', window: 'DAY' });
  const [rlEditUserId, setRlEditUserId] = useState<string | null>(null);
  const [rlUserForm, setRlUserForm] = useState<{ maxTokens: string; window: 'FIVE_HOURS' | 'DAY' }>({ maxTokens: '100000', window: 'DAY' });

  // ── Load services ──

  const loadServices = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/services/my');
      setServices(res.data.services || []);
    } catch (err: unknown) {
      console.error('Failed to load services:', err);
      setError('서비스 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  // ── Filter services by tab ──

  const filteredServices = services.filter((s) => {
    switch (activeTab) {
      case 'all':
        return true;
      case 'created':
        return s._isCreator;
      case 'team':
        return s.registeredByDept === user.deptname;
      case 'service-admin':
        return s._isServiceAdmin;
      default:
        return true;
    }
  });

  // ── Create / Edit service ──

  const openCreateModal = () => {
    setEditingService(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setShowServiceModal(true);
  };

  const openEditModal = (service: Service) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      displayName: service.displayName,
      description: service.description || '',
      type: service.type,
    });
    setFormError(null);
    setShowServiceModal(true);
  };

  const closeServiceModal = () => {
    setShowServiceModal(false);
    setEditingService(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
  };

  const handleSaveService = async () => {
    if (!formData.name.trim() || !formData.displayName.trim()) {
      setFormError('서비스 코드와 표시 이름은 필수입니다.');
      return;
    }

    // Validate name format: lowercase alphanumeric + hyphens
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(formData.name) && formData.name.length > 1) {
      setFormError('서비스 코드는 영문 소문자, 숫자, 하이픈만 사용 가능합니다.');
      return;
    }

    setFormSaving(true);
    setFormError(null);

    try {
      if (editingService) {
        await api.put(`/services/${editingService.id}`, {
          displayName: formData.displayName,
          description: formData.description || undefined,
          type: formData.type,
        });
      } else {
        await api.post('/services', {
          name: formData.name,
          displayName: formData.displayName,
          description: formData.description || undefined,
          type: formData.type,
        });
      }
      closeServiceModal();
      await loadServices();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(msg || '저장에 실패했습니다.');
    } finally {
      setFormSaving(false);
    }
  };

  // ── Deploy ──

  const openDeployModal = (service: Service) => {
    setDeployTarget(service);
    // Pre-fill scope from existing service data or default to ALL
    setDeployScope(service.deployScope || 'ALL');
    setDeployScopeValue(
      (service.deployScopeValue || []).join(', ') ||
      (service.registeredByBusinessUnit || service.registeredByDept || '')
    );
  };

  const handleDeploy = async () => {
    if (!deployTarget) return;
    setDeploying(true);
    try {
      await api.post(`/services/${deployTarget.id}/deploy`, {
        deployScope,
        deployScopeValue: deployScope !== 'ALL' && deployScopeValue
          ? deployScopeValue.split(',').map((v: string) => v.trim()).filter(Boolean)
          : [],
      });
      setDeployTarget(null);
      await loadServices();
    } catch (err: unknown) {
      console.error('Deploy failed:', err);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || '배포에 실패했습니다.');
    } finally {
      setDeploying(false);
    }
  };

  const handleUndeploy = async (serviceId: string) => {
    if (!confirm('배포를 취소하고 개발 상태로 되돌리시겠습니까?')) return;
    try {
      await api.post(`/services/${serviceId}/undeploy`);
      await loadServices();
    } catch (err: unknown) {
      console.error('Undeploy failed:', err);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || '배포 취소에 실패했습니다.');
    }
  };

  // ── Delete service ──

  const handleDeleteService = async (service: Service) => {
    const usageCount = service._count?.usageLogs || 0;
    const message = usageCount > 0
      ? `'${service.displayName}' 서비스를 삭제하시겠습니까?\n\n⚠️ 이 서비스에는 ${usageCount.toLocaleString()}건의 사용 기록이 있습니다. 삭제 시 모든 데이터가 함께 삭제됩니다.\n\n정말 삭제하시겠습니까?`
      : `'${service.displayName}' 서비스를 삭제하시겠습니까?`;
    if (!confirm(message)) return;
    try {
      await api.delete(`/services/${service.id}${usageCount > 0 ? '?force=true' : ''}`);
      await loadServices();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || '서비스 삭제에 실패했습니다.');
    }
  };

  // ── Member management ──

  const openMemberModal = async (service: Service) => {
    setMemberTarget(service);
    setMembersLoading(true);
    setUserSearch('');
    setSearchResults([]);
    try {
      const res = await api.get(`/services/${service.id}/members`);
      setMembers(res.data.members || []);
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setMembersLoading(false);
    }
  };

  const handleSearchUsers = async (query: string) => {
    setUserSearch(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await api.get('/services/search-users', { params: { q: query } });
      setSearchResults(res.data.users || []);
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!memberTarget) return;
    setMemberActionLoading(true);
    try {
      const user = searchResults.find((u) => u.id === userId);
      await api.post(`/services/${memberTarget.id}/members`, { loginid: user?.loginid });
      const res = await api.get(`/services/${memberTarget.id}/members`);
      setMembers(res.data.members || []);
      setUserSearch('');
      setSearchResults([]);
    } catch (err: unknown) {
      console.error('Failed to add member:', err);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || '멤버 추가에 실패했습니다.');
    } finally {
      setMemberActionLoading(false);
    }
  };

  const handleChangeRole = async (userId: string, role: string) => {
    if (!memberTarget) return;
    setMemberActionLoading(true);
    try {
      await api.put(`/services/${memberTarget.id}/members/${userId}/role`, { role });
      const res = await api.get(`/services/${memberTarget.id}/members`);
      setMembers(res.data.members || []);
    } catch (err: unknown) {
      console.error('Failed to change role:', err);
    } finally {
      setMemberActionLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!memberTarget) return;
    setMemberActionLoading(true);
    try {
      await api.delete(`/services/${memberTarget.id}/members/${userId}`);
      const res = await api.get(`/services/${memberTarget.id}/members`);
      setMembers(res.data.members || []);
    } catch (err: unknown) {
      console.error('Failed to remove member:', err);
    } finally {
      setMemberActionLoading(false);
    }
  };

  const closeMemberModal = () => {
    setMemberTarget(null);
    setMembers([]);
    setUserSearch('');
    setSearchResults([]);
  };

  // ── Rate Limit management ──

  const openRateLimitModal = async (service: Service) => {
    setRateLimitTarget(service);
    setRateLimitLoading(true);
    setRlEditUserId(null);
    try {
      const [commonRes, userRes] = await Promise.all([
        serviceRateLimitScopedApi.getCommon(service.id),
        serviceRateLimitScopedApi.list(service.id),
      ]);
      const common = commonRes.data.rateLimit;
      setCommonRateLimit(common || null);
      if (common) {
        setRlForm({ maxTokens: String(common.maxTokens), window: common.window });
      } else {
        setRlForm({ maxTokens: '100000', window: 'DAY' });
      }
      setUserRateLimits(userRes.data.rateLimits || []);
    } catch (err) {
      console.error('Failed to load rate limits:', err);
    } finally {
      setRateLimitLoading(false);
    }
  };

  const handleSaveCommonRateLimit = async () => {
    if (!rateLimitTarget) return;
    const maxTokens = parseInt(rlForm.maxTokens);
    if (isNaN(maxTokens) || maxTokens < 1) return;
    setRateLimitSaving(true);
    try {
      await serviceRateLimitScopedApi.setCommon(rateLimitTarget.id, { maxTokens, window: rlForm.window, enabled: true });
      const res = await serviceRateLimitScopedApi.getCommon(rateLimitTarget.id);
      setCommonRateLimit(res.data.rateLimit || null);
    } catch (err) {
      console.error('Failed to save common rate limit:', err);
    } finally {
      setRateLimitSaving(false);
    }
  };

  const handleRemoveCommonRateLimit = async () => {
    if (!rateLimitTarget || !commonRateLimit) return;
    setRateLimitSaving(true);
    try {
      await serviceRateLimitScopedApi.removeCommon(rateLimitTarget.id);
      setCommonRateLimit(null);
    } catch (err) {
      console.error('Failed to remove common rate limit:', err);
    } finally {
      setRateLimitSaving(false);
    }
  };

  const handleSaveUserRateLimit = async (userId: string) => {
    if (!rateLimitTarget) return;
    const maxTokens = parseInt(rlUserForm.maxTokens);
    if (isNaN(maxTokens) || maxTokens < 1) return;
    setRateLimitSaving(true);
    try {
      await serviceRateLimitScopedApi.setUser(rateLimitTarget.id, userId, { maxTokens, window: rlUserForm.window, enabled: true });
      const res = await serviceRateLimitScopedApi.list(rateLimitTarget.id);
      setUserRateLimits(res.data.rateLimits || []);
      setRlEditUserId(null);
    } catch (err) {
      console.error('Failed to save user rate limit:', err);
    } finally {
      setRateLimitSaving(false);
    }
  };

  const handleRemoveUserRateLimit = async (userId: string) => {
    if (!rateLimitTarget) return;
    setRateLimitSaving(true);
    try {
      await serviceRateLimitScopedApi.removeUser(rateLimitTarget.id, userId);
      setUserRateLimits((prev) => prev.filter((r) => r.userId !== userId));
    } catch (err) {
      console.error('Failed to remove user rate limit:', err);
    } finally {
      setRateLimitSaving(false);
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  };

  // ── Role display helpers ──

  const roleIcon = (role: string) => {
    switch (role) {
      case 'OWNER': return <Crown className="w-3 h-3" />;
      case 'ADMIN': return <Shield className="w-3 h-3" />;
      default: return <User className="w-3 h-3" />;
    }
  };

  const roleLabel = (role: string) => {
    switch (role) {
      case 'OWNER': return '소유자';
      case 'ADMIN': return '서비스 관리자';
      default: return '사용자';
    }
  };

  const roleBadgeClass = (role: string) => {
    switch (role) {
      case 'OWNER': return 'bg-amber-50 text-amber-700';
      case 'ADMIN': return 'bg-blue-50 text-blue-700';
      default: return 'bg-gray-50 text-gray-600';
    }
  };

  // ── Already-member user IDs ──

  const memberUserIds = new Set(members.map((m) => m.userId));

  // ── Render ──

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-7 w-28 bg-gray-100 animate-pulse rounded" />
            <div className="h-4 w-64 bg-gray-50 animate-pulse rounded" />
          </div>
          <div className="h-9 w-36 bg-gray-100 animate-pulse rounded-lg" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {isSystemAdmin ? '서비스 관리' : '내 서비스'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isSystemAdmin
              ? '서비스를 관리하고 모니터링합니다.'
              : '내가 등록한 서비스를 관리하고, 새 서비스를 만들 수 있습니다.'}
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          새 서비스 만들기
        </button>
      </div>

      {/* ── Tabs (System Admin only) ── */}
      {isSystemAdmin && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 -mt-2">
          {([
            { key: 'all' as ServiceTab, label: '전체', count: services.length },
            { key: 'created' as ServiceTab, label: '내가 만든 서비스', count: services.filter(s => s._isCreator).length },
            { key: 'team' as ServiceTab, label: '내 팀의 서비스', count: services.filter(s => s.registeredByDept === user.deptname).length },
            { key: 'service-admin' as ServiceTab, label: '내가 관리자인 서비스', count: services.filter(s => s._isServiceAdmin).length },
          ]).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                activeTab === key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
              }`}>
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Help text */}
      {!isSystemAdmin && (
        <p className="text-xs text-gray-400 leading-relaxed -mt-3">
          나의 서비스를 생성하고 관리합니다. 서비스 ID는 영문 소문자와 하이픈만 사용 가능하며, 생성 후 변경할 수 없습니다.
          배포 전에 모델 설정과 멤버를 구성하세요. 배포하면 서비스 마켓에 공개됩니다.
        </p>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Service cards grid ── */}
      {filteredServices.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredServices.map((service) => {
            const isBG = service.type === 'BACKGROUND';
            const isDev = service.status === 'DEVELOPMENT';
            const Icon = isBG ? Server : Cpu;

            return (
              <div
                key={service.id}
                className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all duration-150 flex flex-col"
              >
                <div className="p-5 flex-1 cursor-pointer" onClick={() => navigate(`/my-services/${service.id}`)}>
                  {/* Card header */}
                  <div className="flex items-start gap-3 mb-3">
                    {service.iconUrl ? (
                      <img src={service.iconUrl} alt="" className="w-10 h-10 rounded-lg flex-shrink-0" />
                    ) : (
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isBG ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        <Icon className="w-5 h-5" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {service.displayName}
                        </h3>
                        {/* Type badge */}
                        <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                          isBG ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {isBG ? 'BG' : 'STD'}
                        </span>
                        {/* Status badge */}
                        <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                          isDev
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-green-50 text-green-700'
                        }`}>
                          {isDev ? '개발중' : '배포됨'}
                        </span>
                        {/* Deploy scope badge */}
                        {!isDev && service.deployScope && (
                          <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                            service.deployScope === 'ALL'
                              ? 'bg-blue-50 text-blue-600'
                              : service.deployScope === 'BUSINESS_UNIT'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-green-50 text-green-700'
                          }`}>
                            {service.deployScope === 'ALL'
                              ? '전체 공개'
                              : service.deployScope === 'BUSINESS_UNIT'
                                ? `사업부: ${(service.deployScopeValue || []).join(', ')}`
                                : `팀: ${(service.deployScopeValue || []).join(', ')}`}
                          </span>
                        )}
                      </div>
                      <code className="text-xs text-gray-400 font-mono">{service.name}</code>
                      {/* Relationship badges (for system admins) */}
                      {isSystemAdmin && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {service._isCreator && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-700">
                              <Crown className="w-2.5 h-2.5" />소유자
                            </span>
                          )}
                          {service._isServiceAdmin && !service._isCreator && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-700">
                              <Shield className="w-2.5 h-2.5" />서비스 관리자
                            </span>
                          )}
                          {!service._isCreator && !service._isServiceAdmin && (
                            <span className="text-[10px] text-gray-400">
                              등록자: {service.registeredBy} ({service.registeredByDept})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 mb-3">
                    {service.description || '설명이 등록되지 않았습니다.'}
                  </p>

                  {/* Meta */}
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{formatDate(service.createdAt)}</span>
                    {service._count?.usageLogs !== undefined && (
                      <>
                        <span className="text-gray-300">&middot;</span>
                        <span>요청 {service._count.usageLogs.toLocaleString()}건</span>
                      </>
                    )}
                    {service.serviceModels && service.serviceModels.length > 0 && (
                      <>
                        <span className="text-gray-300">&middot;</span>
                        <span>모델 {service.serviceModels.length}개</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="border-t border-gray-100 px-5 py-3 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => navigate(`/my-services/${service.id}/models`)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    모델 설정
                  </button>
                  <button
                    onClick={() => openMemberModal(service)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                  >
                    <Users className="w-3.5 h-3.5" />
                    멤버 관리
                  </button>
                  <button
                    onClick={() => openRateLimitModal(service)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                  >
                    <Gauge className="w-3.5 h-3.5" />
                    Rate Limit
                  </button>
                  {isDev ? (
                    <button
                      onClick={() => openDeployModal(service)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-md hover:bg-green-100 transition-colors"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      배포하기
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUndeploy(service.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-md hover:bg-amber-100 transition-colors"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      배포 취소
                    </button>
                  )}
                  <button
                    onClick={() => openEditModal(service)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors ml-auto"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    수정
                  </button>
                  <button
                    onClick={() => handleDeleteService(service)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900 mb-1">
            {isSystemAdmin && activeTab !== 'all' ? '해당 조건의 서비스가 없습니다' : '등록된 서비스가 없습니다'}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            {isSystemAdmin && activeTab !== 'all'
              ? '다른 탭을 선택하거나 새 서비스를 만들어 보세요.'
              : '새 서비스를 만들어 AI 모델을 연동해 보세요.'}
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            새 서비스 만들기
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          Create / Edit Service Modal
         ══════════════════════════════════════════════════ */}
      {showServiceModal && (
        <ModalBackdrop onClose={closeServiceModal}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">
                {editingService ? '서비스 수정' : '새 서비스 만들기'}
              </h3>
              <button onClick={closeServiceModal} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name (code) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  서비스 코드 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  disabled={!!editingService}
                  placeholder="my-service"
                  className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors ${
                    editingService ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white text-gray-900'
                  }`}
                />
                <p className="mt-1 text-xs text-gray-400">영문 소문자, 숫자, 하이픈만 사용 (생성 후 변경 불가)</p>
              </div>

              {/* Display name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  표시 이름 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="내 AI 서비스"
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1 text-xs text-gray-400">사용자에게 보여지는 서비스 이름 (한글/영문 자유)</p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="서비스에 대한 간단한 설명 (예: 사내 문서 검색 AI 챗봇)"
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors resize-none"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">서비스 타입</label>
                <div className="relative">
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'STANDARD' | 'BACKGROUND' })}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors appearance-none pr-8"
                  >
                    <option value="STANDARD">표준 (STANDARD)</option>
                    <option value="BACKGROUND">백그라운드 (BACKGROUND)</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                <p className="mt-1 text-xs text-gray-400">표준: 일반 API 서비스 | 백그라운드: 비동기 배치 처리용 서비스</p>
              </div>
            </div>

            {/* Error */}
            {formError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {formError}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={closeServiceModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveService}
                disabled={formSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {formSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingService ? '저장' : '만들기'}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* ══════════════════════════════════════════════════
          Deploy Confirmation Modal
         ══════════════════════════════════════════════════ */}
      {deployTarget && (
        <ModalBackdrop onClose={() => !deploying && setDeployTarget(null)}>
          <div className="p-6">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                <Rocket className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">서비스 배포</h3>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  <strong className="text-gray-700">{deployTarget.displayName}</strong> 서비스를 배포하시겠습니까?
                  배포하면 서비스 마켓에 공개됩니다.
                </p>
              </div>
            </div>

            {/* Deploy scope selection */}
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">공개 범위</label>
                <div className="relative">
                  <select
                    value={deployScope}
                    onChange={(e) => {
                      const scope = e.target.value as 'ALL' | 'BUSINESS_UNIT' | 'TEAM';
                      setDeployScope(scope);
                      if (scope === 'BUSINESS_UNIT') {
                        setDeployScopeValue(deployTarget.registeredByBusinessUnit || deployTarget.registeredByDept || '');
                      } else if (scope === 'TEAM') {
                        setDeployScopeValue(deployTarget.registeredByDept || '');
                      } else {
                        setDeployScopeValue('');
                      }
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors appearance-none pr-8"
                  >
                    <option value="ALL">전체 공개 (ALL)</option>
                    <option value="BUSINESS_UNIT">사업부 공개 (BUSINESS_UNIT)</option>
                    <option value="TEAM">팀 공개 (TEAM)</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {deployScope !== 'ALL' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {deployScope === 'BUSINESS_UNIT' ? '사업부명' : '팀명'} (콤마로 구분하여 복수 입력 가능)
                  </label>
                  <input
                    type="text"
                    value={deployScopeValue}
                    onChange={(e) => setDeployScopeValue(e.target.value)}
                    placeholder={deployScope === 'BUSINESS_UNIT' ? '예: AI사업부, 플랫폼사업부' : '예: AI개발팀, 백엔드팀'}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
              )}

              <p className="text-xs text-gray-400 leading-relaxed">
                전체 공개: 모든 사용자에게 노출 | 사업부 공개: 같은 사업부 사용자에게만 노출 | 팀 공개: 같은 팀 사용자에게만 노출
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeployTarget(null)}
                disabled={deploying}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deploying && <Loader2 className="w-4 h-4 animate-spin" />}
                배포하기
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* ══════════════════════════════════════════════════
          Member Management Modal
         ══════════════════════════════════════════════════ */}
      {memberTarget && (
        <ModalBackdrop onClose={closeMemberModal}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-gray-900">멤버 관리</h3>
                <p className="text-sm text-gray-500 mt-0.5">{memberTarget.displayName}</p>
              </div>
              <button onClick={closeMemberModal} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {membersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
              </div>
            ) : (
              <>
                {/* Search & add user */}
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => handleSearchUsers(e.target.value)}
                      placeholder="사용자 검색 (이름 또는 ID)..."
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                    />
                    {searchLoading && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                    )}
                  </div>

                  {/* Search results dropdown */}
                  {searchResults.length > 0 && (
                    <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-sm max-h-40 overflow-y-auto">
                      {searchResults.map((u) => {
                        const alreadyMember = memberUserIds.has(u.id);
                        return (
                          <button
                            key={u.id}
                            onClick={() => !alreadyMember && handleAddMember(u.id)}
                            disabled={alreadyMember || memberActionLoading}
                            className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                              alreadyMember
                                ? 'text-gray-400 cursor-not-allowed bg-gray-50'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <div className="min-w-0">
                              <span className="font-medium">{u.username}</span>
                              <span className="text-gray-400 ml-1.5">{u.loginid}</span>
                              <span className="text-gray-300 mx-1">&middot;</span>
                              <span className="text-gray-400 text-xs">{u.deptname}</span>
                            </div>
                            {alreadyMember ? (
                              <span className="text-xs text-gray-400 flex-shrink-0">이미 멤버</span>
                            ) : (
                              <UserPlus className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Current members */}
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {members.length > 0 ? (
                    members.map((member) => {
                      const isOwner = member.role === 'OWNER';
                      return (
                        <div
                          key={member.id}
                          className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-medium text-gray-600">
                                {member.user.username.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-gray-900 truncate">
                                  {member.user.username}
                                </span>
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded ${roleBadgeClass(member.role)}`}>
                                  {roleIcon(member.role)}
                                  {roleLabel(member.role)}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400 truncate">
                                {member.user.loginid} &middot; {member.user.deptname}
                              </p>
                            </div>
                          </div>

                          {!isOwner && (
                            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                              {/* Role dropdown */}
                              <div className="relative">
                                <select
                                  value={member.role}
                                  onChange={(e) => handleChangeRole(member.userId, e.target.value)}
                                  disabled={memberActionLoading}
                                  className="text-xs px-2 py-1 border border-gray-200 rounded bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none pr-6 cursor-pointer"
                                >
                                  <option value="ADMIN">서비스 관리자</option>
                                  <option value="USER">사용자</option>
                                </select>
                                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                              </div>
                              {/* Remove */}
                              <button
                                onClick={() => handleRemoveMember(member.userId)}
                                disabled={memberActionLoading}
                                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                title="멤버 제거"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-6 text-sm text-gray-400">
                      등록된 멤버가 없습니다.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ModalBackdrop>
      )}

      {/* ══════════════════════════════════════════════════
          Rate Limit Modal
         ══════════════════════════════════════════════════ */}
      {rateLimitTarget && (
        <ModalBackdrop onClose={() => setRateLimitTarget(null)}>
          <div className="p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Rate Limit 설정</h3>
                <p className="text-xs text-gray-400 mt-0.5">{rateLimitTarget.displayName}</p>
              </div>
              <button onClick={() => setRateLimitTarget(null)} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {rateLimitLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-5">
                {/* ── 공통 Rate Limit ── */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">서비스 공통 제한</h4>
                  <p className="text-xs text-gray-400 mb-3">개별 설정이 없는 모든 사용자에게 적용됩니다.</p>

                  {commonRateLimit ? (
                    <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-gray-200 mb-3">
                      <div>
                        <span className="text-sm font-medium text-gray-900">{formatTokens(commonRateLimit.maxTokens)} 토큰</span>
                        <span className="text-xs text-gray-400 ml-2">/ {commonRateLimit.window === 'FIVE_HOURS' ? '5시간' : '24시간'}</span>
                      </div>
                      <button
                        onClick={handleRemoveCommonRateLimit}
                        disabled={rateLimitSaving}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors"
                      >
                        제거
                      </button>
                    </div>
                  ) : null}

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">최대 토큰</label>
                      <input
                        type="number"
                        value={rlForm.maxTokens}
                        onChange={(e) => setRlForm({ ...rlForm, maxTokens: e.target.value })}
                        min={1}
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-xs text-gray-500 mb-1">기간</label>
                      <select
                        value={rlForm.window}
                        onChange={(e) => setRlForm({ ...rlForm, window: e.target.value as 'FIVE_HOURS' | 'DAY' })}
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      >
                        <option value="FIVE_HOURS">5시간</option>
                        <option value="DAY">24시간</option>
                      </select>
                    </div>
                    <button
                      onClick={handleSaveCommonRateLimit}
                      disabled={rateLimitSaving}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {rateLimitSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : '저장'}
                    </button>
                  </div>
                </div>

                {/* ── 사용자별 Rate Limit ── */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">사용자별 제한</h4>
                  <p className="text-xs text-gray-400 mb-3">개별 제한이 공통 제한보다 우선합니다.</p>

                  {userRateLimits.length > 0 ? (
                    <div className="space-y-2">
                      {userRateLimits.map((rl) => (
                        <div key={rl.userId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-medium text-gray-900">{rl.user.username}</span>
                            <span className="text-xs text-gray-400 ml-1.5">{rl.user.loginid}</span>
                          </div>

                          {rlEditUserId === rl.userId ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                value={rlUserForm.maxTokens}
                                onChange={(e) => setRlUserForm({ ...rlUserForm, maxTokens: e.target.value })}
                                min={1}
                                className="w-24 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <select
                                value={rlUserForm.window}
                                onChange={(e) => setRlUserForm({ ...rlUserForm, window: e.target.value as 'FIVE_HOURS' | 'DAY' })}
                                className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="FIVE_HOURS">5h</option>
                                <option value="DAY">24h</option>
                              </select>
                              <button
                                onClick={() => handleSaveUserRateLimit(rl.userId)}
                                disabled={rateLimitSaving}
                                className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                저장
                              </button>
                              <button
                                onClick={() => setRlEditUserId(null)}
                                className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">{formatTokens(rl.maxTokens)} / {rl.window === 'FIVE_HOURS' ? '5h' : '24h'}</span>
                              <button
                                onClick={() => {
                                  setRlEditUserId(rl.userId);
                                  setRlUserForm({ maxTokens: String(rl.maxTokens), window: rl.window });
                                }}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                수정
                              </button>
                              <button
                                onClick={() => handleRemoveUserRateLimit(rl.userId)}
                                disabled={rateLimitSaving}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                제거
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-sm text-gray-400 bg-gray-50 rounded-lg">
                      사용자별 Rate Limit이 설정되지 않았습니다.
                    </div>
                  )}

                  <p className="text-xs text-gray-400 mt-3">
                    사용자별 Rate Limit은 멤버 관리에서 멤버를 추가한 뒤, 시스템 관리자 페이지 또는 이 화면에서 설정할 수 있습니다.
                  </p>
                </div>
              </div>
            )}
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
