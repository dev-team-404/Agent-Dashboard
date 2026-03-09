/**
 * Proxy Authentication Middleware (v2)
 *
 * /v1/* 프록시 라우트 전용 인증
 * Bearer token 대신 헤더 기반 인증:
 * - 일반 서비스: x-service-id, x-user-id, x-dept-name 필수
 * - 백그라운드 서비스: x-service-id, x-dept-name 필수 (x-user-id 불필요)
 *
 * 서비스는 등록한 admin의 LLM 권한을 자동 계승
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../index.js';
import { extractBusinessUnit, isSuperAdminByEnv, isModelVisibleTo } from './auth.js';

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
  // 서비스 등록 admin 정보 (LLM 접근 권한 판단용)
  registeredByLoginId?: string;
  registeredByDept?: string;
  registeredByBU?: string;
  registeredByIsSuperAdmin?: boolean;
  registeredByIsAdmin?: boolean;
}

function safeDecodeURIComponent(text: string): string {
  if (!text) return text;
  try {
    if (!text.includes('%')) return text;
    return decodeURIComponent(text);
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
    res.status(403).json({
      error: `Service '${serviceIdHeader}' is not registered`,
      message: 'Please register your service at the dashboard before making API calls.',
    });
    return;
  }

  if (!service.enabled) {
    res.status(403).json({
      error: `Service '${serviceIdHeader}' is disabled`,
      message: 'This service has been disabled. Contact your admin.',
    });
    return;
  }

  const isBackground = service.type === 'BACKGROUND';

  // 3. x-dept-name 필수 (모든 서비스)
  const deptNameHeader = safeDecodeURIComponent(req.headers['x-dept-name'] as string || '');
  if (!deptNameHeader) {
    res.status(401).json({
      error: 'x-dept-name header is required',
      message: 'All API calls must include x-dept-name header. Format: "팀명(사업부)" e.g., "SW혁신팀(S.LSI)"',
    });
    return;
  }

  // 4. x-user-id: 일반 서비스는 필수, 백그라운드는 선택
  const userIdHeader = req.headers['x-user-id'] as string | undefined;
  if (!isBackground && !userIdHeader) {
    res.status(401).json({
      error: 'x-user-id header is required for standard services',
      message: 'Standard services must include x-user-id header. If this is a background service, register it as BACKGROUND type.',
    });
    return;
  }

  // 5. 팀명/사업부 추출
  const teamName = deptNameHeader.match(/^([^(]+)/)?.[1]?.trim() || deptNameHeader;
  const businessUnit = extractBusinessUnit(deptNameHeader);

  // 6. 서비스 등록 admin 정보 설정
  let registeredByIsSuperAdmin = false;
  let registeredByIsAdmin = false;
  let registeredByDept = service.registeredByDept || '';
  let registeredByBU = service.registeredByBusinessUnit || '';

  if (service.registeredBy) {
    if (isSuperAdminByEnv(service.registeredBy)) {
      registeredByIsSuperAdmin = true;
      registeredByIsAdmin = true;
    } else {
      const admin = await prisma.admin.findUnique({
        where: { loginid: service.registeredBy },
        select: { role: true, deptname: true, businessUnit: true },
      });
      if (admin) {
        registeredByIsAdmin = true;
        registeredByIsSuperAdmin = admin.role === 'SUPER_ADMIN';
        registeredByDept = admin.deptname || registeredByDept;
        registeredByBU = admin.businessUnit || registeredByBU;
      }
    }
  }

  // ProxyAuthRequest에 정보 설정
  proxyReq.serviceId = service.id;
  proxyReq.serviceName = service.name;
  proxyReq.serviceType = service.type as 'STANDARD' | 'BACKGROUND';
  proxyReq.userLoginId = userIdHeader;
  proxyReq.deptName = deptNameHeader;
  proxyReq.teamName = teamName;
  proxyReq.businessUnit = businessUnit;
  proxyReq.isBackground = isBackground;
  proxyReq.registeredByLoginId = service.registeredBy || undefined;
  proxyReq.registeredByDept = registeredByDept;
  proxyReq.registeredByBU = registeredByBU;
  proxyReq.registeredByIsSuperAdmin = registeredByIsSuperAdmin;
  proxyReq.registeredByIsAdmin = registeredByIsAdmin;

  next();
}

/**
 * 서비스가 특정 LLM에 접근 가능한지 확인
 * 서비스는 등록한 admin의 LLM 접근 권한을 계승
 */
export function canServiceAccessModel(
  proxyReq: ProxyAuthRequest,
  model: { visibility: string; visibilityScope: string[] }
): boolean {
  // 등록 admin이 super admin이면 모든 LLM 접근 가능
  if (proxyReq.registeredByIsSuperAdmin) return true;

  // 등록 admin이 admin이 아니면 접근 불가 (서비스는 admin만 등록 가능하므로 이론상 발생하지 않음)
  if (!proxyReq.registeredByIsAdmin) return false;

  return isModelVisibleTo(
    model,
    proxyReq.registeredByDept || '',
    proxyReq.registeredByBU || '',
    true // admin이므로
  );
}
