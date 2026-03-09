/**
 * Models Routes (v2)
 *
 * LLM 모델 CRUD (서비스와 독립)
 * - Super Admin: 모든 LLM CRUD
 * - Admin: LLM 등록 가능, 수정/삭제는 super admin이 등록하지 않은 + 본인 dept LLM만
 * - User: CRUD 불가 (사용만)
 *
 * Visibility: PUBLIC / BUSINESS_UNIT / TEAM / ADMIN_ONLY
 */
export declare const modelsRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=models.routes.d.ts.map