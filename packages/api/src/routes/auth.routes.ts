/**
 * Auth Routes (v2)
 *
 * SSO / OIDC 기반 인증 (Dashboard용)
 * 3단계 권한: SUPER_ADMIN / ADMIN / USER
 * Knox 임직원 인증 연동 (최초 1회)
 */

import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, signToken, isSuperAdminByEnv, extractBusinessUnit, requireSuperAdmin } from '../middleware/auth.js';
import crypto from 'crypto';
import { trackActiveUser } from '../services/redis.service.js';
import { redis } from '../index.js';
import { verifyAndRegisterUser } from '../services/knoxEmployee.service.js';

export const authRoutes = Router();

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
 * POST /auth/oidc-token
 * OIDC authorization code → token exchange (server-side proxy to avoid CORS)
 * Frontend sends: { code, redirect_uri, client_id }
 * Returns: OIDC token response { access_token, id_token, ... }
 */
authRoutes.post('/oidc-token', async (req, res) => {
  try {
    const { code, redirect_uri, client_id } = req.body;
    if (!code || !redirect_uri || !client_id) {
      res.status(400).json({ error: 'Missing required OIDC parameters' });
      return;
    }

    // Use server-side issuer — never trust the frontend value (SSRF prevention)
    const issuer = process.env['OIDC_ISSUER'] || 'http://a2g.samsungds.net:8090';
    // Use server-side client secret — never expose in frontend bundle
    const client_secret = process.env['OIDC_CLIENT_SECRET'] || '';

    const tokenUrl = `${issuer}/oidc/token`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri,
      client_id,
      ...(client_secret ? { client_secret } : {}),
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[OIDC] Token exchange failed:', tokenResponse.status, errorText);
      res.status(tokenResponse.status).json({
        error: 'OIDC token exchange failed',
        details: errorText,
      });
      return;
    }

    const tokenData = await tokenResponse.json();
    res.json(tokenData);
  } catch (error) {
    console.error('[OIDC] Token exchange error:', error);
    res.status(500).json({ error: 'OIDC token exchange failed' });
  }
});

/**
 * POST /auth/callback
 * SSO callback - sync user with database
 */
authRoutes.post('/callback', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const loginid = req.user.loginid;
    const deptname = safeDecodeURIComponent(req.user.deptname || '');
    const username = safeDecodeURIComponent(req.user.username || '');
    const businessUnit = extractBusinessUnit(deptname);

    const user = await prisma.user.upsert({
      where: { loginid },
      update: { deptname, username, businessUnit, lastActive: new Date() },
      create: { loginid, deptname, username, businessUnit },
    });

    await trackActiveUser(redis, loginid);
    const sessionToken = signToken({ loginid, deptname, username });

    res.json({
      success: true,
      user: { id: user.id, loginid: user.loginid, deptname: user.deptname, username: user.username },
      sessionToken,
    });
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).json({ error: 'Failed to process authentication' });
  }
});

/**
 * GET /auth/me
 */
