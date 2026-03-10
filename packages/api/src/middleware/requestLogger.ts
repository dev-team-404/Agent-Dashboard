/**
 * Request Logger Middleware (v3)
 *
 * 모든 API 호출에 service, user, dept를 항상 표시 (없으면 null)
 * - 프록시 라우트: x-service-id, x-user-id, x-dept-name 헤더에서 추출
 * - 대시보드 라우트: Authorization (JWT/SSO) 토큰에서 추출
 */

import { Request, Response, NextFunction } from 'express';

function safeDecode(value: string | undefined): string {
  if (!value) return '';
  try {
    if (value.includes('%')) return decodeURIComponent(value);
    const buf = Buffer.from(value, 'latin1');
    const decoded = buf.toString('utf8');
    if (decoded !== value && !decoded.includes('\ufffd')) return decoded;
    return value;
  } catch {
    return value;
  }
}

function decodeAuthHeader(authHeader: string | undefined): Record<string, unknown> | null {
  if (!authHeader) return null;
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (token.startsWith('sso.')) {
    try {
      const binaryString = Buffer.from(token.substring(4), 'base64').toString('binary');
      const jsonString = decodeURIComponent(
        binaryString.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      const payload = JSON.parse(jsonString);
      return { type: 'sso', loginid: payload.loginid, username: payload.username, deptname: payload.deptname };
    } catch {
      return { type: 'sso', error: 'decode_failed' };
    }
  }

  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const payloadBase64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      return {
        type: 'jwt',
        loginid: payload.loginid || payload.sub || '',
        username: payload.username || payload.name || '',
        deptname: payload.deptname || payload.department || '',
      };
    } catch {
      return { type: 'jwt', error: 'decode_failed' };
    }
  }

  return { type: 'unknown' };
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // 헤더 기반 (프록시 라우트)
  const headerServiceId = (req.headers['x-service-id'] as string) || '';
  const headerUserId = (req.headers['x-user-id'] as string) || '';
  const headerDept = safeDecode(req.headers['x-dept-name'] as string);

  // JWT/SSO 기반 (대시보드 라우트)
  const authInfo = decodeAuthHeader(req.headers['authorization'] as string);
  const authUserId = (authInfo?.loginid as string) || '';
  const authDept = (authInfo?.deptname as string) || '';

  // 통합: 헤더 우선, 없으면 auth 토큰에서
  const serviceId = headerServiceId || null;
  const userId = headerUserId || authUserId || null;
  const dept = headerDept || authDept || null;

  const model = req.body?.model || null;
  const stream = req.body?.stream || false;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;

    const logLine = `[Request] ${req.method} ${req.originalUrl || req.url} ${status} ${duration}ms` +
      ` | service=${serviceId}` +
      ` | user=${userId}` +
      ` | dept=${dept}` +
      (model ? ` | model=${model}` : '') +
      (stream ? ` | stream=${stream}` : '');

    if (status >= 500) {
      console.error(logLine);
    } else if (status >= 400) {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }
  });

  next();
}
