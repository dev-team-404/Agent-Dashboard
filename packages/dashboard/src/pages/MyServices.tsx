import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Edit2, Rocket, Server, Cpu, X, Loader2,
  Layers, Trash2, ChevronDown,
  Crown, Shield, Link, Image,
  ArrowLeft, ArrowRight, Check, ExternalLink, FileText, Ticket
} from 'lucide-react';
import { api } from '../services/api';

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
  serviceUrl?: string;
  type: 'STANDARD' | 'BACKGROUND';
  status: 'DEVELOPMENT' | 'DEPLOYED';
  enabled: boolean;
  registeredBy?: string;
  registeredByDept?: string;
  registeredByBusinessUnit?: string;
  deployScope?: 'ALL' | 'BUSINESS_UNIT' | 'TEAM';
  deployScopeValue?: string[];
  targetMM?: number | null;
  serviceCategory?: string[];
  standardMD?: number | null;
  jiraTicket?: string | null;
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


interface ServiceFormData {
  name: string;
  displayName: string;
  description: string;
  type: 'STANDARD' | 'BACKGROUND';
  iconUrl: string;
  docsUrl: string;
  serviceUrl: string;
  targetMM: string;
  serviceCategory: string[];
  standardMD: string;
  jiraTicket: string;
}

const EMPTY_FORM: ServiceFormData = {
  name: '',
  displayName: '',
  description: '',
  type: 'STANDARD',
  iconUrl: '',
  docsUrl: '',
  serviceUrl: '',
  targetMM: '',
  serviceCategory: [],
  standardMD: '',
  jiraTicket: '',
};

