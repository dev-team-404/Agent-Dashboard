import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus, Edit2, Rocket, Server, Cpu, X, Loader2,
  Layers, Trash2, ChevronDown, Search,
  Crown, Shield, Link, Image, RefreshCw, Upload,
  ArrowLeft, ArrowRight, Check, ExternalLink, FileText, Ticket
} from 'lucide-react';
import { api, serviceApi } from '../services/api';
import OrgTreeSelector from '../components/OrgTreeSelector';
import { useOrgCodeResolver } from '../hooks/useOrgCodeResolver';
import ServiceGuide from '../components/Tour/ServiceGuide';
import { BookOpen } from 'lucide-react';

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
  apiOnly?: boolean;
  status: 'DEVELOPMENT' | 'DEPLOYED';
  enabled: boolean;
  registeredBy?: string;
  registeredByDept?: string;
  registeredByBusinessUnit?: string;
  team?: string;
  center2Name?: string;
  center1Name?: string;
  deployScope?: 'ALL' | 'BUSINESS_UNIT' | 'TEAM';
  deployScopeValue?: string[];
  targetMM?: number | null;
  serviceCategory?: string[];
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


interface EmployeeSearchResult {
  loginid: string;
  username: string;
  deptname: string;
}

interface ServiceFormData {
  name: string;
  displayName: string;
  description: string;
  type: 'STANDARD' | 'BACKGROUND';
  apiOnly: boolean;
  iconUrl: string;
  docsUrl: string;
  serviceUrl: string;
  serviceCategory: string[];
  jiraTicket: string;
  registeredBy: string;
  registeredByName: string;
  registeredByDept: string;
  deployScope: 'ALL' | 'TEAM';
  deployScopeValue: string[];
}

const EMPTY_FORM: ServiceFormData = {
  name: '',
  displayName: '',
  description: '',
  type: 'STANDARD',
  apiOnly: false,
  iconUrl: '',
  docsUrl: '',
  serviceUrl: '',
  serviceCategory: [],
  jiraTicket: '',
  registeredBy: '',
  registeredByName: '',
  registeredByDept: '',
  deployScope: 'ALL',
  deployScopeValue: [],
};

