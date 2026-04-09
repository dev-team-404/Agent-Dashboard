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
import { buildAllHierarchyMap, buildOverseasMap } from '../services/orgTree.service.js';
// ── 사업부 필터 (S.LSI만 집계) ──
const INSIGHT_BUSINESS_UNIT = 'S.LSI';

// ── 센터 그룹핑 규칙 ──
const BUSINESS_TEAM_CENTERS = new Set(['SOC Business Team', 'LSI Business Team', 'Sensor Business Team']);

// ── 해외 R&D 센터 루트 노드 (org_nodes.enDepartmentName 기준) ──
const OVERSEAS_CENTER_NAMES = ['DSC(DS)', 'DSRA-S.LSI(DS)', 'DSRJ(DS)', 'SSIR(DS)', 'SSCR'];

/**
 * 국내 센터 그룹 결정 (org_nodes 계층 기반)
 * overseas 분류는 별도 overseasMap으로 처리하므로 여기선 국내만 판별
 */
function resolveDomesticCenter(h: { team: string; center1Name: string; center2Name: string }): string {
  const c1 = (h.center1Name || '').trim();
  const c2 = (h.center2Name || '').trim();
  const team = (h.team || '').trim();

  // 팀 자체가 BT이거나, c1/c2에 BT가 있으면 해당 BT
  if (BUSINESS_TEAM_CENTERS.has(team)) return team;
  if (BUSINESS_TEAM_CENTERS.has(c1)) return c1;
  if (BUSINESS_TEAM_CENTERS.has(c2)) return c2;

  // System LSI Business 소속 → Direct
  if (c1 === 'System LSI Business' || c2 === 'System LSI Business') return 'Direct';

  // 그 외 → 집계 제외
  return '';
}

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

// ── 요청 파라미터에서 대상 월 결정 ──
// ?year=2026&month=3 → 해당 월, 미입력 → 이번달
function resolveTargetMonth(req: Request): {
  targetYear: number; targetMonth: number;
  prevYear: number; prevMonth: number;
  targetStart: Date; targetEnd: Date; effectiveEnd: Date;
  prevStart: Date; prevEnd: Date;
  isCurrentMonth: boolean;
  monthLabel: string;
} {
  const kstNow = getKSTNow();
  const curYear = kstNow.getUTCFullYear();
  const curMonth = kstNow.getUTCMonth() + 1;

  const qYear = req.query['year'] ? parseInt(req.query['year'] as string) : null;
  const qMonth = req.query['month'] ? parseInt(req.query['month'] as string) : null;

  let targetYear: number, targetMonth: number;
  if (qYear && qMonth && qMonth >= 1 && qMonth <= 12) {
    targetYear = qYear;
    targetMonth = qMonth;
  } else {
    // 미입력 → 이번달
    targetYear = curYear;
    targetMonth = curMonth;
  }

  const isCurrentMonth = targetYear === curYear && targetMonth === curMonth;
  const prev = new Date(Date.UTC(targetYear, targetMonth - 2, 1));
  const prevYear = prev.getUTCFullYear();
  const prevMonth = prev.getUTCMonth() + 1;

  const [targetStart, targetEnd] = getMonthBoundariesKST(targetYear, targetMonth);
  const [prevStart, prevEnd] = getMonthBoundariesKST(prevYear, prevMonth);
  const effectiveEnd = isCurrentMonth ? new Date() : targetEnd;

  return {
    targetYear, targetMonth, prevYear, prevMonth,
    targetStart, targetEnd, effectiveEnd, prevStart, prevEnd,
    isCurrentMonth,
    monthLabel: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
  };
}

// ── Shared handler types ──
interface MauRow {
  deptname: string;
  mau: bigint;
}
interface AvgDauRow {
  deptname: string;
  d?: Date | string;
  avg_dau: number;
}

