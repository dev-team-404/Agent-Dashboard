/**
 * Admin Routes (v2)
 *
 * Protected endpoints for admin dashboard
 * - 3-tier admin system: SUPER_ADMIN / ADMIN (dept-scoped)
 * - Models are independent of services (no serviceId on Model)
 * - Model visibility: PUBLIC / BUSINESS_UNIT / TEAM / ADMIN_ONLY
 * - Admin has deptname, businessUnit, designatedBy
 */
export declare const adminRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=admin.routes.d.ts.map