import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('agent_stats_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors (401 only — 403 is permission denied, not token expiry)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('agent_stats_token');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// API functions
export const authApi = {
  me: () => api.get('/auth/me'),
  callback: (token: string) => api.post('/auth/callback', {}, {
    headers: { Authorization: `Bearer ${token}` }
  }),
  // SSO 기반 로그인 (토큰으로 인증)
  login: (token: string) => api.post('/auth/login', {}, {
    headers: { Authorization: `Bearer ${token}` }
  }),
  // 현재 세션 체크 (admin 아니어도 OK)
  check: () => api.get('/auth/check'),
};

// Service API
export const serviceApi = {
  list: () => api.get('/services'),
  listAll: () => api.get('/services/all'),
  listNames: () => api.get('/services/names'),
  listMy: () => api.get('/services/my'),
  get: (id: string) => api.get(`/services/${id}`),
  create: (data: CreateServiceData) => api.post('/services', data),
  update: (id: string, data: Partial<CreateServiceData>) => api.put(`/services/${id}`, data),
  delete: (id: string) => api.delete(`/services/${id}`),
  deploy: (id: string) => api.post(`/services/${id}/deploy`),
  resetData: (id: string) => api.post(`/services/${id}/reset-data`),
  stats: (id: string) => api.get(`/services/${id}/stats`),
  checkName: (name: string) => api.get(`/services/check-name/${name}`),
  // Service Models
  listModels: (id: string) => api.get(`/services/${id}/models`),
  addModel: (id: string, modelId: string) => api.post(`/services/${id}/models`, { modelId }),
  removeModel: (id: string, modelId: string) => api.delete(`/services/${id}/models/${modelId}`),
  // Service Members
  listMembers: (id: string) => api.get(`/services/${id}/members`),
  addMember: (id: string, loginid: string, role?: string) => api.post(`/services/${id}/members`, { loginid, role }),
  updateMemberRole: (id: string, userId: string, role: string) => api.put(`/services/${id}/members/${userId}/role`, { role }),
  removeMember: (id: string, userId: string) => api.delete(`/services/${id}/members/${userId}`),
  // Search users
  searchUsers: (q: string) => api.get('/services/search-users', { params: { q } }),
};

export const modelsApi = {
  list: () => api.get('/models'),
  get: (id: string) => api.get(`/models/${id}`),
  create: (data: CreateModelData) => api.post('/models', data),
  update: (id: string, data: Partial<CreateModelData>) => api.put(`/models/${id}`, data),
  delete: (id: string, force = false) => api.delete(`/models/${id}`, { params: { force } }),
  toggle: (id: string) => api.patch(`/models/${id}/toggle`),
  reorder: (modelIds: string[]) => api.put('/admin/models/reorder', { modelIds }),
  // SubModel API (로드밸런싱)
  listSubModels: (modelId: string) => api.get(`/admin/models/${modelId}/sub-models`),
  createSubModel: (modelId: string, data: CreateSubModelData) => api.post(`/admin/models/${modelId}/sub-models`, data),
  updateSubModel: (modelId: string, subModelId: string, data: Partial<CreateSubModelData>) =>
    api.put(`/admin/models/${modelId}/sub-models/${subModelId}`, data),
  deleteSubModel: (modelId: string, subModelId: string) =>
    api.delete(`/admin/models/${modelId}/sub-models/${subModelId}`),
  // 엔드포인트 테스트
  testEndpoint: (data: { endpointUrl: string; modelName: string; apiKey?: string; extraHeaders?: Record<string, string>; extraBody?: Record<string, unknown> }) =>
    api.post('/admin/models/test', data),
  testVision: (data: { endpointUrl: string; modelName: string; apiKey?: string; extraHeaders?: Record<string, string> }) =>
    api.post('/admin/models/test-vl', data),
  testImage: (data: { endpointUrl: string; modelName: string; apiKey?: string; extraHeaders?: Record<string, string>; extraBody?: Record<string, unknown>; imageProvider?: string }) =>
    api.post('/admin/models/test-image', data),
  testEmbedding: (data: { endpointUrl: string; modelName: string; apiKey?: string; extraHeaders?: Record<string, string> }) =>
    api.post('/admin/models/test-embedding', data),
  testRerank: (data: { endpointUrl: string; modelName: string; apiKey?: string; extraHeaders?: Record<string, string> }) =>
    api.post('/admin/models/test-rerank', data),
};

// Scope options API (for visibility dropdowns)
export const scopeApi = {
  businessUnits: () => api.get('/admin/scope/business-units'),
  departments: () => api.get('/admin/scope/departments'),
};

export const usersApi = {
  list: (page = 1, limit = 50, serviceId?: string) =>
    api.get('/admin/users', { params: { page, limit, serviceId } }),
  get: (id: string) => api.get(`/admin/users/${id}`),
  getAdminStatus: (id: string) => api.get(`/admin/users/${id}/admin-status`),
  promote: (id: string, role: 'ADMIN', serviceId?: string) =>
    api.post(`/admin/users/${id}/promote`, { role, serviceId }),
  demote: (id: string, serviceId?: string) =>
    api.delete(`/admin/users/${id}/demote`, { data: { serviceId } }),
  // Rate limit
  getRateLimit: (userId: string, serviceId: string) =>
    api.get(`/admin/users/${userId}/rate-limit`, { params: { serviceId } }),
  setRateLimit: (userId: string, data: { serviceId: string; maxTokens: number; window: 'FIVE_HOURS' | 'DAY'; enabled?: boolean }) =>
    api.put(`/admin/users/${userId}/rate-limit`, data),
  deleteRateLimit: (userId: string, serviceId: string) =>
    api.delete(`/admin/users/${userId}/rate-limit`, { params: { serviceId } }),
  // User deletion
  deleteUser: (userId: string) =>
    api.delete(`/admin/users/${userId}`),
};

export const rateLimitApi = {
  listByService: (serviceId: string) =>
    api.get('/admin/rate-limits', { params: { serviceId } }),
};

// Service Rate Limit (공통)
export const serviceRateLimitApi = {
  get: (serviceId: string) =>
    api.get('/admin/service-rate-limit', { params: { serviceId } }),
  set: (data: { serviceId: string; maxTokens: number; window: 'FIVE_HOURS' | 'DAY'; enabled?: boolean }) =>
    api.put('/admin/service-rate-limit', data),
  remove: (serviceId: string) =>
    api.delete('/admin/service-rate-limit', { params: { serviceId } }),
};

export const statsApi = {
  // Service-specific stats
  overview: (serviceId?: string) => api.get('/admin/stats/overview', { params: { serviceId } }),
  daily: (days = 30, serviceId?: string) => api.get('/admin/stats/daily', { params: { days, serviceId } }),
  byUser: (days = 30, serviceId?: string) => api.get('/admin/stats/by-user', { params: { days, serviceId } }),
  byModel: (days = 30, serviceId?: string) => api.get('/admin/stats/by-model', { params: { days, serviceId } }),
  byDept: (days = 30, serviceId?: string) => api.get('/admin/stats/by-dept', { params: { days, serviceId } }),
  dailyActiveUsers: (days = 30, serviceId?: string) =>
    api.get('/admin/stats/daily-active-users', { params: { days, serviceId } }),
  cumulativeUsers: (days = 30, serviceId?: string) =>
    api.get('/admin/stats/cumulative-users', { params: { days, serviceId } }),
  modelDailyTrend: (days = 30, serviceId?: string) =>
    api.get('/admin/stats/model-daily-trend', { params: { days, serviceId } }),
  modelUserTrend: (modelId: string, days = 30, topN = 10, serviceId?: string) =>
    api.get('/admin/stats/model-user-trend', { params: { modelId, days, topN, serviceId } }),

  // Global stats (across all services)
  globalOverview: () => api.get('/admin/stats/global/overview'),
  globalByService: (days = 30) => api.get('/admin/stats/global/by-service', { params: { days } }),
  globalByDept: (days = 30) => api.get('/admin/stats/global/by-dept', { params: { days } }),
  globalByDeptDaily: (days = 30, topN = 5) => api.get('/admin/stats/global/by-dept-daily', { params: { days, topN } }),
  globalByDeptUsersDaily: (days = 30, topN = 5) => api.get('/admin/stats/global/by-dept-users-daily', { params: { days, topN } }),
  globalByDeptServiceRequestsDaily: (days = 30, topN = 10) => api.get('/admin/stats/global/by-dept-service-requests-daily', { params: { days, topN } }),
  weeklyBusinessDau: (days = 90, granularity: 'daily' | 'weekly' = 'weekly') => api.get('/admin/stats/weekly-business-dau', { params: { days, granularity } }),

  // Enhanced global metrics
  globalCumulativeUsersByService: (days = 30) => api.get('/admin/stats/global/cumulative-users-by-service', { params: { days } }),
  globalCumulativeTokensByService: (days = 30) => api.get('/admin/stats/global/cumulative-tokens-by-service', { params: { days } }),
  globalDauByService: (days = 30) => api.get('/admin/stats/global/dau-by-service', { params: { days } }),
  globalDeptUsageByService: (days = 30, topN = 10) => api.get('/admin/stats/global/dept-usage-by-service', { params: { days, topN } }),
  globalServiceDailyRequests: (days = 30) => api.get('/admin/stats/global/service-daily-requests', { params: { days } }),

  // Latency stats
  latency: () => api.get('/admin/stats/latency'),
  latencyHistory: (hours = 24, interval = 10) => api.get('/admin/stats/latency/history', { params: { hours, interval } }),
};

// 개인 사용량 API
export const myUsageApi = {
  summary: (serviceId?: string) => api.get('/my-usage/summary', { params: { serviceId } }),
  daily: (days = 30, serviceId?: string) => api.get('/my-usage/daily', { params: { days, serviceId } }),
  byModel: (days = 30, serviceId?: string) => api.get('/my-usage/by-model', { params: { days, serviceId } }),
  byService: (days = 30) => api.get('/my-usage/by-service', { params: { days } }),
  recent: (limit = 50, offset = 0, serviceId?: string) =>
    api.get('/my-usage/recent', { params: { limit, offset, serviceId } }),
};

// 모델 평점 API
export const ratingApi = {
  stats: (days = 30, serviceId?: string) => api.get('/rating/stats', { params: { days, serviceId } }),
};

// 통합 사용자 관리 API
export interface UnifiedUserFilters {
  page?: number;
  limit?: number;
  serviceId?: string;
  businessUnit?: string;
  deptname?: string;
  role?: string;
  search?: string;
}

export interface ServicePermission {
  serviceId: string;
  role: string;
}

export const unifiedUsersApi = {
  list: (filters?: UnifiedUserFilters) => api.get('/admin/unified-users', { params: filters }),
  updatePermissions: (id: string, data: { globalRole?: string; servicePermissions?: ServicePermission[] }) =>
    api.put(`/admin/unified-users/${id}/permissions`, data),
};

interface CreateModelData {
  name: string;
  displayName: string;
  endpointUrl: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  maxTokens?: number;
  enabled?: boolean;
  supportsVision?: boolean;
  type?: 'CHAT' | 'IMAGE' | 'EMBEDDING' | 'RERANKING';
  imageProvider?: string;
  visibility?: 'PUBLIC' | 'BUSINESS_UNIT' | 'TEAM' | 'ADMIN_ONLY' | 'SUPER_ADMIN_ONLY';
  visibilityScope?: string[];
  sortOrder?: number;
}

interface CreateSubModelData {
  modelName?: string;
  endpointUrl: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  enabled?: boolean;
  sortOrder?: number;
}

interface CreateServiceData {
  name: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  enabled?: boolean;
  type?: 'STANDARD' | 'BACKGROUND';
  status?: 'DEVELOPMENT' | 'DEPLOYED';
}

// Admin Logs API
export const logsApi = {
  // Request Logs
  listRequestLogs: (params: {
    userId?: string; serviceId?: string; modelName?: string;
    statusCode?: number; stream?: boolean;
    startDate?: string; endDate?: string;
    page?: number; limit?: number;
  }) => api.get('/admin/logs', { params }),
  getRequestLog: (id: string) => api.get(`/admin/logs/${id}`),
  cleanupLogs: (retentionDays?: number) => api.delete('/admin/logs/cleanup', { params: { retentionDays } }),

  // Audit Logs
  listAuditLogs: (params: {
    loginid?: string; action?: string; targetType?: string;
    startDate?: string; endDate?: string;
    page?: number; limit?: number;
  }) => api.get('/admin/audit', { params }),
};

// 휴일 관리 API
export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: 'NATIONAL' | 'COMPANY' | 'CUSTOM';
  createdAt: string;
  updatedAt: string;
}

export interface CreateHolidayData {
  date: string;  // YYYY-MM-DD
  name: string;
  type?: 'NATIONAL' | 'COMPANY' | 'CUSTOM';
}

export const holidaysApi = {
  list: (year?: number, month?: number) =>
    api.get<{ holidays: Holiday[] }>('/holidays', { params: { year, month } }),
  getByYear: (year: number) =>
    api.get<{ holidays: Holiday[]; year: number }>(`/holidays/${year}`),
  getDates: (days = 365) =>
    api.get<{ dates: string[] }>('/holidays/dates', { params: { days } }),
  create: (data: CreateHolidayData) =>
    api.post<{ holiday: Holiday }>('/holidays', data),
  bulkCreate: (holidays: CreateHolidayData[]) =>
    api.post<{ message: string; created: Array<{ date: string; name: string }>; skipped: Array<{ date: string; reason: string }> }>('/holidays/bulk', { holidays }),
  update: (id: string, data: Partial<Omit<CreateHolidayData, 'date'>>) =>
    api.put<{ holiday: Holiday }>(`/holidays/${id}`, data),
  delete: (id: string) =>
    api.delete<{ message: string }>(`/holidays/${id}`),
};
