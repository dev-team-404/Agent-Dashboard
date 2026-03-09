/**
 * Public Stats Routes
 *
 * 인증 없이 접근 가능한 사용량 통계 공개 API
 * DailyUsageStat 집계 테이블을 사용하여 성능 최적화
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index.js';

export const publicStatsRoutes = Router();

// ─── Helpers ────────────────────────────────────────────────

function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function parseDateRange(query: Request['query']): {
  startDate: Date;
  endDate: Date;
  error?: string;
} {
  const startStr = query['startDate'] as string | undefined;
  const endStr = query['endDate'] as string | undefined;

  if (!startStr || !endStr) {
    return {
      startDate: new Date(),
      endDate: new Date(),
      error: 'startDate와 endDate는 필수 파라미터입니다. (형식: YYYY-MM-DD)',
    };
  }

  if (!isValidDate(startStr) || !isValidDate(endStr)) {
    return {
      startDate: new Date(),
      endDate: new Date(),
      error: '유효하지 않은 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
    };
  }

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);

  if (endDate < startDate) {
    return {
      startDate,
      endDate,
      error: 'endDate는 startDate보다 같거나 이후여야 합니다.',
    };
  }

  const diffDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays > 365) {
    return {
      startDate,
      endDate,
      error: '조회 기간은 최대 365일까지 가능합니다.',
    };
  }

  return { startDate, endDate };
}

function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    return date.split('T')[0] || date;
  }
  return date.toISOString().split('T')[0]!;
}

function extractBusinessUnit(deptname: string): string {
  if (!deptname) return '';
  const match = deptname.match(/\(([^)]+)\)/);
  if (match) return match[1]!;
  const parts = deptname.split('/');
  return parts[0]?.trim() || '';
}

// ─── GET /service-usage ─────────────────────────────────────

/**
 * 일별 서비스별 사용량 통계
 */
publicStatsRoutes.get('/service-usage', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceId = req.query['serviceId'] as string | undefined;

    const whereClause: Record<string, unknown> = {
      date: { gte: startDate, lte: endDate },
    };
    if (serviceId) {
      whereClause['serviceId'] = serviceId;
    }

    // Group by date + serviceId
    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['date', 'serviceId'],
      where: whereClause,
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
      _count: {
        userId: true,
      },
      orderBy: { date: 'asc' },
    });

    // Fetch service names
    const serviceIds = [
      ...new Set(stats.map((s) => s.serviceId).filter(Boolean)),
    ] as string[];
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true, displayName: true },
    });
    const serviceMap = new Map(services.map((s) => [s.id, s]));

    const data = stats.map((s) => {
      const svc = s.serviceId ? serviceMap.get(s.serviceId) : null;
      const inputTokens = s._sum.totalInputTokens ?? 0;
      const outputTokens = s._sum.totalOutputTokens ?? 0;
      return {
        date: formatDate(s.date),
        serviceId: s.serviceId || null,
        serviceName: svc?.name || 'unknown',
        requests: s._sum.requestCount ?? 0,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        activeUsers: s._count.userId,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Public stats service-usage error:', err);
    res.status(500).json({ error: '서비스 사용량 통계 조회에 실패했습니다.' });
  }
});

// ─── GET /team-tokens ───────────────────────────────────────

/**
 * 팀/부서별 토큰 사용량
 */
publicStatsRoutes.get('/team-tokens', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceId = req.query['serviceId'] as string | undefined;

    const whereClause: Record<string, unknown> = {
      date: { gte: startDate, lte: endDate },
    };
    if (serviceId) {
      whereClause['serviceId'] = serviceId;
    }

    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['deptname'],
      where: whereClause,
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
      orderBy: { deptname: 'asc' },
    });

    const data = stats.map((s) => {
      const inputTokens = s._sum.totalInputTokens ?? 0;
      const outputTokens = s._sum.totalOutputTokens ?? 0;
      return {
        deptname: s.deptname,
        businessUnit: extractBusinessUnit(s.deptname),
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        requestCount: s._sum.requestCount ?? 0,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Public stats team-tokens error:', err);
    res.status(500).json({ error: '팀별 토큰 사용량 조회에 실패했습니다.' });
  }
});

// ─── GET /team-service-usage ────────────────────────────────

/**
 * 팀 × 서비스 크로스탭 사용량
 */
