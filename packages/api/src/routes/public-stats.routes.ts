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
      where: { status: 'DEPLOYED' },
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
 * deptname 형식: "팀명(사업부)" 예) "S/W혁신팀(S.LSI)"
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
      res.status(400).json({ error: 'deptname은 필수 파라미터입니다. (형식: 팀명(사업부), 예: S/W혁신팀(S.LSI))' });
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

// ─── 6. GET /dau-mau ─────────────────────────────────────────

/**
 * 서비스별 DAU/MAU (년/월 기준)
 * BACKGROUND 서비스는 추정 DAU/MAU 제공
 */
publicStatsRoutes.get('/dau-mau', async (req: Request, res: Response) => {
  try {
    const year = parseInt(req.query['year'] as string);
    const month = parseInt(req.query['month'] as string);

    if (!year || year < 2000 || year > 2100 || !month || month < 1 || month > 12) {
      res.status(400).json({ error: 'year(2000~2100)와 month(1~12)는 필수 파라미터입니다. (예: year=2026&month=3)' });
      return;
    }

    // KST 기준 해당 월의 시작/끝 (TZ=Asia/Seoul 환경에서 로컬 시간 사용)
    // Date.UTC()를 쓰면 pg 드라이버가 KST로 변환 시 9시간 밀림
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // Get deployed services with metadata
    const services = await prisma.service.findMany({
      where: { status: 'DEPLOYED' },
      select: {
        id: true, name: true, displayName: true, description: true,
        type: true, status: true, enabled: true, iconUrl: true,
        targetMM: true, serviceCategory: true, standardMD: true,
        jiraTicket: true, serviceUrl: true, docsUrl: true,
        registeredBy: true, registeredByDept: true, createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    const standardServiceIds = services.filter(s => s.type === 'STANDARD').map(s => s.id);
    const backgroundServiceIds = services.filter(s => s.type === 'BACKGROUND').map(s => s.id);

    // STANDARD services: real DAU (avg business day) and MAU
    const standardDauResult = await prisma.$queryRaw<
      Array<{ service_id: string; avg_dau: number }>
    >`
      WITH daily_dau AS (
        SELECT ul.service_id::text as service_id, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
          AND u.loginid != 'anonymous'
          AND ul.service_id IS NOT NULL
          AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
        GROUP BY ul.service_id, DATE(ul.timestamp)
      )
      SELECT service_id, COALESCE(AVG(dau), 0)::float as avg_dau FROM daily_dau GROUP BY service_id
    `;

    const standardMauResult = await prisma.$queryRaw<
      Array<{ service_id: string; mau: bigint }>
    >`
      SELECT ul.service_id::text as service_id, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
      GROUP BY ul.service_id
    `;

    // Estimation baseline: 해당 월의 STANDARD 데이터 사용
    // 과거 월 → 고정값 (해당 월 전체), 이번 달 → 실시간 (누적 데이터)
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && (now.getMonth() + 1) === month;
    const baselineStart = startDate;
    const baselineEnd = isCurrentMonth ? now : endDate;

    const [baselineDailyCalls, baselineDailyDau, baselineMonthly] = await Promise.all([
      prisma.$queryRaw<Array<{ avg_daily_calls: number }>>`
        WITH daily AS (
          SELECT DATE(timestamp) as d, COUNT(*) as cnt
          FROM usage_logs
          WHERE timestamp >= ${baselineStart} AND timestamp <= ${baselineEnd}
            AND service_id::text = ANY(${standardServiceIds})
            AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
          GROUP BY DATE(timestamp)
        )
        SELECT COALESCE(AVG(cnt), 0)::float as avg_daily_calls FROM daily
      `,
      prisma.$queryRaw<Array<{ avg_daily_dau: number }>>`
        WITH daily AS (
          SELECT DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.timestamp >= ${baselineStart} AND ul.timestamp <= ${baselineEnd}
            AND ul.service_id::text = ANY(${standardServiceIds})
            AND u.loginid != 'anonymous'
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
          GROUP BY DATE(ul.timestamp)
        )
        SELECT COALESCE(AVG(dau), 0)::float as avg_daily_dau FROM daily
      `,
      prisma.$queryRaw<Array<{ total_calls: bigint; mau: bigint }>>`
        SELECT COUNT(*) as total_calls, COUNT(DISTINCT ul.user_id) as mau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${baselineStart} AND ul.timestamp <= ${baselineEnd}
          AND ul.service_id::text = ANY(${standardServiceIds})
          AND u.loginid != 'anonymous'
      `,
    ]);

    const avgCallsPerDay = baselineDailyCalls[0]?.avg_daily_calls || 0;
    const avgDau = baselineDailyDau[0]?.avg_daily_dau || 0;
    const callsPerPersonPerDay = avgDau > 0 ? avgCallsPerDay / avgDau : 0;
    const totalCalls = Number(baselineMonthly[0]?.total_calls || 0);
    const baseMau = Number(baselineMonthly[0]?.mau || 0);
    const callsPerPersonPerMonth = baseMau > 0 ? totalCalls / baseMau : 0;

    // BACKGROUND services: get calls in the requested month
    const bgDailyResult = await prisma.$queryRaw<
      Array<{ service_id: string; avg_daily_calls: number }>
    >`
      WITH daily AS (
        SELECT service_id::text as service_id, DATE(timestamp) as d, COUNT(*) as cnt
        FROM usage_logs
        WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
          AND service_id::text = ANY(${backgroundServiceIds})
          AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
        GROUP BY service_id, DATE(timestamp)
      )
      SELECT service_id, COALESCE(AVG(cnt), 0)::float as avg_daily_calls FROM daily GROUP BY service_id
    `;

    const bgMonthlyResult = await prisma.$queryRaw<
      Array<{ service_id: string; total_calls: bigint }>
    >`
      SELECT service_id::text as service_id, COUNT(*) as total_calls
      FROM usage_logs
      WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
        AND service_id::text = ANY(${backgroundServiceIds})
      GROUP BY service_id
    `;

    // 일별 DAU (서비스별 + 전체 중복제거) — 라인 차트용
    const dailyDauRows = await prisma.$queryRaw<
      Array<{ service_id: string; d: Date | string; dau: bigint }>
    >`
      SELECT ul.service_id::text as service_id, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
      GROUP BY ul.service_id, DATE(ul.timestamp)
      ORDER BY d ASC
    `;
    const dailyOverallRows = await prisma.$queryRaw<
      Array<{ d: Date | string; dau: bigint }>
    >`
      SELECT DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
      GROUP BY DATE(ul.timestamp)
      ORDER BY d ASC
    `;

    // BACKGROUND 일별 호출 수 (추정 DAU 계산용)
    const bgDailyCallRows = await prisma.$queryRaw<
      Array<{ service_id: string; d: Date | string; cnt: bigint }>
    >`
      SELECT service_id::text as service_id, DATE(timestamp) as d, COUNT(*) as cnt
      FROM usage_logs
      WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
        AND service_id::text = ANY(${backgroundServiceIds})
      GROUP BY service_id, DATE(timestamp)
      ORDER BY d ASC
    `;

    // Per-service total call count and total tokens in the requested month
    const allServiceIds = services.map(s => s.id);
    const serviceUsageResult = await prisma.$queryRaw<
      Array<{ service_id: string; total_calls: bigint; total_input_tokens: bigint; total_output_tokens: bigint }>
    >`
      SELECT
        service_id::text as service_id,
        COUNT(*) as total_calls,
        COALESCE(SUM("inputTokens"), 0) as total_input_tokens,
        COALESCE(SUM("outputTokens"), 0) as total_output_tokens
      FROM usage_logs
      WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
        AND service_id::text = ANY(${allServiceIds})
      GROUP BY service_id
    `;
    const usageMap = new Map(serviceUsageResult.map(r => [r.service_id, {
      totalCallCount: Number(r.total_calls),
      totalInputTokens: Number(r.total_input_tokens),
      totalOutputTokens: Number(r.total_output_tokens),
      totalTokens: Number(r.total_input_tokens) + Number(r.total_output_tokens),
    }]));

    // Build lookup maps
    const stdDauMap = new Map(standardDauResult.map(r => [r.service_id, Math.round(r.avg_dau)]));
    const stdMauMap = new Map(standardMauResult.map(r => [r.service_id, Number(r.mau)]));
    const bgDailyMap = new Map(bgDailyResult.map(r => [r.service_id, r.avg_daily_calls]));
    const bgMonthlyMap = new Map(bgMonthlyResult.map(r => [r.service_id, Number(r.total_calls)]));

    // 전체 중복제거 DAU/MAU 계산
    // STANDARD: 이미 교차 서비스 중복제거된 avgDau / baseMau 사용
    // BACKGROUND: 유저 식별 불가하므로 추정 DAU 합산
    let totalBgEstimatedDau = 0;
    let totalBgEstimatedMau = 0;
    if (callsPerPersonPerDay > 0) {
      for (const dailyCalls of bgDailyMap.values()) {
        totalBgEstimatedDau += Math.round(dailyCalls / callsPerPersonPerDay);
      }
    }
    if (callsPerPersonPerMonth > 0) {
      for (const monthlyCalls of bgMonthlyMap.values()) {
        totalBgEstimatedMau += Math.round(monthlyCalls / callsPerPersonPerMonth);
      }
    }
    const overallAvgDailyDAU = Math.round(avgDau) + totalBgEstimatedDau;
    const overallMAU = baseMau + totalBgEstimatedMau;

    const data = services.map(s => {
      const usage = usageMap.get(s.id) || { totalCallCount: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 };
      const base = {
        serviceId: s.id,
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        type: s.type,
        status: s.status,
        enabled: s.enabled,
        iconUrl: s.iconUrl,
        targetMM: s.targetMM,
        serviceCategory: s.serviceCategory,
        standardMD: s.standardMD,
        jiraTicket: s.jiraTicket,
        serviceUrl: s.serviceUrl,
        docsUrl: s.docsUrl,
        registeredBy: s.registeredBy,
        registeredByDept: s.registeredByDept,
        createdAt: s.createdAt,
        totalCallCount: usage.totalCallCount,
        totalInputTokens: usage.totalInputTokens,
        totalOutputTokens: usage.totalOutputTokens,
        totalTokens: usage.totalTokens,
      };

      if (s.type === 'STANDARD') {
        return {
          ...base,
          dau: stdDauMap.get(s.id) || 0,
          mau: stdMauMap.get(s.id) || 0,
          isEstimated: false,
        };
      } else {
        const dailyCalls = bgDailyMap.get(s.id) || 0;
        const monthlyCalls = bgMonthlyMap.get(s.id) || 0;
        return {
          ...base,
          dau: callsPerPersonPerDay > 0 ? Math.round(dailyCalls / callsPerPersonPerDay) : 0,
          mau: callsPerPersonPerMonth > 0 ? Math.round(monthlyCalls / callsPerPersonPerMonth) : 0,
          isEstimated: true,
          estimationDetail: {
            avgDailyApiCalls: Math.round(dailyCalls),
            totalMonthlyApiCalls: monthlyCalls,
            avgCallsPerPersonPerDay: Math.round(callsPerPersonPerDay * 10) / 10,
            avgCallsPerPersonPerMonth: Math.round(callsPerPersonPerMonth * 10) / 10,
          },
        };
      }
    });

    // 일별 DAU 차트 데이터 구축
    const serviceDisplayMap = new Map(services.map(s => [s.id, s.displayName]));
    const serviceTypeMapLocal = new Map(services.map(s => [s.id, s.type]));
    const dailyDauMap = new Map<string, Record<string, number>>();

    // 전체 중복제거 DAU
    for (const row of dailyOverallRows) {
      const dateStr = typeof row.d === 'string' ? row.d : (row.d as Date).toISOString().slice(0, 10);
      if (!dailyDauMap.has(dateStr)) dailyDauMap.set(dateStr, {});
      dailyDauMap.get(dateStr)!['전체 (중복제거)'] = Number(row.dau);
    }

    // STANDARD 서비스별 DAU
    for (const row of dailyDauRows) {
      const dateStr = typeof row.d === 'string' ? row.d : (row.d as Date).toISOString().slice(0, 10);
      if (!dailyDauMap.has(dateStr)) dailyDauMap.set(dateStr, {});
      const displayName = serviceDisplayMap.get(row.service_id) || row.service_id;
      if (serviceTypeMapLocal.get(row.service_id) === 'STANDARD') {
        dailyDauMap.get(dateStr)![displayName] = Number(row.dau);
      }
    }

    // BACKGROUND 서비스별 추정 DAU
    if (callsPerPersonPerDay > 0) {
      for (const row of bgDailyCallRows) {
        const dateStr = typeof row.d === 'string' ? row.d : (row.d as Date).toISOString().slice(0, 10);
        if (!dailyDauMap.has(dateStr)) dailyDauMap.set(dateStr, {});
        const displayName = serviceDisplayMap.get(row.service_id) || row.service_id;
        dailyDauMap.get(dateStr)![displayName] = Math.round(Number(row.cnt) / callsPerPersonPerDay);
      }
    }

    const dailyDauChart = Array.from(dailyDauMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));

    res.json({
      year,
      month,
      isCurrentMonth,
      overallAvgDailyDAU,
      overallMAU,
      dailyDauChart,
      estimationBaseline: {
        callsPerPersonPerDay: Math.round(callsPerPersonPerDay * 10) / 10,
        callsPerPersonPerMonth: Math.round(callsPerPersonPerMonth * 10) / 10,
        standardAvgDailyDAU: Math.round(avgDau),
        standardMAU: baseMau,
        standardTotalCalls: totalCalls,
        baselinePeriod: { start: baselineStart, end: baselineEnd },
        isFixed: !isCurrentMonth,
      },
      data,
    });
  } catch (err) {
    console.error('Public stats dau-mau error:', err);
    res.status(500).json({ error: 'DAU/MAU 조회에 실패했습니다.' });
  }
});
