/**
 * Insight Routes
 *
 * 센터별/서비스별 AI 활용 인사이트 대시보드
 * - GET /admin/insight/usage-rate             — 센터별 AI 활용율 (MAU + Saved M/M)
 * - GET /admin/insight/usage-rate/:centerName — 센터 상세 (팀별 MAU, 월별 트렌드, 팀×서비스 매트릭스)
 * - GET /admin/insight/service-usage          — 서비스별 LLM 호출량 순위
 * - GET /admin/insight/service-usage/:serviceId — 서비스 상세 (팀별 토큰)
 *
 * 동일 핸들러를 /public/stats/insight_* 경로에도 등록 (인증 없이 접근 가능)
 */

import { Router, Request, Response, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { isTopLevelDivision } from '../services/knoxEmployee.service.js';

// ── Admin router (auth required) ──
export const insightRoutes = Router();
insightRoutes.use(authenticateToken);
insightRoutes.use(requireAdmin as RequestHandler);

// ── Public router (no auth) ──
export const publicInsightRoutes = Router();

// ── KST month boundary helpers ──

function getKSTNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

function getMonthBoundariesKST(year: number, month: number): [Date, Date] {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - 9 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 9 * 60 * 60 * 1000);
  return [start, end];
}

// ── Shared handler types ──
interface DeptHierarchyRow {
  id: string;
  departmentCode: string;
  departmentName: string;
  team: string;
  center2Name: string;
  center1Name: string;
}

interface MauRow {
  deptname: string;
  mau: bigint;
}

// ============================================
// GET /insight/usage-rate
// 센터별 AI 활용율 (MAU + Saved M/M)
// ============================================
async function handleUsageRate(_req: Request, res: Response) {
  try {
    const kstNow = getKSTNow();
    const currentYear = kstNow.getUTCFullYear();
    const currentMonth = kstNow.getUTCMonth() + 1;

    const lastMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const lastYear = lastMonthDate.getUTCFullYear();
    const lastMonth = lastMonthDate.getUTCMonth() + 1;

    const prevMonthDate = new Date(Date.UTC(lastYear, lastMonth - 2, 1));
    const prevYear = prevMonthDate.getUTCFullYear();
    const prevMonth = prevMonthDate.getUTCMonth() + 1;

    const [lastMonthStart, lastMonthEnd] = getMonthBoundariesKST(lastYear, lastMonth);
    const [prevMonthStart, prevMonthEnd] = getMonthBoundariesKST(prevYear, prevMonth);

    // 1. Department hierarchies
    const hierarchies = await prisma.departmentHierarchy.findMany();

    // Build deptname → hierarchy map
    const deptHierarchyMap = new Map<string, DeptHierarchyRow>();
    for (const h of hierarchies) {
      deptHierarchyMap.set(h.departmentName, h as DeptHierarchyRow);
    }

    // 2. Last month MAU per deptname
    const lastMonthMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
      GROUP BY u.deptname
    `;

    // 3. Previous month MAU per deptname
    const prevMonthMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${prevMonthStart} AND ul.timestamp < ${prevMonthEnd}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
      GROUP BY u.deptname
    `;

    // 4. DeptServiceSavedMM grouped by deptname
    const savedMMRows = await prisma.$queryRaw<Array<{ deptname: string; total_saved: number | null }>>`
      SELECT deptname, COALESCE(SUM(saved_mm), 0)::float as total_saved
      FROM dept_service_saved_mm
      GROUP BY deptname
    `;

    // Build maps
    const lastMauMap = new Map(lastMonthMauRows.map(r => [r.deptname, Number(r.mau)]));
    const prevMauMap = new Map(prevMonthMauRows.map(r => [r.deptname, Number(r.mau)]));
    const savedMMMap = new Map(savedMMRows.map(r => [r.deptname, r.total_saved || 0]));

    // 5. Determine center group for each deptname
    // Collect all unique deptnames from MAU results
    const allDeptnames = new Set<string>();
    for (const r of lastMonthMauRows) allDeptnames.add(r.deptname);
    for (const r of savedMMRows) allDeptnames.add(r.deptname);

    // centerName → { teams: [...] }
    const centerGroups = new Map<string, {
      teams: Array<{
        team: string;
        deptname: string;
        mau: number;
        savedMM: number;
      }>;
    }>();

    for (const deptname of allDeptnames) {
      if (!deptname) continue;

      const h = deptHierarchyMap.get(deptname);
      let centerName = 'Direct';
      let teamName = deptname;

      if (h) {
        teamName = h.team || deptname;

        if (h.center2Name && h.center2Name !== 'none' && !isTopLevelDivision(h.center2Name)) {
          centerName = h.center2Name;
        } else if (h.center1Name && h.center1Name !== 'none' && !isTopLevelDivision(h.center1Name)) {
          centerName = h.center1Name;
        }
      }

      if (!centerGroups.has(centerName)) {
        centerGroups.set(centerName, { teams: [] });
      }

      centerGroups.get(centerName)!.teams.push({
        team: teamName,
        deptname,
        mau: lastMauMap.get(deptname) || 0,
        savedMM: savedMMMap.get(deptname) || 0,
      });
    }

    // 6. Aggregate per center
    const centers = Array.from(centerGroups.entries()).map(([name, group]) => {
      const totalMau = group.teams.reduce((sum, t) => sum + t.mau, 0);
      const totalSavedMM = group.teams.reduce((sum, t) => sum + t.savedMM, 0);

      // mauChangePercent: compare with previous month
      const prevMau = group.teams.reduce((sum, t) => sum + (prevMauMap.get(t.deptname) || 0), 0);
      const mauChangePercent = prevMau > 0
        ? Math.round(((totalMau - prevMau) / prevMau) * 10000) / 100
        : totalMau > 0 ? 100 : 0;

      return {
        name,
        totalMau,
        mauChangePercent,
        totalSavedMM: Math.round(totalSavedMM * 100) / 100,
        teams: group.teams.sort((a, b) => b.mau - a.mau),
      };
    });

    // 7. Sort by totalSavedMM descending
    centers.sort((a, b) => b.totalSavedMM - a.totalSavedMM);

    res.json({
      month: `${lastYear}-${String(lastMonth).padStart(2, '0')}`,
      centers,
    });
  } catch (error) {
    console.error('Insight usage-rate error:', error);
    res.status(500).json({ error: 'Failed to get usage rate data' });
  }
}

