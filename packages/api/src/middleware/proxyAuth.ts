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
import { extractBusinessUnit } from './auth.js';

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
      message: 'All API calls must include x-dept-name header. Format: "팀명(사업부)" e.g., "S/W혁신팀(S.LSI)"',
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

  // 6. 서비스 배포 범위(deployScope) 접근 제어
  //    ALL → 누구나 호출 가능
  //    BUSINESS_UNIT → 호출자의 사업부가 deployScopeValue에 포함
  //    TEAM → 호출자의 부서명이 deployScopeValue에 포함
  const scope = service.deployScope; // ALL | BUSINESS_UNIT | TEAM
  const scopeValues = service.deployScopeValue || [];

  if (scope === 'BUSINESS_UNIT' && scopeValues.length > 0) {
    if (!scopeValues.includes(businessUnit)) {
      res.status(403).json({
        error: `This service is restricted to specific business units`,
        message: `Your business unit '${businessUnit}' does not have access to service '${service.name}'.`,
      });
      return;
    }
  } else if (scope === 'TEAM' && scopeValues.length > 0) {
    if (!scopeValues.includes(deptNameHeader) && !scopeValues.includes(teamName)) {
      res.status(403).json({
        error: `This service is restricted to specific teams`,
        message: `Your team '${deptNameHeader}' does not have access to service '${service.name}'.`,
      });
      return;
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

  next();
}

