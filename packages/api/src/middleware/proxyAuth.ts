/**
 * Proxy Authentication Middleware (v3)
 *
 * /v1/* 프록시 라우트 전용 인증
 * Bearer token 대신 헤더 기반 인증:
 * - Standard 서비스: x-service-id, x-user-id 필수 (부서 정보는 DB/Knox에서 자동 resolve)
 * - Background 서비스: x-service-id, x-dept-name 필수 (DB에 등록된 부서만 허용, x-user-id 불필요)
 *
 * 서비스는 등록한 admin의 LLM 권한을 자동 계승
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../index.js';
import { extractBusinessUnit } from './auth.js';
import { logErrorToRequestLog } from '../services/requestLog.js';
import { isUnderAnyScope } from '../services/orgAncestorCache.js';

export interface ProxyAuthRequest extends Request {
  serviceId: string;
  serviceName: string;
  serviceType: 'STANDARD' | 'BACKGROUND';
  userId?: string;        // null for background services
  userLoginId?: string;
  deptName: string;
  teamName: string;
  businessUnit: string;
  isBackground: boolean;
  userDeptCode: string;          // 사용자 departmentCode (scope 매칭용)
  deployScope: string;           // 서비스 배포 범위 (ALL | BUSINESS_UNIT | TEAM)
  deployScopeValue: string[];    // 배포 범위 허용 값 (departmentCode[])
}

function safeDecodeURIComponent(text: string): string {
  if (!text) return text;
  try {
    // URL-encoded (%XX) → decode
    if (text.includes('%')) return decodeURIComponent(text);
    // Raw UTF-8 bytes in header → Node.js reads as latin1 → convert back to UTF-8
    const buf = Buffer.from(text, 'latin1');
    const decoded = buf.toString('utf8');
    if (decoded !== text && !decoded.includes('\ufffd')) return decoded;
    return text;
  } catch {
    return text;
  }
}

/**
 * 프록시 요청 헤더 검증 미들웨어
 * 모든 /v1/* 요청에 적용
 */
