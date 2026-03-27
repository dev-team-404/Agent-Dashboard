/**
 * GPU Capacity Prediction Routes (관리자)
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { prisma } from '../index.js';
import { z } from 'zod';
import { runGpuCapacityPrediction } from '../services/gpuCapacityPrediction.service.js';

export const gpuCapacityRoutes = Router();
gpuCapacityRoutes.use(authenticateToken);
gpuCapacityRoutes.use(requireAdmin);

// 최신 예측
gpuCapacityRoutes.get('/latest', async (_req: Request, res: Response) => {
  try {
    const prediction = await prisma.gpuCapacityPrediction.findFirst({ orderBy: { date: 'desc' } });
    res.json({ prediction });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get prediction' });
  }
});

// 히스토리
gpuCapacityRoutes.get('/history', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(); since.setDate(since.getDate() - days);
    const predictions = await prisma.gpuCapacityPrediction.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'desc' },
      select: {
        id: true, date: true, targetUserCount: true, currentDau: true, currentUsers: true,
        predictedB300Units: true, gapVramGb: true, currentTotalVramGb: true, predictedTotalVramGb: true,
        aiConfidence: true, currentAvgGpuUtil: true, scalingFactor: true, createdAt: true,
      },
    });
    res.json({ predictions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// 수동 실행 (슈퍼관리자)
gpuCapacityRoutes.post('/run', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const prediction = await runGpuCapacityPrediction();
    const user = (req as any).user;
    prisma.auditLog.create({
      data: { loginid: user?.loginid || 'unknown', action: 'RUN_GPU_CAPACITY_PREDICTION', targetType: 'GpuCapacityPrediction', ipAddress: req.ip || null },
    }).catch(() => {});
    res.json({ success: true, prediction });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Prediction failed' });
  }
});

// 설정 조회 (target + 미연결 장비)
gpuCapacityRoutes.get('/settings', async (_req: Request, res: Response) => {
  try {
    const [targetSetting, fleetSetting, noticeSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'GPU_CAPACITY_TARGET_USERS' } }),
      prisma.systemSetting.findUnique({ where: { key: 'GPU_UNMONITORED_FLEET' } }),
      prisma.systemSetting.findUnique({ where: { key: 'GPU_PREDICTION_NOTICE' } }),
    ]);
    const unmonitoredFleet = fleetSetting?.value ? JSON.parse(fleetSetting.value) : [];
    res.json({
      targetUserCount: parseInt(targetSetting?.value || '15000', 10),
      unmonitoredFleet,
      notice: noticeSetting?.value || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// 설정 변경 (슈퍼관리자)
gpuCapacityRoutes.put('/settings', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = z.object({
      targetUserCount: z.number().int().min(100).max(500000).optional(),
      unmonitoredFleet: z.array(z.object({
        type: z.string(),
        count: z.number().int().min(0).max(10000),
        label: z.string().optional(),
        vramGb: z.number().min(0).optional(),
      })).optional(),
      notice: z.string().max(2000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

    const loginid = (req as any).user?.loginid;
    if (parsed.data.targetUserCount != null) {
      await prisma.systemSetting.upsert({
        where: { key: 'GPU_CAPACITY_TARGET_USERS' },
        update: { value: String(parsed.data.targetUserCount), updatedBy: loginid },
        create: { key: 'GPU_CAPACITY_TARGET_USERS', value: String(parsed.data.targetUserCount), updatedBy: loginid },
      });
    }
    if (parsed.data.unmonitoredFleet != null) {
      await prisma.systemSetting.upsert({
        where: { key: 'GPU_UNMONITORED_FLEET' },
        update: { value: JSON.stringify(parsed.data.unmonitoredFleet), updatedBy: loginid },
        create: { key: 'GPU_UNMONITORED_FLEET', value: JSON.stringify(parsed.data.unmonitoredFleet), updatedBy: loginid },
      });
    }
    if (parsed.data.notice != null) {
      await prisma.systemSetting.upsert({
        where: { key: 'GPU_PREDICTION_NOTICE' },
        update: { value: parsed.data.notice, updatedBy: loginid },
        create: { key: 'GPU_PREDICTION_NOTICE', value: parsed.data.notice, updatedBy: loginid },
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ── 벤치마크 관리 ──

// 전체 벤치마크 조회
gpuCapacityRoutes.get('/benchmarks', async (_req: Request, res: Response) => {
  try {
    const { getAllBenchmarks } = await import('../services/gpuBenchmark.service.js');
    const benchmarks = await getAllBenchmarks();
    res.json({ benchmarks: Array.from(benchmarks.values()) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get benchmarks' });
  }
});

// 단일 서버 벤치마크
gpuCapacityRoutes.get('/benchmarks/:serverId', async (req: Request, res: Response) => {
  try {
    const { getBenchmark } = await import('../services/gpuBenchmark.service.js');
    const benchmark = await getBenchmark(req.params.serverId);
    res.json({ benchmark });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get benchmark' });
  }
});

// 수동 오버라이드 (슈퍼관리자)
gpuCapacityRoutes.put('/benchmarks/:serverId', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = z.object({
      peakTps: z.number().min(0).optional(),
      peakKvPct: z.number().min(0).max(100).optional(),
      peakConcurrent: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

    const { setManualBenchmark } = await import('../services/gpuBenchmark.service.js');
    const benchmark = await setManualBenchmark(req.params.serverId, parsed.data, (req as any).user?.loginid);
    res.json({ success: true, benchmark });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update benchmark' });
  }
});

// 전체 재산출 (슈퍼관리자)
gpuCapacityRoutes.post('/benchmarks/refresh', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const force = req.body?.force === true;
    const { refreshAllBenchmarks } = await import('../services/gpuBenchmark.service.js');
    const benchmarks = await refreshAllBenchmarks(force);
    res.json({ success: true, benchmarks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh benchmarks' });
  }
});

// manual → auto 복원 (슈퍼관리자)
gpuCapacityRoutes.delete('/benchmarks/:serverId', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { computeBenchmark, saveBenchmark } = await import('../services/gpuBenchmark.service.js');
    const benchmark = await computeBenchmark(req.params.serverId);
    if (benchmark) {
      await saveBenchmark(benchmark);
      res.json({ success: true, benchmark });
    } else {
      res.status(404).json({ error: 'Server not found or no data' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset benchmark' });
  }
});
