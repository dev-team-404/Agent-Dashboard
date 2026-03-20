/**
 * Insight Routes — Center Token Usage Time Series (v2)
 *
 * 센터별 토큰 사용량 시계열 대시보드
 * - GET /admin/insight/token-usage  — 센터 내부 팀별/서비스별 토큰 사용량 (daily/weekly/monthly)
 *
 * 동일 핸들러를 /public/stats/insight_token_usage 경로에도 등록 (인증 없이 접근 가능)
 */

import { Router, Request, Response, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { isTopLevelDivision } from '../services/knoxEmployee.service.js';

// ── 사업부 필터 (S.LSI만 집계) ──
const INSIGHT_BUSINESS_UNIT = 'S.LSI';

// ── 차트 항목 제한 (나머지 → '기타') ──
const MAX_CHART_ITEMS = 12;

// ── Admin router (auth required) ──
export const insightRoutes = Router();
insightRoutes.use(authenticateToken);
insightRoutes.use(requireAdmin as RequestHandler);

// ── Public router (no auth) ──
export const publicInsightRoutes = Router();

// ── KST now ──
function getKSTNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// ── Center resolution ──

function buildCenterMap(hierarchies: Array<{
  departmentName: string;
  team: string;
  center1Name: string;
  center2Name: string;
}>) {
  const knownCenter1s = new Set<string>();
  for (const h of hierarchies) {
    const c1 = (h.center1Name || '').trim();
    if (c1 && c1 !== 'none' && !isTopLevelDivision(c1)) knownCenter1s.add(c1);
  }

  const result = new Map<string, { deptnames: string[]; deptTeamMap: Map<string, string> }>();

  for (const h of hierarchies) {
    const c1 = (h.center1Name || '').trim();
    const c2 = (h.center2Name || '').trim();
    const c1v = !!(c1 && c1 !== 'none' && !isTopLevelDivision(c1));
    const c2v = !!(c2 && c2 !== 'none' && !isTopLevelDivision(c2));

    let center = 'Direct';
    if (c1v && knownCenter1s.has(c1)) center = c1;
    else if (c2v && knownCenter1s.has(c2)) center = c2;
    else if (c1v) center = c1;
    else if (c2v) center = c2;

    if (!result.has(center)) result.set(center, { deptnames: [], deptTeamMap: new Map() });
    const e = result.get(center)!;
    e.deptnames.push(h.departmentName);
    e.deptTeamMap.set(h.departmentName, h.team || h.departmentName);
  }

  return result;
}

// ── Main handler ──

async function handleTokenUsage(req: Request, res: Response) {
  try {
    const centerParam = req.query['centerName'] as string | undefined;
    const granularity = (req.query['granularity'] as string) || 'monthly';

    if (!['daily', 'weekly', 'monthly'].includes(granularity)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, or monthly' });
      return;
    }

    // 1. Build hierarchy → center mapping
    const hierarchies = await prisma.departmentHierarchy.findMany();
    const centerMap = buildCenterMap(hierarchies);
    const centers = Array.from(centerMap.keys()).filter(c => c !== 'Direct').sort();

    const selected = centerParam ? decodeURIComponent(centerParam) : centers[0] || 'Direct';
    const centerData = centerMap.get(selected);

    if (!centerData || centerData.deptnames.length === 0) {
      res.json({ centers, centerName: selected, granularity, byTeam: [], byService: [], teams: [], services: [] });
      return;
    }

    const { deptnames, deptTeamMap } = centerData;

    // 2. Time range + date grouping expression
    const kst = getKSTNow();
    const ky = kst.getUTCFullYear();
    const km = kst.getUTCMonth(); // 0-based
    const kd = kst.getUTCDate();

    let qStart: Date;
    let dateExpr: string;

    if (granularity === 'daily') {
      // 최근 30일
      qStart = new Date(Date.UTC(ky, km, kd - 29) - 9 * 3600000);
      dateExpr = `TO_CHAR((ul.timestamp + INTERVAL '9 hours')::date, 'YYYY-MM-DD')`;
    } else if (granularity === 'weekly') {
      // 최근 6개월
      qStart = new Date(Date.UTC(ky, km - 5, 1) - 9 * 3600000);
      dateExpr = `TO_CHAR(DATE_TRUNC('week', ul.timestamp + INTERVAL '9 hours'), 'YYYY-MM-DD')`;
    } else {
      // 최근 12개월
      qStart = new Date(Date.UTC(ky, km - 11, 1) - 9 * 3600000);
      dateExpr = `TO_CHAR(DATE_TRUNC('month', ul.timestamp + INTERVAL '9 hours'), 'YYYY-MM')`;
    }

    const qEnd = new Date();

    // 3. Query raw data: period × deptname × service_id → total_tokens
    const rawData = await prisma.$queryRaw<Array<{
      period: string;
      deptname: string;
      service_id: string;
      total_tokens: bigint;
    }>>`
      SELECT ${Prisma.raw(dateExpr)} as period,
             u.deptname,
             ul.service_id::text as service_id,
             COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${qStart} AND ul.timestamp < ${qEnd}
        AND u.loginid != 'anonymous'
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
        AND u.deptname = ANY(${deptnames})
        AND ul.service_id IS NOT NULL
      GROUP BY 1, u.deptname, ul.service_id
      ORDER BY 1
    `;

    // 4. Service display names
    const svcIds = [...new Set(rawData.map(r => r.service_id))];
    const svcs = svcIds.length > 0
      ? await prisma.service.findMany({ where: { id: { in: svcIds } }, select: { id: true, displayName: true } })
      : [];
    const svcNameMap = new Map(svcs.map(s => [s.id, s.displayName]));

    // 5. Aggregate by team (deptname → team via hierarchy)
    const teamTotals = new Map<string, number>();
    const teamPeriods = new Map<string, Map<string, number>>();

    for (const r of rawData) {
      const team = deptTeamMap.get(r.deptname) || r.deptname;
      const tokens = Number(r.total_tokens);
      teamTotals.set(team, (teamTotals.get(team) || 0) + tokens);
      if (!teamPeriods.has(r.period)) teamPeriods.set(r.period, new Map());
      const pm = teamPeriods.get(r.period)!;
      pm.set(team, (pm.get(team) || 0) + tokens);
    }

    // 6. Aggregate by service
    const svcTotals = new Map<string, number>();
    const svcPeriods = new Map<string, Map<string, number>>();

    for (const r of rawData) {
      const sn = svcNameMap.get(r.service_id) || 'Unknown';
      const tokens = Number(r.total_tokens);
      svcTotals.set(sn, (svcTotals.get(sn) || 0) + tokens);
      if (!svcPeriods.has(r.period)) svcPeriods.set(r.period, new Map());
      const pm = svcPeriods.get(r.period)!;
      pm.set(sn, (pm.get(sn) || 0) + tokens);
    }

    // 7. Top N + '기타' grouping
    function topNWithOther(
      totals: Map<string, number>,
      periods: Map<string, Map<string, number>>,
    ): { keys: string[]; chartData: Array<Record<string, any>> } {
      const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
      const topKeys = sorted.slice(0, MAX_CHART_ITEMS).map(([k]) => k);
      const otherKeys = new Set(sorted.slice(MAX_CHART_ITEMS).map(([k]) => k));
      const hasOther = otherKeys.size > 0;
      const keys = hasOther ? [...topKeys, '기타'] : topKeys;

      const allPeriods = Array.from(periods.keys()).sort();
      const chartData = allPeriods.map(p => {
        const m = periods.get(p) || new Map();
        const entry: Record<string, any> = { period: p };
        let otherTotal = 0;
        for (const [k, v] of m.entries()) {
          if (otherKeys.has(k)) {
            otherTotal += v;
          } else if (topKeys.includes(k)) {
            entry[k] = v;
          }
        }
        // Ensure all top keys have a value
        for (const k of topKeys) {
          if (!(k in entry)) entry[k] = 0;
        }
        if (hasOther) entry['기타'] = otherTotal;
        return entry;
      });

      return { keys, chartData };
    }

    const teamResult = topNWithOther(teamTotals, teamPeriods);
    const svcResult = topNWithOther(svcTotals, svcPeriods);

    res.json({
      centers,
      centerName: selected,
      granularity,
      byTeam: teamResult.chartData,
      byService: svcResult.chartData,
      teams: teamResult.keys,
      services: svcResult.keys,
    });
  } catch (err) {
    console.error('Insight token-usage error:', err);
    res.status(500).json({ error: 'Failed to get token usage data' });
  }
}

// ── Register routes ──
insightRoutes.get('/insight/token-usage', handleTokenUsage as RequestHandler);
publicInsightRoutes.get('/insight_token_usage', handleTokenUsage as RequestHandler);
