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
import { prisma, pgPool } from '../index.js';
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
  calcBandwidthMaxTps,
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
  sshPort: z.union([z.number(), z.string().transform(v => parseInt(v) || 22)]).pipe(z.number().int().min(1).max(65535)).optional(),
  sshUsername: z.string().min(1).optional(),
  sshPassword: z.string().optional(),
  description: z.union([z.string(), z.null()]).optional(),
  isLocal: z.boolean().optional(),
  enabled: z.boolean().optional(),
  pollIntervalSec: z.union([z.number(), z.string().transform(v => parseInt(v) || 60)]).pipe(z.number().int().min(10).max(3600)).optional(),
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
      let recentSnaps: any[] = [];
      try {
        recentSnaps = await prisma.gpuMetricSnapshot.findMany({
          where: { serverId: s.id, timestamp: { gte: sevenDaysAgo } },
          select: { llmMetrics: true },
          orderBy: { timestamp: 'desc' },
          take: 100,
        });
      } catch {
        try {
          const rawSnaps = await prisma.$queryRaw<any[]>`
            SELECT llm_metrics::text as "llmMetrics" FROM gpu_metric_snapshots
            WHERE server_id = ${s.id} AND timestamp >= ${sevenDaysAgo}
            ORDER BY timestamp DESC LIMIT 100`;
          recentSnaps = rawSnaps.map(r => {
            try { return { llmMetrics: typeof r.llmMetrics === 'string' ? JSON.parse(r.llmMetrics) : r.llmMetrics }; }
            catch { return { llmMetrics: [] }; }
          });
        } catch {}
      }
      for (const snap of recentSnaps) {
        const llms = snap.llmMetrics as any[];
        if (!Array.isArray(llms)) continue;
        const tps = llms.reduce((sum: number, l: any) => sum + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0);
        if (tps > (peakTpsMap.get(s.id) || 0)) peakTpsMap.set(s.id, tps);
      }
    }

    // Prometheus 기반 서버는 DB에서 최신 스냅샷 가져오기 (in-memory에 없으므로)
    const promServerIds = servers.filter(s => s.sshPort === 0 || s.description?.includes('[DTGPT-Prometheus]')).map(s => s.id);
    const promMetricsMap = new Map<string, any>();
    if (promServerIds.length > 0) {
      try {
        const { rows } = await pgPool.query(`
          SELECT DISTINCT ON (server_id) server_id,
            gpu_metrics::text as gm, llm_metrics::text as lm,
            hostname, timestamp
          FROM gpu_metric_snapshots
          WHERE server_id = ANY($1)
          ORDER BY server_id, timestamp DESC
        `, [promServerIds]);
        for (const r of rows) {
          try {
            const gpus = JSON.parse(r.gm || '[]');
            const llms = JSON.parse(r.lm || '[]');
            promMetricsMap.set(r.server_id, {
              serverId: r.server_id, serverName: '', timestamp: r.timestamp,
              gpus, processes: [], llmEndpoints: llms,
              cpuLoadAvg: null, cpuCores: null, memoryTotalMb: null, memoryUsedMb: null,
              diskTotalGb: null, diskUsedGb: null, diskFreeGb: null, hostname: r.hostname,
            });
          } catch {}
        }
      } catch {}
    }

    // 벤치마크 로드
    const { getAllBenchmarks, calcCompositeCapacity } = await import('../services/gpuBenchmark.service.js');
    const benchmarkMap = await getAllBenchmarks();

    const result = servers.map(s => {
      const m = metrics.find(mt => mt.serverId === s.id) || promMetricsMap.get(s.id) || null;
      const gpuCount = m?.gpus?.length || 0;
      const spec = gpuCount > 0 ? m!.gpus[0].spec : null;
      const endpoints: any[] = (m?.llmEndpoints || []).filter((ep: any) => ep.type !== 'unknown');

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
      // precision 자동 감지 (LLM 엔드포인트의 precision 필드에서)
      const precision = endpoints.some((ep: any) => ep.precision === 'fp8') ? 'fp8' as const : 'fp16' as const;

      const theoreticalMaxTps = (spec && primaryModelParams && gpuCount > 0)
        ? Math.round(calcTheoreticalMaxTps(spec, gpuCount, primaryModelParams, precision) * 10) / 10
        : null;
      const bandwidthMaxTps = (spec && primaryModelParams && gpuCount > 0)
        ? Math.round(calcBandwidthMaxTps(spec, gpuCount, primaryModelParams, precision) * 10) / 10
        : null;

      // 현재 처리량 (unknown 제외)
      const currentTps = endpoints.reduce((sum: number, ep: any) =>
        sum + (ep.promptThroughputTps || 0) + (ep.genThroughputTps || 0), 0);

      // 7일 피크
      const peakTps = peakTpsMap.get(s.id) || null;

      // 벤치마크 기반 종합 용량 계산
      const bm = benchmarkMap.get(s.id);
      const currentKvPct = endpoints.length > 0
        ? endpoints.reduce((s: number, ep: any) => s + (ep.kvCacheUsagePct || 0), 0) / endpoints.length
        : null;
      const currentConcurrent = endpoints.reduce((s: number, ep: any) => s + (ep.runningRequests || 0) + (ep.waitingRequests || 0), 0);

      const capacity = bm
        ? calcCompositeCapacity(currentTps, currentKvPct, currentConcurrent, bm)
        : null;

      return {
        server: serverMap.get(s.id),
        metrics: m,
        // 벤치마크 기반 (PRIMARY — 종합 용량 %)
        capacityAnalysis: capacity ? {
          ...capacity,
          currentTps: Math.round(currentTps * 10) / 10,
          peakTps: bm?.peakTps || peakTps,
          modelName: primaryModelName,
          modelParams: primaryModelParams ? `${primaryModelParams}B` : null,
          benchmark: bm ? { peakTps: bm.peakTps, peakKvPct: bm.peakKvPct, peakConcurrent: bm.peakConcurrent, source: bm.source } : null,
        } : null,
        // 이전 호환 (LEGACY — 전환 후 제거)
        throughputAnalysis: {
          theoreticalMaxTps,
          bandwidthMaxTps,
          peakTps,
          currentTps: Math.round(currentTps * 10) / 10,
          modelName: primaryModelName,
          modelParams: primaryModelParams ? `${primaryModelParams}B` : null,
          gpuHealthPct: (theoreticalMaxTps && peakTps) ? Math.round((peakTps / theoreticalMaxTps) * 1000) / 10 : null,
          utilizationPct: (peakTps && peakTps > 0) ? Math.round((currentTps / peakTps) * 1000) / 10 : null,
          theoreticalUtilPct: (theoreticalMaxTps && theoreticalMaxTps > 0) ? Math.round((currentTps / theoreticalMaxTps) * 1000) / 10 : null,
          practicalUtilPct: (bandwidthMaxTps && bandwidthMaxTps > 0) ? Math.round((currentTps / bandwidthMaxTps) * 1000) / 10 : null,
          practicalHealthPct: (bandwidthMaxTps && peakTps) ? Math.round((peakTps / bandwidthMaxTps) * 1000) / 10 : null,
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

    let snapshots: any[] = [];
    try {
      snapshots = await prisma.gpuMetricSnapshot.findMany({
        where: { serverId: id, timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, gpuMetrics: true, cpuLoadAvg: true, cpuCores: true, memoryTotalMb: true, memoryUsedMb: true, gpuProcesses: true, llmMetrics: true },
      });
    } catch {
      try {
        const rawSnaps = await prisma.$queryRaw<any[]>`
          SELECT timestamp, gpu_metrics::text as "gpuMetrics", cpu_load_avg as "cpuLoadAvg", cpu_cores as "cpuCores",
                 memory_total_mb as "memoryTotalMb", memory_used_mb as "memoryUsedMb",
                 gpu_processes::text as "gpuProcesses", llm_metrics::text as "llmMetrics"
          FROM gpu_metric_snapshots WHERE server_id = ${id} AND timestamp >= ${since} ORDER BY timestamp ASC`;
        snapshots = rawSnaps.map(r => {
          try { return { ...r, gpuMetrics: typeof r.gpuMetrics === 'string' ? JSON.parse(r.gpuMetrics) : r.gpuMetrics, gpuProcesses: typeof r.gpuProcesses === 'string' ? JSON.parse(r.gpuProcesses || '[]') : r.gpuProcesses, llmMetrics: typeof r.llmMetrics === 'string' ? JSON.parse(r.llmMetrics || '[]') : r.llmMetrics }; }
          catch { return { ...r, gpuMetrics: [], gpuProcesses: [], llmMetrics: [] }; }
        });
      } catch {}
    }

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

// ── AI 코칭 ──

gpuServerRoutes.post('/coaching', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const { runGpuCoaching } = await import('../services/gpuCoaching.service.js');
    runGpuCoaching().catch(err => console.error('[GPU Coaching] Manual run failed:', err));
    res.json({ success: true, message: 'Coaching started for all servers' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed' });
  }
});

gpuServerRoutes.get('/:id/coaching', async (req: Request, res: Response) => {
  try {
    const { getCoachingResult } = await import('../services/gpuCoaching.service.js');
    const result = await getCoachingResult(req.params.id);
    res.json({ coaching: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get coaching' });
  }
});

gpuServerRoutes.post('/:id/coaching', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { runGpuCoaching } = await import('../services/gpuCoaching.service.js');
    await runGpuCoaching(req.params.id);
    const { getCoachingResult } = await import('../services/gpuCoaching.service.js');
    const result = await getCoachingResult(req.params.id);
    res.json({ success: true, coaching: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Coaching failed' });
  }
});

// ── 종합 분석 ──

gpuServerRoutes.get('/analytics/overview', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    // Redis 캐시 (5분 TTL)
    try {
      const { redis } = await import('../index.js');
      const cached = await redis.get(`gpu:analytics:${days}`);
      if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
    } catch {}
    const since = new Date();
    since.setDate(since.getDate() - days);

    const holidays = await prisma.holiday.findMany({ where: { date: { gte: since } }, select: { date: true } });
    const holidayDates = holidays.map(h => h.date.toISOString().split('T')[0]);

    // ── pg 직접 쿼리 (Prisma napi 완전 우회) ──
    // 1개 쿼리로 스냅샷당 숫자만 추출 (JSON 전송 없음)
    const { rows } = await pgPool.query(`
      SELECT
        s.id,
        EXTRACT(HOUR FROM s.timestamp + INTERVAL '9 hours')::int AS h,
        EXTRACT(DOW FROM s.timestamp + INTERVAL '9 hours')::int AS d,
        to_char(s.timestamp + INTERVAL '9 hours', 'YYYY-MM-DD') AS dt,
        (SELECT AVG((g->>'utilGpu')::float) FROM jsonb_array_elements(s.gpu_metrics) g) AS gpu,
        (SELECT CASE WHEN SUM((g->>'memTotalMb')::float) > 0
          THEN SUM((g->>'memUsedMb')::float)/SUM((g->>'memTotalMb')::float)*100 ELSE 0 END
          FROM jsonb_array_elements(s.gpu_metrics) g) AS mem,
        (SELECT AVG((l->>'kvCacheUsagePct')::float)
          FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l
          WHERE (l->>'kvCacheUsagePct') IS NOT NULL) AS kv,
        (SELECT SUM(COALESCE((l->>'runningRequests')::float,0))
          FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS run,
        (SELECT SUM(COALESCE((l->>'waitingRequests')::float,0))
          FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS wait,
        (SELECT SUM(COALESCE((l->>'promptThroughputTps')::float,0)+COALESCE((l->>'genThroughputTps')::float,0))
          FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS tps,
        (SELECT SUM(COALESCE((l->>'preemptionCount')::float,0))
          FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS preempt
      FROM gpu_metric_snapshots s
      WHERE s.timestamp >= $1
      ORDER BY s.timestamp ASC
    `, [since]);

    const holidaySet = new Set(holidayDates);
    const isBiz = (h: number, d: number, dt: string) => h >= 9 && h < 18 && d >= 1 && d <= 5 && !holidaySet.has(dt);

    let bizCount = 0, offCount = 0;
    let bizLlmKvCache = 0, bizLlmCount = 0, bizLlmRunning = 0, bizLlmWaiting = 0;
    let bizTotalTps = 0, bizTpsCount = 0, bizPeakTps = 0;

    // 날짜×시간 히트맵 (3차원: tok/s, kv%, 대기건수)
    const dateHourMap = new Map<string, { tps: number[]; kv: number[]; wait: number[]; preempt: number[] }>();

    for (const r of rows) {
      const h = +r.h, d = +r.d;
      const kv = r.kv != null ? +r.kv : null;
      const run = +(r.run || 0), wait = +(r.wait || 0), tps = +(r.tps || 0);
      const biz = isBiz(h, d, r.dt);

      // 날짜×시간 히트맵 집계
      const key = `${r.dt}|${h}`;
      const preempt = +(r.preempt || 0);
      const entry = dateHourMap.get(key) || { tps: [], kv: [], wait: [], preempt: [] };
      if (tps > 0) entry.tps.push(tps);
      if (kv != null) entry.kv.push(kv);
      entry.wait.push(wait);
      entry.preempt.push(preempt);
      dateHourMap.set(key, entry);

      if (biz) {
        bizCount++;
        if (kv != null) { bizLlmKvCache += kv; bizLlmCount++; }
        bizLlmRunning += run; bizLlmWaiting += wait;
        if (tps > 0) { bizTotalTps += tps; bizTpsCount++; }
        if (tps > bizPeakTps) bizPeakTps = tps;
      } else {
        offCount++;
      }
    }

    const r1 = (v: number) => Math.round(v * 10) / 10;

    // 날짜×시간 히트맵 데이터 (6개 히트맵용: 실제값 3 + %값 3)
    const dateHourHeatmap = Array.from(dateHourMap.entries()).map(([key, v]) => {
      const [dt, hStr] = key.split('|');
      const avgTps = v.tps.length > 0 ? v.tps.reduce((a, b) => a + b, 0) / v.tps.length : 0;
      const avgKv = v.kv.length > 0 ? v.kv.reduce((a, b) => a + b, 0) / v.kv.length : 0;
      const avgWait = v.wait.length > 0 ? v.wait.reduce((a, b) => a + b, 0) / v.wait.length : 0;
      const avgPreempt = v.preempt.length > 0 ? v.preempt.reduce((a, b) => a + b, 0) / v.preempt.length : 0;
      return { date: dt, hour: +hStr, tps: r1(avgTps), kv: r1(avgKv), wait: r1(avgWait), preempt: r1(avgPreempt), samples: v.tps.length || v.wait.length };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);

    const analyticsResult = {
      period: { days, since: since.toISOString(), holidayCount: holidays.length },
      businessHours: {
        avgKvCache: bizLlmCount > 0 ? r1(bizLlmKvCache / bizLlmCount) : null,
        avgRunningReqs: bizCount > 0 ? r1(bizLlmRunning / bizCount) : null,
        avgWaitingReqs: bizCount > 0 ? r1(bizLlmWaiting / bizCount) : null,
        avgTps: bizTpsCount > 0 ? r1(bizTotalTps / bizTpsCount) : null,
        peakTps: bizPeakTps > 0 ? r1(bizPeakTps) : null,
        sampleCount: bizCount,
      },
      offHours: { sampleCount: offCount },
      // 날짜×시간 히트맵 (3차원)
      dateHourHeatmap,
      totalSnapshots: rows.length,
    };
    try { const { redis } = await import('../index.js'); await redis.setex(`gpu:analytics:${days}`, 300, JSON.stringify(analyticsResult)); } catch {}
    res.json(analyticsResult);
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});
