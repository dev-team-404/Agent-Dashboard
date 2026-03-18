/**
 * Public Stats Routes
 *
 * 사용량 통계 공개 API
 * - GET 요청: API Key 필수 (SystemSetting 'PUBLIC_STATS_API_KEY')
 * - POST 요청 (external-usage): 인증 불필요
 * 모든 서비스 → usage_logs
 * 모든 날짜는 KST (Asia/Seoul) 기준
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../index.js';
import { extractBusinessUnit } from '../middleware/auth.js';
import { isTopLevelDivision, getDepartmentHierarchy, lookupEmployee } from '../services/knoxEmployee.service.js';

function filterHierarchy<T extends { center2Name?: string | null; center1Name?: string | null }>(s: T): T {
  let c2 = s.center2Name ?? null;
  let c1 = s.center1Name ?? null;
  if (c2 && isTopLevelDivision(c2)) { c2 = 'none'; c1 = 'none'; }
  else if (c1 && isTopLevelDivision(c1)) { c1 = 'none'; }
  return { ...s, center2Name: c2, center1Name: c1 };
}

export const publicStatsRoutes = Router();

// ─── API Key 검증 미들웨어 (GET 요청만) ────────────────────
// 캐시: 30초 TTL
let cachedApiKey: { value: string | null; ts: number } = { value: null, ts: 0 };
const API_KEY_CACHE_TTL = 30_000;

async function getApiKey(): Promise<string | null> {
  if (Date.now() - cachedApiKey.ts < API_KEY_CACHE_TTL) return cachedApiKey.value;
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'PUBLIC_STATS_API_KEY' } });
    cachedApiKey = { value: setting?.value || null, ts: Date.now() };
    return cachedApiKey.value;
  } catch {
    return cachedApiKey.value;
  }
}

/** 캐시 무효화 (설정 변경 시 호출) */
export function invalidateApiKeyCache() {
  cachedApiKey = { value: null, ts: 0 };
}

async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const storedKey = await getApiKey();

  // 비밀번호가 설정되지 않은 경우 → 통과 (초기 상태)
  if (!storedKey) {
    next();
    return;
  }

  // 대시보드 인증 사용자(Bearer 토큰)는 API Key 없이 통과
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  // query param ?apiKey=
  const provided = req.query['apiKey'] as string;

  if (!provided) {
    res.status(401).json({
      error: 'API key required. Provide via ?apiKey= query parameter.',
      error_kr: 'API 비밀번호가 필요합니다. ?apiKey= 쿼리 파라미터로 전달하세요.',
    });
    return;
  }

  if (provided !== storedKey) {
    res.status(403).json({
      error: 'Invalid API key.',
      error_kr: 'API 비밀번호가 올바르지 않습니다.',
    });
    return;
  }

  next();
}

// GET 요청에만 API Key 검증 적용
publicStatsRoutes.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET') {
    requireApiKey(req, res, next);
  } else {
    next();
  }
});

// ─── Helpers ────────────────────────────────────────────────

