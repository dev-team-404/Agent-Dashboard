/**
 * Authentication Middleware (v2)
 *
 * 3단계 권한 체계:
 * - SUPER_ADMIN: 하드코딩(syngha.han, young87.kim, byeongju.lee) + DB 지정자
 * - ADMIN: super admin이 지정, dept 내 권한
 * - USER: 일반 사용자 (대시보드: 본인 사용량만)
 *
 * Dashboard 인증: JWT/SSO 토큰 (기존 유지)
 * API 프록시 인증: x-service-id, x-user-id, x-dept-name 헤더 기반
 */
import { Request, Response, NextFunction } from 'express';
export interface JWTPayload {
    loginid: string;
    deptname: string;
    username: string;
    iat?: number;
    exp?: number;
}
export interface AuthenticatedRequest extends Request {
    user?: JWTPayload;
    userId?: string;
    isAdmin?: boolean;
    adminRole?: 'SUPER_ADMIN' | 'ADMIN' | null;
    isSuperAdmin?: boolean;
    adminId?: string;
    adminDept?: string;
    adminBusinessUnit?: string;
    adminDeptCode?: string;
}
/**
 * 하드코딩 Super Admin인지 확인
 */
export declare function isHardcodedSuperAdmin(loginid: string): boolean;
/**
 * 환경변수 + 하드코딩 Super Admin인지 확인
 */
export declare function isSuperAdminByEnv(loginid: string): boolean;
/**
 * deptname에서 businessUnit 추출
 * "S/W혁신팀(S.LSI)" → "S.LSI"
 */
export declare function extractBusinessUnit(deptname: string): string;
/**
 * deptname에서 팀명 추출
 * "S/W혁신팀(S.LSI)" → "S/W혁신팀"
 */
export declare function extractTeamName(deptname: string): string;
/**
 * Verify JWT token and attach user to request
 */
export declare function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void;
/**
 * Check if user is an admin (SUPER_ADMIN or ADMIN)
 */
export declare function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>;
/**
 * Check if user is a super admin
 */
export declare function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>;
/**
 * LLM이 특정 사용자(dept/BU/role)에게 보이는지 확인
 *
 * visibilityScope는 departmentCode 배열:
 * - TEAM: 사용자의 departmentCode 또는 조상 코드가 scope에 포함되면 허용 (하위 조직 포함)
 * - BUSINESS_UNIT: 사용자의 departmentCode 또는 조상 코드가 scope에 포함되면 허용
 */
export declare function isModelVisibleTo(model: {
    visibility: string;
    visibilityScope: string[];
    adminVisible?: boolean;
}, userDeptCode: string, isAdmin: boolean): boolean;
export declare function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string;
export declare function verifyInternalToken(token: string): JWTPayload | null;
//# sourceMappingURL=auth.d.ts.map