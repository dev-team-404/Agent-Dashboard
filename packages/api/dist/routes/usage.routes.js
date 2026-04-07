/**
 * Usage Routes
 *
 * Endpoints for viewing usage statistics
 */
import { Router } from 'express';
import { prisma, redis } from '../index.js';
import { getTodayUsage, getActiveUserCount, withCache } from '../services/redis.service.js';
export const usageRoutes = Router();
/**
 * GET /usage/summary
 * Get usage summary (today's stats)
 */
usageRoutes.get('/summary', async (_req, res) => {
    try {
        const todayUsage = await getTodayUsage(redis);
        const activeUsers = await getActiveUserCount(redis);
        res.json({
            today: todayUsage,
            activeUsers,
        });
    }
    catch (error) {
        console.error('Get usage summary error:', error);
        res.status(500).json({ error: 'Failed to get usage summary' });
    }
});
/**
 * GET /usage/daily
 * Get daily usage stats for the last N days
 */
usageRoutes.get('/daily', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 7));
        const result = await withCache(redis, `cache:usage:daily:${days}`, 60, async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            const raw = await prisma.usageLog.groupBy({
                by: ['timestamp'],
                where: { timestamp: { gte: startDate } },
                _sum: {
                    inputTokens: true,
                    outputTokens: true,
                    totalTokens: true,
                },
                _count: true,
            });
            // Aggregate by date (YYYY-MM-DD)
            const byDate = new Map();
            for (const r of raw) {
                const dateStr = r.timestamp.toISOString().slice(0, 10);
                const existing = byDate.get(dateStr);
                if (existing) {
                    existing.requests += r._count;
                    existing.inputTokens += r._sum?.inputTokens ?? 0;
                    existing.outputTokens += r._sum?.outputTokens ?? 0;
                    existing.totalTokens += r._sum?.totalTokens ?? 0;
                }
                else {
                    byDate.set(dateStr, {
                        date: dateStr,
                        requests: r._count,
                        inputTokens: r._sum?.inputTokens ?? 0,
                        outputTokens: r._sum?.outputTokens ?? 0,
                        totalTokens: r._sum?.totalTokens ?? 0,
                    });
                }
            }
            const stats = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
            return { stats };
        });
        res.json(result);
    }
    catch (error) {
        console.error('Get daily usage error:', error);
        res.status(500).json({ error: 'Failed to get daily usage' });
    }
});
/**
 * GET /usage/by-model
 * Get usage breakdown by model
 */
usageRoutes.get('/by-model', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 7));
        const result = await withCache(redis, `cache:usage:by-model:${days}`, 60, async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            const usage = await prisma.usageLog.groupBy({
                by: ['modelId'],
                where: {
                    timestamp: { gte: startDate },
                },
                _sum: {
                    inputTokens: true,
                    outputTokens: true,
                    totalTokens: true,
                },
                _count: true,
            });
            const modelIds = usage.map(u => u.modelId);
            const models = await prisma.model.findMany({
                where: { id: { in: modelIds } },
                select: { id: true, displayName: true },
            });
            const modelMap = new Map(models.map(m => [m.id, m.displayName]));
            return { usage: usage.map(u => ({
                    modelId: u.modelId,
                    modelName: modelMap.get(u.modelId) || u.modelId,
                    requests: u._count,
                    inputTokens: u._sum?.inputTokens ?? 0,
                    outputTokens: u._sum?.outputTokens ?? 0,
                    totalTokens: u._sum?.totalTokens ?? 0,
                })) };
        });
        res.json(result);
    }
    catch (error) {
        console.error('Get usage by model error:', error);
        res.status(500).json({ error: 'Failed to get usage by model' });
    }
});
/**
 * GET /usage/by-user
 * Get usage breakdown by user
 */
usageRoutes.get('/by-user', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 7));
        const result = await withCache(redis, `cache:usage:by-user:${days}`, 60, async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            const usage = await prisma.usageLog.groupBy({
                by: ['userId'],
                where: {
                    timestamp: { gte: startDate },
                    userId: { not: null },
                },
                _sum: {
                    inputTokens: true,
                    outputTokens: true,
                    totalTokens: true,
                },
                _count: true,
            });
            const userIds = usage.map(u => u.userId).filter((id) => id !== null);
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, username: true, loginid: true },
            });
            const userMap = new Map(users.map(u => [u.id, { username: u.username, loginid: u.loginid }]));
            return { usage: usage.map(u => ({
                    userId: u.userId,
                    username: u.userId ? (userMap.get(u.userId)?.username || 'Unknown') : 'Background',
                    loginid: u.userId ? (userMap.get(u.userId)?.loginid || 'unknown') : 'background',
                    requests: u._count,
                    inputTokens: u._sum?.inputTokens ?? 0,
                    outputTokens: u._sum?.outputTokens ?? 0,
                    totalTokens: u._sum?.totalTokens ?? 0,
                })) };
        });
        res.json(result);
    }
    catch (error) {
        console.error('Get usage by user error:', error);
        res.status(500).json({ error: 'Failed to get usage by user' });
    }
});
/**
 * GET /usage/logs
 * Get recent usage logs
 */
usageRoutes.get('/logs', async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query['limit']) || 100));
        const offset = Math.max(0, parseInt(req.query['offset']) || 0);
        const logs = await prisma.usageLog.findMany({
            orderBy: { timestamp: 'desc' },
            take: limit,
            skip: offset,
            include: {
                user: {
                    select: { username: true, loginid: true },
                },
                model: {
                    select: { displayName: true },
                },
            },
        });
        const total = await prisma.usageLog.count();
        res.json({
            logs,
            pagination: {
                total,
                limit,
                offset,
            },
        });
    }
    catch (error) {
        console.error('Get usage logs error:', error);
        res.status(500).json({ error: 'Failed to get usage logs' });
    }
});
//# sourceMappingURL=usage.routes.js.map