function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/**
 * YYYY-MM-DD → KST 로컬 Date 객체 변환 (TZ=Asia/Seoul 환경)
 * usage_logs.timestamp 와 정확히 매칭
 */
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

  // KST 로컬 시간 (dau-mau 엔드포인트와 동일 방식)
  const [y1, m1, d1] = startStr.split('-').map(Number);
  const [y2, m2, d2] = endStr.split('-').map(Number);
  const startDate = new Date(y1, m1 - 1, d1, 0, 0, 0, 0);
  const endDate = new Date(y2, m2 - 1, d2, 23, 59, 59, 999);

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
        apiOnly: true,
        status: true,
        enabled: true,
        targetMM: true,
        savedMM: true,
        serviceCategory: true,
        standardMD: true,
        jiraTicket: true,
        serviceUrl: true,
        docsUrl: true,
        registeredBy: true,
        registeredByDept: true,
        team: true,
        center2Name: true,
        center1Name: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      data: services.map((s) => ({
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        type: s.type,
        apiOnly: s.apiOnly,
        status: s.status,
        enabled: s.enabled,
        targetMM: s.targetMM,
        savedMM: s.savedMM,
        serviceCategory: s.serviceCategory,
        standardMD: s.standardMD,
        jiraTicket: s.jiraTicket,
        serviceUrl: s.serviceUrl,
        docsUrl: s.docsUrl,
        registeredBy: s.registeredBy,
        registeredByDept: s.registeredByDept,
        ...filterHierarchy({ team: s.team, center2Name: s.center2Name, center1Name: s.center1Name }),
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
 * 모든 서비스 → usage_logs
 */
publicStatsRoutes.get('/team-usage', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceName = req.query['serviceName'] as string | undefined;
    if (!serviceName) {
      res.status(400).json({ error: 'serviceName은 필수 파라미터입니다. (서비스 코드, 예: nexus-coder)' });
      return;
    }

    const service = await prisma.service.findUnique({
      where: { name: serviceName },
      select: { id: true, apiOnly: true },
    });
    if (!service) {
      res.status(404).json({ error: `서비스 '${serviceName}'을 찾을 수 없습니다.` });
      return;
    }
    const serviceId = service.id;

    const stats = await prisma.$queryRaw<Array<{
      deptname: string; total_input: bigint; total_output: bigint;
      request_count: bigint; unique_users: bigint;
    }>>`
      SELECT ul.deptname,
             COALESCE(SUM(ul."inputTokens"), 0) as total_input,
             COALESCE(SUM(ul."outputTokens"), 0) as total_output,
             COALESCE(SUM(ul.request_count), 0) as request_count,
             COUNT(DISTINCT ul.user_id) as unique_users
      FROM usage_logs ul
      WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
        AND ul.service_id = ${serviceId}
        AND ul.deptname IS NOT NULL
      GROUP BY ul.deptname
      ORDER BY ul.deptname ASC
    `;
    const data = stats.map(s => ({
      deptname: s.deptname,
      businessUnit: extractBusinessUnit(s.deptname),
      totalInputTokens: Number(s.total_input),
      totalOutputTokens: Number(s.total_output),
      totalTokens: Number(s.total_input) + Number(s.total_output),
      requestCount: Number(s.request_count),
      uniqueUsers: Number(s.unique_users),
    }));

    res.json({ data });
  } catch (err) {
    console.error('Public stats team-usage error:', err);
    res.status(500).json({ error: '팀별 사용량 조회에 실패했습니다.' });
  }
});

// ─── 3. GET /team-usage-all ─────────────────────────────────

/**
 * 모든 서비스에 대해 팀별 사용량 (토큰 + API 호출 수)
 * 모든 서비스 → usage_logs
 */
publicStatsRoutes.get('/team-usage-all', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    // 서비스 정보 조회
    const allServices = await prisma.service.findMany({
      select: { id: true, name: true, displayName: true },
    });
    const serviceMap = new Map(allServices.map(s => [s.id, s]));
    const allServiceIds = allServices.map(s => s.id);

    // usage_logs에서 전체 서비스 팀별 사용량 조회
    const stats = allServiceIds.length > 0
      ? await prisma.$queryRaw<Array<{
          deptname: string; service_id: string;
          total_input: bigint; total_output: bigint;
          request_count: bigint; unique_users: bigint;
        }>>`
          SELECT ul.deptname, ul.service_id::text as service_id,
                 COALESCE(SUM(ul."inputTokens"), 0) as total_input,
                 COALESCE(SUM(ul."outputTokens"), 0) as total_output,
                 COALESCE(SUM(ul.request_count), 0) as request_count,
                 COUNT(DISTINCT ul.user_id) as unique_users
          FROM usage_logs ul
          WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
            AND ul.service_id::text = ANY(${allServiceIds})
            AND ul.deptname IS NOT NULL
          GROUP BY ul.deptname, ul.service_id
        `
      : [];

    const data = stats.map(r => {
      const svc = serviceMap.get(r.service_id);
      return {
        deptname: r.deptname,
        businessUnit: extractBusinessUnit(r.deptname),
        serviceName: svc?.name || 'unknown',
        serviceDisplayName: svc?.displayName || 'Unknown',
        totalInputTokens: Number(r.total_input),
        totalOutputTokens: Number(r.total_output),
        totalTokens: Number(r.total_input) + Number(r.total_output),
        requestCount: Number(r.request_count),
        uniqueUsers: Number(r.unique_users),
      };
    }).sort((a, b) => a.deptname.localeCompare(b.deptname));

    res.json({ data });
  } catch (err) {
    console.error('Public stats team-usage-all error:', err);
    res.status(500).json({ error: '전체 팀별 사용량 조회에 실패했습니다.' });
  }
});

