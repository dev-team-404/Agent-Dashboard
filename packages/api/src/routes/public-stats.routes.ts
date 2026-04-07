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
import { Prisma } from '@prisma/client';
import { prisma } from '../index.js';
import { extractBusinessUnit } from '../middleware/auth.js';
import { isTopLevelDivision, lookupEmployee } from '../services/knoxEmployee.service.js';

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

    // Unknown 서비스 제외: serviceMap에 존재하는 것만 포함
    const data = stats
      .filter(r => serviceMap.has(r.service_id))
      .map(r => {
        const svc = serviceMap.get(r.service_id)!;
        return {
          deptname: r.deptname,
          businessUnit: extractBusinessUnit(r.deptname),
          serviceName: svc.name,
          serviceDisplayName: svc.displayName,
          totalInputTokens: Number(r.total_input),
          totalOutputTokens: Number(r.total_output),
          totalTokens: Number(r.total_input) + Number(r.total_output),
          requestCount: Number(r.request_count),
          uniqueUsers: Number(r.unique_users),
        };
      })
      .sort((a, b) => a.deptname.localeCompare(b.deptname));

    res.json({ data });
  } catch (err) {
    console.error('Public stats team-usage-all error:', err);
    res.status(500).json({ error: '전체 팀별 사용량 조회에 실패했습니다.' });
  }
});

// ─── 4. GET /top-users ──────────────────────────────────────

// ─── 5. GET /dau-mau ─────────────────────────────────────────

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
        targetMM: true, savedMM: true, serviceCategory: true,
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
              AND u.loginid != 'anonymous' AND u.is_test_account = false
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
            AND u.loginid != 'anonymous' AND u.is_test_account = false
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
                AND u.loginid != 'anonymous' AND u.is_test_account = false
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
              AND u.loginid != 'anonymous' AND u.is_test_account = false
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
        AND u.loginid != 'anonymous' AND u.is_test_account = false
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
        AND u.loginid != 'anonymous' AND u.is_test_account = false
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
 * G2 서비스 ID 조회 (DTGPT endpoint 모델을 사용하는 등록 서비스)
 */
async function getDtgptDynamicServiceIds(): Promise<string[]> {
  const results = await prisma.$queryRaw<Array<{ service_id: string }>>`
    SELECT DISTINCT sm.service_id
    FROM service_models sm
    INNER JOIN models m ON sm.model_id = m.id
    WHERE m."endpointUrl" LIKE ${DTGPT_ENDPOINT_PREFIX + '%'}
      AND sm.enabled = true
      AND m.enabled = true
  `;
  return results.map(r => r.service_id);
}

// ─── 7. GET /stats/dtgpt/service-usage ──────────────────────
// 해당 월 일별 × 서비스별 토큰 사용량 (input/output/total)

