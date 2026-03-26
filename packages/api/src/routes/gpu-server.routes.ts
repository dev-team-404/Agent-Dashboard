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
    const servers = await prisma.gpuServer.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    const metrics = getAllLatestMetrics();
    const serverMap = new Map(servers.map(s => [s.id, { ...s, sshPassword: '***' }]));

    const result = servers.map(s => ({
      server: serverMap.get(s.id),
      metrics: metrics.find(m => m.serverId === s.id) || null,
    }));

    res.json({ data: result });
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
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });

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
      },
    });

    // KST 영업시간 (9-18) 평균 계산
    const KST_OFFSET = 9 * 60; // UTC+9
    const businessHourSnapshots = snapshots.filter(s => {
      const kstHour = new Date(s.timestamp.getTime() + KST_OFFSET * 60 * 1000).getUTCHours();
      return kstHour >= 9 && kstHour < 18;
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