// ============================================
// GET /insight/usage-rate/:centerName
// 센터 상세 (팀별 MAU, 월별 트렌드, 팀×서비스 매트릭스)
// ============================================
async function handleUsageRateDetail(req: Request, res: Response) {
  try {
    const centerName = decodeURIComponent(req.params['centerName'] as string);

    const kstNow = getKSTNow();
    const currentYear = kstNow.getUTCFullYear();
    const currentMonth = kstNow.getUTCMonth() + 1;

    const lastMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const lastYear = lastMonthDate.getUTCFullYear();
    const lastMonth = lastMonthDate.getUTCMonth() + 1;

    const [lastMonthStart, lastMonthEnd] = getMonthBoundariesKST(lastYear, lastMonth);

    // 1. Find all deptnames belonging to this center
    const hierarchies = await prisma.departmentHierarchy.findMany();

    const centerDepts: Array<{ deptname: string; team: string }> = [];
    for (const h of hierarchies) {
      let resolvedCenter = 'Direct';
      if (h.center2Name && h.center2Name !== 'none' && !isTopLevelDivision(h.center2Name)) {
        resolvedCenter = h.center2Name;
      } else if (h.center1Name && h.center1Name !== 'none' && !isTopLevelDivision(h.center1Name)) {
        resolvedCenter = h.center1Name;
      }

      if (resolvedCenter === centerName) {
        centerDepts.push({ deptname: h.departmentName, team: h.team || h.departmentName });
      }
    }

    if (centerDepts.length === 0) {
      res.status(404).json({ error: `Center '${centerName}' not found or has no departments` });
      return;
    }

    const deptnames = centerDepts.map(d => d.deptname);
    const deptTeamMap = new Map(centerDepts.map(d => [d.deptname, d.team]));

    // 2. teamMauChart: MAU per team (last month)
    const teamMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
      GROUP BY u.deptname
    `;

    const teamMauChart = teamMauRows.map(r => ({
      team: deptTeamMap.get(r.deptname) || r.deptname,
      mau: Number(r.mau),
    })).sort((a, b) => b.mau - a.mau);

    // 3. monthlyTrend: last 6 months total MAU for the center
    const monthlyTrend: Array<{ month: string; mau: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const trendDate = new Date(Date.UTC(currentYear, currentMonth - 2 - i, 1));
      const trendYear = trendDate.getUTCFullYear();
      const trendMonth = trendDate.getUTCMonth() + 1;
      const [trendStart, trendEnd] = getMonthBoundariesKST(trendYear, trendMonth);

      const mauResult = await prisma.$queryRaw<[{ mau: bigint }]>`
        SELECT COUNT(DISTINCT ul.user_id) as mau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${trendStart} AND ul.timestamp < ${trendEnd}
          AND u.loginid != 'anonymous'
          AND ul.service_id IS NOT NULL
          AND u.deptname = ANY(${deptnames})
      `;

      monthlyTrend.push({
        month: `${trendYear}-${String(trendMonth).padStart(2, '0')}`,
        mau: Number(mauResult[0]?.mau || 0),
      });
    }

    // 4. teamServices: team x service matrix (last month)
    const teamServiceRows = await prisma.$queryRaw<Array<{
      deptname: string;
      service_id: string;
      mau: bigint;
      llm_call_count: bigint;
    }>>`
      SELECT u.deptname,
             ul.service_id::text as service_id,
             COUNT(DISTINCT ul.user_id) as mau,
             COALESCE(SUM(ul.request_count), 0) as llm_call_count
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
      GROUP BY u.deptname, ul.service_id
    `;

    // Get service info
    const svcIds = [...new Set(teamServiceRows.map(r => r.service_id))];
    const services = svcIds.length > 0
      ? await prisma.service.findMany({
          where: { id: { in: svcIds } },
          select: { id: true, name: true, displayName: true, type: true },
        })
      : [];
    const svcMap = new Map(services.map(s => [s.id, s]));

    // Get savedMM per dept+service
    const savedMMEntries = svcIds.length > 0
      ? await prisma.deptServiceSavedMM.findMany({
          where: {
            serviceId: { in: svcIds },
            deptname: { in: deptnames },
          },
        })
      : [];
    const savedMMKey = (serviceId: string, deptname: string) => `${serviceId}:${deptname}`;
    const savedMMMap = new Map(savedMMEntries.map(e => [savedMMKey(e.serviceId, e.deptname), e.savedMM]));

    const teamServices = teamServiceRows.map(r => {
      const svc = svcMap.get(r.service_id);
      return {
        team: deptTeamMap.get(r.deptname) || r.deptname,
        serviceName: svc?.name || 'unknown',
        serviceDisplayName: svc?.displayName || 'Unknown',
        serviceType: svc?.type || 'STANDARD',
        savedMM: savedMMMap.get(savedMMKey(r.service_id, r.deptname)) ?? null,
        mau: Number(r.mau),
        llmCallCount: Number(r.llm_call_count),
      };
    }).sort((a, b) => b.llmCallCount - a.llmCallCount);

    res.json({
      centerName,
      period: `${lastYear}-${String(lastMonth).padStart(2, '0')}`,
      teamMauChart,
      monthlyTrend,
      teamServices,
    });
  } catch (error) {
    console.error('Insight usage-rate detail error:', error);
    res.status(500).json({ error: 'Failed to get center detail data' });
  }
}

// ============================================
// GET /insight/service-usage
// 서비스별 LLM 호출량 순위 (last month)
// ============================================
async function handleServiceUsage(_req: Request, res: Response) {
  try {
    const kstNow = getKSTNow();
    const currentYear = kstNow.getUTCFullYear();
    const currentMonth = kstNow.getUTCMonth() + 1;

    const lastMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const lastYear = lastMonthDate.getUTCFullYear();
    const lastMonth = lastMonthDate.getUTCMonth() + 1;

    const [lastMonthStart, lastMonthEnd] = getMonthBoundariesKST(lastYear, lastMonth);

    // Service usage stats
    const usageRows = await prisma.$queryRaw<Array<{
      service_id: string;
      llm_call_count: bigint;
      total_input: bigint;
      total_output: bigint;
      total_tokens: bigint;
      mau: bigint;
    }>>`
      SELECT ul.service_id::text as service_id,
             COALESCE(SUM(ul.request_count), 0) as llm_call_count,
             COALESCE(SUM(ul."inputTokens"), 0) as total_input,
             COALESCE(SUM(ul."outputTokens"), 0) as total_output,
             COALESCE(SUM(ul."totalTokens"), 0) as total_tokens,
             COUNT(DISTINCT CASE WHEN u.loginid != 'anonymous' THEN ul.user_id END) as mau
      FROM usage_logs ul
      LEFT JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
        AND ul.service_id IS NOT NULL
      GROUP BY ul.service_id
      ORDER BY llm_call_count DESC
    `;

    // Get service info
    const svcIds = usageRows.map(r => r.service_id);
    const services = svcIds.length > 0
      ? await prisma.service.findMany({
          where: { id: { in: svcIds } },
          select: { id: true, name: true, displayName: true },
        })
      : [];
    const svcMap = new Map(services.map(s => [s.id, s]));

    const data = usageRows.map(r => {
      const svc = svcMap.get(r.service_id);
      return {
        id: r.service_id,
        name: svc?.name || 'unknown',
        displayName: svc?.displayName || 'Unknown',
        llmCallCount: Number(r.llm_call_count),
        tokenUsage: {
          input: Number(r.total_input),
          output: Number(r.total_output),
          total: Number(r.total_tokens),
        },
        mau: Number(r.mau),
      };
    });

    res.json({
      month: `${lastYear}-${String(lastMonth).padStart(2, '0')}`,
      services: data,
    });
  } catch (error) {
    console.error('Insight service-usage error:', error);
    res.status(500).json({ error: 'Failed to get service usage data' });
  }
}

// ============================================
// GET /insight/service-usage/:serviceId
// 서비스 상세 (팀별 토큰 사용량)
// ============================================
async function handleServiceUsageDetail(req: Request, res: Response) {
  try {
    const serviceId = req.params['serviceId'] as string;

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true, displayName: true },
    });

    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const kstNow = getKSTNow();
    const currentYear = kstNow.getUTCFullYear();
    const currentMonth = kstNow.getUTCMonth() + 1;

    const lastMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const lastYear = lastMonthDate.getUTCFullYear();
    const lastMonth = lastMonthDate.getUTCMonth() + 1;

    const [lastMonthStart, lastMonthEnd] = getMonthBoundariesKST(lastYear, lastMonth);

    // Team-level token usage
    const tokenRows = await prisma.$queryRaw<Array<{
      deptname: string;
      total_tokens: bigint;
    }>>`
      SELECT u.deptname, COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
        AND ul.service_id = ${serviceId}
        AND u.loginid != 'anonymous'
        AND u.deptname IS NOT NULL AND u.deptname != ''
      GROUP BY u.deptname
      ORDER BY total_tokens DESC
    `;

    // Map deptname → English team name via department_hierarchies
    const hierarchies = await prisma.departmentHierarchy.findMany();
    const deptToTeam = new Map<string, string>();
    for (const h of hierarchies) {
      if (h.team) {
        deptToTeam.set(h.departmentName, h.team);
      }
    }

    const teamTokens = tokenRows.map(r => ({
      team: deptToTeam.get(r.deptname) || r.deptname,
      tokensM: Math.round(Number(r.total_tokens) / 1000000 * 100) / 100,
    }));

    res.json({
      service: {
        id: service.id,
        name: service.name,
        displayName: service.displayName,
      },
      period: `${lastYear}-${String(lastMonth).padStart(2, '0')}`,
      teamTokens,
    });
  } catch (error) {
    console.error('Insight service-usage detail error:', error);
    res.status(500).json({ error: 'Failed to get service usage detail' });
  }
}

// ── Register admin routes ──
insightRoutes.get('/insight/usage-rate', handleUsageRate as RequestHandler);
insightRoutes.get('/insight/usage-rate/:centerName', handleUsageRateDetail as RequestHandler);
insightRoutes.get('/insight/service-usage', handleServiceUsage as RequestHandler);
insightRoutes.get('/insight/service-usage/:serviceId', handleServiceUsageDetail as RequestHandler);

// ── Register public routes (same handlers, no auth) ──
publicInsightRoutes.get('/insight_ai_usage_rate', handleUsageRate as RequestHandler);
publicInsightRoutes.get('/insight_ai_usage_rate/:centerName', handleUsageRateDetail as RequestHandler);
publicInsightRoutes.get('/insight_service_usage', handleServiceUsage as RequestHandler);
publicInsightRoutes.get('/insight_service_usage/:serviceId', handleServiceUsageDetail as RequestHandler);