// ============================================
// GET /insight/usage-rate
// 센터별 AI 활용율 (MAU + Saved M/M)
// ============================================
async function handleUsageRate(req: Request, res: Response) {
  try {
    const tm = resolveTargetMonth(req);
    const { targetStart, effectiveEnd, isCurrentMonth, monthLabel } = tm;
    const { prevStart: prevMonthStart, prevEnd: prevMonthEnd } = tm;

    // 1. org_nodes 기반 부서 계층 맵 + 해외센터 후손 맵
    const deptHierarchyMap = await buildAllHierarchyMap();
    const overseasMap = await buildOverseasMap(OVERSEAS_CENTER_NAMES);

    // 2. Target month MAU per deptname (business_unit 필터 없음 — deptname suffix로 분류)
    const targetMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND ul.service_id IS NOT NULL
      GROUP BY u.deptname
    `;

    // 3. Previous month MAU per deptname (비교용)
    const prevMonthMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${prevMonthStart} AND ul.timestamp < ${prevMonthEnd}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND ul.service_id IS NOT NULL
      GROUP BY u.deptname
    `;

    // 4. DeptServiceSavedMM grouped by deptname
    //    saved_mm가 없으면 ai_estimated_mm 폴백
    const savedMMRows = await prisma.$queryRaw<Array<{ deptname: string; total_saved: number | null; has_manual: boolean }>>`
      SELECT dsm.deptname,
             COALESCE(SUM(COALESCE(dsm.saved_mm, dsm.ai_estimated_mm)), 0)::float as total_saved,
             bool_or(dsm.saved_mm IS NOT NULL) as has_manual
      FROM dept_service_saved_mm dsm
      GROUP BY dsm.deptname
    `;

    // Build maps
    const targetMauMap = new Map(targetMauRows.map(r => [r.deptname, Number(r.mau)]));
    const prevMauMap = new Map(prevMonthMauRows.map(r => [r.deptname, Number(r.mau)]));
    const savedMMMap = new Map(savedMMRows.map(r => [r.deptname, r.total_saved || 0]));
    const savedMMManualMap = new Map(savedMMRows.map(r => [r.deptname, r.has_manual]));

    // 5. Determine center group for each deptname
    const allDeptnames = new Set<string>();
    for (const r of targetMauRows) allDeptnames.add(r.deptname);
    for (const r of savedMMRows) allDeptnames.add(r.deptname);

    const centerGroups = new Map<string, {
      teams: Array<{
        team: string;
        deptname: string;
        mau: number;
        savedMM: number;
        hasManual: boolean;
      }>;
    }>();

    for (const deptname of allDeptnames) {
      if (!deptname) continue;

      const h = deptHierarchyMap.get(deptname);
      let teamName = h?.team || deptname;
      let centerName = '';

      const overseasCenter = overseasMap.get(deptname);
      if (overseasCenter) {
        // 해외센터 후손 → Overseas R&D Center
        centerName = 'Overseas R&D Center';
      } else if (h) {
        // 국내 → BT/Direct 분류
        centerName = resolveDomesticCenter(h);
      }

      if (!centerName) continue;

      if (!centerGroups.has(centerName)) {
        centerGroups.set(centerName, { teams: [] });
      }

      centerGroups.get(centerName)!.teams.push({
        team: teamName,
        deptname,
        mau: targetMauMap.get(deptname) || 0,
        savedMM: savedMMMap.get(deptname) || 0,
        hasManual: savedMMManualMap.get(deptname) || false,
      });
    }

    // 센터별 정확한 avgDau 계산을 위해 일자×부서 DAU를 먼저 집계 (당월 / 전월)
    const centerDeptnames = Array.from(allDeptnames).filter(Boolean);
    const mergeDailyDauIntoCenterMap = (
      rows: Array<{ deptname: string; d: Date | string; dau: bigint }>,
      into: Map<string, Map<string, number>>,
    ) => {
      for (const row of rows) {
        const dateStr = typeof row.d === 'string' ? row.d : (row.d as Date).toISOString().slice(0, 10);
        const centerName = (() => {
          const h = deptHierarchyMap.get(row.deptname);
          const overseasCenter = overseasMap.get(row.deptname);
          if (overseasCenter) return 'Overseas R&D Center';
          if (h) return resolveDomesticCenter(h);
          return '';
        })();
        if (!centerName) continue;
        if (!into.has(centerName)) into.set(centerName, new Map<string, number>());
        const daily = into.get(centerName)!;
        daily.set(dateStr, (daily.get(dateStr) || 0) + Number(row.dau));
      }
    };

    const [centerDailyDauRows, prevCenterDailyDauRows] = centerDeptnames.length > 0
      ? await Promise.all([
          prisma.$queryRaw<Array<{ deptname: string; d: Date | string; dau: bigint }>>`
            SELECT u.deptname, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
            FROM usage_logs ul
            INNER JOIN users u ON ul.user_id = u.id
            WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
              AND u.loginid != 'anonymous' AND u.is_test_account = false
              AND ul.service_id IS NOT NULL
              AND u.deptname = ANY(${centerDeptnames})
              AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
              AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
            GROUP BY u.deptname, DATE(ul.timestamp)
          `,
          prisma.$queryRaw<Array<{ deptname: string; d: Date | string; dau: bigint }>>`
            SELECT u.deptname, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
            FROM usage_logs ul
            INNER JOIN users u ON ul.user_id = u.id
            WHERE ul.timestamp >= ${prevMonthStart} AND ul.timestamp < ${prevMonthEnd}
              AND u.loginid != 'anonymous' AND u.is_test_account = false
              AND ul.service_id IS NOT NULL
              AND u.deptname = ANY(${centerDeptnames})
              AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
              AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
            GROUP BY u.deptname, DATE(ul.timestamp)
          `,
        ])
      : [[], []];

    const centerDailyMap = new Map<string, Map<string, number>>();
    const prevCenterDailyMap = new Map<string, Map<string, number>>();
    mergeDailyDauIntoCenterMap(centerDailyDauRows, centerDailyMap);
    mergeDailyDauIntoCenterMap(prevCenterDailyDauRows, prevCenterDailyMap);

    // 6. Aggregate per center
    const centers = Array.from(centerGroups.entries()).map(([name, group]) => {
      const totalMau = group.teams.reduce((sum, t) => sum + t.mau, 0);
      const centerDaily = centerDailyMap.get(name);
      const totalAvgDau = centerDaily && centerDaily.size > 0
        ? Array.from(centerDaily.values()).reduce((sum, v) => sum + v, 0) / centerDaily.size
        : 0;
      const prevCenterDaily = prevCenterDailyMap.get(name);
      const prevAvgDau = prevCenterDaily && prevCenterDaily.size > 0
        ? Array.from(prevCenterDaily.values()).reduce((sum, v) => sum + v, 0) / prevCenterDaily.size
        : 0;
      const totalSavedMM = group.teams.reduce((sum, t) => sum + t.savedMM, 0);

      // mauChangePercent: compare with previous month
      const prevMau = group.teams.reduce((sum, t) => sum + (prevMauMap.get(t.deptname) || 0), 0);
      const mauChangePercent = prevMau > 0
        ? Math.round(((totalMau - prevMau) / prevMau) * 10000) / 100
        : totalMau > 0 ? 100 : 0;

      // dauChangePercent: 전월 대비 avgDau(영업일 평균) 변화율
      const dauChangePercent = prevAvgDau > 0
        ? Math.round(((totalAvgDau - prevAvgDau) / prevAvgDau) * 10000) / 100
        : totalAvgDau > 0 ? 100 : 0;

      // Overseas R&D Center → 해외센터(DSC/DSRA/DSRJ/SSIR) 수로 카운트
      let teamCount = group.teams.length;
      if (name === 'Overseas R&D Center') {
        const subgroups = new Set<string>();
        for (const t of group.teams) {
          subgroups.add(overseasMap.get(t.deptname) || 'Other');
        }
        teamCount = subgroups.size;
      }

      // 센터 내 모든 부서가 수기 입력 없으면 → AI 추정치
      const allManual = group.teams.every(t => t.hasManual);
      const someManual = group.teams.some(t => t.hasManual);

      return {
        name,
        totalMau,
        avgDau: Math.round(totalAvgDau * 100) / 100,
        mauChangePercent,
        dauChangePercent,
        totalSavedMM: Math.round(totalSavedMM * 100) / 100,
        savedMMSource: allManual ? 'manual' : someManual ? 'mixed' : 'ai_estimate',
        teamCount,
      };
    });

    // 7. Sort by totalSavedMM descending
    centers.sort((a, b) => b.totalSavedMM - a.totalSavedMM);

    res.json({
      month: monthLabel,
      isCurrentMonth,
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
    const tm = resolveTargetMonth(req);
    const { targetYear, targetMonth, targetStart, effectiveEnd, monthLabel } = tm;
    const currentYear = targetYear;
    const currentMonth = targetMonth;

    // 1. Find depts belonging to this center (org_nodes 기반)
    const hierMap = await buildAllHierarchyMap();
    const overseasMap = await buildOverseasMap(OVERSEAS_CENTER_NAMES);

    const centerDepts: Array<{ deptname: string; team: string }> = [];

    if (centerName === 'Overseas R&D Center') {
      // 해외센터 후손 맵에서 직접 추출
      for (const [deptname, _center] of overseasMap) {
        const h = hierMap.get(deptname);
        centerDepts.push({ deptname, team: h?.team || deptname });
      }
    } else {
      // 국내 센터 — hierarchy 기반 매칭
      for (const [deptname, h] of hierMap) {
        if (!overseasMap.has(deptname) && resolveDomesticCenter(h) === centerName) {
          centerDepts.push({ deptname, team: h.team || deptname });
        }
      }
    }

    if (centerDepts.length === 0) {
      res.status(404).json({ error: `Center '${centerName}' not found or has no departments` });
      return;
    }

    const deptnames = centerDepts.map(d => d.deptname);
    const deptTeamMap = new Map(centerDepts.map(d => [d.deptname, d.team]));

    // Overseas → 소속 해외센터명으로 서브그룹, 그 외 → 영문 팀명
    const isOverseas = centerName === 'Overseas R&D Center';
    const deptGroupMap = new Map<string, string>();
    if (isOverseas) {
      for (const d of centerDepts) {
        deptGroupMap.set(d.deptname, overseasMap.get(d.deptname) || 'Other');
      }
    } else {
      for (const d of centerDepts) {
        deptGroupMap.set(d.deptname, d.team);
      }
    }

    // 그룹명 → 한글 부서명 매핑 (UI 표시용, swagger 미노출)
    const groupKrMap: Record<string, string[]> = {};
    for (const d of centerDepts) {
      const group = deptGroupMap.get(d.deptname) || d.team;
      if (!groupKrMap[group]) groupKrMap[group] = [];
      if (!groupKrMap[group].includes(d.deptname)) groupKrMap[group].push(d.deptname);
    }

    // 2. teamMauChart: MAU per group
    const teamMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
      GROUP BY u.deptname
    `;
    const teamAvgDauDailyRows = await prisma.$queryRaw<Array<{ deptname: string; d: Date | string; dau: bigint }>>`
      SELECT u.deptname, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
        AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
        AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
      GROUP BY u.deptname, DATE(ul.timestamp)
    `;

    // 서브그룹별 합산
    const mauByGroup = new Map<string, number>();
    const avgDauByGroup = new Map<string, number>();
    const groupDailyMap = new Map<string, Map<string, number>>();
    for (const r of teamMauRows) {
      const group = deptGroupMap.get(r.deptname) || r.deptname;
      mauByGroup.set(group, (mauByGroup.get(group) || 0) + Number(r.mau));
    }
    for (const r of teamAvgDauDailyRows) {
      const group = deptGroupMap.get(r.deptname) || r.deptname;
      const dateStr = typeof r.d === 'string' ? r.d : (r.d as Date).toISOString().slice(0, 10);
      if (!groupDailyMap.has(group)) groupDailyMap.set(group, new Map<string, number>());
      const daily = groupDailyMap.get(group)!;
      daily.set(dateStr, (daily.get(dateStr) || 0) + Number(r.dau));
    }
    for (const [group, daily] of groupDailyMap.entries()) {
      const avg = daily.size > 0
        ? Array.from(daily.values()).reduce((sum, v) => sum + v, 0) / daily.size
        : 0;
      avgDauByGroup.set(group, avg);
    }
    const teamMauChart = Array.from(mauByGroup.entries())
      .map(([team, mau]) => ({ team, mau, avgDau: Math.round((avgDauByGroup.get(team) || 0) * 100) / 100 }))
      .sort((a, b) => b.mau - a.mau);

    // 3+5. monthlyTrend + monthlyTokenTrend: single query (replaces 12 sequential queries)
    const firstTrendDate = new Date(Date.UTC(currentYear, currentMonth - 2 - 5, 1));
    const lastTrendDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const [rangeStart] = getMonthBoundariesKST(firstTrendDate.getUTCFullYear(), firstTrendDate.getUTCMonth() + 1);
    const [, rangeEnd] = getMonthBoundariesKST(lastTrendDate.getUTCFullYear(), lastTrendDate.getUTCMonth() + 1);

    const monthlyRows = await prisma.$queryRaw<Array<{ month: string; mau: bigint; total_tokens: bigint }>>`
      SELECT
        TO_CHAR(ul.timestamp AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') as month,
        COUNT(DISTINCT ul.user_id) as mau,
        COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${rangeStart} AND ul.timestamp < ${rangeEnd}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
      GROUP BY TO_CHAR(ul.timestamp AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')
      ORDER BY month ASC
    `;

    const monthlyDataMap = new Map(monthlyRows.map(r => [r.month, r]));
    const monthlyTrend: Array<{ month: string; mau: number }> = [];
    const monthlyTokenTrend: Array<{ month: string; tokens: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const trendDate = new Date(Date.UTC(currentYear, currentMonth - 2 - i, 1));
      const trendYear = trendDate.getUTCFullYear();
      const trendMonth = trendDate.getUTCMonth() + 1;
      const monthKey = `${trendYear}-${String(trendMonth).padStart(2, '0')}`;
      const row = monthlyDataMap.get(monthKey);
      monthlyTrend.push({ month: monthKey, mau: Number(row?.mau || 0) });
      monthlyTokenTrend.push({ month: monthKey, tokens: Number(row?.total_tokens || 0) });
    }

    // 4. teamTokenChart: 팀별 토큰 사용량
    const teamTokenRows = await prisma.$queryRaw<Array<{
      deptname: string; total_tokens: bigint;
    }>>`
      SELECT u.deptname,
             COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
      GROUP BY u.deptname
    `;

    const tokensByGroup = new Map<string, number>();
    for (const r of teamTokenRows) {
      const group = deptGroupMap.get(r.deptname) || r.deptname;
      tokensByGroup.set(group, (tokensByGroup.get(group) || 0) + Number(r.total_tokens));
    }
    const teamTokenChart = Array.from(tokensByGroup.entries())
      .map(([team, tokens]) => ({ team, tokens }))
      .sort((a, b) => b.tokens - a.tokens);

    // 6. teamServices: team x service matrix (last month)
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
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
      GROUP BY u.deptname, ul.service_id
    `;

    // Get service info (DEPLOYED only)
    const svcIds = [...new Set(teamServiceRows.map(r => r.service_id))];
    const services = svcIds.length > 0
      ? await prisma.service.findMany({
          where: { id: { in: svcIds }, status: 'DEPLOYED' },
          select: { id: true, name: true, displayName: true, type: true },
        })
      : [];
    const svcMap = new Map(services.map(s => [s.id, s]));

    // Get savedMM per dept+service (saved_mm 없으면 ai_estimated_mm 폴백)
    const savedMMEntries = svcIds.length > 0
      ? await prisma.deptServiceSavedMM.findMany({
          where: {
            serviceId: { in: svcIds },
            deptname: { in: deptnames },
          },
        })
      : [];
    const savedMMKey = (serviceId: string, deptname: string) => `${serviceId}:${deptname}`;
    const savedMMMap = new Map(savedMMEntries.map(e => [
      savedMMKey(e.serviceId, e.deptname),
      { value: e.savedMM ?? e.aiEstimatedMM, isAiEstimate: e.savedMM == null && e.aiEstimatedMM != null },
    ]));

    // teamServices용 avgDau: deptname × service_id 별 일일 DAU
    const teamServiceDailyDauRows = svcIds.length > 0
      ? await prisma.$queryRaw<Array<{ deptname: string; service_id: string; d: Date | string; dau: bigint }>>`
          SELECT u.deptname, ul.service_id::text as service_id, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
            AND u.loginid != 'anonymous' AND u.is_test_account = false
            AND ul.service_id IS NOT NULL
            AND u.deptname = ANY(${deptnames})
            AND ul.service_id::text = ANY(${svcIds})
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
          GROUP BY u.deptname, ul.service_id, DATE(ul.timestamp)
        `
      : [];

    // deptname×service별 avgDau (행 단위와 동일한 granularity)
    const tsAvgDauKey = (deptname: string, serviceId: string) => `${deptname}::${serviceId}`;
    const tsDailyMap = new Map<string, Map<string, number>>();
    for (const r of teamServiceDailyDauRows) {
      const key = tsAvgDauKey(r.deptname, r.service_id);
      const dateStr = typeof r.d === 'string' ? r.d : (r.d as Date).toISOString().slice(0, 10);
      if (!tsDailyMap.has(key)) tsDailyMap.set(key, new Map<string, number>());
      const daily = tsDailyMap.get(key)!;
      daily.set(dateStr, (daily.get(dateStr) || 0) + Number(r.dau));
    }
    const tsAvgDauMap = new Map<string, number>();
    for (const [key, daily] of tsDailyMap.entries()) {
      const avg = daily.size > 0
        ? Array.from(daily.values()).reduce((sum, v) => sum + v, 0) / daily.size
        : 0;
      tsAvgDauMap.set(key, avg);
    }

    // Unknown 서비스 제외: svcMap에 존재하는 것만 포함
    const teamServices = teamServiceRows
      .filter(r => svcMap.has(r.service_id))
      .map(r => {
        const svc = svcMap.get(r.service_id)!;
        const group = deptGroupMap.get(r.deptname) || r.deptname;
        const mmEntry = savedMMMap.get(savedMMKey(r.service_id, r.deptname));
        return {
          team: group,
          serviceDisplayName: svc.displayName,
          serviceType: svc.type || 'STANDARD',
          savedMM: mmEntry?.value ?? null,
          savedMMSource: mmEntry ? (mmEntry.isAiEstimate ? 'ai_estimate' : 'manual') : null,
          avgDau: Math.round((tsAvgDauMap.get(tsAvgDauKey(r.deptname, r.service_id)) || 0) * 100) / 100,
          mau: Number(r.mau),
          llmCallCount: Number(r.llm_call_count),
        };
      })
      .sort((a, b) => b.llmCallCount - a.llmCallCount);

    res.json({
      centerName,
      period: monthLabel,
      teamMauChart,
      monthlyTrend,
      teamTokenChart,
      monthlyTokenTrend,
      teamServices,
      teamKrMap: groupKrMap,
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
async function handleServiceUsage(req: Request, res: Response) {
  try {
    const tm = resolveTargetMonth(req);
    const { targetStart, effectiveEnd, isCurrentMonth, monthLabel } = tm;

    // DEPLOYED 서비스 ID 목록
    const deployedServices = await prisma.service.findMany({
      where: { status: 'DEPLOYED' },
      select: { id: true, name: true, displayName: true, registeredByDept: true },
    });
    const EXCLUDED_SERVICE_NAMES = ['api'];
    const filteredServices = deployedServices.filter(s => !EXCLUDED_SERVICE_NAMES.includes(s.name) && s.registeredByDept);
    const deployedIds = filteredServices.map(s => s.id);

    if (deployedIds.length === 0) {
      res.json({ month: monthLabel, isCurrentMonth, services: [] });
      return;
    }

    // Service usage stats (DEPLOYED only)
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
             COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND ul.service_id::text = ANY(${deployedIds})
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
      GROUP BY ul.service_id
      ORDER BY llm_call_count DESC
    `;
    const avgDauRows = await prisma.$queryRaw<Array<{ service_id: string; avg_dau: number }>>`
      WITH daily_dau AS (
        SELECT ul.service_id::text as service_id, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
          AND ul.service_id::text = ANY(${deployedIds})
          AND u.loginid != 'anonymous' AND u.is_test_account = false
          AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
          AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
        GROUP BY ul.service_id, DATE(ul.timestamp)
      )
      SELECT service_id, COALESCE(AVG(dau), 0)::float as avg_dau
      FROM daily_dau
      GROUP BY service_id
    `;

    const svcMap = new Map(deployedServices.map(s => [s.id, s]));
    const avgDauMap = new Map(avgDauRows.map(r => [r.service_id, r.avg_dau]));

    // Unknown 서비스 제외: svcMap에 존재하는 것만 포함
    const data = usageRows
      .filter(r => svcMap.has(r.service_id))
      .map(r => {
        const svc = svcMap.get(r.service_id)!;
        return {
          displayName: svc.displayName,
          serviceProvider: svc.registeredByDept!,
          llmCallCount: Number(r.llm_call_count),
          tokenUsage: {
            input: Number(r.total_input),
            output: Number(r.total_output),
            total: Number(r.total_tokens),
          },
          avgDau: Math.round((avgDauMap.get(r.service_id) || 0) * 100) / 100,
          mau: Number(r.mau),
        };
      });

    res.json({
      month: monthLabel,
      isCurrentMonth,
      services: data,
    });
  } catch (error) {
    console.error('Insight service-usage error:', error);
    res.status(500).json({ error: 'Failed to get service usage data' });
  }
}

// ============================================
// GET /insight/service-usage/:serviceName
// 서비스 상세 (팀별 토큰 사용량) — serviceName = displayName
// ============================================
async function handleServiceUsageDetail(req: Request, res: Response) {
  try {
    const serviceName = decodeURIComponent(req.params['serviceName'] as string);

    const service = await prisma.service.findUnique({
      where: { displayName: serviceName },
      select: { id: true, displayName: true },
    });

    if (!service) {
      res.status(404).json({ error: `Service "${serviceName}" not found` });
      return;
    }

    const tm = resolveTargetMonth(req);
    const { targetStart, effectiveEnd, monthLabel } = tm;

    // Team-level token usage + MAU + LLM call count
    const teamRows = await prisma.$queryRaw<Array<{
      deptname: string;
      total_tokens: bigint;
      mau: bigint;
      llm_call_count: bigint;
    }>>`
      SELECT u.deptname,
             COALESCE(SUM(ul."totalTokens"), 0) as total_tokens,
             COUNT(DISTINCT ul.user_id) as mau,
             COALESCE(SUM(ul.request_count), 0) as llm_call_count
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND ul.service_id = ${service.id}
        AND u.loginid != 'anonymous' AND u.is_test_account = false
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
        AND u.deptname IS NOT NULL AND u.deptname != ''
      GROUP BY u.deptname
      ORDER BY total_tokens DESC
    `;
    const teamAvgDauRows = await prisma.$queryRaw<Array<{ deptname: string; avg_dau: number }>>`
      WITH daily_dau AS (
        SELECT u.deptname, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
          AND ul.service_id = ${service.id}
          AND u.loginid != 'anonymous' AND u.is_test_account = false
          AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
          AND u.deptname IS NOT NULL AND u.deptname != ''
          AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
        GROUP BY u.deptname, DATE(ul.timestamp)
      )
      SELECT deptname, COALESCE(AVG(dau), 0)::float as avg_dau
      FROM daily_dau
      GROUP BY deptname
    `;

    // Map deptname → English team name via org_nodes
    const hierMap = await buildAllHierarchyMap();
    const deptToTeam = new Map<string, string>();
    for (const [deptname, h] of hierMap) {
      if (h.team) {
        deptToTeam.set(deptname, h.team);
      }
    }
    const avgDauByDept = new Map(teamAvgDauRows.map(r => [r.deptname, r.avg_dau]));

    const teamDetails = teamRows.map(r => ({
      team: deptToTeam.get(r.deptname) || r.deptname,
      teamKr: r.deptname,
      tokensM: Math.round(Number(r.total_tokens) / 1000000 * 100) / 100,
      avgDau: Math.round((avgDauByDept.get(r.deptname) || 0) * 100) / 100,
      mau: Number(r.mau),
      llmCallCount: Number(r.llm_call_count),
    }));

    res.json({
      displayName: service.displayName,
      period: monthLabel,
      teamDetails,
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
insightRoutes.get('/insight/service-usage/:serviceName', handleServiceUsageDetail as RequestHandler);

// ── Register public routes (no auth, UI 전용 필드 제거) ──
publicInsightRoutes.get('/insight_ai_usage_rate', handleUsageRate as RequestHandler);
publicInsightRoutes.get('/insight_ai_usage_rate/:centerName', (async (req: Request, res: Response) => {
  const origJson = res.json.bind(res);
  res.json = (body: Record<string, unknown>) => {
    if (body && typeof body === 'object') {
      // teamMauChart + teamTokenChart → data 배열로 합침
      const mauChart = (body.teamMauChart || []) as Array<{ team: string; mau: number; avgDau?: number }>;
      const tokenChart = (body.teamTokenChart || []) as Array<{ team: string; tokens: number }>;
      const tokenMap = new Map(tokenChart.map(t => [t.team, t.tokens]));
      const data = mauChart.map(t => ({
        teamName: t.team,
        avgDau: t.avgDau || 0,
        mau: t.mau,
        tokens: tokenMap.get(t.team) || 0,
      }));

      // monthlyTrend + monthlyTokenTrend → monthlyTrend에 tokens 합침
      const mauTrend = (body.monthlyTrend || []) as Array<{ month: string; mau: number }>;
      const tokenTrend = (body.monthlyTokenTrend || []) as Array<{ month: string; tokens: number }>;
      const tokenTrendMap = new Map(tokenTrend.map(t => [t.month, t.tokens]));
      const monthlyTrend = mauTrend.map(t => ({
        month: t.month,
        mau: t.mau,
        tokens: tokenTrendMap.get(t.month) || 0,
      }));

      // 순서 보장: data → monthlyTrend → teamServices 순으로 새 객체 구성
      const result = {
        centerName: body.centerName,
        period: body.period,
        data,
        monthlyTrend,
        teamServices: body.teamServices,
      };
      return origJson(result);
    }
    return origJson(body);
  };
  await handleUsageRateDetail(req, res);
}) as RequestHandler);
publicInsightRoutes.get('/insight_service_usage', handleServiceUsage as RequestHandler);
publicInsightRoutes.get('/insight_service_usage/:serviceName', handleServiceUsageDetail as RequestHandler);