authRoutes.get('/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const user = await prisma.user.findUnique({ where: { loginid: req.user.loginid } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    await prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } });
    await trackActiveUser(redis, user.loginid);

    const admin = await prisma.admin.findUnique({ where: { loginid: user.loginid } });
    const isHardcodedFallback = !admin && isSuperAdminByEnv(user.loginid);

    res.json({
      user: {
        id: user.id, loginid: user.loginid, deptname: user.deptname,
        username: user.username, firstSeen: user.firstSeen, lastActive: user.lastActive,
      },
      isAdmin: !!admin || isHardcodedFallback,
      adminRole: admin ? (admin.role as string) : (isHardcodedFallback ? 'SUPER_ADMIN' : null),
      isSuperAdmin: admin?.role === 'SUPER_ADMIN' || isHardcodedFallback,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * POST /auth/refresh
 */
authRoutes.post('/refresh', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { loginid, deptname, username } = req.user;
    const sessionToken = signToken({ loginid, deptname, username });
    res.json({ success: true, sessionToken });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

/**
 * POST /auth/login
 * Dashboard SSO 로그인 + Knox 인증 (미인증 사용자만)
 */
authRoutes.post('/login', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const loginid = req.user.loginid;
    const deptname = safeDecodeURIComponent(req.user.deptname || '');
    const username = safeDecodeURIComponent(req.user.username || '');
    const businessUnit = extractBusinessUnit(deptname);
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || undefined;

    // Knox 인증 체크: 미인증 사용자만 Knox API 호출
    const existingUser = await prisma.user.findUnique({ where: { loginid } });

    let user;
    if (!existingUser || !existingUser.knoxVerified) {
      // Knox API로 인증 (대시보드 로그인 시에는 부서 검증 없이 인증만)
      const knoxResult = await verifyAndRegisterUser(loginid, deptname, 'DASHBOARD', '/dashboard/login', ipAddress);
      if (knoxResult.success && knoxResult.user) {
        user = await prisma.user.findUnique({ where: { id: knoxResult.user.id } });
      } else {
        // Knox 인증 실패해도 대시보드 로그인은 허용 (SSO 인증은 이미 통과)
        // 기존 사용자가 이미 Knox 인증된 경우 deptname 덮어쓰기 방지
        if (existingUser && existingUser.knoxVerified) {
          user = await prisma.user.update({
            where: { loginid },
            data: { lastActive: new Date() },
          });
        } else {
          user = await prisma.user.upsert({
            where: { loginid },
            update: { deptname, username, businessUnit, lastActive: new Date() },
            create: { loginid, deptname, username, businessUnit },
          });
        }
        console.warn(`[Knox] Dashboard login: Knox verification failed for ${loginid}, using SSO info`);
      }
    } else {
      // 이미 Knox 인증 완료 → lastActive만 업데이트
      user = await prisma.user.update({
        where: { loginid },
        data: { lastActive: new Date() },
      });
    }

    if (!user) {
      res.status(500).json({ error: 'Failed to create user' });
      return;
    }

    await trackActiveUser(redis, loginid);

    const admin = await prisma.admin.findUnique({ where: { loginid } });
    const isHardcodedFallback = !admin && isSuperAdminByEnv(loginid);

    const sessionToken = signToken({ loginid, deptname: user.deptname, username: user.username });

    res.json({
      success: true,
      user: { id: user.id, loginid: user.loginid, deptname: user.deptname, username: user.username },
      sessionToken,
      isAdmin: !!admin || isHardcodedFallback,
      adminRole: admin ? (admin.role as string) : (isHardcodedFallback ? 'SUPER_ADMIN' : null),
      isSuperAdmin: admin?.role === 'SUPER_ADMIN' || isHardcodedFallback,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/dev-login
 * 개발/테스트용 로그인 (SSO 우회) — NODE_ENV !== 'production'일 때만 활성화
 */
authRoutes.post('/dev-login', async (req, res) => {
  if (process.env['ENABLE_DEV_LOGIN'] !== 'true') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { loginid } = req.body;
  if (!loginid) {
    res.status(400).json({ error: 'loginid is required' });
    return;
  }

  try {
    const user = await prisma.user.upsert({
      where: { loginid },
      update: { lastActive: new Date() },
      create: { loginid, username: loginid, deptname: '' },
    });

    await trackActiveUser(redis, loginid);

    const admin = await prisma.admin.findUnique({ where: { loginid } });
    const isHardcodedFallback = !admin && isSuperAdminByEnv(loginid);
    const sessionToken = signToken({ loginid, deptname: user.deptname, username: user.username });

    res.json({
      success: true,
      user: { id: user.id, loginid: user.loginid, deptname: user.deptname, username: user.username },
      sessionToken,
      isAdmin: !!admin || isHardcodedFallback,
      adminRole: admin ? (admin.role as string) : (isHardcodedFallback ? 'SUPER_ADMIN' : null),
      isSuperAdmin: admin?.role === 'SUPER_ADMIN' || isHardcodedFallback,
    });
  } catch (error) {
    console.error('Dev login error:', error);
    res.status(500).json({ error: 'Dev login failed' });
  }
});

/**
 * GET /auth/check
 * 현재 세션 권한 정보
 */
authRoutes.get('/check', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const { loginid, deptname, username } = req.user;

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const admin = await prisma.admin.findUnique({ where: { loginid } });
    const isHardcodedFallback = !admin && isSuperAdminByEnv(loginid);

    res.json({
      user: {
        id: user.id, loginid: user.loginid,
        deptname: user.deptname || deptname,
        username: user.username || username,
      },
      isAdmin: !!admin || isHardcodedFallback,
      adminRole: admin ? (admin.role as string) : (isHardcodedFallback ? 'SUPER_ADMIN' : null),
      isSuperAdmin: admin?.role === 'SUPER_ADMIN' || isHardcodedFallback,
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({ error: 'Failed to check auth status' });
  }
});

// ============================================
// OIDC Client Management (Super Admin only)
// ============================================

const DEFAULT_CLIENT_IDS = ['agent-dashboard', 'open-webui', 'cli-default'];

interface OidcClient {
  secret: string;
  redirectUris: string[];
  createdAt?: string;
  createdBy?: string | null;
}

/** Auth Server에 클라이언트 변경 알림 (인메모리 Map 동기화) */
async function syncClientsToAuthServer(clients: Record<string, OidcClient>) {
  try {
    await fetch('https://auth:9050/oidc/admin/reload-clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients }),
    });
  } catch {
    console.warn('[OIDC] Auth Server 클라이언트 동기화 실패 — 다음 재시작 시 반영됨');
  }
}

/**
 * GET /auth/oidc-clients
 * 등록된 OIDC 클라이언트 목록 조회
 */
authRoutes.get('/oidc-clients', authenticateToken, requireSuperAdmin, async (_req: AuthenticatedRequest, res) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'oidc_clients' } });
    const clients: Record<string, OidcClient> = setting?.value ? JSON.parse(setting.value) : {};
    const list = Object.entries(clients).map(([id, c]) => ({
      clientId: id,
      redirectUris: c.redirectUris,
      createdAt: c.createdAt || null,
      createdBy: c.createdBy || null,
      isDefault: DEFAULT_CLIENT_IDS.includes(id),
    }));
    res.json(list);
  } catch (error) {
    console.error('OIDC clients list error:', error);
    res.status(500).json({ error: 'Failed to list OIDC clients' });
  }
});

/**
 * POST /auth/oidc-clients
 * 새 OIDC 클라이언트 생성 (시크릿 자동 생성)
 */
authRoutes.post('/oidc-clients', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId, redirectUris } = req.body;
    if (!clientId || typeof clientId !== 'string' || clientId.trim().length < 2) {
      res.status(400).json({ error: 'clientId는 2자 이상이어야 합니다.' });
      return;
    }

    const cleanId = clientId.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '');
    if (cleanId !== clientId.trim()) {
      res.status(400).json({ error: 'clientId는 영문 소문자, 숫자, 하이픈, 밑줄만 허용됩니다.' });
      return;
    }

    const setting = await prisma.systemSetting.findUnique({ where: { key: 'oidc_clients' } });
    const clients: Record<string, OidcClient> = setting?.value ? JSON.parse(setting.value) : {};

    if (clients[cleanId]) {
      res.status(409).json({ error: '이미 존재하는 클라이언트 ID입니다.' });
      return;
    }

    const secret = crypto.randomUUID();
    clients[cleanId] = {
      secret,
      redirectUris: Array.isArray(redirectUris) && redirectUris.length > 0
        ? redirectUris.map((u: string) => u.trim()).filter(Boolean)
        : ['http://*:*/callback'],
      createdAt: new Date().toISOString(),
      createdBy: req.user?.loginid || null,
    };

    await prisma.systemSetting.upsert({
      where: { key: 'oidc_clients' },
      update: { value: JSON.stringify(clients), updatedBy: req.user?.loginid },
      create: { key: 'oidc_clients', value: JSON.stringify(clients), updatedBy: req.user?.loginid },
    });

    await syncClientsToAuthServer(clients);

    res.json({
      clientId: cleanId,
      secret,
      redirectUris: clients[cleanId].redirectUris,
      createdAt: clients[cleanId].createdAt,
    });
  } catch (error) {
    console.error('OIDC client create error:', error);
    res.status(500).json({ error: 'Failed to create OIDC client' });
  }
});

