/**
 * Insight Routes — Center Token Usage Time Series (v2)
 *
 * DTGPT 서버(cloud.dtgpt.samsunds.net) 모델 사용량만 집계
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

// ── DTGPT 서버 필터 (특정 LLM + 특정 서비스) ──
const DTGPT_ENDPOINT_PREFIX = 'http://cloud.dtgpt.samsunds.net/llm/v1';
const DTGPT_FIXED_SERVICES = ['roocode', 'dify', 'openwebui', 'claudecode'];
const DTGPT_API_SERVICE = 'api';

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
    const empty = { centers: [] as string[], centerName: '', granularity, byTeam: [], byService: [], teams: [], services: [] };

    if (!['daily', 'weekly', 'monthly'].includes(granularity)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, or monthly' });
      return;
    }

    // 1-a. 특정 LLM 필터: DTGPT 서버 모델 ID
    const dtgptModelRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM models WHERE "endpointUrl" LIKE ${DTGPT_ENDPOINT_PREFIX + '%'}
    `;
    const dtgptModelIds = dtgptModelRows.map(r => r.id);

    // 1-b. 특정 서비스 필터: roocode, dify, openwebui, claudecode, api
    const dtgptSvcRows = await prisma.service.findMany({
      where: { name: { in: [...DTGPT_FIXED_SERVICES, DTGPT_API_SERVICE] } },
      select: { id: true },
    });
    const dtgptServiceIds = dtgptSvcRows.map(s => s.id);

    if (dtgptModelIds.length === 0 || dtgptServiceIds.length === 0) {
      res.json(empty);
      return;
    }

    // 2. Time range
    const kst = getKSTNow();
    const ky = kst.getUTCFullYear();
    const km = kst.getUTCMonth();
    const kd = kst.getUTCDate();

    let qStart: Date;
    let dateExpr: string;

    if (granularity === 'daily') {
      qStart = new Date(Date.UTC(ky, km, kd - 29) - 9 * 3600000);
      dateExpr = `TO_CHAR((ul.timestamp + INTERVAL '9 hours')::date, 'YYYY-MM-DD')`;
    } else if (granularity === 'weekly') {
      qStart = new Date(Date.UTC(ky, km - 5, 1) - 9 * 3600000);
      dateExpr = `TO_CHAR(DATE_TRUNC('week', ul.timestamp + INTERVAL '9 hours'), 'YYYY-MM-DD')`;
    } else {
      qStart = new Date(Date.UTC(ky, km - 11, 1) - 9 * 3600000);
      dateExpr = `TO_CHAR(DATE_TRUNC('month', ul.timestamp + INTERVAL '9 hours'), 'YYYY-MM')`;
    }

    const qEnd = new Date();

    // 3. DTGPT 사용 실적이 있는 부서만 조회 (특정 서비스 + 특정 LLM 모두 충족)
    const activeDeptRows = await prisma.$queryRaw<Array<{ deptname: string }>>`
      SELECT DISTINCT u.deptname
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${qStart} AND ul.timestamp < ${qEnd}
        AND u.loginid != 'anonymous'
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
        AND ul.model_id = ANY(${dtgptModelIds})
        AND ul.service_id = ANY(${dtgptServiceIds})
        AND u.deptname IS NOT NULL AND u.deptname != ''
    `;
    const activeDeptSet = new Set(activeDeptRows.map(r => r.deptname));

    if (activeDeptSet.size === 0) {
      res.json(empty);
      return;
    }

    // 4. hierarchy에서 활성 부서만 → center 매핑
    const hierarchies = await prisma.departmentHierarchy.findMany();
    const fullCenterMap = buildCenterMap(hierarchies);

    // 활성 부서만 남긴 center map
    const activeCenterMap = new Map<string, { deptnames: string[]; deptTeamMap: Map<string, string> }>();
    for (const [cName, cData] of fullCenterMap.entries()) {
      const activeDepts = cData.deptnames.filter(d => activeDeptSet.has(d));
      if (activeDepts.length > 0) {
        activeCenterMap.set(cName, { deptnames: activeDepts, deptTeamMap: cData.deptTeamMap });
      }
    }

    const centers = Array.from(activeCenterMap.keys()).filter(c => c !== 'Direct').sort();

    if (centers.length === 0) {
      res.json(empty);
      return;
    }

    const selected = centerParam ? decodeURIComponent(centerParam) : centers[0];
    const centerData = activeCenterMap.get(selected);

    if (!centerData || centerData.deptnames.length === 0) {
      res.json({ ...empty, centers, centerName: selected });
      return;
    }

    const { deptnames, deptTeamMap } = centerData;

    // 5. 메인 쿼리: DTGPT 모델 + DTGPT 서비스 + 해당 센터 부서
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
        AND ul.model_id = ANY(${dtgptModelIds})
        AND ul.service_id = ANY(${dtgptServiceIds})
      GROUP BY 1, u.deptname, ul.service_id
      ORDER BY 1
    `;

    // 6. Service display names
    const svcIds = [...new Set(rawData.map(r => r.service_id))];
    const svcs = svcIds.length > 0
      ? await prisma.service.findMany({ where: { id: { in: svcIds } }, select: { id: true, displayName: true } })
      : [];
    const svcNameMap = new Map(svcs.map(s => [s.id, s.displayName]));

    // 7. Aggregate by team
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

    // 8. Aggregate by service
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

    // 9. Top N + '기타' grouping
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
