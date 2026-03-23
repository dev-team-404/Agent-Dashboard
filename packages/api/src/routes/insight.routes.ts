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
// ── 사업부 필터 (S.LSI만 집계) ──
const INSIGHT_BUSINESS_UNIT = 'S.LSI';

// ── 센터 그룹핑 규칙 ──
const BUSINESS_TEAM_CENTERS = new Set(['SOC Business Team', 'LSI Business Team', 'Sensor Business Team']);

/**
 * 한글 부서명(deptname) 끝의 괄호 내용 추출
 * 예: "SOC플랫폼팀(S.LSI)" → "S.LSI"
 *     "반도체연구팀(SCSC)" → "SCSC"
 */
function extractSuffix(deptname: string): string {
  const match = deptname.match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : '';
}

/**
 * 센터 그룹 결정 (한글 부서명 기준)
 * - (S.LSI)로 끝남 → 국내: SOC/LSI/Sensor BT 또는 Direct
 * - (S.LSI)가 아님 → Overseas R&D Center
 */
function resolveCenter(deptname: string, h: { team: string; center1Name: string; center2Name: string }): string {
  const suffix = extractSuffix(deptname);

  // (S.LSI)가 아니면 → Overseas R&D Center
  if (suffix !== 'S.LSI') return 'Overseas R&D Center';

  // (S.LSI)인 경우 → c1/c2로 Business Team 분류
  const c1 = (h.center1Name || '').trim();
  const c2 = (h.center2Name || '').trim();

  if (BUSINESS_TEAM_CENTERS.has(c1)) return c1;
  if (BUSINESS_TEAM_CENTERS.has(c2)) return c2;

  // System LSI Business 소속 → Direct
  if (c1 === 'System LSI Business' || c2 === 'System LSI Business') return 'Direct';

  // 그 외 → 집계 제외
  return '';
}

/**
 * Overseas R&D Center 서브그룹 = 부서명 맨 뒤 괄호 (연구소명)
 * 예: "반도체연구팀(SCSC)" → "SCSC"
 *     "설계팀" (괄호 없음) → "Other"
 */
