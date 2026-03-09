/**
 * Auth Routes (v2)
 *
 * SSO 기반 인증 (Dashboard용)
 * 3단계 권한: SUPER_ADMIN / ADMIN / USER
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, signToken, isSuperAdminByEnv, extractBusinessUnit } from '../middleware/auth.js';
import { trackActiveUser } from '../services/redis.service.js';
import { redis } from '../index.js';
export const authRoutes = Router();
function safeDecodeURIComponent(text) {
    if (!text)
        return text;
    try {
        if (!text.includes('%'))
            return text;
        return decodeURIComponent(text);
    }
    catch {
        return text;
    }
}
/**
 * POST /auth/callback
 * SSO callback - sync user with database
 */
authRoutes.post('/callback', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
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
    }
    catch (error) {
        console.error('Auth callback error:', error);
        res.status(500).json({ error: 'Failed to process authentication' });
    }
});
/**
 * GET /auth/me
 */
authRoutes.get('/me', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const user = await prisma.user.findUnique({ where: { loginid: req.user.loginid } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        await prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } });
        await trackActiveUser(redis, user.loginid);
        const admin = await prisma.admin.findUnique({ where: { loginid: user.loginid } });
        const isEnvSuperAdmin = isSuperAdminByEnv(user.loginid);
        res.json({
            user: {
                id: user.id, loginid: user.loginid, deptname: user.deptname,
                username: user.username, firstSeen: user.firstSeen, lastActive: user.lastActive,
            },
            isAdmin: isEnvSuperAdmin || !!admin,
            adminRole: isEnvSuperAdmin ? 'SUPER_ADMIN' : (admin?.role || null),
            isSuperAdmin: isEnvSuperAdmin || admin?.role === 'SUPER_ADMIN',
        });
    }
    catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});
/**
 * POST /auth/refresh
 */
authRoutes.post('/refresh', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { loginid, deptname, username } = req.user;
        const sessionToken = signToken({ loginid, deptname, username });
        res.json({ success: true, sessionToken });
    }
    catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ error: 'Failed to refresh token' });
    }
});
/**
 * POST /auth/login
 * Dashboard SSO 로그인
 */
authRoutes.post('/login', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
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
        let isAdmin = false;
        let adminRole = null;
        const isEnvSuperAdmin = isSuperAdminByEnv(loginid);
        if (isEnvSuperAdmin) {
            isAdmin = true;
            adminRole = 'SUPER_ADMIN';
        }
        else {
            const admin = await prisma.admin.findUnique({ where: { loginid } });
            if (admin) {
                isAdmin = true;
                adminRole = admin.role;
            }
        }
        const sessionToken = signToken({ loginid, deptname, username });
        res.json({
            success: true,
            user: { id: user.id, loginid: user.loginid, deptname: user.deptname, username: user.username },
            sessionToken,
            isAdmin,
            adminRole,
            isSuperAdmin: isEnvSuperAdmin || adminRole === 'SUPER_ADMIN',
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});
/**
 * GET /auth/check
 * 현재 세션 권한 정보
 */
authRoutes.get('/check', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { loginid, deptname, username } = req.user;
        const user = await prisma.user.findUnique({ where: { loginid } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        let isAdmin = false;
        let adminRole = null;
        const isEnvSuperAdmin = isSuperAdminByEnv(loginid);
        if (isEnvSuperAdmin) {
            isAdmin = true;
            adminRole = 'SUPER_ADMIN';
        }
        else {
            const admin = await prisma.admin.findUnique({ where: { loginid } });
            if (admin) {
                isAdmin = true;
                adminRole = admin.role;
            }
        }
        res.json({
            user: {
                id: user.id, loginid: user.loginid,
                deptname: user.deptname || deptname,
                username: user.username || username,
            },
            isAdmin,
            adminRole,
            isSuperAdmin: isEnvSuperAdmin || adminRole === 'SUPER_ADMIN',
        });
    }
    catch (error) {
        console.error('Auth check error:', error);
        res.status(500).json({ error: 'Failed to check auth status' });
    }
});
//# sourceMappingURL=auth.routes.js.map