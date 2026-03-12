/**
 * Public Stats Routes
 *
 * 인증 없이 접근 가능한 사용량 통계 공개 API
 * DailyUsageStat 집계 테이블을 사용하여 성능 최적화
 * 모든 날짜는 KST (Asia/Seoul) 기준
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index.js';

export const publicStatsRoutes = Router();

// ─── Helpers ────────────────────────────────────────────────

function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/**
 * YYYY-MM-DD 문자열을 KST 자정 기준 Date 객체로 변환
 * PostgreSQL DATE 칼럼은 UTC 00:00 으로 저장되므로,
 * KST 날짜를 정확히 매칭하려면 UTC 기준으로 변환
 */
function toKstDate(dateStr: string): Date {
  // "2025-01-15" → KST 2025-01-15 00:00 = UTC 2025-01-14 15:00
  // 하지만 DB에 date만 저장되므로 날짜 자체로 비교하면 됨
  return new Date(dateStr + 'T00:00:00.000Z');
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

  const startDate = toKstDate(startStr);
  const endDate = toKstDate(endStr);

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

function extractBusinessUnit(deptname: string): string {
  if (!deptname) return '';
  const match = deptname.match(/\(([^)]+)\)/);
  if (match) return match[1]!;
  const parts = deptname.split('/');
  return parts[0]?.trim() || '';
}

// ─── 1. GET /services ───────────────────────────────────────

/**
 * 전체 서비스 ID 목록
 */
