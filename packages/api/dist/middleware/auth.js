/**
 * Authentication Middleware (v2)
 *
 * 3단계 권한 체계:
 * - SUPER_ADMIN: 하드코딩(syngha.han, young87.kim, byeongju.lee) + DB 지정자
 * - ADMIN: super admin이 지정, dept 내 권한
 * - USER: 일반 사용자 (대시보드: 본인 사용량만)
 *
 * Dashboard 인증: JWT/SSO 토큰 (기존 유지)
 * API 프록시 인증: x-service-id, x-user-id, x-dept-name 헤더 기반
 */
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';
const JWT_SECRET = process.env['JWT_SECRET'] || 'your-jwt-secret-change-in-production';
// 하드코딩된 Super Admin 목록
const HARDCODED_SUPER_ADMINS = ['syngha.han', 'young87.kim', 'byeongju.lee'];
/**
 * 하드코딩 Super Admin인지 확인
 */
export function isHardcodedSuperAdmin(loginid) {
    return HARDCODED_SUPER_ADMINS.includes(loginid);
}
/**
 * 환경변수 + 하드코딩 Super Admin인지 확인
 */
export function isSuperAdminByEnv(loginid) {
    if (isHardcodedSuperAdmin(loginid))
        return true;
    const developers = (process.env['DEVELOPERS'] || '').split(',').map(d => d.trim()).filter(Boolean);
    return developers.includes(loginid);
}
/**
 * deptname에서 businessUnit 추출
 * "SW혁신팀(S.LSI)" → "S.LSI"
 */
export function extractBusinessUnit(deptname) {
    if (!deptname)
        return '';
    const match = deptname.match(/\(([^)]+)\)/);
    if (match)
        return match[1];
    const parts = deptname.split('/');
    return parts[0]?.trim() || '';
}
/**
 * deptname에서 팀명 추출
 * "SW혁신팀(S.LSI)" → "SW혁신팀"
 */
export function extractTeamName(deptname) {
    if (!deptname)
        return '';
    const match = deptname.match(/^([^(]+)/);
    return match ? match[1].trim() : deptname.trim();
}
/**
 * Verify JWT token and attach user to request
 */
export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        res.status(401).json({ error: 'Access token required' });
        return;
    }
    try {
        const internalPayload = verifyInternalToken(token);
        if (internalPayload && internalPayload.loginid) {
            req.user = internalPayload;
            next();
            return;
        }
        if (token.startsWith('sso.')) {
            const ssoData = decodeSSOToken(token.substring(4));
            if (ssoData && ssoData.loginid) {
                req.user = ssoData;
                next();
                return;
            }
        }
        const decoded = decodeJWT(token);
        if (!decoded || !decoded.loginid) {
            res.status(403).json({ error: 'Invalid token' });
            return;
        }
        req.user = decoded;
        next();
    }
    catch (error) {
        console.error('Token verification error:', error);
        res.status(403).json({ error: 'Invalid token' });
    }
}
/**
 * Check if user is an admin (SUPER_ADMIN or ADMIN)
 */
export async function requireAdmin(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    try {
        // 1. 하드코딩/환경변수 Super Admin 체크
        if (isSuperAdminByEnv(req.user.loginid)) {
            req.isAdmin = true;
            req.isSuperAdmin = true;
            req.adminRole = 'SUPER_ADMIN';
            req.adminDept = req.user.deptname;
            req.adminBusinessUnit = extractBusinessUnit(req.user.deptname);
            next();
            return;
        }
        // 2. DB admin 체크
        const admin = await prisma.admin.findUnique({
            where: { loginid: req.user.loginid },
        });
        if (!admin) {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }
        req.isAdmin = true;
        req.isSuperAdmin = admin.role === 'SUPER_ADMIN';
        req.adminRole = admin.role;
        req.adminId = admin.id;
        req.adminDept = admin.deptname || req.user.deptname;
        req.adminBusinessUnit = admin.businessUnit || extractBusinessUnit(req.user.deptname);
        next();
    }
    catch (error) {
        console.error('Admin check error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
/**
 * Check if user is a super admin
 */
export async function requireSuperAdmin(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    try {
        if (isSuperAdminByEnv(req.user.loginid)) {
            req.isAdmin = true;
            req.isSuperAdmin = true;
            req.adminRole = 'SUPER_ADMIN';
            next();
            return;
        }
        const admin = await prisma.admin.findUnique({
            where: { loginid: req.user.loginid },
        });
        if (!admin || admin.role !== 'SUPER_ADMIN') {
            res.status(403).json({ error: 'Super admin access required' });
            return;
        }
        req.isAdmin = true;
        req.isSuperAdmin = true;
        req.adminRole = 'SUPER_ADMIN';
        req.adminId = admin.id;
        next();
    }
    catch (error) {
        console.error('Super admin check error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
/**
 * LLM이 특정 사용자(dept/BU/role)에게 보이는지 확인
 */
export function isModelVisibleTo(model, userDept, userBU, isAdmin) {
    switch (model.visibility) {
        case 'PUBLIC':
            return true;
        case 'BUSINESS_UNIT':
            return model.visibilityScope.includes(userBU);
        case 'TEAM':
            return model.visibilityScope.includes(userDept);
        case 'ADMIN_ONLY':
            return isAdmin;
        case 'SUPER_ADMIN_ONLY':
            return false; // Only super admins can see; handled separately before calling this
        default:
            return false;
    }
}
// ============================================
// Token utility functions
// ============================================
function safeDecodeURIComponent(str) {
    if (!str)
        return '';
    try {
        if (str.includes('%'))
            return decodeURIComponent(str);
        return str;
    }
    catch {
        return str;
    }
}
function decodeSSOToken(base64Token) {
    try {
        const binaryString = Buffer.from(base64Token, 'base64').toString('binary');
        const jsonString = decodeURIComponent(binaryString.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        const payload = JSON.parse(jsonString);
        return {
            loginid: safeDecodeURIComponent(payload.loginid || ''),
            deptname: safeDecodeURIComponent(payload.deptname || ''),
            username: safeDecodeURIComponent(payload.username || ''),
        };
    }
    catch (error) {
        console.error('SSO token decode error:', error);
        return null;
    }
}
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        const loginid = payload.loginid || payload.sub || payload.user_id || payload.userId || payload.id || '';
        const deptname = payload.deptname || payload.department || payload.dept || payload.deptName || '';
        const username = payload.username || payload.name || payload.display_name || payload.userName || payload.displayName || '';
        return {
            loginid: safeDecodeURIComponent(loginid),
            deptname: safeDecodeURIComponent(deptname),
            username: safeDecodeURIComponent(username),
            iat: payload.iat,
            exp: payload.exp,
        };
    }
    catch (error) {
        console.error('JWT decode error:', error);
        return null;
    }
}
export function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}
export function verifyInternalToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=auth.js.map