const SERVICE_CATEGORIES = [
  '설계 자동화 및 최적화',
  '코드개발/분석/검증 지원',
  '디버깅 및 분석 자동화',
  '문서 및 요구사항 지능형 처리',
  'Agent플랫폼 및 개발 생태계',
  '데이터 기반 인사이트 및 대시보드',
  '인프라/도구/협력 요청',
];

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

  // Wizard states (creation only)
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);

  // Deploy modal
  const [deployTarget, setDeployTarget] = useState<Service | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployScope, setDeployScope] = useState<'ALL' | 'BUSINESS_UNIT' | 'TEAM'>('ALL');
  const [deployScopeValue, setDeployScopeValue] = useState('');


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

  const openCreateWizard = () => {
    setFormData(EMPTY_FORM);
    setFormError(null);
    setWizardStep(0);
    setShowWizard(true);
  };

  const closeWizard = () => {
    setShowWizard(false);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setWizardStep(0);
  };

  const openEditModal = (service: Service) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      displayName: service.displayName,
      description: service.description || '',
      type: service.type,
      iconUrl: service.iconUrl || '',
      docsUrl: service.docsUrl || '',
      serviceUrl: service.serviceUrl || '',
      targetMM: service.targetMM != null ? String(service.targetMM) : '',
      serviceCategory: service.serviceCategory || [],
      standardMD: service.standardMD != null ? String(service.standardMD) : '',
      jiraTicket: service.jiraTicket || '',
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

  const buildPayload = () => ({
    displayName: formData.displayName,
    description: formData.description || undefined,
    type: formData.type,
    iconUrl: formData.iconUrl.trim() || null,
    docsUrl: formData.docsUrl.trim() || null,
    serviceUrl: formData.serviceUrl.trim() || null,
    targetMM: formData.targetMM ? parseFloat(formData.targetMM) : null,
    serviceCategory: formData.serviceCategory.length > 0 ? formData.serviceCategory : [],
    standardMD: formData.standardMD ? parseFloat(formData.standardMD) : null,
    jiraTicket: formData.jiraTicket.trim() || null,
  });

  const handleSaveService = async () => {
    if (!formData.name.trim() || !formData.displayName.trim()) {
      setFormError('서비스 코드와 표시 이름은 필수입니다.');
      return;
    }

    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(formData.name) && formData.name.length > 1) {
      setFormError('서비스 코드는 영문 소문자, 숫자, 하이픈만 사용 가능합니다.');
      return;
    }

    setFormSaving(true);
    setFormError(null);

    try {
      if (editingService) {
        await api.put(`/services/${editingService.id}`, buildPayload());
      } else {
        await api.post('/services', { name: formData.name, ...buildPayload() });
      }
      if (editingService) closeServiceModal();
      else closeWizard();
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
          onClick={openCreateWizard}
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
          배포 전에 모델 설정과 멤버를 구성하세요. 배포하면 서비스 목록에 공개됩니다.
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
                  <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 mb-2">
                    {service.description || '설명이 등록되지 않았습니다.'}
                  </p>

                  {/* Category */}
                  {service.serviceCategory && service.serviceCategory.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {service.serviceCategory.map(cat => (
                        <span key={cat} className="inline-block px-2 py-0.5 text-[10px] font-medium text-gray-500 bg-gray-100 rounded">
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}

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

                {/* Shortcut buttons */}
                {(service.serviceUrl || service.docsUrl || service.jiraTicket) && (
                  <div className="border-t border-gray-100 px-5 py-2 flex items-center gap-1.5">
                    {service.serviceUrl && (
                      <a href={service.serviceUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors">
                        <ExternalLink className="w-3 h-3" />서비스
                      </a>
                    )}
                    {service.docsUrl && (
                      <a href={service.docsUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors">
                        <FileText className="w-3 h-3" />문서
                      </a>
                    )}
                    {service.jiraTicket && (
                      <a href={service.jiraTicket} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-600 bg-violet-50 rounded hover:bg-violet-100 transition-colors">
                        <Ticket className="w-3 h-3" />Jira
                      </a>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="border-t border-gray-100 px-5 py-3 flex items-center gap-2 flex-wrap">
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
            onClick={openCreateWizard}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            새 서비스 만들기
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          Edit Service Modal (popup)
         ══════════════════════════════════════════════════ */}
      {showServiceModal && editingService && (
        <ModalBackdrop onClose={closeServiceModal}>
          <div className="p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">서비스 수정</h3>
              <button onClick={closeServiceModal} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">서비스 코드</label>
                <input type="text" value={formData.name} disabled className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">표시 이름 <span className="text-red-500">*</span></label>
                <input type="text" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={2} className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">서비스 타입</label>
                  <div className="relative">
                    <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as 'STANDARD' | 'BACKGROUND' })} className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                      <option value="STANDARD">표준 — UI 있음 (ex. Chatbot)</option>
                      <option value="BACKGROUND">백그라운드 — 자동 실행 (ex. Auto Code Review)</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리 (복수 선택)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SERVICE_CATEGORIES.map(cat => {
                      const selected = formData.serviceCategory.includes(cat);
                      return (
                        <button key={cat} type="button"
                          onClick={() => setFormData({ ...formData, serviceCategory: selected ? formData.serviceCategory.filter(c => c !== cat) : [...formData.serviceCategory, cat] })}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${selected ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">목표 MM</label>
                  <input type="number" step="0.1" min="0" value={formData.targetMM} onChange={(e) => setFormData({ ...formData, targetMM: e.target.value })} placeholder="예: 3.5" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
                {formData.type === 'BACKGROUND' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Standard M/D</label>
                    <input type="number" step="0.01" min="0" value={formData.standardMD} onChange={(e) => setFormData({ ...formData, standardMD: e.target.value })} placeholder="예: 0.1" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><Image className="w-3.5 h-3.5" /> 로고 URL</span></label>
                <input type="url" value={formData.iconUrl} onChange={(e) => setFormData({ ...formData, iconUrl: e.target.value })} placeholder="https://example.com/logo.png" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><Link className="w-3.5 h-3.5" /> 서비스 URL</span></label>
                  <input type="url" value={formData.serviceUrl} onChange={(e) => setFormData({ ...formData, serviceUrl: e.target.value })} placeholder="https://my-service.example.com" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> API 문서 URL</span></label>
                  <input type="url" value={formData.docsUrl} onChange={(e) => setFormData({ ...formData, docsUrl: e.target.value })} placeholder="https://docs.example.com/api" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><Ticket className="w-3.5 h-3.5" /> Jira 티켓</span></label>
                  <input type="url" value={formData.jiraTicket} onChange={(e) => setFormData({ ...formData, jiraTicket: e.target.value })} placeholder="https://jira.example.com/browse/PROJ-123" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
              </div>
            </div>
            {formError && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeServiceModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleSaveService} disabled={formSaving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {formSaving && <Loader2 className="w-4 h-4 animate-spin" />}저장
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* ══════════════════════════════════════════════════
          Create Service Wizard (full-page overlay)
         ══════════════════════════════════════════════════ */}
      {showWizard && <ServiceCreationWizard
        formData={formData}
        setFormData={setFormData}
        wizardStep={wizardStep}
        setWizardStep={setWizardStep}
        formError={formError}
        setFormError={setFormError}
        formSaving={formSaving}
        onSave={handleSaveService}
        onClose={closeWizard}
      />}

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
                  배포하면 서비스 목록에 공개됩니다.
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

    </div>
  );
}

// ══════════════════════════════════════════════════
// Service Creation Wizard Component
// ══════════════════════════════════════════════════

const WIZARD_STEPS = [
  { title: '기본 정보', desc: '서비스 코드와 이름을 설정합니다' },
  { title: '서비스 분류', desc: '타입과 카테고리를 선택합니다' },
  { title: '서비스 목표', desc: '목표 공수와 표준 M/D를 입력합니다' },
  { title: '링크 설정', desc: '관련 URL을 등록합니다 (선택)' },
  { title: '확인', desc: '입력한 정보를 확인하고 등록합니다' },
];

function ServiceCreationWizard({
  formData, setFormData, wizardStep, setWizardStep,
  formError, setFormError, formSaving, onSave, onClose,
}: {
  formData: ServiceFormData;
  setFormData: (d: ServiceFormData) => void;
  wizardStep: number;
  setWizardStep: (s: number) => void;
  formError: string | null;
  setFormError: (e: string | null) => void;
  formSaving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const canNext = (): boolean => {
    switch (wizardStep) {
      case 0: return !!(formData.name.trim() && formData.displayName.trim());
      case 1: return formData.serviceCategory.length > 0;
      case 2: return !!(formData.targetMM);
      default: return true;
    }
  };

  const handleNext = () => {
    setFormError(null);
    if (wizardStep === 0) {
      if (!formData.name.trim() || !formData.displayName.trim()) {
        setFormError('서비스 코드와 표시 이름은 필수입니다.');
        return;
      }
      if (formData.name.length > 1 && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(formData.name)) {
        setFormError('서비스 코드는 영문 소문자로 시작/끝, 하이픈 사용 가능');
        return;
      }
    }
    if (wizardStep === 1 && formData.serviceCategory.length === 0) {
      setFormError('서비스 카테고리를 1개 이상 선택해주세요.');
      return;
    }
    if (wizardStep === 2 && !formData.targetMM) {
      setFormError('목표 MM을 입력해주세요.');
      return;
    }
    setWizardStep(wizardStep + 1);
  };

  const inputClass = "w-full px-3.5 py-2.5 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors";

  return (
    <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">새 서비스 등록</h2>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {WIZARD_STEPS.map((step, i) => (
              <div key={i} className="flex items-center flex-1">
                <button
                  onClick={() => { if (i < wizardStep) setWizardStep(i); }}
                  className={`flex items-center gap-1.5 ${i <= wizardStep ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                    i < wizardStep ? 'bg-green-500 text-white' : i === wizardStep ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {i < wizardStep ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-xs font-medium truncate hidden sm:block ${i === wizardStep ? 'text-blue-600' : 'text-gray-400'}`}>
                    {step.title}
                  </span>
                </button>
                {i < WIZARD_STEPS.length - 1 && (
                  <div className={`h-px flex-1 mx-1 ${i < wizardStep ? 'bg-green-300' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-5">
            <h3 className="text-base font-semibold text-gray-900">{WIZARD_STEPS[wizardStep].title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{WIZARD_STEPS[wizardStep].desc}</p>
          </div>

          {/* Step 0: 기본 정보 */}
          {wizardStep === 0 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">서비스 코드 <span className="text-red-500">*</span></label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  placeholder="my-ai-service" className={inputClass} />
                <p className="mt-1.5 text-xs text-gray-400">API 호출 시 사용되는 고유 식별자입니다. 영문 소문자, 숫자, 하이픈만 사용 가능하며 생성 후 변경할 수 없습니다.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">표시 이름 <span className="text-red-500">*</span></label>
                <input type="text" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="내 AI 서비스" className={inputClass} />
                <p className="mt-1.5 text-xs text-gray-400">대시보드와 서비스 목록에 표시되는 이름입니다. 한글/영문 자유롭게 입력하세요.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">설명 <span className="text-red-500">*</span></label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="서비스에 대한 간단한 설명 (예: 사내 문서 검색 AI 챗봇)" rows={3} className={`${inputClass} resize-none`} />
              </div>
            </div>
          )}

          {/* Step 1: 서비스 분류 */}
          {wizardStep === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">서비스 타입 <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {([['STANDARD', '표준 (Standard)', 'UI가 있어 사용자가 직접 조작·소통하는 서비스 (ex. Chatbot)', Cpu],
                     ['BACKGROUND', '백그라운드 (Background)', 'UI 없이 일정 조건에 의해 자동으로 돌아가는 서비스 (ex. Auto Code Review)', Server]] as const).map(([val, label, desc, Icon]) => (
                    <button key={val} onClick={() => setFormData({ ...formData, type: val as 'STANDARD' | 'BACKGROUND' })}
                      className={`p-4 rounded-lg border-2 text-left transition-all ${formData.type === val ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon className={`w-4 h-4 ${formData.type === val ? 'text-blue-600' : 'text-gray-400'}`} />
                        <span className={`text-sm font-semibold ${formData.type === val ? 'text-blue-700' : 'text-gray-700'}`}>{label}</span>
                      </div>
                      <p className="text-xs text-gray-500">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">서비스 카테고리 <span className="text-red-500">*</span> <span className="text-xs text-gray-400 font-normal">(복수 선택 가능)</span></label>
                <p className="text-xs text-gray-400 mb-3">서비스의 주요 목적에 맞는 카테고리를 모두 선택해주세요.</p>
                <div className="grid grid-cols-1 gap-2">
                  {SERVICE_CATEGORIES.map((cat) => {
                    const selected = formData.serviceCategory.includes(cat);
                    return (
                      <button key={cat} onClick={() => setFormData({ ...formData, serviceCategory: selected ? formData.serviceCategory.filter(c => c !== cat) : [...formData.serviceCategory, cat] })}
                        className={`px-4 py-3 rounded-lg border text-left text-sm transition-all ${selected ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'}`}>
                        {selected && <Check className="w-4 h-4 inline mr-2 text-blue-500" />}
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 서비스 목표 */}
          {wizardStep === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">목표 MM (Men/Month) <span className="text-red-500">*</span></label>
                <input type="number" step="0.1" min="0" value={formData.targetMM} onChange={(e) => setFormData({ ...formData, targetMM: e.target.value })}
                  placeholder="예: 3.5" className={inputClass} />
                <p className="mt-1.5 text-xs text-gray-400">이 서비스가 절감하거나 대체할 것으로 예상되는 인력 공수입니다.</p>
              </div>
              {formData.type === 'BACKGROUND' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Standard M/D (Man/Day) <span className="text-red-500">*</span></label>
                  <input type="number" step="0.01" min="0" value={formData.standardMD} onChange={(e) => setFormData({ ...formData, standardMD: e.target.value })}
                    placeholder="예: 0.1" className={inputClass} />
                  <p className="mt-1.5 text-xs text-gray-400">해당 작업을 숙련된 인간이 수행 시 소요되는 표준 공수입니다. 예: 코드 리뷰 1건 = 0.1 M/D</p>
                </div>
              )}
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                <p className="text-xs text-blue-700 leading-relaxed">
                  <strong>MM (Men/Month)</strong>은 서비스의 사업적 가치를 측정하는 핵심 지표입니다.
                  AI 서비스가 자동화하는 업무량을 인력 기준으로 환산하여 입력해주세요.
                  {formData.type === 'BACKGROUND' && (
                    <><br /><br /><strong>Standard M/D</strong>는 백그라운드 서비스가 처리하는 단위 작업의 인간 기준 소요 공수입니다.
                    서비스의 처리 건수와 곱하여 총 절감 공수를 산출하는 데 사용됩니다.</>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Step 3: 링크 설정 */}
          {wizardStep === 3 && (
            <div className="space-y-5">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 mb-2">
                <p className="text-xs text-gray-500">아래 항목은 모두 선택사항입니다. 나중에 수정할 수 있습니다.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><Image className="w-3.5 h-3.5" /> 로고 URL</span></label>
                <input type="url" value={formData.iconUrl} onChange={(e) => setFormData({ ...formData, iconUrl: e.target.value })}
                  placeholder="https://example.com/logo.png" className={inputClass} />
                {formData.iconUrl.trim() && (
                  <div className="mt-2 flex items-center gap-2">
                    <img src={formData.iconUrl.trim()} alt="" className="w-8 h-8 rounded-lg border border-gray-200 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span className="text-xs text-gray-400">미리보기</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> 서비스 URL</span></label>
                <input type="url" value={formData.serviceUrl} onChange={(e) => setFormData({ ...formData, serviceUrl: e.target.value })}
                  placeholder="https://my-service.example.com" className={inputClass} />
                <p className="mt-1.5 text-xs text-gray-400">서비스 목록과 카드에 바로가기 버튼으로 연결됩니다</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> API 문서 URL</span></label>
                <input type="url" value={formData.docsUrl} onChange={(e) => setFormData({ ...formData, docsUrl: e.target.value })}
                  placeholder="https://docs.example.com/api" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><Ticket className="w-3.5 h-3.5" /> Jira 티켓</span></label>
                <input type="url" value={formData.jiraTicket} onChange={(e) => setFormData({ ...formData, jiraTicket: e.target.value })}
                  placeholder="https://jira.example.com/browse/PROJ-123" className={inputClass} />
              </div>
            </div>
          )}

          {/* Step 4: 확인 */}
          {wizardStep === 4 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
                {([
                  ['서비스 코드', formData.name],
                  ['표시 이름', formData.displayName],
                  ['설명', formData.description || '-'],
                  ['서비스 타입', formData.type === 'STANDARD' ? '표준 (Standard)' : '백그라운드 (Background)'],
                  ['카테고리', formData.serviceCategory.length > 0 ? formData.serviceCategory.join(', ') : '-'],
                  ['목표 MM', formData.targetMM ? `${formData.targetMM} MM` : '-'],
                  ...(formData.type === 'BACKGROUND' ? [['Standard M/D', formData.standardMD ? `${formData.standardMD} M/D` : '-']] : []),
                  ['로고 URL', formData.iconUrl || '-'],
                  ['서비스 URL', formData.serviceUrl || '-'],
                  ['API 문서 URL', formData.docsUrl || '-'],
                  ['Jira 티켓', formData.jiraTicket || '-'],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-start px-4 py-3">
                    <span className="text-xs font-medium text-gray-500 w-28 flex-shrink-0 pt-0.5">{label}</span>
                    <span className="text-sm text-gray-900 break-all">{value}</span>
                  </div>
                ))}
              </div>
              <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                <p className="text-sm text-green-700">위 정보로 서비스를 등록합니다. 등록 후 모델 연동, 멤버 추가 등 추가 설정을 진행할 수 있습니다.</p>
              </div>
            </div>
          )}

          {formError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button onClick={wizardStep === 0 ? onClose : () => setWizardStep(wizardStep - 1)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" />
            {wizardStep === 0 ? '취소' : '이전'}
          </button>
          {wizardStep < WIZARD_STEPS.length - 1 ? (
            <button onClick={handleNext} disabled={!canNext()}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              다음 <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={onSave} disabled={formSaving}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {formSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              서비스 등록
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