// ─── 4. GET /top-users ──────────────────────────────────────

/**
 * 특정 서비스의 Top K 사용자 (토큰 + API 호출 수)
 * 모든 서비스 → usage_logs
 */
publicStatsRoutes.get('/top-users', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceName = req.query['serviceName'] as string | undefined;
    if (!serviceName) {
      res.status(400).json({ error: 'serviceName은 필수 파라미터입니다. (서비스 코드, 예: nexus-coder)' });
      return;
    }

    const service = await prisma.service.findUnique({
      where: { name: serviceName },
      select: { id: true, apiOnly: true },
    });
    if (!service) {
      res.status(404).json({ error: `서비스 '${serviceName}'을 찾을 수 없습니다.` });
      return;
    }
    const serviceId = service.id;
    const topK = Math.min(Math.max(parseInt(req.query['topK'] as string) || 10, 1), 100);

    const userStats = await prisma.$queryRaw<Array<{ user_id: string; total_input: bigint; total_output: bigint; request_count: bigint }>>`
      SELECT user_id,
             COALESCE(SUM("inputTokens"), 0) as total_input,
             COALESCE(SUM("outputTokens"), 0) as total_output,
             COALESCE(SUM(request_count), 0) as request_count
      FROM usage_logs
      WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
        AND service_id = ${serviceId}
        AND user_id IS NOT NULL
      GROUP BY user_id
    `;

    // Sort by totalTokens desc, take topK
    const sorted = userStats
      .map(s => ({
        userId: s.user_id,
        totalInputTokens: Number(s.total_input),
        totalOutputTokens: Number(s.total_output),
        totalTokens: Number(s.total_input) + Number(s.total_output),
        requestCount: Number(s.request_count),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, topK);

    // Fetch user info
    const userIds = sorted.map(s => s.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, loginid: true, username: true, deptname: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const data = sorted.map((s, i) => {
      const user = userMap.get(s.userId);
      return {
        rank: i + 1,
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
      totalUsers: userStats.length,
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
 * 모든 서비스 → usage_logs
 */
publicStatsRoutes.get('/top-users-by-dept', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, error } = parseDateRange(req.query);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const serviceName = req.query['serviceName'] as string | undefined;
    if (!serviceName) {
      res.status(400).json({ error: 'serviceName은 필수 파라미터입니다. (서비스 코드, 예: nexus-coder)' });
      return;
    }

    const service = await prisma.service.findUnique({
      where: { name: serviceName },
      select: { id: true, apiOnly: true },
    });
    if (!service) {
      res.status(404).json({ error: `서비스 '${serviceName}'을 찾을 수 없습니다.` });
      return;
    }
    const serviceId = service.id;

    const deptname = req.query['deptname'] as string | undefined;
    if (!deptname) {
      res.status(400).json({ error: 'deptname은 필수 파라미터입니다. (형식: 팀명(사업부), 예: S/W혁신팀(S.LSI))' });
      return;
    }

    const topK = Math.min(Math.max(parseInt(req.query['topK'] as string) || 10, 1), 100);

    const userStats = await prisma.$queryRaw<Array<{ user_id: string; total_input: bigint; total_output: bigint; request_count: bigint }>>`
      SELECT user_id,
             COALESCE(SUM("inputTokens"), 0) as total_input,
             COALESCE(SUM("outputTokens"), 0) as total_output,
             COALESCE(SUM(request_count), 0) as request_count
      FROM usage_logs
      WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
        AND service_id = ${serviceId}
        AND deptname = ${deptname}
        AND user_id IS NOT NULL
      GROUP BY user_id
    `;

    const sorted = userStats
      .map(s => ({
        userId: s.user_id,
        totalInputTokens: Number(s.total_input),
        totalOutputTokens: Number(s.total_output),
        totalTokens: Number(s.total_input) + Number(s.total_output),
        requestCount: Number(s.request_count),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, topK);

    const userIds = sorted.map(s => s.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, loginid: true, username: true, deptname: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const data = sorted.map((s, i) => {
      const user = userMap.get(s.userId);
      return {
        rank: i + 1,
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
      totalUsersInDept: userStats.length,
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
        type: true, apiOnly: true, status: true, enabled: true, iconUrl: true,
        targetMM: true, savedMM: true, serviceCategory: true, standardMD: true,
        jiraTicket: true, serviceUrl: true, docsUrl: true,
        registeredBy: true, registeredByDept: true,
        team: true, center2Name: true, center1Name: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    // 서비스 타입별 ID 분리 (모든 서비스 → usage_logs)
    const standardIds = services.filter(s => s.type === 'STANDARD').map(s => s.id);
    const backgroundIds = services.filter(s => s.type === 'BACKGROUND').map(s => s.id);

    // STANDARD 서비스: 실측 DAU (영업일 평균) 및 MAU
    const standardDauResult = standardIds.length > 0
      ? await prisma.$queryRaw<Array<{ service_id: string; avg_dau: number }>>`
          WITH daily_dau AS (
            SELECT ul.service_id::text as service_id, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
            FROM usage_logs ul
            INNER JOIN users u ON ul.user_id = u.id
            WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
              AND u.loginid != 'anonymous'
              AND ul.service_id::text = ANY(${standardIds})
              AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
              AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
            GROUP BY ul.service_id, DATE(ul.timestamp)
          )
          SELECT service_id, COALESCE(AVG(dau), 0)::float as avg_dau FROM daily_dau GROUP BY service_id
        `
      : [];

    const standardMauResult = standardIds.length > 0
      ? await prisma.$queryRaw<Array<{ service_id: string; mau: bigint }>>`
          SELECT ul.service_id::text as service_id, COUNT(DISTINCT ul.user_id) as mau
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
            AND u.loginid != 'anonymous'
            AND ul.service_id::text = ANY(${standardIds})
          GROUP BY ul.service_id
        `
      : [];

    // Estimation baseline: 해당 월의 STANDARD 데이터 사용
    // 과거 월 → 고정값 (해당 월 전체), 이번 달 → 실시간 (누적 데이터)
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && (now.getMonth() + 1) === month;
    const baselineStart = startDate;
    const baselineEnd = isCurrentMonth ? now : endDate;

    const [baselineDailyCalls, baselineDailyDau, baselineMonthly] = standardIds.length > 0
      ? await Promise.all([
          prisma.$queryRaw<Array<{ avg_daily_calls: number }>>`
            WITH daily AS (
              SELECT DATE(timestamp) as d, COALESCE(SUM(request_count), 0) as cnt
              FROM usage_logs
              WHERE timestamp >= ${baselineStart} AND timestamp <= ${baselineEnd}
                AND service_id::text = ANY(${standardIds})
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
                AND ul.service_id::text = ANY(${standardIds})
                AND u.loginid != 'anonymous'
                AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
                AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
              GROUP BY DATE(ul.timestamp)
            )
            SELECT COALESCE(AVG(dau), 0)::float as avg_daily_dau FROM daily
          `,
          prisma.$queryRaw<Array<{ total_calls: bigint; mau: bigint }>>`
            SELECT COALESCE(SUM(ul.request_count), 0) as total_calls, COUNT(DISTINCT ul.user_id) as mau
            FROM usage_logs ul
            INNER JOIN users u ON ul.user_id = u.id
            WHERE ul.timestamp >= ${baselineStart} AND ul.timestamp <= ${baselineEnd}
              AND ul.service_id::text = ANY(${standardIds})
              AND u.loginid != 'anonymous'
          `,
        ])
      : [[{ avg_daily_calls: 0 }], [{ avg_daily_dau: 0 }], [{ total_calls: BigInt(0), mau: BigInt(0) }]];

    const avgCallsPerDay = baselineDailyCalls[0]?.avg_daily_calls || 0;
    const avgDau = baselineDailyDau[0]?.avg_daily_dau || 0;
    const callsPerPersonPerDay = avgDau > 0 ? avgCallsPerDay / avgDau : 0;
    const totalCalls = Number(baselineMonthly[0]?.total_calls || 0);
    const baseMau = Number(baselineMonthly[0]?.mau || 0);
    const callsPerPersonPerMonth = baseMau > 0 ? totalCalls / baseMau : 0;

    // BACKGROUND 서비스: 해당 월 호출 수
    const bgDailyResult = backgroundIds.length > 0
      ? await prisma.$queryRaw<Array<{ service_id: string; avg_daily_calls: number }>>`
          WITH daily AS (
            SELECT service_id::text as service_id, DATE(timestamp) as d, COALESCE(SUM(request_count), 0) as cnt
            FROM usage_logs
            WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
              AND service_id::text = ANY(${backgroundIds})
              AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
              AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
            GROUP BY service_id, DATE(timestamp)
          )
          SELECT service_id, COALESCE(AVG(cnt), 0)::float as avg_daily_calls FROM daily GROUP BY service_id
        `
      : [];

    const bgMonthlyResult = backgroundIds.length > 0
      ? await prisma.$queryRaw<Array<{ service_id: string; total_calls: bigint }>>`
          SELECT service_id::text as service_id, COALESCE(SUM(request_count), 0) as total_calls
          FROM usage_logs
          WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
            AND service_id::text = ANY(${backgroundIds})
          GROUP BY service_id
        `
      : [];

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

    // BACKGROUND 서비스 일별 호출 수 (추정 DAU 계산용)
    const bgDailyCallRows = backgroundIds.length > 0
      ? await prisma.$queryRaw<Array<{ service_id: string; d: Date | string; cnt: bigint }>>`
          SELECT service_id::text as service_id, DATE(timestamp) as d, COALESCE(SUM(request_count), 0) as cnt
          FROM usage_logs
          WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
            AND service_id::text = ANY(${backgroundIds})
          GROUP BY service_id, DATE(timestamp)
          ORDER BY d ASC
        `
      : [];

    // Per-service total call count and total tokens in the requested month
    const allServiceIds = services.map(s => s.id);
    const serviceUsageResult = allServiceIds.length > 0 ? await prisma.$queryRaw<
      Array<{ service_id: string; total_calls: bigint; total_input_tokens: bigint; total_output_tokens: bigint }>
    >`
      SELECT
        service_id::text as service_id,
        COALESCE(SUM(request_count), 0) as total_calls,
        COALESCE(SUM("inputTokens"), 0) as total_input_tokens,
        COALESCE(SUM("outputTokens"), 0) as total_output_tokens
      FROM usage_logs
      WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
        AND service_id::text = ANY(${allServiceIds})
      GROUP BY service_id
    ` : [];
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
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        type: s.type,
        apiOnly: s.apiOnly,
        status: s.status,
        enabled: s.enabled,
        iconUrl: s.iconUrl,
        targetMM: s.targetMM,
        savedMM: s.savedMM,
        serviceCategory: s.serviceCategory,
        standardMD: s.standardMD,
        jiraTicket: s.jiraTicket,
        serviceUrl: s.serviceUrl,
        docsUrl: s.docsUrl,
        registeredBy: s.registeredBy,
        registeredByDept: s.registeredByDept,
        ...filterHierarchy({ team: s.team, center2Name: s.center2Name, center1Name: s.center1Name }),
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
        // BACKGROUND: 호출 수 기반 역산
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DTGPT Server Usage APIs
// 특정 서버(cloud.dtgpt) 사용량 집계 전용 엔드포인트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DTGPT_ENDPOINT_PREFIX = 'http://cloud.dtgpt.samsunds.net/llm/v1';
const DTGPT_FIXED_SERVICES = ['roocode', 'dify', 'openwebui', 'claudecode'];
const DTGPT_API_SERVICE = 'api';

/**
 * G1+G3 서비스 ID 조회 (고정 서비스 + api 서비스)
 */
async function getDtgptFixedAndApiServiceIds(): Promise<{ g1Ids: string[]; g3Id: string | null }> {
  const services = await prisma.service.findMany({
    where: { name: { in: [...DTGPT_FIXED_SERVICES, DTGPT_API_SERVICE] } },
    select: { id: true, name: true },
  });
  const g1Ids = services.filter(s => DTGPT_FIXED_SERVICES.includes(s.name)).map(s => s.id);
  const g3 = services.find(s => s.name === DTGPT_API_SERVICE);
  return { g1Ids, g3Id: g3?.id || null };
}

/**
 * G2 서비스 ID 조회 (해당 endpoint 모델을 사용하는 서비스)
 */
async function getDtgptDynamicServiceIds(): Promise<string[]> {
  const results = await prisma.$queryRaw<Array<{ service_id: string }>>`
    SELECT DISTINCT sm.service_id
    FROM service_models sm
    INNER JOIN models m ON sm.model_id = m.id
    WHERE m.endpoint_url LIKE ${DTGPT_ENDPOINT_PREFIX + '%'}
      AND sm.enabled = true
      AND m.enabled = true
  `;
  return results.map(r => r.service_id);
}

/**
 * 한글 부서명 → 영문 팀명 변환 (캐시 활용)
 * 해당 부서에 속한 user를 DB에서 찾아 Knox 조회 후 영문 팀명 resolve
 */
async function resolveTeamName(deptname: string): Promise<string> {
  if (!deptname) return 'Unknown';

  // 1. department_hierarchies 캐시에서 한글 부서명으로 조회
  try {
    const cached = await prisma.departmentHierarchy.findFirst({
      where: { departmentName: deptname },
      select: { team: true },
    });
    if (cached?.team) return cached.team;
  } catch (_) { /* ignore */ }

  // 2. 해당 부서에 속한 유저 중 departmentCode가 있는 유저 찾기
  const user = await prisma.user.findFirst({
    where: { deptname, departmentCode: { not: null } },
    select: { departmentCode: true, enDeptName: true },
  });

  if (user?.departmentCode) {
    const hierarchy = await getDepartmentHierarchy(
      user.departmentCode,
      deptname,
      user.enDeptName || '',
    );
    if (hierarchy?.team) return hierarchy.team;
  }

  // 3. departmentCode 없는 경우 → Knox Employee API로 조회
  const anyUser = await prisma.user.findFirst({
    where: { deptname, loginid: { not: 'anonymous' } },
    select: { loginid: true },
  });

  if (anyUser) {
    const emp = await lookupEmployee(anyUser.loginid);
    if (emp?.departmentCode) {
      const hierarchy = await getDepartmentHierarchy(
        emp.departmentCode,
        emp.departmentName || deptname,
        emp.enDepartmentName || '',
      );
      if (hierarchy?.team) return hierarchy.team;
      // fallback: 영문 부서명이라도 반환
      if (emp.enDepartmentName) return emp.enDepartmentName;
    }
  }

  return deptname; // 최종 fallback: 한글 부서명 그대로
}

// ─── 7. GET /stats/dtgpt/team-usage ─────────────────────────

publicStatsRoutes.get('/dtgpt/team-usage', async (req: Request, res: Response) => {
  try {
    const month = req.query['month'] as string;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: 'month 파라미터가 필요합니다. (형식: YYYY-MM, 예: 2026-01)' });
      return;
    }

    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);
    if (year < 2000 || year > 2100 || mon < 1 || mon > 12) {
      res.status(400).json({ error: 'year(2000~2100)와 month(1~12)가 유효해야 합니다.' });
      return;
    }

    // KST 기준 월 범위
    const startDate = new Date(year, mon - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, mon, 0, 23, 59, 59, 999); // 해당 월 마지막 날

    // G1 + G3 서비스 ID
    const { g1Ids, g3Id } = await getDtgptFixedAndApiServiceIds();
    const allIds = [...g1Ids, ...(g3Id ? [g3Id] : [])];

    if (allIds.length === 0) {
      res.json({ month, data: [] });
      return;
    }

    // 부서별 토큰 사용량 집계
    const stats = await prisma.$queryRaw<Array<{
      deptname: string;
      total_input: bigint;
      total_output: bigint;
      request_count: bigint;
      unique_users: bigint;
    }>>`
      SELECT ul.deptname,
             COALESCE(SUM(ul."inputTokens"), 0) as total_input,
             COALESCE(SUM(ul."outputTokens"), 0) as total_output,
             COALESCE(SUM(ul.request_count), 0) as request_count,
             COUNT(DISTINCT ul.user_id) as unique_users
      FROM usage_logs ul
      WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
        AND ul.service_id = ANY(${allIds})
        AND ul.deptname IS NOT NULL AND ul.deptname != ''
      GROUP BY ul.deptname
      ORDER BY SUM(ul."inputTokens") + SUM(ul."outputTokens") DESC
    `;

    // 한글 부서명 → 영문 팀명 변환 + 팀별 합산
    const teamMap = new Map<string, {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      requestCount: number;
      uniqueUsers: number;
      depts: string[];
    }>();

    for (const row of stats) {
      const teamName = await resolveTeamName(row.deptname);
      const existing = teamMap.get(teamName);
      const input = Number(row.total_input);
      const output = Number(row.total_output);

      if (existing) {
        existing.totalInputTokens += input;
        existing.totalOutputTokens += output;
        existing.totalTokens += input + output;
        existing.requestCount += Number(row.request_count);
        existing.uniqueUsers += Number(row.unique_users); // 팀 내 중복 가능하지만 근사치
        if (!existing.depts.includes(row.deptname)) existing.depts.push(row.deptname);
      } else {
        teamMap.set(teamName, {
          totalInputTokens: input,
          totalOutputTokens: output,
          totalTokens: input + output,
          requestCount: Number(row.request_count),
          uniqueUsers: Number(row.unique_users),
          depts: [row.deptname],
        });
      }
    }

    const data = Array.from(teamMap.entries())
      .map(([team, v]) => ({
        team,
        totalInputTokens: v.totalInputTokens,
        totalOutputTokens: v.totalOutputTokens,
        totalTokens: v.totalTokens,
        requestCount: v.requestCount,
        uniqueUsers: v.uniqueUsers,
        departments: v.depts,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    res.json({
      month,
      server: DTGPT_ENDPOINT_PREFIX,
      scope: 'G1 (fixed services) + G3 (api service)',
      fixedServices: DTGPT_FIXED_SERVICES,
      data,
    });
  } catch (err) {
    console.error('DTGPT team-usage error:', err);
    res.status(500).json({ error: 'DTGPT 팀별 사용량 조회에 실패했습니다.' });
  }
});

// ─── 8. GET /stats/dtgpt/service-usage ──────────────────────

publicStatsRoutes.get('/dtgpt/service-usage', async (req: Request, res: Response) => {
  try {
    const month = req.query['month'] as string;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: 'month 파라미터가 필요합니다. (형식: YYYY-MM, 예: 2026-01)' });
      return;
    }

    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);
    if (year < 2000 || year > 2100 || mon < 1 || mon > 12) {
      res.status(400).json({ error: 'year(2000~2100)와 month(1~12)가 유효해야 합니다.' });
      return;
    }

    const startDate = new Date(year, mon - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, mon, 0, 23, 59, 59, 999);

    // G1, G2, G3 서비스 조회
    const { g1Ids, g3Id } = await getDtgptFixedAndApiServiceIds();
    const g2Ids = await getDtgptDynamicServiceIds();

    // G1 + G2 서비스 정보 (이름 포함)
    const allServiceIds = [...new Set([...g1Ids, ...g2Ids])];
    const serviceInfos = await prisma.service.findMany({
      where: { id: { in: allServiceIds } },
      select: { id: true, name: true, displayName: true },
    });
    const serviceById = new Map(serviceInfos.map(s => [s.id, s]));

    // G1 + G2 서비스별 사용량 조회
    const serviceStats = allServiceIds.length > 0
      ? await prisma.$queryRaw<Array<{
          service_id: string;
          total_input: bigint;
          total_output: bigint;
          request_count: bigint;
          unique_users: bigint;
        }>>`
          SELECT ul.service_id::text as service_id,
                 COALESCE(SUM(ul."inputTokens"), 0) as total_input,
                 COALESCE(SUM(ul."outputTokens"), 0) as total_output,
                 COALESCE(SUM(ul.request_count), 0) as request_count,
                 COUNT(DISTINCT ul.user_id) as unique_users
          FROM usage_logs ul
          WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
            AND ul.service_id::text = ANY(${allServiceIds})
          GROUP BY ul.service_id
        `
      : [];

    // G3 (api 서비스) 전체 사용량
    let g3Total = { input: 0, output: 0, requests: 0, users: 0 };
    if (g3Id) {
      const g3Stats = await prisma.$queryRaw<Array<{
        total_input: bigint;
        total_output: bigint;
        request_count: bigint;
        unique_users: bigint;
      }>>`
        SELECT COALESCE(SUM("inputTokens"), 0) as total_input,
               COALESCE(SUM("outputTokens"), 0) as total_output,
               COALESCE(SUM(request_count), 0) as request_count,
               COUNT(DISTINCT user_id) as unique_users
        FROM usage_logs
        WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
          AND service_id = ${g3Id}
      `;
      if (g3Stats[0]) {
        g3Total = {
          input: Number(g3Stats[0].total_input),
          output: Number(g3Stats[0].total_output),
          requests: Number(g3Stats[0].request_count),
          users: Number(g3Stats[0].unique_users),
        };
      }
    }

    // G2 사용량 합계 (api 서비스에서 빼기 위한 값)
    // G2 중 G3(api)와 겹치는 서비스의 사용량
    const g2InG3 = g3Id && g2Ids.includes(g3Id);
    let g2TotalTokens = 0;

    // 결과 구성
    const data: Array<{
      service: string;
      displayName: string;
      group: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      requestCount: number;
      uniqueUsers: number;
    }> = [];

    for (const row of serviceStats) {
      const svc = serviceById.get(row.service_id);
      if (!svc) continue;

      const input = Number(row.total_input);
      const output = Number(row.total_output);
      const isG1 = g1Ids.includes(row.service_id);
      const isG2 = g2Ids.includes(row.service_id);

      // G2에 해당하는 사용량 누적 (api 서비스 제외 — api는 G3으로 별도 처리)
      if (isG2 && row.service_id !== g3Id) {
        g2TotalTokens += input + output;
      }

      const groups: string[] = [];
      if (isG1) groups.push('G1:fixed');
      if (isG2) groups.push('G2:dynamic');

      data.push({
        service: svc.name,
        displayName: svc.displayName,
        group: groups.join(', '),
        totalInputTokens: input,
        totalOutputTokens: output,
        totalTokens: input + output,
        requestCount: Number(row.request_count),
        uniqueUsers: Number(row.unique_users),
      });
    }

    // "other" = G3 전체 - G2 사용량 합 (음수면 0)
    const otherInput = Math.max(g3Total.input - (g2InG3 ? 0 : 0), 0); // G3 자체가 G2에 포함되면 other=0
    const otherTokens = Math.max((g3Total.input + g3Total.output) - g2TotalTokens, 0);
    // other의 input/output 비율을 G3 비율로 추정
    const g3TotalTokens = g3Total.input + g3Total.output;
    const inputRatio = g3TotalTokens > 0 ? g3Total.input / g3TotalTokens : 0.5;

    data.push({
      service: 'other',
      displayName: 'Other (미분류 직접 사용)',
      group: 'G3:api-remainder',
      totalInputTokens: Math.round(otherTokens * inputRatio),
      totalOutputTokens: Math.round(otherTokens * (1 - inputRatio)),
      totalTokens: otherTokens,
      requestCount: Math.max(g3Total.requests - data.filter(d => d.group.includes('G2')).reduce((s, d) => s + d.requestCount, 0), 0),
      uniqueUsers: g3Total.users, // 정확한 차집합은 어려우므로 G3 전체
    });

    // totalTokens 내림차순 정렬
    data.sort((a, b) => b.totalTokens - a.totalTokens);

    res.json({
      month,
      server: DTGPT_ENDPOINT_PREFIX,
      scope: 'G1 (fixed) + G2 (dynamic by endpoint) + other (G3 - G2)',
      fixedServices: DTGPT_FIXED_SERVICES,
      dynamicServiceCount: g2Ids.length,
      g3ServiceName: DTGPT_API_SERVICE,
      g3TotalTokens: g3TotalTokens,
      g2TotalTokens,
      data,
    });
  } catch (err) {
    console.error('DTGPT service-usage error:', err);
    res.status(500).json({ error: 'DTGPT 서비스별 사용량 조회에 실패했습니다.' });
  }
});
