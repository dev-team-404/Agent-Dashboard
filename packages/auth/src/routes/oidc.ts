/**
 * OIDC Provider
 *
 * Endpoints:
 *   GET  /.well-known/openid-configuration   — Discovery metadata
 *   GET  /oidc/authorize                      — Authorization endpoint
 *   POST /oidc/sso-callback                   — SSO callback (form_post)
 *   POST /oidc/token                          — Token endpoint
 *   GET  /oidc/userinfo                       — UserInfo endpoint
 *   GET  /oidc/jwks                           — JWKS (placeholder)
 *
 * Auth codes and session states are stored in memory Maps with auto-cleanup.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { config } from '../config.js';
import {
  createAccessToken,
  createOidcIdToken,
  verifyToken,
  decodeToken,
  type IdTokenPayload,
} from '../utils/jwt.js';

const router = Router();

// ============================================
// Client Registry
// ============================================

interface OidcClient {
  secret: string;
  redirectUris: string[];
}

// 기본 클라이언트: redirect_uri는 와일드카드(*)로 사내 어디서든 접근 가능하게
const clients = new Map<string, OidcClient>([
  ['agent-dashboard', {
    secret: process.env['OIDC_DASHBOARD_SECRET'] || 'dashboard-secret',
    redirectUris: ['*'],
  }],
  ['open-webui', {
    secret: process.env['OIDC_OPENWEBUI_SECRET'] || 'open-webui-secret',
    redirectUris: ['*'],
  }],
  ['cli-default', {
    secret: '',
    redirectUris: ['*'],
  }],
]);

// Load additional clients from OIDC_CLIENTS env var (JSON string)
try {
  const envClients = process.env['OIDC_CLIENTS'];
  if (envClients) {
    const parsed: Record<string, { secret: string; redirectUris: string[] }> = JSON.parse(envClients);
    for (const [id, client] of Object.entries(parsed)) {
      clients.set(id, client);
    }
    console.log(`\x1b[36m[OIDC]\x1b[0m Loaded ${Object.keys(parsed).length} extra client(s) from OIDC_CLIENTS`);
  }
} catch (e) {
  console.warn('\x1b[33m[OIDC WARN]\x1b[0m Failed to parse OIDC_CLIENTS env:', e);
}

/** 외부에서 클라이언트를 동적으로 추가/업데이트/삭제할 수 있는 API */
export function reloadClients(clientMap: Record<string, { secret: string; redirectUris: string[] }>) {
  // 기본 클라이언트 유지, 나머지 교체
  const defaultIds = ['agent-dashboard', 'open-webui', 'cli-default'];
  for (const [id] of clients) {
    if (!defaultIds.includes(id)) clients.delete(id);
  }
  for (const [id, client] of Object.entries(clientMap)) {
    clients.set(id, client);
  }
  console.log(`\x1b[36m[OIDC]\x1b[0m Clients reloaded: ${clients.size} total`);
}

/** POST /oidc/admin/reload-clients — API 서버에서 호출 */
router.post('/oidc/admin/reload-clients', (req: Request, res: Response) => {
  try {
    const { clients: newClients } = req.body;
    if (newClients && typeof newClients === 'object') {
      reloadClients(newClients);
    }
    res.json({ success: true, count: clients.size });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reload clients' });
  }
});

/**
 * Validate redirect_uri for a given client.
 * For 'cli-default' we allow any localhost port via wildcard matching.
 */
function isRedirectUriAllowed(client: OidcClient, uri: string): boolean {
  for (const pattern of client.redirectUris) {
    if (pattern === uri) return true;
    // Support wildcard in port — e.g. http://localhost:*
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => m === '*' ? '.*' : '\\' + m) + '$');
      if (regex.test(uri)) return true;
    }
  }
  return false;
}

// ============================================
// In-Memory Stores (with auto-cleanup)
// ============================================

/** Authorization session: created at /oidc/authorize, consumed at /oidc/sso-callback */
interface AuthSession {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state: string;        // client's original state
  nonce: string;
  createdAt: number;
}

/** Authorization code record: created at /oidc/sso-callback, consumed at /oidc/token */
interface AuthCodeRecord {
  user: IdTokenPayload;
  clientId: string;
  redirectUri: string;
  nonce: string;
  createdAt: number;
}

