/**
 * LLM Proxy Routes (v2)
 *
 * 헤더 기반 인증 (Bearer token 폐지):
 * - 일반 서비스: x-service-id, x-user-id, x-dept-name
 * - 백그라운드 서비스: x-service-id, x-dept-name
 *
 * 서비스는 등록한 admin의 LLM 접근 권한을 자동 계승
 * LLM visibility: PUBLIC / BUSINESS_UNIT / TEAM / ADMIN_ONLY
 */
export declare const proxyRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=proxy.routes.d.ts.map