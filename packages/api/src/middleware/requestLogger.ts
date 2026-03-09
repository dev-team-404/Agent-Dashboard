/**
 * Request Logger Middleware (v2)
 *
 * 모든 API 호출의 헤더 정보를 디코딩하여 구조화된 로그로 출력
 * v2: x-user-dept → x-dept-name 헤더 변경 반영
 */

import { Request, Response, NextFunction } from 'express';

function safeDecode(value: string | undefined): string {
  if (!value) return '';
  try {
    if (value.includes('%')) return decodeURIComponent(value);
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
        exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
      };
    } catch {
      return { type: 'jwt', error: 'decode_failed' };
    }
  }

  return { type: 'unknown' };
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  const serviceId = (req.headers['x-service-id'] as string) || '';
  const userId = (req.headers['x-user-id'] as string) || '';
  const deptName = safeDecode(req.headers['x-dept-name'] as string);
  const authInfo = decodeAuthHeader(req.headers['authorization'] as string);

  const model = req.body?.model || '';
  const stream = req.body?.stream || false;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;

    const logLine = `[Request] ${req.method} ${req.originalUrl || req.url} ${status} ${duration}ms` +
      (serviceId ? ` | service=${serviceId}` : '') +
      (userId ? ` | user=${userId}` : '') +
      (deptName ? ` | dept=${deptName}` : '') +
      (model ? ` | model=${model}` : '') +
      (stream ? ` | stream=${stream}` : '') +
      (authInfo ? ` | auth=${authInfo.type}(${authInfo.loginid || ''})` : '');

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