publicStatsRoutes.get('/services', async (_req: Request, res: Response) => {
  try {
    const services = await prisma.service.findMany({
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        type: true,
        status: true,
        enabled: true,
        targetMM: true,
        serviceCategory: true,
        standardMD: true,
        jiraTicket: true,
        serviceUrl: true,
        docsUrl: true,
        registeredBy: true,
        registeredByDept: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      data: services.map((s) => ({
        serviceId: s.id,
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        type: s.type,
        status: s.status,
        enabled: s.enabled,
        targetMM: s.targetMM,
        serviceCategory: s.serviceCategory,
        standardMD: s.standardMD,
        jiraTicket: s.jiraTicket,
        serviceUrl: s.serviceUrl,
        docsUrl: s.docsUrl,
        registeredBy: s.registeredBy,
        registeredByDept: s.registeredByDept,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    console.error('Public stats services error:', err);
    res.status(500).json({ error: '서비스 목록 조회에 실패했습니다.' });
  }
});

// ─── 2. GET /team-usage ─────────────────────────────────────

/**
 * 특정 서비스의 팀별 사용량 (토큰 + API 호출 수)
 */
publicStatsRoutes.get('/team-usage', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceId = req.query['serviceId'] as string | undefined;
    if (!serviceId) {
      res.status(400).json({ error: 'serviceId는 필수 파라미터입니다.' });
      return;
    }

    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['deptname'],
      where: {
        date: { gte: startDate, lte: endDate },
        serviceId,
      },
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
      orderBy: { deptname: 'asc' },
    });

    // Unique users per dept
    const uniqueUserRows = await prisma.dailyUsageStat.groupBy({
      by: ['deptname', 'userId'],
      where: {
        date: { gte: startDate, lte: endDate },
        serviceId,
        userId: { not: null },
      },
    });
    const deptUserMap = new Map<string, Set<string>>();
    for (const row of uniqueUserRows) {
      if (!deptUserMap.has(row.deptname)) {
        deptUserMap.set(row.deptname, new Set());
      }
      if (row.userId) {
        deptUserMap.get(row.deptname)!.add(row.userId);
      }
    }

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
        uniqueUsers: deptUserMap.get(s.deptname)?.size ?? 0,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Public stats team-usage error:', err);
    res.status(500).json({ error: '팀별 사용량 조회에 실패했습니다.' });
  }
});

// ─── 3. GET /team-usage-all ─────────────────────────────────

/**
 * 모든 서비스에 대해 팀별 사용량 (토큰 + API 호출 수)
 */
publicStatsRoutes.get('/team-usage-all', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['deptname', 'serviceId'],
      where: {
        date: { gte: startDate, lte: endDate },
      },
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

    // Unique users per dept+service
    const uniqueUserRows = await prisma.dailyUsageStat.groupBy({
      by: ['deptname', 'serviceId', 'userId'],
      where: {
        date: { gte: startDate, lte: endDate },
        userId: { not: null },
      },
    });
    const deptSvcUserMap = new Map<string, Set<string>>();
    for (const row of uniqueUserRows) {
      const key = `${row.deptname}|${row.serviceId ?? ''}`;
      if (!deptSvcUserMap.has(key)) {
        deptSvcUserMap.set(key, new Set());
      }
      if (row.userId) {
        deptSvcUserMap.get(key)!.add(row.userId);
      }
    }

    const data = stats.map((s) => {
      const svc = s.serviceId ? serviceMap.get(s.serviceId) : null;
      const inputTokens = s._sum.totalInputTokens ?? 0;
      const outputTokens = s._sum.totalOutputTokens ?? 0;
      const key = `${s.deptname}|${s.serviceId ?? ''}`;
      return {
        deptname: s.deptname,
        businessUnit: extractBusinessUnit(s.deptname),
        serviceId: s.serviceId || null,
        serviceName: svc?.name || 'unknown',
        serviceDisplayName: svc?.displayName || 'Unknown',
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        requestCount: s._sum.requestCount ?? 0,
        uniqueUsers: deptSvcUserMap.get(key)?.size ?? 0,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Public stats team-usage-all error:', err);
    res.status(500).json({ error: '전체 팀별 사용량 조회에 실패했습니다.' });
  }
});

// ─── 4. GET /top-users ──────────────────────────────────────

/**
 * 특정 서비스의 Top K 사용자 (토큰 + API 호출 수)
 * topK보다 사용자가 적으면 존재하는 만큼만 반환
 */
publicStatsRoutes.get('/top-users', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceId = req.query['serviceId'] as string | undefined;
    if (!serviceId) {
      res.status(400).json({ error: 'serviceId는 필수 파라미터입니다.' });
      return;
    }

    const topK = Math.min(Math.max(parseInt(req.query['topK'] as string) || 10, 1), 100);

    // Aggregate by userId
    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['userId'],
      where: {
        date: { gte: startDate, lte: endDate },
        serviceId,
        userId: { not: null },
      },
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
    });

    // Sort by totalTokens desc, take topK
    const sorted = stats
      .map((s) => ({
        userId: s.userId!,
        totalInputTokens: s._sum.totalInputTokens ?? 0,
        totalOutputTokens: s._sum.totalOutputTokens ?? 0,
        totalTokens: (s._sum.totalInputTokens ?? 0) + (s._sum.totalOutputTokens ?? 0),
        requestCount: s._sum.requestCount ?? 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, topK);

    // Fetch user info
    const userIds = sorted.map((s) => s.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, loginid: true, username: true, deptname: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = sorted.map((s, i) => {
      const user = userMap.get(s.userId);
      return {
        rank: i + 1,
        userId: s.userId,
        loginId: user?.loginid || 'unknown',
        username: user?.username || 'Unknown',
        deptname: user?.deptname || '',
        businessUnit: extractBusinessUnit(user?.deptname || ''),
        totalInputTokens: s.totalInputTokens,
        totalOutputTokens: s.totalOutputTokens,
        totalTokens: s.totalTokens,
        requestCount: s.requestCount,
      };
    });

    res.json({
      topK,
      totalUsers: stats.length,
      returnedCount: data.length,
      data,
    });
  } catch (err) {
    console.error('Public stats top-users error:', err);
    res.status(500).json({ error: 'Top 사용자 조회에 실패했습니다.' });
  }
});

// ─── 5. GET /top-users-by-dept ──────────────────────────────

/**
 * 특정 서비스 + 부서의 Top K 사용자 (토큰 + API 호출 수)
 * deptname 형식: "팀명(사업부)" 예) "SW혁신팀(S.LSI)"
 * topK보다 사용자가 적으면 존재하는 만큼만 반환
 */
publicStatsRoutes.get('/top-users-by-dept', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceId = req.query['serviceId'] as string | undefined;
    if (!serviceId) {
      res.status(400).json({ error: 'serviceId는 필수 파라미터입니다.' });
      return;
    }

    const deptname = req.query['deptname'] as string | undefined;
    if (!deptname) {
      res.status(400).json({ error: 'deptname은 필수 파라미터입니다. (형식: 팀명(사업부), 예: SW혁신팀(S.LSI))' });
      return;
    }

    const topK = Math.min(Math.max(parseInt(req.query['topK'] as string) || 10, 1), 100);

    // Aggregate by userId within the dept
    const stats = await prisma.dailyUsageStat.groupBy({
      by: ['userId'],
      where: {
        date: { gte: startDate, lte: endDate },
        serviceId,
        deptname,
        userId: { not: null },
      },
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        requestCount: true,
      },
    });

    // Sort by totalTokens desc, take topK
    const sorted = stats
      .map((s) => ({
        userId: s.userId!,
        totalInputTokens: s._sum.totalInputTokens ?? 0,
        totalOutputTokens: s._sum.totalOutputTokens ?? 0,
        totalTokens: (s._sum.totalInputTokens ?? 0) + (s._sum.totalOutputTokens ?? 0),
        requestCount: s._sum.requestCount ?? 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, topK);

    // Fetch user info
    const userIds = sorted.map((s) => s.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, loginid: true, username: true, deptname: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = sorted.map((s, i) => {
      const user = userMap.get(s.userId);
      return {
        rank: i + 1,
        userId: s.userId,
        loginId: user?.loginid || 'unknown',
        username: user?.username || 'Unknown',
        deptname: user?.deptname || '',
        businessUnit: extractBusinessUnit(user?.deptname || ''),
        totalInputTokens: s.totalInputTokens,
        totalOutputTokens: s.totalOutputTokens,
        totalTokens: s.totalTokens,
        requestCount: s.requestCount,
      };
    });

    res.json({
      topK,
      deptname,
      totalUsersInDept: stats.length,
      returnedCount: data.length,
      data,
    });
  } catch (err) {
    console.error('Public stats top-users-by-dept error:', err);
    res.status(500).json({ error: '부서별 Top 사용자 조회에 실패했습니다.' });
  }
});