function resolveOverseasSubgroup(deptname: string): string {
  const suffix = extractSuffix(deptname);
  return suffix || 'Other';
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
async function handleUsageRate(req: Request, res: Response) {
  try {
    const tm = resolveTargetMonth(req);
    const { targetStart, effectiveEnd, isCurrentMonth, monthLabel } = tm;
    const { prevStart: prevMonthStart, prevEnd: prevMonthEnd } = tm;

    // 1. Department hierarchies
    const hierarchies = await prisma.departmentHierarchy.findMany();

    // Build deptname → hierarchy map
    const deptHierarchyMap = new Map<string, DeptHierarchyRow>();
    for (const h of hierarchies) {
      deptHierarchyMap.set(h.departmentName, h as DeptHierarchyRow);
    }

    // 2. Target month MAU per deptname
    const targetMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND u.loginid != 'anonymous'
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
        AND ul.service_id IS NOT NULL
      GROUP BY u.deptname
    `;

    // 3. Previous month MAU per deptname (비교용)
    const prevMonthMauRows = await prisma.$queryRaw<MauRow[]>`
      SELECT u.deptname, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${prevMonthStart} AND ul.timestamp < ${prevMonthEnd}
        AND u.loginid != 'anonymous'
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
        AND ul.service_id IS NOT NULL
      GROUP BY u.deptname
    `;

    // 4. DeptServiceSavedMM grouped by deptname (S.LSI 소속 부서만)
    const savedMMRows = await prisma.$queryRaw<Array<{ deptname: string; total_saved: number | null }>>`
      SELECT dsm.deptname, COALESCE(SUM(dsm.saved_mm), 0)::float as total_saved
      FROM dept_service_saved_mm dsm
      WHERE EXISTS (
        SELECT 1 FROM users u WHERE u.deptname = dsm.deptname AND u.business_unit = ${INSIGHT_BUSINESS_UNIT} LIMIT 1
      )
      GROUP BY dsm.deptname
    `;

    // Build maps
    const targetMauMap = new Map(targetMauRows.map(r => [r.deptname, Number(r.mau)]));
    const prevMauMap = new Map(prevMonthMauRows.map(r => [r.deptname, Number(r.mau)]));
    const savedMMMap = new Map(savedMMRows.map(r => [r.deptname, r.total_saved || 0]));

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
      }>;
    }>();

    for (const deptname of allDeptnames) {
      if (!deptname) continue;

      const h = deptHierarchyMap.get(deptname);
      let teamName = deptname;
      let centerName = '';

      if (h) {
        teamName = h.team || deptname;
        centerName = resolveCenter(deptname, h);
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

      // Overseas R&D Center → 서브그룹(연구소/SSCR) 수로 카운트
      let teamCount = group.teams.length;
      if (name === 'Overseas R&D Center') {
        const subgroups = new Set<string>();
        for (const t of group.teams) {
          subgroups.add(resolveOverseasSubgroup(t.deptname));
        }
        teamCount = subgroups.size;
      }

      return {
        name,
        totalMau,
        mauChangePercent,
        totalSavedMM: Math.round(totalSavedMM * 100) / 100,
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

    // 1. Find depts belonging to this center
    const hierarchies = await prisma.departmentHierarchy.findMany();

    const centerDepts: Array<{ deptname: string; team: string }> = [];
    for (const h of hierarchies) {
      if (resolveCenter(h.departmentName, h) === centerName) {
        centerDepts.push({ deptname: h.departmentName, team: h.team || h.departmentName });
      }
    }

    if (centerDepts.length === 0) {
      res.status(404).json({ error: `Center '${centerName}' not found or has no departments` });
      return;
    }

    const deptnames = centerDepts.map(d => d.deptname);
    const deptTeamMap = new Map(centerDepts.map(d => [d.deptname, d.team]));

    // Overseas → 부서명 맨 뒤 괄호로 서브그룹, 그 외 → 영문 팀명
    const isOverseas = centerName === 'Overseas R&D Center';
    const deptGroupMap = new Map<string, string>();
    if (isOverseas) {
      for (const d of centerDepts) {
        deptGroupMap.set(d.deptname, resolveOverseasSubgroup(d.deptname));
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
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
        AND u.deptname = ANY(${deptnames})
      GROUP BY u.deptname
    `;

    // 서브그룹별 합산
    const mauByGroup = new Map<string, number>();
    for (const r of teamMauRows) {
      const group = deptGroupMap.get(r.deptname) || r.deptname;
      mauByGroup.set(group, (mauByGroup.get(group) || 0) + Number(r.mau));
    }
    const teamMauChart = Array.from(mauByGroup.entries())
      .map(([team, mau]) => ({ team, mau }))
      .sort((a, b) => b.mau - a.mau);

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

    // 4. teamTokenChart: 팀별 토큰 사용량
    const teamTokenRows = await prisma.$queryRaw<Array<{
      deptname: string; total_tokens: bigint;
    }>>`
      SELECT u.deptname,
             COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${targetStart} AND ul.timestamp < ${effectiveEnd}
        AND u.loginid != 'anonymous'
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

    // 5. monthlyTokenTrend: 최근 6개월 센터 토큰 추이
    const monthlyTokenTrend: Array<{ month: string; tokens: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const trendDate = new Date(Date.UTC(currentYear, currentMonth - 2 - i, 1));
      const trendYear = trendDate.getUTCFullYear();
      const trendMonth = trendDate.getUTCMonth() + 1;
      const [trendStart, trendEnd] = getMonthBoundariesKST(trendYear, trendMonth);

      const tokenResult = await prisma.$queryRaw<[{ total_tokens: bigint }]>`
        SELECT COALESCE(SUM(ul."totalTokens"), 0) as total_tokens
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${trendStart} AND ul.timestamp < ${trendEnd}
          AND u.loginid != 'anonymous'
          AND ul.service_id IS NOT NULL
          AND u.deptname = ANY(${deptnames})
      `;

      monthlyTokenTrend.push({
        month: `${trendYear}-${String(trendMonth).padStart(2, '0')}`,
        tokens: Number(tokenResult[0]?.total_tokens || 0),
      });
    }

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
          select: { id: true, name: true, displayName: true, type: true, jiraTicket: true },
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
        team: deptGroupMap.get(r.deptname) || r.deptname,
        serviceDisplayName: svc?.displayName || 'Unknown',
        serviceType: svc?.type || 'STANDARD',
        savedMM: savedMMMap.get(savedMMKey(r.service_id, r.deptname)) ?? null,
        mau: Number(r.mau),
        llmCallCount: Number(r.llm_call_count),
        jiraLink: svc?.jiraTicket || 'none',
      };
    }).sort((a, b) => b.llmCallCount - a.llmCallCount);

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
      select: { id: true, name: true, displayName: true },
    });
    const deployedIds = deployedServices.map(s => s.id);

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
        AND u.loginid != 'anonymous'
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
      GROUP BY ul.service_id
      ORDER BY llm_call_count DESC
    `;

    const svcMap = new Map(deployedServices.map(s => [s.id, s]));

    const data = usageRows.map(r => {
      const svc = svcMap.get(r.service_id);
      return {
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
        AND u.loginid != 'anonymous'
        AND u.business_unit = ${INSIGHT_BUSINESS_UNIT}
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

    const teamDetails = teamRows.map(r => ({
      team: deptToTeam.get(r.deptname) || r.deptname,
      teamKr: r.deptname,
      tokensM: Math.round(Number(r.total_tokens) / 1000000 * 100) / 100,
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

// ── Register public routes (same handlers, no auth) ──
publicInsightRoutes.get('/insight_ai_usage_rate', handleUsageRate as RequestHandler);
publicInsightRoutes.get('/insight_ai_usage_rate/:centerName', handleUsageRateDetail as RequestHandler);
publicInsightRoutes.get('/insight_service_usage', handleServiceUsage as RequestHandler);
publicInsightRoutes.get('/insight_service_usage/:serviceName', handleServiceUsageDetail as RequestHandler);