/**
 * PUT /auth/oidc-clients/:clientId
 * OIDC 클라이언트 수정 (redirectUris 변경, 시크릿 재생성)
 */
authRoutes.put('/oidc-clients/:clientId', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId } = req.params;
    const { redirectUris, regenerateSecret } = req.body;

    const setting = await prisma.systemSetting.findUnique({ where: { key: 'oidc_clients' } });
    const clients: Record<string, OidcClient> = setting?.value ? JSON.parse(setting.value) : {};

    if (!clients[clientId!]) {
      res.status(404).json({ error: '클라이언트를 찾을 수 없습니다.' });
      return;
    }

    if (Array.isArray(redirectUris)) {
      clients[clientId!].redirectUris = redirectUris.map((u: string) => u.trim()).filter(Boolean);
    }

    let newSecret: string | null = null;
    if (regenerateSecret) {
      newSecret = crypto.randomUUID();
      clients[clientId!].secret = newSecret;
    }

    await prisma.systemSetting.upsert({
      where: { key: 'oidc_clients' },
      update: { value: JSON.stringify(clients), updatedBy: req.user?.loginid },
      create: { key: 'oidc_clients', value: JSON.stringify(clients), updatedBy: req.user?.loginid },
    });

    await syncClientsToAuthServer(clients);

    res.json({
      clientId,
      redirectUris: clients[clientId!].redirectUris,
      ...(newSecret ? { secret: newSecret } : {}),
    });
  } catch (error) {
    console.error('OIDC client update error:', error);
    res.status(500).json({ error: 'Failed to update OIDC client' });
  }
});

/**
 * DELETE /auth/oidc-clients/:clientId
 * OIDC 클라이언트 삭제 (기본 클라이언트는 삭제 불가)
 */
authRoutes.delete('/oidc-clients/:clientId', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId } = req.params;

    if (DEFAULT_CLIENT_IDS.includes(clientId!)) {
      res.status(403).json({ error: '기본 클라이언트는 삭제할 수 없습니다.' });
      return;
    }

    const setting = await prisma.systemSetting.findUnique({ where: { key: 'oidc_clients' } });
    const clients: Record<string, OidcClient> = setting?.value ? JSON.parse(setting.value) : {};

    if (!clients[clientId!]) {
      res.status(404).json({ error: '클라이언트를 찾을 수 없습니다.' });
      return;
    }

    delete clients[clientId!];

    await prisma.systemSetting.upsert({
      where: { key: 'oidc_clients' },
      update: { value: JSON.stringify(clients), updatedBy: req.user?.loginid },
      create: { key: 'oidc_clients', value: JSON.stringify(clients), updatedBy: req.user?.loginid },
    });

    await syncClientsToAuthServer(clients);

    res.json({ success: true, message: `클라이언트 '${clientId}'가 삭제되었습니다.` });
  } catch (error) {
    console.error('OIDC client delete error:', error);
    res.status(500).json({ error: 'Failed to delete OIDC client' });
  }
});
