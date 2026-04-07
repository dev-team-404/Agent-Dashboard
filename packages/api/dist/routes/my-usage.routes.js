/**
 * My Usage Routes
 *
 * Endpoints for viewing personal usage statistics
 * - 일반 사용자가 본인의 사용량 통계를 조회
 * - ?serviceId= 쿼리 파라미터로 서비스별 필터링 지원
 */
import { Router } from 'express';
import { prisma, redis } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { withCache } from '../services/redis.service.js';
export const myUsageRoutes = Router();
// 인증 필수
myUsageRoutes.use(authenticateToken);
/**
 * Helper: serviceId 필터 조건 생성
 */
function getServiceFilter(serviceId) {
    return serviceId ? { serviceId } : {};
}
/**
 * GET /my-usage/summary
 * 내 사용량 요약 (오늘, 이번 주, 이번 달)
 * Query: ?serviceId= (optional)
 */
myUsageRoutes.get('/summary', async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const user = await prisma.user.findUnique({
            where: { loginid: req.user.loginid },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const serviceId = req.query['serviceId'];
        const serviceFilter = getServiceFilter(serviceId);
        const result = await withCache(redis, `cache:my-usage:summary:${user.id}:${serviceId || 'all'}`, 180, async () => {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart = new Date(todayStart);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const [todayUsage, weekUsage, monthUsage] = await Promise.all([
                prisma.usageLog.aggregate({
                    where: { userId: user.id, timestamp: { gte: todayStart }, ...serviceFilter },
                    _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
                    _count: true,
                }),
                prisma.usageLog.aggregate({
                    where: { userId: user.id, timestamp: { gte: weekStart }, ...serviceFilter },
                    _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
                    _count: true,
                }),
                prisma.usageLog.aggregate({
                    where: { userId: user.id, timestamp: { gte: monthStart }, ...serviceFilter },
                    _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
                    _count: true,
                }),
            ]);
            return {
                today: {
                    requests: todayUsage._count,
                    inputTokens: todayUsage._sum?.inputTokens ?? 0,
                    outputTokens: todayUsage._sum?.outputTokens ?? 0,
                    totalTokens: todayUsage._sum?.totalTokens ?? 0,
                },
                week: {
                    requests: weekUsage._count,
                    inputTokens: weekUsage._sum?.inputTokens ?? 0,
                    outputTokens: weekUsage._sum?.outputTokens ?? 0,
                    totalTokens: weekUsage._sum?.totalTokens ?? 0,
                },
                month: {
                    requests: monthUsage._count,
                    inputTokens: monthUsage._sum?.inputTokens ?? 0,
                    outputTokens: monthUsage._sum?.outputTokens ?? 0,
                    totalTokens: monthUsage._sum?.totalTokens ?? 0,
                },
                serviceId: serviceId || null,
            };
        });
        res.json(result);
    }
    catch (error) {
        console.error('Get my usage summary error:', error);
        res.status(500).json({ error: 'Failed to get usage summary' });
    }
});
/**
 * GET /my-usage/daily
 * 내 일별 사용량 (최근 N일)
 * Query: ?serviceId= (optional), ?days=
 */
myUsageRoutes.get('/daily', async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const user = await prisma.user.findUnique({
            where: { loginid: req.user.loginid },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const serviceId = req.query['serviceId'];
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        const result = await withCache(redis, `cache:my-usage:daily:${user.id}:${days}:${serviceId || 'all'}`, 300, async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            startDate.setHours(0, 0, 0, 0);
            let dailyStats;
            if (serviceId) {
                dailyStats = await prisma.$queryRaw `
          SELECT
            DATE(timestamp) as date,
            COALESCE(SUM(request_count), 0) as requests,
            COALESCE(SUM("inputTokens"), 0) as input_tokens,
            COALESCE(SUM("outputTokens"), 0) as output_tokens,
            COALESCE(SUM("totalTokens"), 0) as total_tokens
          FROM usage_logs
          WHERE user_id = ${user.id}
            AND timestamp >= ${startDate}
            AND service_id::text = ${serviceId}
          GROUP BY DATE(timestamp)
          ORDER BY date ASC
        `;
            }
            else {
                dailyStats = await prisma.$queryRaw `
          SELECT
            DATE(timestamp) as date,
            COALESCE(SUM(request_count), 0) as requests,
            COALESCE(SUM("inputTokens"), 0) as input_tokens,
            COALESCE(SUM("outputTokens"), 0) as output_tokens,
            COALESCE(SUM("totalTokens"), 0) as total_tokens
          FROM usage_logs
          WHERE user_id = ${user.id}
            AND timestamp >= ${startDate}
          GROUP BY DATE(timestamp)
          ORDER BY date ASC
        `;
            }
            return { stats: dailyStats.map(row => ({
                    date: row.date instanceof Date
                        ? row.date.toISOString().split('T')[0]
                        : String(row.date).split('T')[0],
                    requests: Number(row.requests),
                    inputTokens: Number(row.input_tokens),
                    outputTokens: Number(row.output_tokens),
                    totalTokens: Number(row.total_tokens),
                })) };
        });
        res.json(result);
    }
    catch (error) {
        console.error('Get my daily usage error:', error);
        res.status(500).json({ error: 'Failed to get daily usage' });
    }
});
/**
 * GET /my-usage/by-model
 * 내 모델별 사용량
 * Query: ?serviceId= (optional), ?days=
 */
