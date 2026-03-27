/**
 * Auth Routes (v2)
 *
 * SSO 기반 인증 (Dashboard용)
 * 3단계 권한: SUPER_ADMIN / ADMIN / USER
 * Knox 임직원 인증 연동 (최초 1회)
 */

import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, signToken, isSuperAdminByEnv, extractBusinessUnit } from '../middleware/auth.js';
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
