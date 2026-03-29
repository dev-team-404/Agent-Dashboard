import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface IdTokenPayload {
  loginid: string;
  username: string;
  mail?: string;
  deptid?: string;
  deptname: string;
  deptname_en?: string;
  role?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface AccessTokenPayload {
  sub: string;           // loginid
  name: string;          // username
  email?: string;
  dept: string;          // deptname
  dept_en?: string;
  dept_code?: string;
  role?: string;
  iat?: number;
  exp?: number;
  iss?: string;
}

// jwt.sign expiresIn 타입 호환 헬퍼
const signOpts = (expiresIn: string) => ({ algorithm: 'HS256' as const, expiresIn: expiresIn as unknown as number });

/** Mock SSO용 ID 토큰 생성 (HS256) */
export function createMockIdToken(user: IdTokenPayload): string {
  const payload = {
    ...user,
    iss: 'mock-sso',
    aud: 'agent-platform',
  };
  return jwt.sign(payload, config.jwt.secret, signOpts('1h'));
}

/** OIDC Access Token 생성 */
export function createAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp' | 'iss'>): string {
  return jwt.sign(
    { ...payload, iss: config.oidc.issuer },
    config.jwt.secret,
    signOpts(config.jwt.expiresIn),
  );
}

/** OIDC ID Token 생성 — HS256은 client_secret으로 서명 (OIDC Core 10.1) */
export function createOidcIdToken(user: IdTokenPayload, audience: string, nonce?: string, clientSecret?: string): string {
  const payload: Record<string, unknown> = {
    sub: user.loginid,
    name: user.username,
    email: user.mail,
    dept: user.deptname,
    dept_en: user.deptname_en,
    dept_code: user.deptid,
    iss: config.oidc.issuer,
    aud: audience,
  };
  if (nonce) payload['nonce'] = nonce;
  const signingKey = clientSecret || config.jwt.secret;
  return jwt.sign(payload, signingKey, signOpts('1h'));
}

/** JWT 토큰 검증 */
export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    return jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** JWT 토큰 디코딩 (검증 없이) */
export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    return jwt.decode(token, { complete: false }) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Agent Dashboard의 sso.xxx 토큰 디코딩 */
export function decodeSsoToken(base64Part: string): Record<string, unknown> | null {
  try {
    const binary = Buffer.from(base64Part, 'base64').toString('binary');
    const jsonString = decodeURIComponent(
      binary.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}