publicStatsRoutes.get('/dtgpt/service-usage', async (req: Request, res: Response) => {
  try {
    const year = parseInt(req.query['year'] as string);
    const month = parseInt(req.query['month'] as string);
    if (!year || year < 2000 || year > 2100 || !month || month < 1 || month > 12) {
      res.status(400).json({ error: 'year(2000~2100)와 month(1~12)는 필수입니다. (예: year=2026&month=3)' });
      return;
    }

    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // G1(고정) + G2(동적) + G3(api)
    const [{ g1Ids, g3Id }, g2Ids] = await Promise.all([
      getDtgptFixedAndApiServiceIds(),
      getDtgptDynamicServiceIds(),
    ]);
    const allSvcIds = [...new Set([...g1Ids, ...g2Ids, ...(g3Id ? [g3Id] : [])])];
    if (allSvcIds.length === 0) { res.json({ year, month, data: [] }); return; }

    // 서비스 displayName 조회
    const svcInfos = await prisma.service.findMany({
      where: { id: { in: allSvcIds } },
      select: { id: true, displayName: true },
    });
    const svcNameMap = new Map(svcInfos.map(s => [s.id, s.displayName]));

    // 일별 × 서비스별 토큰 (input/output/total)
    const rows = await prisma.$queryRaw<Array<{
      d: string; service_id: string; input_tokens: bigint; output_tokens: bigint; total_tokens: bigint;
    }>>`
      SELECT TO_CHAR((ul.timestamp + INTERVAL '9 hours')::date, 'YYYY-MM-DD') as d,
             ul.service_id::text as service_id,
             COALESCE(SUM(ul."inputTokens"), 0) as input_tokens,
             COALESCE(SUM(ul."outputTokens"), 0) as output_tokens,
             COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
      FROM usage_logs ul
      WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
        AND ul.service_id = ANY(${allSvcIds})
      GROUP BY 1, ul.service_id
      ORDER BY 1
    `;

    // 일별 → 서비스별 집계
    // G1: 개별 표시, G2: 개별 표시, 기타 = G3 total - G2 합산
    const g2Set = new Set(g2Ids);
    const dateMap = new Map<string, Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>>();
    for (const r of rows) {
      if (!dateMap.has(r.d)) dateMap.set(r.d, {});
      const entry = dateMap.get(r.d)!;

      if (g3Id && r.service_id === g3Id) {
        // G3(api): 일단 "기타"에 전체 적립
        if (!entry['기타']) entry['기타'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        entry['기타'].inputTokens += Number(r.input_tokens);
        entry['기타'].outputTokens += Number(r.output_tokens);
        entry['기타'].totalTokens += Number(r.total_tokens);
      } else {
        // G1 또는 G2: 개별 서비스명으로 표시 (Unknown 서비스 제외)
        const name = svcNameMap.get(r.service_id);
        if (!name) continue; // Unknown 서비스는 스킵
        if (!entry[name]) entry[name] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        entry[name].inputTokens += Number(r.input_tokens);
        entry[name].outputTokens += Number(r.output_tokens);
        entry[name].totalTokens += Number(r.total_tokens);

        // G2면 "기타"에서 차감
        if (g2Set.has(r.service_id)) {
          if (!entry['기타']) entry['기타'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          entry['기타'].inputTokens -= Number(r.input_tokens);
          entry['기타'].outputTokens -= Number(r.output_tokens);
          entry['기타'].totalTokens -= Number(r.total_tokens);
        }
      }
    }

    // 기타가 0 이하면 제거
    for (const [, entry] of dateMap) {
      if (entry['기타'] && entry['기타'].totalTokens <= 0) delete entry['기타'];
    }

    const data = Array.from(dateMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, services]) => ({
      date,
      services,
    }));

    res.json({ year, month, server: DTGPT_ENDPOINT_PREFIX, fixedServices: DTGPT_FIXED_SERVICES, data });
  } catch (err) {
    console.error('DTGPT service-usage error:', err);
    res.status(500).json({ error: 'DTGPT 서비스별 사용량 조회에 실패했습니다.' });
  }
});

// ─── 8. GET /stats/dtgpt/token-usage ─────────────────────────
// 해당 월 일별 총 토큰 사용량 (input/output/total)

publicStatsRoutes.get('/dtgpt/token-usage', async (req: Request, res: Response) => {
  try {
    const year = parseInt(req.query['year'] as string);
    const month = parseInt(req.query['month'] as string);
    if (!year || year < 2000 || year > 2100 || !month || month < 1 || month > 12) {
      res.status(400).json({ error: 'year(2000~2100)와 month(1~12)는 필수입니다. (예: year=2026&month=3)' });
      return;
    }

    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const { g1Ids, g3Id } = await getDtgptFixedAndApiServiceIds();
    const svcIds = [...g1Ids, ...(g3Id ? [g3Id] : [])];
    if (svcIds.length === 0) { res.json({ year, month, data: [] }); return; }

    const rows = await prisma.$queryRaw<Array<{
      d: string; input_tokens: bigint; output_tokens: bigint; total_tokens: bigint;
    }>>`
      SELECT TO_CHAR((ul.timestamp + INTERVAL '9 hours')::date, 'YYYY-MM-DD') as d,
             COALESCE(SUM(ul."inputTokens"), 0) as input_tokens,
             COALESCE(SUM(ul."outputTokens"), 0) as output_tokens,
             COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
      FROM usage_logs ul
      WHERE ul.timestamp >= ${startDate} AND ul.timestamp <= ${endDate}
        AND ul.service_id = ANY(${svcIds})
      GROUP BY 1
      ORDER BY 1
    `;

    const data = rows.map(r => ({
      date: r.d,
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      totalTokens: Number(r.total_tokens),
    }));

    res.json({ year, month, server: DTGPT_ENDPOINT_PREFIX, fixedServices: DTGPT_FIXED_SERVICES, data });
  } catch (err) {
    console.error('DTGPT token-usage error:', err);
    res.status(500).json({ error: 'DTGPT 토큰 사용량 조회에 실패했습니다.' });
  }
});