export async function validateProxyHeaders(req: Request, res: Response, next: NextFunction): Promise<void> {
  const proxyReq = req as ProxyAuthRequest;

  // 1. x-service-id 필수
  const serviceIdHeader = req.headers['x-service-id'] as string | undefined;
  if (!serviceIdHeader) {
    logErrorToRequestLog({ req, statusCode: 401, errorMessage: 'x-service-id header is required' }).catch(() => {});
    res.status(401).json({
      error: 'x-service-id header is required',
      message: 'All API calls must include x-service-id header. Register your service at the dashboard first.',
    });
    return;
  }

  // 2. 서비스 조회 (name 또는 id로 검색)
  const service = await prisma.service.findFirst({
    where: {
      OR: [
        { id: serviceIdHeader },
        { name: serviceIdHeader },
      ],
    },
  });

  if (!service) {
    logErrorToRequestLog({ req, statusCode: 403, errorMessage: `Service '${serviceIdHeader}' is not registered` }).catch(() => {});
    res.status(403).json({
      error: `Service '${serviceIdHeader}' is not registered`,
      message: 'Please register your service at the dashboard before making API calls.',
    });
    return;
  }

  if (!service.enabled) {
    logErrorToRequestLog({ req, statusCode: 403, errorMessage: `Service '${serviceIdHeader}' is disabled`, serviceId: service.id }).catch(() => {});
    res.status(403).json({
      error: `Service '${serviceIdHeader}' is disabled`,
      message: 'This service has been disabled. Contact your admin.',
    });
    return;
  }

  const isBackground = service.type === 'BACKGROUND';

  // 3. 헤더 검증 분기: Standard vs Background
  const deptNameHeader = safeDecodeURIComponent(req.headers['x-dept-name'] as string || '');
  const userIdHeader = req.headers['x-user-id'] as string | undefined;
  let teamName = '';
  let businessUnit = '';

  if (isBackground) {
    // ── Background 서비스: x-dept-name 필수 + DB 등록 부서 검증 ──
    if (!deptNameHeader) {
      logErrorToRequestLog({ req, statusCode: 401, errorMessage: 'x-dept-name header is required for background services', serviceId: service.id }).catch(() => {});
      res.status(401).json({
        error: 'x-dept-name header is required for background services',
        message: 'Background services must include x-dept-name header. Format: "팀명(사업부)" e.g., "S/W혁신팀(S.LSI)" 또는 영문 부서명',
      });
      return;
    }

    // DB에서 부서 존재 여부 검증 (한글명/영문명 모두 지원)
    const resolvedDept = await resolveBackgroundDept(deptNameHeader);
    if (!resolvedDept) {
      logErrorToRequestLog({ req, statusCode: 403, errorMessage: `Unknown department: ${deptNameHeader}`, serviceId: service.id }).catch(() => {});
      res.status(403).json({
        error: 'Unknown department',
        message: `부서 '${deptNameHeader}'이(가) 시스템에 등록되지 않은 부서입니다. 조직도에 등록된 부서명(한글/영문)을 사용해 주세요.`,
      });
      return;
    }

    teamName = resolvedDept.teamName;
    businessUnit = resolvedDept.businessUnit;

    // 배포 범위 접근 제어 (부서 정보 확정 상태)
    const scopeError = checkDeployScope(
      service.deployScope, service.deployScopeValue || [],
      resolvedDept.departmentCode, service.name,
    );
    if (scopeError) {
      logErrorToRequestLog({ req, statusCode: 403, errorMessage: scopeError, serviceId: service.id, deptname: deptNameHeader }).catch(() => {});
      res.status(403).json({ error: 'Access denied', message: scopeError });
      return;
    }
  } else {
    // ── Standard 서비스: x-user-id 필수, x-dept-name 불필요 (DB/Knox 자동 resolve) ──
    if (!userIdHeader) {
      logErrorToRequestLog({ req, statusCode: 401, errorMessage: 'x-user-id header is required for standard services', serviceId: service.id }).catch(() => {});
      res.status(401).json({
        error: 'x-user-id header is required for standard services',
        message: 'Standard services must include x-user-id header. If this is a background service, register it as BACKGROUND type.',
      });
      return;
    }

    // DB에서 기존 사용자의 부서 정보 조회 (Knox API 호출 없음, 경량 조회)
    // → Knox 인증 완료 사용자는 미들웨어 단계에서 deployScope 체크 가능
    // → 미인증 사용자는 getOrCreateUser에서 Knox 인증 후 체크
    const existingUser = await prisma.user.findUnique({
      where: { loginid: userIdHeader },
      select: { deptname: true, businessUnit: true, departmentCode: true, knoxVerified: true },
    });

    if (existingUser?.knoxVerified && existingUser.deptname) {
      teamName = existingUser.deptname.match(/^([^(]+)/)?.[1]?.trim() || existingUser.deptname;
      businessUnit = existingUser.businessUnit || extractBusinessUnit(existingUser.deptname);

      // 배포 범위 접근 제어
      const scopeError = checkDeployScope(
        service.deployScope, service.deployScopeValue || [],
        existingUser.departmentCode || '', service.name,
      );
      if (scopeError) {
        logErrorToRequestLog({ req, statusCode: 403, errorMessage: scopeError, serviceId: service.id, deptname: existingUser.deptname, userId: userIdHeader }).catch(() => {});
        res.status(403).json({ error: 'Access denied', message: scopeError });
        return;
      }
    }
    // 미인증 사용자: deployScope는 getOrCreateUser에서 Knox 인증 후 체크
  }

  // ProxyAuthRequest에 정보 설정
  proxyReq.serviceId = service.id;
  proxyReq.serviceName = service.name;
  proxyReq.serviceType = service.type as 'STANDARD' | 'BACKGROUND';
  proxyReq.userLoginId = userIdHeader;
  proxyReq.deptName = isBackground ? deptNameHeader : '';  // Standard는 getOrCreateUser에서 최종 세팅
  proxyReq.teamName = teamName;
  proxyReq.businessUnit = businessUnit;
  proxyReq.isBackground = isBackground;
  proxyReq.userDeptCode = '';  // Standard: getOrCreateUser에서 세팅, Background: 미사용
  proxyReq.deployScope = service.deployScope;
  proxyReq.deployScopeValue = service.deployScopeValue || [];

  next();
}

/**
 * Background 서비스의 x-dept-name을 DB에서 검증 + resolve
 * 한글명/영문명 모두 지원 (User, OrgNode 병렬 조회)
 * @returns resolve된 부서 정보 or null (미등록 부서)
 */
async function resolveBackgroundDept(deptNameInput: string): Promise<{
  deptName: string;
  teamName: string;
  businessUnit: string;
  departmentCode: string;
} | null> {
  const [userMatch, orgMatch] = await Promise.all([
    prisma.user.findFirst({
      where: { OR: [{ deptname: deptNameInput }, { enDeptName: deptNameInput }] },
      select: { deptname: true, businessUnit: true, departmentCode: true },
    }),
    prisma.orgNode.findFirst({
      where: { OR: [{ departmentName: deptNameInput }, { enDepartmentName: deptNameInput }] },
      select: { departmentName: true, departmentCode: true },
    }),
  ]);

  // User 테이블 매칭 (가장 정확한 부서 정보)
  if (userMatch?.deptname) {
    return {
      deptName: userMatch.deptname,
      teamName: userMatch.deptname.match(/^([^(]+)/)?.[1]?.trim() || userMatch.deptname,
      businessUnit: userMatch.businessUnit || extractBusinessUnit(userMatch.deptname),
      departmentCode: userMatch.departmentCode || '',
    };
  }

  // OrgNode 매칭 (조직도)
  if (orgMatch) {
    const deptName = orgMatch.departmentName || deptNameInput;
    return {
      deptName,
      teamName: deptName.match(/^([^(]+)/)?.[1]?.trim() || deptName,
      businessUnit: extractBusinessUnit(deptName),
      departmentCode: orgMatch.departmentCode,
    };
  }

  return null;
}

/**
 * 서비스 배포 범위(deployScope) 접근 제어
 * deployScopeValue는 departmentCode 배열:
 * - TEAM: 사용자의 departmentCode 또는 조상 코드가 scope에 포함되면 통과 (하위 조직 포함)
 * - BUSINESS_UNIT: 사용자의 departmentCode 또는 조상 코드가 scope에 포함되면 통과
 * @returns 에러 메시지 or null (통과)
 */
export function checkDeployScope(
  scope: string,
  scopeValues: string[],
  userDeptCode: string,
  serviceName: string,
): string | null {
  if (scope === 'BUSINESS_UNIT' && scopeValues.length > 0) {
    if (!isUnderAnyScope(userDeptCode, scopeValues)) {
      return `Your department does not have access to service '${serviceName}'.`;
    }
  } else if (scope === 'TEAM' && scopeValues.length > 0) {
    if (!isUnderAnyScope(userDeptCode, scopeValues)) {
      return `Your department does not have access to service '${serviceName}'.`;
    }
  }
  return null;
}

