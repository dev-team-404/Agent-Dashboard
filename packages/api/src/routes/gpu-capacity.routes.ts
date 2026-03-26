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

// 설정 조회
gpuCapacityRoutes.get('/settings', async (_req: Request, res: Response) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'GPU_CAPACITY_TARGET_USERS' } });
    res.json({ targetUserCount: parseInt(setting?.value || '15000', 10) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// 설정 변경 (슈퍼관리자)
gpuCapacityRoutes.put('/settings', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ targetUserCount: z.number().int().min(100).max(500000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

    await prisma.systemSetting.upsert({
      where: { key: 'GPU_CAPACITY_TARGET_USERS' },
      update: { value: String(parsed.data.targetUserCount), updatedBy: (req as any).user?.loginid },
      create: { key: 'GPU_CAPACITY_TARGET_USERS', value: String(parsed.data.targetUserCount), updatedBy: (req as any).user?.loginid },
    });
    res.json({ success: true, targetUserCount: parsed.data.targetUserCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});