// ─── GET /stats/user-usage ─────────────────────────────────
/**
 * 사용자별 서비스 사용량 조회
 * - year, month 필수
 * - apiKey 필수 (기존 API Key 검증 미들웨어 적용)
 * - 응답: 사용자별 × 서비스별 requestCount, inputTokens, outputTokens, totalTokens
 */
publicStatsRoutes.get('/user-usage', async (req: Request, res: Response) => {
  try {
    const yearStr = req.query['year'] as string | undefined;
    const monthStr = req.query['month'] as string | undefined;

    if (!yearStr || !monthStr) {
      res.status(400).json({
        error: 'year and month are required. (e.g., year=2026&month=4)',
        error_kr: 'year와 month는 필수 파라미터입니다. (예: year=2026&month=4)',
      });
      return;
    }

    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    if (!year || year < 2000 || year > 2100 || !month || month < 1 || month > 12) {
      res.status(400).json({
        error: 'year(2000~2100) and month(1~12) are required.',
        error_kr: 'year(2000~2100)와 month(1~12)는 유효한 값이어야 합니다.',
      });
      return;
    }

    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // 사용자별 × 서비스별 집계
    const rows = await prisma.$queryRaw<Array<{
      user_id: string;
      loginid: string;
      username: string;
      deptname: string;
      business_unit: string | null;
      service_id: string;
      service_name: string;
      service_display_name: string;
      request_count: bigint;
      input_tokens: bigint;
      output_tokens: bigint;
      total_tokens: bigint;
    }>>`
      SELECT
        u.id as user_id,
        u.loginid,
        u.username,
        u.deptname,
        u.business_unit,
        s.id as service_id,
        s.name as service_name,
        s."displayName" as service_display_name,
        COALESCE(SUM(ul.request_count), 0)::bigint as request_count,
        COALESCE(SUM(ul."inputTokens"), 0)::bigint as input_tokens,
        COALESCE(SUM(ul."outputTokens"), 0)::bigint as output_tokens,
        COALESCE(SUM(ul."totalTokens"), 0)::bigint as total_tokens
      FROM usage_logs ul
      JOIN users u ON u.id = ul.user_id
      JOIN services s ON s.id = ul.service_id
      WHERE ul.timestamp >= ${startDate}
        AND ul.timestamp <= ${endDate}
        AND ul.user_id IS NOT NULL
        AND ul.service_id IS NOT NULL
      GROUP BY u.id, u.loginid, u.username, u.deptname, u.business_unit, s.id, s.name, s."displayName"
      ORDER BY u.loginid, s.name
    `;

    // 사용자별로 그룹핑
    const userMap = new Map<string, {
      loginid: string;
      username: string;
      deptname: string;
      businessUnit: string | null;
      services: Array<{
        serviceName: string;
        serviceDisplayName: string;
        requestCount: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
      totalRequestCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
    }>();

    for (const row of rows) {
      let user = userMap.get(row.user_id);
      if (!user) {
        user = {
          loginid: row.loginid,
          username: row.username,
          deptname: row.deptname,
          businessUnit: row.business_unit,
          services: [],
          totalRequestCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
        };
        userMap.set(row.user_id, user);
      }

      const reqCount = Number(row.request_count);
      const inTok = Number(row.input_tokens);
      const outTok = Number(row.output_tokens);
      const totTok = Number(row.total_tokens);

      user.services.push({
        serviceName: row.service_name,
        serviceDisplayName: row.service_display_name,
        requestCount: reqCount,
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: totTok,
      });

      user.totalRequestCount += reqCount;
      user.totalInputTokens += inTok;
      user.totalOutputTokens += outTok;
      user.totalTokens += totTok;
    }

    const data = [...userMap.values()].sort((a, b) => b.totalRequestCount - a.totalRequestCount);

    res.json({
      year,
      month,
      totalUsers: data.length,
      data,
    });
  } catch (err) {
    console.error('User usage error:', err);
    res.status(500).json({ error: '사용자별 사용량 조회에 실패했습니다.' });
  }
});