myUsageRoutes.get('/by-model', async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const user = await prisma.user.findUnique({
            where: { loginid: req.user.loginid },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const serviceId = req.query['serviceId'];
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        const result = await withCache(redis, `cache:my-usage:by-model:${user.id}:${days}:${serviceId || 'all'}`, 300, async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            const usage = await prisma.usageLog.groupBy({
                by: ['modelId'],
                where: {
                    userId: user.id,
                    timestamp: { gte: startDate },
                    ...getServiceFilter(serviceId),
                },
                _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
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
        console.error('Get my usage by model error:', error);
        res.status(500).json({ error: 'Failed to get usage by model' });
    }
});
/**
 * GET /my-usage/by-service
 * 내 서비스별 사용량 요약
 */
myUsageRoutes.get('/by-service', async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const user = await prisma.user.findUnique({
            where: { loginid: req.user.loginid },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        const result = await withCache(redis, `cache:my-usage:by-service:${user.id}:${days}`, 300, async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            const usage = await prisma.usageLog.groupBy({
                by: ['serviceId'],
                where: {
                    userId: user.id,
                    timestamp: { gte: startDate },
                    serviceId: { not: null },
                },
                _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
                _count: true,
            });
            const serviceIds = usage.map(u => u.serviceId).filter(Boolean);
            const services = await prisma.service.findMany({
                where: { id: { in: serviceIds } },
                select: { id: true, name: true, displayName: true },
            });
            const serviceMap = new Map(services.map(s => [s.id, s]));
            return { usage: usage
                    .filter(u => serviceMap.has(u.serviceId))
                    .map(u => ({
                    serviceId: u.serviceId,
                    serviceName: serviceMap.get(u.serviceId).name,
                    serviceDisplayName: serviceMap.get(u.serviceId).displayName,
                    requests: u._count,
                    inputTokens: u._sum?.inputTokens ?? 0,
                    outputTokens: u._sum?.outputTokens ?? 0,
                    totalTokens: u._sum?.totalTokens ?? 0,
                })) };
        });
        res.json(result);
    }
    catch (error) {
        console.error('Get my usage by service error:', error);
        res.status(500).json({ error: 'Failed to get usage by service' });
    }
});
/**
 * GET /my-usage/recent
 * 내 최근 사용 로그
 * Query: ?serviceId= (optional), ?limit=, ?offset=
 */
myUsageRoutes.get('/recent', async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const user = await prisma.user.findUnique({
            where: { loginid: req.user.loginid },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const serviceId = req.query['serviceId'];
        const limit = Math.min(100, Math.max(1, parseInt(req.query['limit']) || 50));
        const offset = Math.max(0, parseInt(req.query['offset']) || 0);
        const whereClause = {
            userId: user.id,
            ...getServiceFilter(serviceId),
        };
        const [logs, total] = await Promise.all([
            prisma.usageLog.findMany({
                where: whereClause,
                orderBy: { timestamp: 'desc' },
                take: limit,
                skip: offset,
                include: {
                    model: {
                        select: { displayName: true },
                    },
                    service: {
                        select: { id: true, name: true, displayName: true },
                    },
                },
            }),
            prisma.usageLog.count({ where: whereClause }),
        ]);
        // Unknown 서비스 제외: service가 존재하는 로그만 반환
        const filteredLogs = logs.filter(log => log.service !== null);
        res.json({
            logs: filteredLogs.map(log => ({
                id: log.id,
                modelName: log.model.displayName,
                serviceName: log.service.displayName,
                serviceId: log.serviceId,
                inputTokens: log.inputTokens,
                outputTokens: log.outputTokens,
                totalTokens: log.totalTokens,
                timestamp: log.timestamp,
            })),
            pagination: {
                total,
                limit,
                offset,
            },
        });
    }
    catch (error) {
        console.error('Get my recent usage error:', error);
        res.status(500).json({ error: 'Failed to get recent usage' });
    }
});
//# sourceMappingURL=my-usage.routes.js.map