publicStatsRoutes.get('/team-service-usage', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const deptname = req.query['deptname'] as string | undefined;
    const serviceId = req.query['serviceId'] as string | undefined;

    const whereClause: Record<string, unknown> = {
      date: { gte: startDate, lte: endDate },
    };
    if (deptname) {
      whereClause['deptname'] = deptname;
    }
    if (serviceId) {
      whereClause['serviceId'] = serviceId;
    }

    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['deptname', 'serviceId'],
      where: whereClause,
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
      orderBy: [{ deptname: 'asc' }],
    });

    // Fetch service names
    const serviceIds = [
      ...new Set(stats.map((s) => s.serviceId).filter(Boolean)),
    ] as string[];
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true, displayName: true },
    });
    const serviceMap = new Map(services.map((s) => [s.id, s]));

    const data = stats.map((s) => {
      const svc = s.serviceId ? serviceMap.get(s.serviceId) : null;
      const totalTokens =
        (s._sum.totalInputTokens ?? 0) + (s._sum.totalOutputTokens ?? 0);
      return {
        deptname: s.deptname,
        businessUnit: extractBusinessUnit(s.deptname),
        serviceId: s.serviceId || null,
        serviceName: svc?.name || 'unknown',
        requests: s._sum.requestCount ?? 0,
        totalTokens,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Public stats team-service-usage error:', err);
    res.status(500).json({ error: '팀-서비스 사용량 조회에 실패했습니다.' });
  }
});

// ─── GET /service-tokens ────────────────────────────────────

/**
 * 서비스별 토큰 사용량
 */
publicStatsRoutes.get('/service-tokens', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['serviceId'],
      where: {
        date: { gte: startDate, lte: endDate },
      },
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
      _count: {
        userId: true,
      },
    });

    // Fetch service info
    const serviceIds = [
      ...new Set(stats.map((s) => s.serviceId).filter(Boolean)),
    ] as string[];
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true, displayName: true },
    });
    const serviceMap = new Map(services.map((s) => [s.id, s]));

    // For unique users per service, we need a separate query
    const uniqueUserCounts = await prisma.dailyUsageStat.groupBy({
      by: ['serviceId', 'userId'],
      where: {
        date: { gte: startDate, lte: endDate },
        userId: { not: null },
      },
    });
    const uniqueUsersMap = new Map<string | null, Set<string>>();
    for (const row of uniqueUserCounts) {
      const key = row.serviceId || '__none__';
      if (!uniqueUsersMap.has(key)) {
        uniqueUsersMap.set(key, new Set());
      }
      if (row.userId) {
        uniqueUsersMap.get(key)!.add(row.userId);
      }
    }

    const data = stats.map((s) => {
      const svc = s.serviceId ? serviceMap.get(s.serviceId) : null;
      const inputTokens = s._sum.totalInputTokens ?? 0;
      const outputTokens = s._sum.totalOutputTokens ?? 0;
      const key = s.serviceId || '__none__';
      return {
        serviceId: s.serviceId || null,
        serviceName: svc?.name || 'unknown',
        serviceDisplayName: svc?.displayName || 'Unknown',
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        requestCount: s._sum.requestCount ?? 0,
        uniqueUsers: uniqueUsersMap.get(key)?.size ?? 0,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Public stats service-tokens error:', err);
    res
      .status(500)
      .json({ error: '서비스별 토큰 사용량 조회에 실패했습니다.' });
  }
});

// ─── GET /summary ───────────────────────────────────────────

/**
 * 전체 사용량 요약
 */
publicStatsRoutes.get('/summary', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const whereClause = {
      date: { gte: startDate, lte: endDate },
    };

    const aggregate = await prisma.dailyUsageStat.aggregate({
      where: whereClause,
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
    });

    // Unique users
    const uniqueUsers = await prisma.dailyUsageStat.groupBy({
      by: ['userId'],
      where: {
        ...whereClause,
        userId: { not: null },
      },
    });

    // Unique services
    const uniqueServices = await prisma.dailyUsageStat.groupBy({
      by: ['serviceId'],
      where: {
        ...whereClause,
        serviceId: { not: null },
      },
    });

    const totalInputTokens = aggregate._sum.totalInputTokens ?? 0;
    const totalOutputTokens = aggregate._sum.totalOutputTokens ?? 0;
    const periodDays =
      Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    res.json({
      data: {
        totalRequests: aggregate._sum.requestCount ?? 0,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalInputTokens,
        totalOutputTokens,
        uniqueUsers: uniqueUsers.length,
        uniqueServices: uniqueServices.length,
        periodDays,
      },
    });
  } catch (err) {
    console.error('Public stats summary error:', err);
    res.status(500).json({ error: '사용량 요약 조회에 실패했습니다.' });
  }
});