const authSessions = new Map<string, AuthSession>();   // sessionId → session
const authCodes = new Map<string, AuthCodeRecord>();    // code → record

// Auto-cleanup: sessions expire after 10 min, codes after 5 min
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of authSessions) {
    if (now - session.createdAt > 10 * 60 * 1000) authSessions.delete(id);
  }
  for (const [code, record] of authCodes) {
    if (now - record.createdAt > 5 * 60 * 1000) authCodes.delete(code);
  }
}, 60_000); // run every minute

// ============================================
// 1. Discovery Endpoint
// ============================================
router.get('/.well-known/openid-configuration', (_req: Request, res: Response) => {
  const issuer = config.oidc.issuer;
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/oidc/authorize`,
    token_endpoint: `${issuer}/oidc/token`,
    userinfo_endpoint: `${issuer}/oidc/userinfo`,
    jwks_uri: `${issuer}/oidc/jwks`,
    end_session_endpoint: `${issuer}/oidc/logout`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    claims_supported: ['sub', 'name', 'email', 'dept', 'dept_en', 'dept_code', 'nonce'],
    grant_types_supported: ['authorization_code'],
  });
});

// ============================================
// 2. Authorization Endpoint
// ============================================
router.get('/oidc/authorize', (req: Request, res: Response) => {
  const clientId = req.query['client_id'] as string;
  const redirectUri = req.query['redirect_uri'] as string;
  const responseType = req.query['response_type'] as string || 'code';
  const scope = req.query['scope'] as string || 'openid';
  const state = req.query['state'] as string || '';
  const nonce = req.query['nonce'] as string || '';

  // Validate client_id
  const client = clients.get(clientId);
  if (!client) {
    res.status(400).json({ error: 'invalid_client', error_description: `Unknown client_id: ${clientId}` });
    return;
  }

  // Validate redirect_uri
  if (!redirectUri || !isRedirectUriAllowed(client, redirectUri)) {
    res.status(400).json({ error: 'invalid_redirect_uri', error_description: `redirect_uri not registered for client: ${redirectUri}` });
    return;
  }

  // Create session
  const sessionId = uuidv4();
  authSessions.set(sessionId, {
    clientId,
    redirectUri,
    responseType,
    scope,
    state,
    nonce,
    createdAt: Date.now(),
  });

  console.log(`\x1b[36m[OIDC]\x1b[0m Authorize: client=${clientId}, session=${sessionId.substring(0, 8)}...`);

  // SSO 콜백 URL — 삼성 SSO에 등록한 것과 정확히 일치해야 함 (쿼리파라미터 없이)
  const callbackUrl = `${config.oidc.ssoCallbackBase}/oidc/sso-callback`;

  // 세션 ID는 쿠키로 전달 (SSO가 redirect_uri 정확 일치를 요구하므로 쿼리파라미터 사용 불가)
  res.cookie('oidc_sid', sessionId, { httpOnly: true, maxAge: 600000, sameSite: 'lax' });

  if (config.mockSso.enabled) {
    // Redirect to Mock SSO login page
    const mockLoginUrl = new URL(`${config.mockSso.url}/mock-sso/login`);
    mockLoginUrl.searchParams.set('redirect_uri', callbackUrl);
    mockLoginUrl.searchParams.set('client_id', clientId);
    mockLoginUrl.searchParams.set('state', sessionId);
    mockLoginUrl.searchParams.set('nonce', nonce);
    res.redirect(mockLoginUrl.toString());
  } else {
    // Redirect to Samsung real SSO (A2A 구현과 동일한 방식)
    const idpBase = config.sso.idpEntityId || 'https://sso.samsung.com/auth';
    const ssoParams = new URLSearchParams({
      'client_id': config.sso.clientId,
      'redirect_uri': callbackUrl,
      'response_mode': config.sso.responseMode,
      'response_type': config.sso.responseType,
      'scope': config.sso.scope,
      'nonce': nonce,
      'client-request-id': uuidv4(),
      'pullStatus': '0',
    });
    // A2A와 동일한 URL 구성: IDP_ENTITY_ID/?params
    const separator = idpBase.includes('?') ? '&' : '?';
    res.redirect(`${idpBase}${separator}${ssoParams.toString()}`);
  }
});

// ============================================
// 3. SSO Callback (form_post from SSO)
// ============================================
router.post('/oidc/sso-callback', (req: Request, res: Response) => {
  const idToken = req.body['id_token'] as string;
  const _code = req.body['code'] as string;       // SSO's code (we don't use it directly)

  // 세션 ID: 1순위 쿠키 (실제 SSO), 2순위 쿼리 sid (레거시), 3순위 body state (Mock SSO)
  const sessionId = req.cookies?.['oidc_sid'] || (req.query['sid'] as string) || (req.body['state'] as string);

  console.log(`\x1b[36m[OIDC]\x1b[0m SSO callback received, sid=${sessionId?.substring(0, 8)}...`);

  // Look up session
  const session = sessionId ? authSessions.get(sessionId) : undefined;
  if (!session) {
    res.status(400).json({ error: 'invalid_state', error_description: 'Session not found or expired' });
    return;
  }

  // Consume session
  authSessions.delete(sessionId);

  if (!idToken) {
    res.status(400).json({ error: 'missing_id_token', error_description: 'SSO did not return an id_token' });
    return;
  }

  // Decode and verify id_token from SSO
  let userPayload: Record<string, unknown> | null = null;

  if (config.mockSso.enabled) {
    // Mock mode: verify with HS256 using our JWT secret
    userPayload = verifyToken(idToken);
    if (!userPayload) {
      // Fall back to decode without verification (mock SSO sometimes uses different secret)
      userPayload = decodeToken(idToken);
    }
  } else {
    // Real SSO: verify with RS256 certificate — NO fallback to unverified decode
    try {
      const cert = fs.readFileSync(config.sso.certFile, 'utf-8');
      userPayload = jwt.verify(idToken, cert, { algorithms: ['RS256'] }) as Record<string, unknown>;
    } catch (err) {
      console.error('\x1b[31m[OIDC ERROR]\x1b[0m RS256 verification failed:', err);
      res.status(401).json({ error: 'invalid_id_token', error_description: 'SSO id_token signature verification failed' });
      return;
    }
  }

  if (!userPayload) {
    res.status(400).json({ error: 'invalid_id_token', error_description: 'Failed to decode SSO id_token' });
    return;
  }

  // Extract user info from SSO id_token
  const user: IdTokenPayload = {
    loginid: (userPayload['loginid'] || userPayload['sub'] || '') as string,
    username: (userPayload['username'] || userPayload['name'] || '') as string,
    mail: (userPayload['mail'] || userPayload['email'] || '') as string,
    deptid: (userPayload['deptid'] || userPayload['dept_code'] || '') as string,
    deptname: (userPayload['deptname'] || userPayload['dept'] || '') as string,
    deptname_en: (userPayload['deptname_en'] || userPayload['dept_en'] || '') as string,
    role: (userPayload['role'] || '') as string,
  };

  console.log(`\x1b[36m[OIDC]\x1b[0m User authenticated: ${user.loginid} (${user.username})`);

  // 대시보드 로그인 기록
  try {
    import('./dashboard.js').then(({ recordLogin }) => {
      recordLogin({
        loginid: user.loginid,
        username: user.username,
        deptname: user.deptname,
        clientId: session.clientId,
        ip: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
        method: config.mockSso.enabled ? 'mock-sso' : 'oidc',
      });
    }).catch(() => {});
  } catch { /* dashboard not loaded */ }

  // Generate one-time authorization code
  const authCode = uuidv4();
  authCodes.set(authCode, {
    user,
    clientId: session.clientId,
    redirectUri: session.redirectUri,
    nonce: session.nonce,
    createdAt: Date.now(),
  });

  // Redirect back to client's redirect_uri with authorization code and original state
  const redirectUrl = new URL(session.redirectUri);
  redirectUrl.searchParams.set('code', authCode);
  if (session.state) {
    redirectUrl.searchParams.set('state', session.state);
  }

  res.redirect(redirectUrl.toString());
});

// ============================================
// 4. Token Endpoint
// ============================================
router.post('/oidc/token', (req: Request, res: Response) => {
  const grantType = req.body['grant_type'] as string;
  const code = req.body['code'] as string;
  const redirectUri = req.body['redirect_uri'] as string;

  // Support both body params and Basic auth for client credentials
  let clientId = req.body['client_id'] as string || '';
  let clientSecret = req.body['client_secret'] as string || '';

  // Check Authorization header for Basic auth
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx > 0) {
      clientId = clientId || decodeURIComponent(decoded.substring(0, colonIdx));
      clientSecret = clientSecret || decodeURIComponent(decoded.substring(colonIdx + 1));
    }
  }

  // Validate grant_type
  if (grantType !== 'authorization_code') {
    res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported' });
    return;
  }

  // Validate client
  const client = clients.get(clientId);
  if (!client) {
    res.status(401).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
    return;
  }

  // Validate client_secret (skip for clients with empty secret like CLI)
  if (client.secret && client.secret !== clientSecret) {
    res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client_secret' });
    return;
  }

  // Look up authorization code
  if (!code) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing code parameter' });
    return;
  }

  const codeRecord = authCodes.get(code);
  if (!codeRecord) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code not found or expired' });
    return;
  }

  // Delete code (one-time use)
  authCodes.delete(code);

  // Validate code was issued for this client
  if (codeRecord.clientId !== clientId) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Code was not issued for this client' });
    return;
  }

  // Validate redirect_uri matches (if provided)
  if (redirectUri && redirectUri !== codeRecord.redirectUri) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    return;
  }

  // Check code expiry (5 minutes)
  if (Date.now() - codeRecord.createdAt > 5 * 60 * 1000) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
    return;
  }

  const user = codeRecord.user;

  console.log(`\x1b[36m[OIDC]\x1b[0m Token exchange: client=${clientId}, user=${user.loginid}`);

  // Generate access_token (12h)
  const accessToken = createAccessToken({
    sub: user.loginid,
    name: user.username,
    email: user.mail,
    dept: user.deptname,
    dept_en: user.deptname_en,
    dept_code: user.deptid,
    role: user.role,
  });

  // Generate id_token (1h) — client_secret으로 HS256 서명 (OIDC Core 10.1)
  const oidcIdToken = createOidcIdToken(user, clientId, codeRecord.nonce, client.secret);

  // scope에 openid가 포함된 경우에만 id_token 포함
  // 일부 클라이언트(Open WebUI authlib)는 JWKS 기반 검증만 지원하므로
  // include_id_token 쿼리 파라미터 또는 scope 기반으로 제어
  const includeIdToken = codeRecord.nonce ? false : true; // nonce 있으면 클라이언트가 검증 시도 → 생략

  const tokenResponse: Record<string, unknown> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 43200, // 12 hours
  };

  // id_token은 항상 포함하되, 클라이언트가 검증 실패하면 무시할 수 있도록
  // Open WebUI는 nonce+id_token이 있으면 JWKS로 검증 시도 → 실패
  // → id_token을 빼면 userinfo fallback 사용
  if (!codeRecord.nonce) {
    tokenResponse['id_token'] = oidcIdToken;
  }

  res.json(tokenResponse);
});

// ============================================
// 5. UserInfo Endpoint
// ============================================
router.get('/oidc/userinfo', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'invalid_token', error_description: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: 'invalid_token', error_description: 'Access token is invalid or expired' });
    return;
  }

  res.json({
    sub: payload['sub'],
    name: payload['name'],
    email: payload['email'],
    dept: payload['dept'],
    dept_en: payload['dept_en'],
    dept_code: payload['dept_code'],
  });
});

// ============================================
// 6. JWKS Endpoint (placeholder for HS256)
// ============================================
router.get('/oidc/jwks', (_req: Request, res: Response) => {
  // HS256 doesn't expose public keys — this endpoint exists for spec compliance
  res.json({ keys: [] });
});

// ============================================
// 7. Logout Endpoint
// ============================================
router.get('/oidc/logout', (req: Request, res: Response) => {
  const postLogoutRedirectUri = req.query['post_logout_redirect_uri'] as string;
  if (postLogoutRedirectUri) {
    // Validate against registered client redirect URIs to prevent open redirect
    let allowed = false;
    for (const [, client] of clients) {
      if (isRedirectUriAllowed(client, postLogoutRedirectUri)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'post_logout_redirect_uri is not registered' });
      return;
    }
    res.redirect(postLogoutRedirectUri);
  } else {
    res.json({ message: 'Logged out' });
  }
});

export { router as oidcRouter };
