/**
 * GPU Server Routes (슈퍼관리자 전용)
 *
 * GPU 서버 등록/관리 및 실시간 리소스 모니터링
 *
 * POST   /admin/gpu-servers              - 서버 등록
 * GET    /admin/gpu-servers              - 서버 목록
 * PUT    /admin/gpu-servers/:id          - 서버 수정
 * DELETE /admin/gpu-servers/:id          - 서버 삭제
 * POST   /admin/gpu-servers/:id/test     - SSH 연결 테스트
 * POST   /admin/gpu-servers/test         - SSH 연결 테스트 (등록 전)
 * GET    /admin/gpu-servers/realtime     - 전체 실시간 메트릭
 * GET    /admin/gpu-servers/:id/history  - 히스토리 메트릭
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireSuperAdmin } from '../middleware/auth.js';
import { prisma } from '../index.js';
import { z } from 'zod';
import {
  encryptPassword,
  decryptPassword,
  startPolling,
  stopPolling,
  getAllLatestMetrics,
  getLatestMetrics,
  testSshConnection,
  estimateModelParams,
  calcTheoreticalMaxTps,
  lookupGpuSpec,
} from '../services/gpuMonitor.service.js';

export const gpuServerRoutes = Router();
gpuServerRoutes.use(authenticateToken);
gpuServerRoutes.use(requireSuperAdmin);

// ── Schemas ──

const createSchema = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().min(1),
  sshPassword: z.string().min(1),
  description: z.string().optional(),
  isLocal: z.boolean().default(false),
  pollIntervalSec: z.number().int().min(10).max(3600).default(60),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  host: z.string().min(1).optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshUsername: z.string().min(1).optional(),
  sshPassword: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isLocal: z.boolean().optional(),
  enabled: z.boolean().optional(),
  pollIntervalSec: z.number().int().min(10).max(3600).optional(),
});

const testSchema = z.object({
  host: z.string().min(1),
  sshPort: z.number().int().default(22),
  sshUsername: z.string().min(1),
  sshPassword: z.string().min(1),
});

// ── 서버 등록 ──

gpuServerRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });

    const { sshPassword, ...rest } = parsed.data;

    // 이름 중복 체크
    const existing = await prisma.gpuServer.findUnique({ where: { name: rest.name } });
    if (existing) return res.status(409).json({ error: `서버 이름 "${rest.name}"이 이미 존재합니다` });

    const server = await prisma.gpuServer.create({
      data: {
        ...rest,
        sshPassword: encryptPassword(sshPassword),
      },
    });

    // 폴링 시작
    if (server.enabled) {
      startPolling(server).catch(err =>
        console.error(`[GPU Server] Failed to start polling for "${server.name}":`, err)
      );
    }

    // 감사 로그
    const user = (req as any).user;
    prisma.auditLog.create({
      data: {
        loginid: user?.loginid || 'unknown',
        action: 'CREATE_GPU_SERVER',
        target: server.id,
        targetType: 'GpuServer',
        details: { name: server.name, host: server.host } as any,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
      },
    }).catch(() => {});

    res.status(201).json({
      server: { ...server, sshPassword: '***' },
    });
  } catch (error) {
    console.error('Create GPU server error:', error);
    res.status(500).json({ error: 'Failed to create GPU server' });
  }
});

// ── 서버 목록 ──

gpuServerRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const servers = await prisma.gpuServer.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // 비밀번호 마스킹
    const masked = servers.map(s => ({ ...s, sshPassword: '***' }));
    res.json({ servers: masked });
  } catch (error) {
    console.error('List GPU servers error:', error);
    res.status(500).json({ error: 'Failed to list GPU servers' });
  }
});

// ── 실시간 전체 메트릭 ──

gpuServerRoutes.get('/realtime', async (_req: Request, res: Response) => {
  try {
    // Redis 캐시에서 먼저 확인 (1분 TTL, 백그라운드 갱신)
    try {
      const { redis } = await import('../index.js');
      const cached = await redis.get('gpu:realtime');
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }
    } catch {}

    const servers = await prisma.gpuServer.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const metrics = getAllLatestMetrics();
    const serverMap = new Map(servers.map(s => [s.id, { ...s, sshPassword: '***' }]));

    // 서버별 7일 피크 처리량 (최근 100건만 샘플링 — 성능 최적화)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const peakTpsMap = new Map<string, number>();
    for (const s of servers) {
      const recentSnaps = await prisma.gpuMetricSnapshot.findMany({
        where: { serverId: s.id, timestamp: { gte: sevenDaysAgo } },
        select: { llmMetrics: true },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
      for (const snap of recentSnaps) {
        const llms = snap.llmMetrics as any[];
        if (!Array.isArray(llms)) continue;
        const tps = llms.reduce((sum: number, l: any) => sum + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0);
        if (tps > (peakTpsMap.get(s.id) || 0)) peakTpsMap.set(s.id, tps);
      }
    }

    const result = servers.map(s => {
      const m = metrics.find(mt => mt.serverId === s.id) || null;
      const gpuCount = m?.gpus?.length || 0;
      const spec = gpuCount > 0 ? m!.gpus[0].spec : null;
      const endpoints = (m?.llmEndpoints || []).filter(ep => ep.type !== 'unknown');

      // 이론 최대: 서버 전체 GPU의 compute bound (가장 큰 모델 기준)
      // GPU 분배를 모르므로 전체 GPU × 가장 큰 모델로 보수적 계산
      let primaryModelName: string | null = null;
      let primaryModelParams: number | null = null;
      for (const ep of endpoints) {
        const name = ep.modelNames?.[0] || null;
        const params = name ? estimateModelParams(name) : null;
        if (params && (primaryModelParams == null || params > primaryModelParams)) {
          primaryModelName = name;
          primaryModelParams = params;
        }
      }
      // precision 자동 감지 (모델명이나 경로에 FP8이 포함되면)
      const allModelInfo = endpoints.flatMap(ep => ep.modelNames || []).join(' ');
      const precision = allModelInfo.includes('__precision_fp8__') ? 'fp8' as const : 'fp16' as const;

      const theoreticalMaxTps = (spec && primaryModelParams && gpuCount > 0)
        ? Math.round(calcTheoreticalMaxTps(spec, gpuCount, primaryModelParams, precision) * 10) / 10
        : null;

      // 현재 처리량 (unknown 제외)
      const currentTps = endpoints.reduce((sum, ep) =>
        sum + (ep.promptThroughputTps || 0) + (ep.genThroughputTps || 0), 0);

      // 7일 피크
      const peakTps = peakTpsMap.get(s.id) || null;

      return {
        server: serverMap.get(s.id),
        metrics: m,
        throughputAnalysis: {
          theoreticalMaxTps,
          peakTps,
          currentTps: Math.round(currentTps * 10) / 10,
          modelName: primaryModelName,
          modelParams: primaryModelParams ? `${primaryModelParams}B` : null,
          gpuHealthPct: (theoreticalMaxTps && peakTps) ? Math.round((peakTps / theoreticalMaxTps) * 1000) / 10 : null,
          utilizationPct: (peakTps && peakTps > 0) ? Math.round((currentTps / peakTps) * 1000) / 10 : null,
          theoreticalUtilPct: (theoreticalMaxTps && theoreticalMaxTps > 0) ? Math.round((currentTps / theoreticalMaxTps) * 1000) / 10 : null,
        },
      };
    });

    const response = { data: result };
    // Redis 캐시 저장 (60초 TTL)
    try { const { redis } = await import('../index.js'); await redis.setex('gpu:realtime', 60, JSON.stringify(response)); } catch {}
    res.json(response);
  } catch (error) {
    console.error('Realtime metrics error:', error);
    res.status(500).json({ error: 'Failed to get realtime metrics' });
  }
});

// ── SSH 연결 테스트 (등록 전) ──

gpuServerRoutes.post('/test', async (req: Request, res: Response) => {
  try {
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });

    const result = await testSshConnection(
      parsed.data.host, parsed.data.sshPort,
      parsed.data.sshUsername, parsed.data.sshPassword
    );
    res.json(result);
  } catch (error) {
    console.error('Test SSH error:', error);
    res.status(500).json({ error: 'Failed to test connection' });
  }
});

// ── 서버 수정 ──

gpuServerRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('[GPU Server] Update validation failed:', JSON.stringify(parsed.error.errors));
      return res.status(400).json({ error: 'Invalid request: ' + parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '), details: parsed.error.errors });
    }

    const { id } = req.params;
    const existing = await prisma.gpuServer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Server not found' });

    const { sshPassword, ...rest } = parsed.data;
    const updateData: any = { ...rest };
    if (sshPassword) {
      updateData.sshPassword = encryptPassword(sshPassword);
    }

    const server = await prisma.gpuServer.update({
      where: { id },
      data: updateData,
    });

    // 폴링 재시작
    stopPolling(server.id);
    if (server.enabled) {
      startPolling(server).catch(err =>
        console.error(`[GPU Server] Failed to restart polling for "${server.name}":`, err)
      );
    }

    // 감사 로그
    const user = (req as any).user;
    prisma.auditLog.create({
      data: {
        loginid: user?.loginid || 'unknown',
        action: 'UPDATE_GPU_SERVER',
        target: server.id,
        targetType: 'GpuServer',
        details: { name: server.name, changes: Object.keys(parsed.data) } as any,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
      },
    }).catch(() => {});

    res.json({ server: { ...server, sshPassword: '***' } });
  } catch (error) {
    console.error('Update GPU server error:', error);
    res.status(500).json({ error: 'Failed to update GPU server' });
  }
});

// ── 서버 삭제 ──

gpuServerRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.gpuServer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Server not found' });

    stopPolling(id);
    await prisma.gpuServer.delete({ where: { id } });

    // 감사 로그
    const user = (req as any).user;
    prisma.auditLog.create({
      data: {
        loginid: user?.loginid || 'unknown',
        action: 'DELETE_GPU_SERVER',
        target: id,
        targetType: 'GpuServer',
        details: { name: existing.name, host: existing.host } as any,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
      },
    }).catch(() => {});

    res.json({ message: 'Server deleted' });
  } catch (error) {
    console.error('Delete GPU server error:', error);
    res.status(500).json({ error: 'Failed to delete GPU server' });
  }
});

// ── 개별 서버 SSH 연결 테스트 ──

gpuServerRoutes.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const server = await prisma.gpuServer.findUnique({ where: { id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });

    const password = decryptPassword(server.sshPassword);
    const result = await testSshConnection(server.host, server.sshPort, server.sshUsername, password);
    res.json(result);
  } catch (error) {
    console.error('Test existing server error:', error);
    res.status(500).json({ error: 'Failed to test connection' });
  }
});

// ── 히스토리 메트릭 ──

gpuServerRoutes.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hours = parseInt(req.query.hours as string) || 24;
    const since = new Date();
    since.setHours(since.getHours() - hours);

    const snapshots = await prisma.gpuMetricSnapshot.findMany({
      where: {
        serverId: id,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        timestamp: true,
        gpuMetrics: true,
        cpuLoadAvg: true,
        cpuCores: true,
        memoryTotalMb: true,
        memoryUsedMb: true,
        gpuProcesses: true,
        llmMetrics: true,
      },
    });

    // KST 영업시간 (9-18, 영업일만) 평균 계산
    const KST_OFFSET = 9 * 60; // UTC+9
    const holidays = await prisma.holiday.findMany({ where: { date: { gte: since } }, select: { date: true } });
    const holidaySet = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
    const businessHourSnapshots = snapshots.filter(s => {
      const kstDate = new Date(s.timestamp.getTime() + KST_OFFSET * 60 * 1000);
      const kstHour = kstDate.getUTCHours();
      const kstDow = kstDate.getUTCDay();
      const dateStr = kstDate.toISOString().split('T')[0];
      return kstHour >= 9 && kstHour < 18 && kstDow !== 0 && kstDow !== 6 && !holidaySet.has(dateStr);
    });

    const calcAvg = (items: typeof snapshots) => {
      if (items.length === 0) return null;
      let totalGpuUtil = 0;
      let totalMemUtil = 0;
      let gpuCount = 0;

      for (const snap of items) {
        const gpus = snap.gpuMetrics as any[];
        if (Array.isArray(gpus)) {
          for (const g of gpus) {
            totalGpuUtil += g.utilGpu || 0;
            totalMemUtil += (g.memTotalMb > 0 ? (g.memUsedMb / g.memTotalMb) * 100 : 0);
            gpuCount++;
          }
        }
      }

      return gpuCount > 0 ? {
        avgGpuUtil: Math.round((totalGpuUtil / gpuCount) * 10) / 10,
        avgMemUtil: Math.round((totalMemUtil / gpuCount) * 10) / 10,
        sampleCount: items.length,
      } : null;
    };

    res.json({
      snapshots,
      businessHoursAvg: calcAvg(businessHourSnapshots),
      overallAvg: calcAvg(snapshots),
      hours,
    });
  } catch (error) {
    console.error('History metrics error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// ── SSH raw output 디버그 ──

gpuServerRoutes.get('/:id/debug', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const server = await prisma.gpuServer.findUnique({ where: { id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });

    const { Client } = await import('ssh2');
    const password = decryptPassword(server.sshPassword);

    const output = await new Promise<string>((resolve, reject) => {
      const conn = new Client();
      const timer = setTimeout(() => { conn.end(); reject(new Error('timeout')); }, 30000);
      conn.on('ready', () => {
        // LLM 섹션만 실행
        const cmd = 'docker ps --format "{{.Ports}}|{{.Names}}|{{.Image}}" 2>/dev/null; echo "==="; for port in $(docker ps --format "{{.Ports}}" 2>/dev/null | grep -o "0\\.0\\.0\\.0:[0-9]*" | sed "s/0\\.0\\.0\\.0://" | sort -u); do echo "--- PORT $port ---"; CINFO=$(docker ps --format "{{.Ports}}|{{.Names}}|{{.Image}}" 2>/dev/null | grep "0\\.0\\.0\\.0:$port->"); echo "CONTAINER: $CINFO"; echo "MODELS:"; curl -s --max-time 2 "http://localhost:$port/v1/models" 2>/dev/null | head -20; echo; echo "METRICS (first 30):"; curl -s --max-time 3 "http://localhost:$port/metrics" 2>/dev/null | grep -vE "^#|^$" | head -30; echo; done';
        conn.exec(cmd, (err: any, stream: any) => {
          if (err) { clearTimeout(timer); conn.end(); return reject(err); }
          let out = '';
          stream.on('data', (d: Buffer) => { out += d.toString(); });
          stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(out); });
        });
      });
      conn.on('error', (e: any) => { clearTimeout(timer); reject(e); });
      conn.connect({ host: server.host, port: server.sshPort, username: server.sshUsername, password, readyTimeout: 10000 });
    });

    res.json({ raw: output });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── 종합 분석 (피크타임 히트맵 + 비즈니스시간 분석) ──

gpuServerRoutes.get('/analytics/overview', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    // Redis 캐시 (5분 TTL — 분석은 실시간일 필요 없음)
    try {
      const { redis } = await import('../index.js');
      const cached = await redis.get(`gpu:analytics:${days}`);
      if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
    } catch {}
    const since = new Date();
    since.setDate(since.getDate() - days);

    // 휴일 목록 조회
    const holidays = await prisma.holiday.findMany({
      where: { date: { gte: since } },
      select: { date: true },
    });
    const holidaySet = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));

    // 전체 서버 스냅샷
    const snapshots = await prisma.gpuMetricSnapshot.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
      select: {
        serverId: true,
        timestamp: true,
        gpuMetrics: true,
        cpuLoadAvg: true,
        cpuCores: true,
        memoryTotalMb: true,
        memoryUsedMb: true,
        gpuProcesses: true,
        llmMetrics: true,
      },
    });

    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

    // 시간대별 히트맵 데이터 (0-23시 x 0-6요일)
    // heatmap[hour][dayOfWeek] = { totalUtil, count }
    const heatmap: Array<Array<{ totalUtil: number; count: number }>> = Array.from({ length: 24 }, () =>
      Array.from({ length: 7 }, () => ({ totalUtil: 0, count: 0 }))
    );

    // 비즈니스시간 vs 비영업시간 집계
    let bizGpuUtil = 0, bizMemUtil = 0, bizCount = 0;
    let offGpuUtil = 0, offMemUtil = 0, offCount = 0;
    let bizLlmKvCache = 0, bizLlmCount = 0;
    let bizLlmRunning = 0, bizLlmWaiting = 0, bizLlmThroughput = 0, bizLlmTpCount = 0;

    // 시간대별 LLM throughput 추이
    const hourlyThroughput: Array<{ totalTps: number; count: number }> = Array.from({ length: 24 }, () => ({ totalTps: 0, count: 0 }));

    for (const snap of snapshots) {
      const kstDate = new Date(snap.timestamp.getTime() + KST_OFFSET_MS);
      const kstHour = kstDate.getUTCHours();
      const kstDow = kstDate.getUTCDay(); // 0=Sun
      const dateStr = new Date(snap.timestamp.getTime() + KST_OFFSET_MS).toISOString().split('T')[0];
      const isHoliday = holidaySet.has(dateStr);
      const isWeekend = kstDow === 0 || kstDow === 6;
      const isBusinessHour = kstHour >= 9 && kstHour < 18 && !isHoliday && !isWeekend;

      const gpus = snap.gpuMetrics as any[];
      if (!Array.isArray(gpus) || gpus.length === 0) continue;

      const avgUtil = gpus.reduce((s: number, g: any) => s + (g.utilGpu || 0), 0) / gpus.length;
      const totalMem = gpus.reduce((s: number, g: any) => s + (g.memTotalMb || 0), 0);
      const usedMem = gpus.reduce((s: number, g: any) => s + (g.memUsedMb || 0), 0);
      const memUtil = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

      // 히트맵 집계
      heatmap[kstHour][kstDow].totalUtil += avgUtil;
      heatmap[kstHour][kstDow].count++;

      // 비즈니스시간 집계
      if (isBusinessHour) {
        bizGpuUtil += avgUtil; bizMemUtil += memUtil; bizCount++;
      } else {
        offGpuUtil += avgUtil; offMemUtil += memUtil; offCount++;
      }

      // LLM 메트릭 집계
      const llms = snap.llmMetrics as any[];
      if (Array.isArray(llms)) {
        for (const llm of llms) {
          if (llm.kvCacheUsagePct != null && isBusinessHour) {
            bizLlmKvCache += llm.kvCacheUsagePct; bizLlmCount++;
          }
          if (isBusinessHour) {
            bizLlmRunning += llm.runningRequests || 0;
            bizLlmWaiting += llm.waitingRequests || 0;
          }
          const tps = (llm.promptThroughputTps || 0) + (llm.genThroughputTps || 0);
          if (tps > 0) {
            hourlyThroughput[kstHour].totalTps += tps;
            hourlyThroughput[kstHour].count++;
            if (isBusinessHour) { bizLlmThroughput += tps; bizLlmTpCount++; }
          }
        }
      }
    }

    // 히트맵 → 평균으로 변환
    const heatmapData = heatmap.map((hours, hour) =>
      hours.map((cell, dow) => ({
        hour, dow,
        avgUtil: cell.count > 0 ? Math.round((cell.totalUtil / cell.count) * 10) / 10 : null,
        sampleCount: cell.count,
      }))
    ).flat();

    // 피크타임 탐지 (상위 5개 시간대)
    const peakHours = heatmapData
      .filter(h => h.avgUtil !== null && h.sampleCount >= 3)
      .sort((a, b) => (b.avgUtil || 0) - (a.avgUtil || 0))
      .slice(0, 5);

    // 시간대별 throughput 평균
    const throughputByHour = hourlyThroughput.map((h, hour) => ({
      hour,
      avgTps: h.count > 0 ? Math.round((h.totalTps / h.count) * 10) / 10 : 0,
    }));

    const analyticsResult = {
      period: { days, since: since.toISOString(), holidayCount: holidays.length },
      businessHours: {
        avgGpuUtil: bizCount > 0 ? Math.round((bizGpuUtil / bizCount) * 10) / 10 : null,
        avgMemUtil: bizCount > 0 ? Math.round((bizMemUtil / bizCount) * 10) / 10 : null,
        avgKvCache: bizLlmCount > 0 ? Math.round((bizLlmKvCache / bizLlmCount) * 10) / 10 : null,
        avgRunningReqs: bizCount > 0 ? Math.round((bizLlmRunning / bizCount) * 10) / 10 : null,
        avgWaitingReqs: bizCount > 0 ? Math.round((bizLlmWaiting / bizCount) * 10) / 10 : null,
        avgThroughputTps: bizLlmTpCount > 0 ? Math.round((bizLlmThroughput / bizLlmTpCount) * 10) / 10 : null,
        sampleCount: bizCount,
      },
      offHours: {
        avgGpuUtil: offCount > 0 ? Math.round((offGpuUtil / offCount) * 10) / 10 : null,
        avgMemUtil: offCount > 0 ? Math.round((offMemUtil / offCount) * 10) / 10 : null,
        sampleCount: offCount,
      },
      heatmap: heatmapData,
      peakHours,
      throughputByHour,
      totalSnapshots: snapshots.length,
    };
    try { const { redis } = await import('../index.js'); await redis.setex(`gpu:analytics:${days}`, 300, JSON.stringify(analyticsResult)); } catch {}
    res.json(analyticsResult);
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});