const SERVICE_CATEGORY_KEYS = [
  'categoryDesignAutomation',
  'categoryCodeDev',
  'categoryDebugging',
  'categoryDocuments',
  'categoryAgentPlatform',
  'categoryDataInsight',
  'categoryInfra',
] as const;

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
  const { t } = useTranslation();
  const { summarizeScope } = useOrgCodeResolver();
  const isSystemAdmin = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';
  const SERVICE_CATEGORIES = SERVICE_CATEGORY_KEYS.map(k => t(`myServices.${k}`));
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
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Wizard states (creation only)
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [showGuide, setShowGuide] = useState(false);

  // Owner search states
  const [showOwnerSearch, setShowOwnerSearch] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerResults, setOwnerResults] = useState<EmployeeSearchResult[]>([]);
  const [ownerSearching, setOwnerSearching] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<EmployeeSearchResult | null>(null);

  // Deploy modal
  const [deployTarget, setDeployTarget] = useState<Service | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployScope, setDeployScope] = useState<'ALL' | 'TEAM'>('ALL');
  const [deployScopeValue, setDeployScopeValue] = useState<string[]>([]);


  // ── Load services ──

  const loadServices = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/services/my');
      setServices(res.data.services || []);
    } catch (err: unknown) {
      console.error('Failed to load services:', err);
      setError(t('myServices.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  // ── Owner search ──

  const handleOwnerSearch = async () => {
    if (!ownerQuery || ownerQuery.length < 2) return;
    setOwnerSearching(true);
    setSelectedOwner(null);
    try {
      const res = await api.get(`/services/employees/search?q=${encodeURIComponent(ownerQuery)}`);
      setOwnerResults(res.data.employees || []);
    } catch {
      setOwnerResults([]);
    } finally {
      setOwnerSearching(false);
    }
  };

  const confirmOwnerChange = () => {
    if (!selectedOwner) return;
    setFormData({ ...formData, registeredBy: selectedOwner.loginid, registeredByName: selectedOwner.username, registeredByDept: selectedOwner.deptname });
    setShowOwnerSearch(false);
    setOwnerQuery('');
    setOwnerResults([]);
    setSelectedOwner(null);
  };

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

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    try {
      const res = await serviceApi.uploadLogo(file);
      setFormData(prev => ({ ...prev, iconUrl: res.data.iconUrl }));
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setUploadingLogo(false);
    }
  };

  const openEditModal = (service: Service) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      displayName: service.displayName,
      description: service.description || '',
      type: service.type,
      apiOnly: service.apiOnly || false,
      iconUrl: service.iconUrl || '',
      docsUrl: service.docsUrl || '',
      serviceUrl: service.serviceUrl || '',
      serviceCategory: service.serviceCategory || [],
      jiraTicket: service.jiraTicket || '',
      registeredBy: service.registeredBy || '',
      registeredByName: '',
      registeredByDept: service.registeredByDept || '',
      deployScope: (service.deployScope === 'BUSINESS_UNIT' ? 'TEAM' : service.deployScope || 'ALL') as 'ALL' | 'TEAM',
      deployScopeValue: service.deployScopeValue || [],
    });
    setShowOwnerSearch(false);
    setOwnerQuery('');
    setOwnerResults([]);
    setSelectedOwner(null);
    setFormError(null);
    setShowServiceModal(true);
  };

  const closeServiceModal = () => {
    setShowServiceModal(false);
    setEditingService(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setShowOwnerSearch(false);
    setOwnerQuery('');
    setOwnerResults([]);
    setSelectedOwner(null);
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      displayName: formData.displayName,
      description: formData.description || undefined,
      type: formData.type,
      apiOnly: formData.apiOnly,
      iconUrl: formData.iconUrl.trim() || null,
      docsUrl: formData.docsUrl.trim() || null,
      serviceUrl: formData.serviceUrl.trim() || null,
      serviceCategory: formData.serviceCategory.length > 0 ? formData.serviceCategory : [],
      jiraTicket: formData.jiraTicket.trim() || null,
    };
    // 수정 시: name, registeredBy, deployScope 포함
    if (editingService) {
      if (formData.name !== editingService.name) payload.name = formData.name;
      if (formData.registeredBy && formData.registeredBy !== editingService.registeredBy) {
        payload.registeredBy = formData.registeredBy;
      }
      // 배포 중인 서비스: 공개범위 변경 포함
      if (editingService.status === 'DEPLOYED') {
        payload.deployScope = formData.deployScope === 'ALL' ? 'ALL' : 'TEAM';
        payload.deployScopeValue = formData.deployScope !== 'ALL' ? formData.deployScopeValue : [];
      }
    }
    return payload;
  };

  const handleSaveService = async () => {
    if (!formData.name.trim() || !formData.displayName.trim()) {
      setFormError(t('myServices.codeAndNameRequired'));
      return;
    }

    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(formData.name) && formData.name.length > 1) {
      setFormError(t('myServices.codeInvalidChars'));
      return;
    }

    setFormSaving(true);
    setFormError(null);

    try {
      if (editingService) {
        await api.put(`/services/${editingService.id}`, buildPayload());
      } else {
        const createRes = await api.post('/services', { name: formData.name, ...buildPayload() });
        const newServiceId = createRes.data?.id || createRes.data?.service?.id;
        window.dispatchEvent(new CustomEvent('service-guide-success', {
          detail: { id: newServiceId, name: formData.name, displayName: formData.displayName, description: formData.description, type: formData.type },
        }));
      }
      if (editingService) closeServiceModal();
      else closeWizard();
      await loadServices();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      window.dispatchEvent(new CustomEvent('service-guide-error', { detail: { error: msg || t('myServices.saveFailed') } }));
      setFormError(msg || t('myServices.saveFailed'));
    } finally {
      setFormSaving(false);
    }
  };

  // ── Deploy ──

  const openDeployModal = (service: Service) => {
    setDeployTarget(service);
    // Pre-fill scope from existing service data or default to ALL
    const scope = service.deployScope || 'ALL';
    setDeployScope(scope === 'BUSINESS_UNIT' ? 'TEAM' : scope as 'ALL' | 'TEAM');
    setDeployScopeValue(service.deployScopeValue || []);
  };

  const handleDeploy = async () => {
    if (!deployTarget) return;
    setDeploying(true);
    try {
      await api.post(`/services/${deployTarget.id}/deploy`, {
        deployScope: deployScope === 'ALL' ? 'ALL' : 'TEAM',
        deployScopeValue: deployScope !== 'ALL' ? deployScopeValue : [],
      });
      setDeployTarget(null);
      await loadServices();
    } catch (err: unknown) {
      console.error('Deploy failed:', err);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || t('myServices.deployFailed'));
    } finally {
      setDeploying(false);
    }
  };

  const handleUndeploy = async (serviceId: string) => {
    if (!confirm(t('myServices.undeployConfirm'))) return;
    try {
      await api.post(`/services/${serviceId}/undeploy`);
      await loadServices();
    } catch (err: unknown) {
      console.error('Undeploy failed:', err);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || t('myServices.undeployFailed'));
    }
  };

  // ── Delete service ──

  const handleDeleteService = async (service: Service) => {
    const usageCount = service._count?.usageLogs || 0;
    const message = usageCount > 0
      ? t('myServices.deleteConfirmWithUsage', { name: service.displayName, count: usageCount.toLocaleString() })
      : t('myServices.deleteConfirm', { name: service.displayName });
    if (!confirm(message)) return;
    try {
      await api.delete(`/services/${service.id}${usageCount > 0 ? '?force=true' : ''}`);
      await loadServices();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || t('myServices.deleteFailed'));
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
            {isSystemAdmin ? t('myServices.serviceManagement') : t('myServices.myServices')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isSystemAdmin
              ? t('myServices.serviceManagementDesc')
              : t('myServices.myServicesDesc')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGuide(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-blue-600 bg-blue-50 border border-blue-200 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            {t('myServices.registrationGuide')}
          </button>
          <button
            onClick={openCreateWizard}
            data-tour="my-services-create-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('myServices.createService')}
          </button>
        </div>
      </div>

      {/* ── Tabs (System Admin only) ── */}
      {isSystemAdmin && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 -mt-2">
          {([
            { key: 'all' as ServiceTab, label: t('myServices.tabAll'), count: services.length },
            { key: 'created' as ServiceTab, label: t('myServices.tabCreated'), count: services.filter(s => s._isCreator).length },
            { key: 'team' as ServiceTab, label: t('myServices.tabTeam'), count: services.filter(s => s.registeredByDept === user.deptname).length },
            { key: 'service-admin' as ServiceTab, label: t('myServices.tabServiceAdmin'), count: services.filter(s => s._isServiceAdmin).length },
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
          {t('myServices.helpText')}
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
                        {/* API Only badge */}
                        {service.apiOnly && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-600">
                            API Only
                          </span>
                        )}
                        {/* Status badge */}
                        <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                          isDev
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-green-50 text-green-700'
                        }`}>
                          {isDev ? t('myServices.developing') : t('myServices.deployed')}
                        </span>
                        {/* Deploy scope badge */}
                        {!isDev && service.deployScope === 'ALL' && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-600">
                            {t('myServices.publicScope')}
                          </span>
                        )}
                        {!isDev && service.deployScope && service.deployScope !== 'ALL' &&
                          summarizeScope(service.deployScopeValue || []).map((item, idx) => (
                            <span key={idx} className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                              item.isAll ? 'bg-purple-50 text-purple-700' : 'bg-green-50 text-green-700'
                            }`}>
                              {item.label}
                            </span>
                          ))
                        }
                      </div>
                      <code className="text-xs text-gray-400 font-mono">{service.name}</code>
                      {/* Relationship badges (for system admins) */}
                      {isSystemAdmin && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {service._isCreator && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-700">
                              <Crown className="w-2.5 h-2.5" />{t('myServices.owner')}
                            </span>
                          )}
                          {service._isServiceAdmin && !service._isCreator && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-700">
                              <Shield className="w-2.5 h-2.5" />{t('myServices.serviceAdmin')}
                            </span>
                          )}
                          {!service._isCreator && !service._isServiceAdmin && (
                            <span className="text-[10px] text-gray-400">
                              {t('myServices.registeredBy', { id: service.registeredBy, dept: service.registeredByDept })}
                            </span>
                          )}
                          {(() => {
                            const parts = [service.center1Name, service.center2Name, service.team]
                              .filter(v => v && v !== 'none');
                            return parts.length > 0 ? (
                              <span className="text-[10px] text-gray-400">
                                {parts.join(' > ')}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 mb-2">
                    {service.description || t('myServices.noDescription')}
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
                        <span>{t('myServices.requestCount', { count: service._count.usageLogs.toLocaleString() })}</span>
                      </>
                    )}
                    {service.serviceModels && service.serviceModels.length > 0 && (
                      <>
                        <span className="text-gray-300">&middot;</span>
                        <span>{t('myServices.modelCount', { count: service.serviceModels.length })}</span>
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
                        <ExternalLink className="w-3 h-3" />{t('myServices.serviceLink')}
                      </a>
                    )}
                    {service.docsUrl && (
                      <a href={service.docsUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors">
                        <FileText className="w-3 h-3" />{t('myServices.docsLink')}
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
                      {t('myServices.deploy')}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUndeploy(service.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-md hover:bg-amber-100 transition-colors"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      {t('myServices.undeploy')}
                    </button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const btn = e.currentTarget;
                      btn.disabled = true;
                      btn.textContent = t('myServices.generating');
                      try {
                        const res = await serviceApi.regenerateLogo(service.id);
                        // 카드의 아이콘 즉시 반영
                        service.iconUrl = res.data.iconUrl;
                        loadServices();
                      } catch (err) {
                        console.error('Logo regen failed:', err);
                      } finally {
                        btn.disabled = false;
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-pink-600 bg-pink-50 rounded-md hover:bg-pink-100 transition-colors"
                    title={t('myServices.logoRegenTitle')}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('myServices.logo')}
                  </button>
                  <button
                    onClick={() => openEditModal(service)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors ml-auto"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => handleDeleteService(service)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('common.delete')}
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
            {isSystemAdmin && activeTab !== 'all' ? t('myServices.noServicesFiltered') : t('myServices.noServices')}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            {isSystemAdmin && activeTab !== 'all'
              ? t('myServices.noServicesFilteredDesc')
              : t('myServices.noServicesDesc')}
          </p>
          <button
            onClick={openCreateWizard}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('myServices.createService')}
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
              <h3 className="text-base font-semibold text-gray-900">{t('myServices.editService')}</h3>
              <button onClick={closeServiceModal} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {/* DEPLOYED 상태 안내 */}
            {editingService.status === 'DEPLOYED' && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-700">{t('myServices.deployedNotice')}</p>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('myServices.serviceCode')}</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} disabled={editingService.status === 'DEPLOYED'} className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono ${editingService.status === 'DEPLOYED' ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`} />
                <p className="mt-1 text-xs text-gray-400">{t('myServices.serviceCodeHint')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('myServices.displayName')} <span className="text-red-500">*</span></label>
                <input type="text" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} disabled={editingService.status === 'DEPLOYED'} className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${editingService.status === 'DEPLOYED' ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`} />
              </div>
              {/* 소유자 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><Crown className="w-3.5 h-3.5" /> {t('myServices.ownerLabel')}</span></label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                    {formData.registeredBy || t('myServices.noOwner')}
                    {formData.registeredByDept && <span className="text-gray-400 ml-1">— {formData.registeredByDept}</span>}
                  </div>
                  <button type="button" onClick={() => { setShowOwnerSearch(true); setOwnerQuery(''); setOwnerResults([]); setSelectedOwner(null); }}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap">
                    <Search className="w-3.5 h-3.5" /> {t('myServices.change')}
                  </button>
                </div>
                {/* 소유자 검색 패널 */}
                {showOwnerSearch && (
                  <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={ownerQuery}
                        onChange={(e) => setOwnerQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleOwnerSearch()}
                        placeholder={t('myServices.ownerSearchPlaceholder')}
                        className="flex-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        autoFocus
                      />
                      <button type="button" onClick={handleOwnerSearch} disabled={ownerSearching || ownerQuery.length < 2}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap">
                        {ownerSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} {t('common.search')}
                      </button>
                    </div>
                    {ownerResults.length > 0 && (
                      <div className="border border-gray-200 rounded-lg bg-white max-h-40 overflow-y-auto divide-y divide-gray-100">
                        {ownerResults.map((emp) => (
                          <button key={emp.loginid} type="button"
                            onClick={() => setSelectedOwner(emp)}
                            className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${
                              selectedOwner?.loginid === emp.loginid ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'
                            }`}>
                            <span className="text-sm text-gray-900">
                              {selectedOwner?.loginid === emp.loginid && <Check className="w-3.5 h-3.5 text-blue-600 inline mr-1" />}
                              {emp.username} <span className="text-gray-400">({emp.loginid})</span>
                            </span>
                            <span className="text-xs text-gray-400">{emp.deptname}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {ownerResults.length === 0 && !ownerSearching && ownerQuery.length >= 2 && (
                      <p className="text-xs text-gray-400 text-center py-2">{t('myServices.noSearchResults')}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => { setShowOwnerSearch(false); setSelectedOwner(null); }}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
                      <button type="button" onClick={confirmOwnerChange} disabled={!selectedOwner}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">{t('common.confirm')}</button>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('myServices.description')}</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={2} className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('myServices.serviceType')}</label>
                  <div className="relative">
                    <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as 'STANDARD' | 'BACKGROUND' })} disabled={editingService?.status === 'DEPLOYED'} className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${editingService?.status === 'DEPLOYED' ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}>
                      <option value="STANDARD">{t('myServices.typeStandard')}</option>
                      <option value="BACKGROUND">{t('myServices.typeBackground')}</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('myServices.categoryMultiple')}</label>
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

              {/* 공개범위 — DEPLOYED 서비스에서만 편집 모달에 표시 */}
              {editingService?.status === 'DEPLOYED' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('myServices.deployScope')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, deployScope: 'ALL', deployScopeValue: [] })}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all
                        ${formData.deployScope === 'ALL' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                    >
                      {t('myServices.deployScopeAll')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, deployScope: 'TEAM' })}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all
                        ${formData.deployScope === 'TEAM' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                    >
                      {t('myServices.deployScopeDept')}
                    </button>
                  </div>
                  {formData.deployScope === 'TEAM' && (
                    <OrgTreeSelector
                      selected={formData.deployScopeValue}
                      onChange={(next) => setFormData({ ...formData, deployScopeValue: next })}
                      maxHeight="max-h-48"
                    />
                  )}
                </div>
              )}

              {/* API Only 토글 */}
              <div className="flex items-center justify-between p-3 bg-amber-50/60 border border-amber-200/80 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-700">{t('myServices.apiOnlyLabel')}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t('myServices.apiOnlyDesc')}</p>
                </div>
                <button type="button" onClick={() => setFormData({ ...formData, apiOnly: !formData.apiOnly })}
                  className={`relative w-11 h-6 rounded-full transition-colors ${formData.apiOnly ? 'bg-amber-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.apiOnly ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><Image className="w-3.5 h-3.5" /> {t('myServices.logoUrl')}</span></label>
                <div className="flex gap-2">
                  <input type="url" value={formData.iconUrl} onChange={(e) => setFormData({ ...formData, iconUrl: e.target.value })} placeholder="https://example.com/logo.png" className="flex-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                  <input type="file" accept="image/*" className="hidden" id="edit-logo-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ''; }} />
                  <button type="button" onClick={() => document.getElementById('edit-logo-upload')?.click()} disabled={uploadingLogo}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
                    {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {uploadingLogo ? t('myServices.uploadingLogo') : t('myServices.uploadLogo')}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><Link className="w-3.5 h-3.5" /> {t('myServices.serviceUrl')}</span></label>
                  <input type="url" value={formData.serviceUrl} onChange={(e) => setFormData({ ...formData, serviceUrl: e.target.value })} placeholder="https://my-service.example.com" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {t('myServices.apiDocsUrl')}</span></label>
                  <input type="url" value={formData.docsUrl} onChange={(e) => setFormData({ ...formData, docsUrl: e.target.value })} placeholder="https://docs.example.com/api" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><span className="inline-flex items-center gap-1"><Ticket className="w-3.5 h-3.5" /> {t('myServices.jiraTicket')}</span></label>
                  <input type="url" value={formData.jiraTicket} onChange={(e) => setFormData({ ...formData, jiraTicket: e.target.value })} placeholder="https://jira.example.com/browse/PROJ-123" className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
              </div>
            </div>
            {formError && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeServiceModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
              <button onClick={handleSaveService} disabled={formSaving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {formSaving && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}
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
        uploadingLogo={uploadingLogo}
        onLogoUpload={handleLogoUpload}
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
                <h3 className="text-sm font-semibold text-gray-900">{t('myServices.deployTitle')}</h3>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  <strong className="text-gray-700">{deployTarget.displayName}</strong> — {t('myServices.deployConfirmMsg')}
                </p>
              </div>
            </div>

            {/* Deploy scope selection */}
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('myServices.deployScope')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setDeployScope('ALL'); setDeployScopeValue([]); }}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all
                      ${deployScope === 'ALL' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                  >
                    {t('myServices.deployScopeAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeployScope('TEAM')}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all
                      ${deployScope === 'TEAM' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                  >
                    {t('myServices.deployScopeDept')}
                  </button>
                </div>
              </div>

              {deployScope === 'TEAM' && (
                <OrgTreeSelector
                  selected={deployScopeValue}
                  onChange={setDeployScopeValue}
                  maxHeight="max-h-48"
                />
              )}

              <p className="text-xs text-gray-400 leading-relaxed">
                {t('myServices.deployScopeHelp')}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeployTarget(null)}
                disabled={deploying}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deploying && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('myServices.deploy')}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {showGuide && (
        <ServiceGuide
          onClose={() => setShowGuide(false)}
          onOpenCreateWizard={openCreateWizard}
          onNavigateToService={(id) => navigate(`/my-services/${id}`)}
          wizardStep={wizardStep}
          wizardOpen={showWizard}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════
// Service Creation Wizard Component
// ══════════════════════════════════════════════════

function ServiceCreationWizard({
  formData, setFormData, wizardStep, setWizardStep,
  formError, setFormError, formSaving, onSave, onClose,
  uploadingLogo, onLogoUpload,
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
  uploadingLogo: boolean;
  onLogoUpload: (file: File) => void;
}) {
  const { t } = useTranslation();

  const WIZARD_STEPS = [
    { title: t('myServices.wizardStep0Title'), desc: t('myServices.wizardStep0Desc') },
    { title: t('myServices.wizardStep1Title'), desc: t('myServices.wizardStep1Desc') },
    { title: t('myServices.wizardStep2Title'), desc: t('myServices.wizardStep2Desc') },
    { title: t('myServices.wizardStep3Title'), desc: t('myServices.wizardStep3Desc') },
  ];

  const SERVICE_CATEGORIES = SERVICE_CATEGORY_KEYS.map(k => t(`myServices.${k}`));
  const canNext = (): boolean => {
    switch (wizardStep) {
      case 0: return !!(formData.name.trim() && formData.displayName.trim());
      case 1: return formData.serviceCategory.length > 0;
      default: return true;
    }
  };

  const handleNext = () => {
    setFormError(null);
    if (wizardStep === 0) {
      if (!formData.name.trim() || !formData.displayName.trim()) {
        setFormError(t('myServices.codeAndNameRequired'));
        return;
      }
      if (formData.name.length > 1 && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(formData.name)) {
        setFormError(t('myServices.codeStartEndInvalid'));
        return;
      }
    }
    if (wizardStep === 1 && formData.serviceCategory.length === 0) {
      setFormError(t('myServices.categoryMinOne'));
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
            <h2 className="text-lg font-bold text-gray-900">{t('myServices.wizardTitle')}</h2>
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('myServices.serviceCodeRequired')} <span className="text-red-500">*</span></label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  placeholder="my-ai-service" className={inputClass} />
                <p className="mt-1.5 text-xs text-gray-400">{t('myServices.serviceCodeHelp')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('myServices.displayNameRequired')} <span className="text-red-500">*</span></label>
                <input type="text" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder={t('myServices.displayNamePlaceholder')} className={inputClass} />
                <p className="mt-1.5 text-xs text-gray-400">{t('myServices.displayNameHelp')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('myServices.descriptionRequired')} <span className="text-red-500">*</span></label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('myServices.descriptionPlaceholder')} rows={3} className={`${inputClass} resize-none`} />
              </div>
            </div>
          )}

          {/* Step 1: 서비스 분류 */}
          {wizardStep === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('myServices.serviceTypeRequired')} <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {([['STANDARD', t('myServices.typeStandardLabel'), t('myServices.typeStandardDesc'), Cpu],
                     ['BACKGROUND', t('myServices.typeBackgroundLabel'), t('myServices.typeBackgroundDesc'), Server]] as [string, string, string, typeof Cpu][]).map(([val, label, desc, Icon]) => (
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
              {/* API Only 토글 */}
              <div className="flex items-center justify-between p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-lg">
                <div>
                  <p className="text-sm font-semibold text-gray-700">{t('myServices.apiOnlyLabel')}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t('myServices.apiOnlyWizardDesc')}</p>
                </div>
                <button type="button" onClick={() => setFormData({ ...formData, apiOnly: !formData.apiOnly })}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${formData.apiOnly ? 'bg-amber-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.apiOnly ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('myServices.categoryRequired')} <span className="text-red-500">*</span> <span className="text-xs text-gray-400 font-normal">{t('myServices.categoryMultipleHint')}</span></label>
                <p className="text-xs text-gray-400 mb-3">{t('myServices.categoryHelp')}</p>
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

          {/* Step 2: 링크 설정 */}
          {wizardStep === 2 && (
            <div className="space-y-5">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 mb-2">
                <p className="text-xs text-gray-500">{t('myServices.linkOptionalNotice')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><Image className="w-3.5 h-3.5" /> {t('myServices.logoUrl')}</span></label>
                <div className="flex gap-2">
                  <input type="url" value={formData.iconUrl} onChange={(e) => setFormData({ ...formData, iconUrl: e.target.value })}
                    placeholder="https://example.com/logo.png" className={`${inputClass} flex-1`} />
                  <input type="file" accept="image/*" className="hidden" id="wizard-logo-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoUpload(f); e.target.value = ''; }} />
                  <button type="button" onClick={() => document.getElementById('wizard-logo-upload')?.click()} disabled={uploadingLogo}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
                    {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {uploadingLogo ? t('myServices.uploadingLogo') : t('myServices.uploadLogo')}
                  </button>
                </div>
                {formData.iconUrl.trim() && (
                  <div className="mt-2 flex items-center gap-2">
                    <img src={formData.iconUrl.trim()} alt="" className="w-8 h-8 rounded-lg border border-gray-200 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span className="text-xs text-gray-400">{t('myServices.preview')}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> {t('myServices.serviceUrl')}</span></label>
                <input type="url" value={formData.serviceUrl} onChange={(e) => setFormData({ ...formData, serviceUrl: e.target.value })}
                  placeholder="https://my-service.example.com" className={inputClass} />
                <p className="mt-1.5 text-xs text-gray-400">{t('myServices.serviceUrlHelp')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {t('myServices.apiDocsUrl')}</span></label>
                <input type="url" value={formData.docsUrl} onChange={(e) => setFormData({ ...formData, docsUrl: e.target.value })}
                  placeholder="https://docs.example.com/api" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><span className="inline-flex items-center gap-1"><Ticket className="w-3.5 h-3.5" /> {t('myServices.jiraTicket')}</span></label>
                <input type="url" value={formData.jiraTicket} onChange={(e) => setFormData({ ...formData, jiraTicket: e.target.value })}
                  placeholder="https://jira.example.com/browse/PROJ-123" className={inputClass} />
              </div>
            </div>
          )}

          {/* Step 3: 확인 */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
                {([
                  [t('myServices.confirmSummaryCode'), formData.name],
                  [t('myServices.confirmSummaryDisplayName'), formData.displayName],
                  [t('myServices.confirmSummaryDescription'), formData.description || '-'],
                  [t('myServices.confirmSummaryType'), `${formData.type === 'STANDARD' ? t('myServices.typeStandardSummary') : t('myServices.typeBackgroundSummary')}${formData.apiOnly ? ' — API Only' : ''}`],
                  [t('myServices.confirmSummaryCategory'), formData.serviceCategory.length > 0 ? formData.serviceCategory.join(', ') : '-'],
                  [t('myServices.confirmSummaryLogoUrl'), formData.iconUrl || '-'],
                  [t('myServices.confirmSummaryServiceUrl'), formData.serviceUrl || '-'],
                  [t('myServices.confirmSummaryApiDocsUrl'), formData.docsUrl || '-'],
                  [t('myServices.confirmSummaryJiraTicket'), formData.jiraTicket || '-'],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-start px-4 py-3">
                    <span className="text-xs font-medium text-gray-500 w-28 flex-shrink-0 pt-0.5">{label}</span>
                    <span className="text-sm text-gray-900 break-all">{value}</span>
                  </div>
                ))}
              </div>
              <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                <p className="text-sm text-green-700">{t('myServices.confirmNotice')}</p>
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
            data-tour="wizard-prev-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" />
            {wizardStep === 0 ? t('common.cancel') : t('common.prev')}
          </button>
          {wizardStep < WIZARD_STEPS.length - 1 ? (
            <button onClick={handleNext} disabled={!canNext()} data-tour="wizard-next-btn"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {t('common.next')} <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={onSave} disabled={formSaving} data-tour="wizard-save-btn"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {formSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {t('myServices.registerService')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
