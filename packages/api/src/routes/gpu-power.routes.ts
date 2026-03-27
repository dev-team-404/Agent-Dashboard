/**
 * GPU Power Usage Routes (인증 불필요)
 *
 * DT GPU 전력 사용률 집계 (시간별)
 * - POST /gpu-power: 시간별 전력 사용률 등록/업데이트
 * - GET  /gpu-power: 최근 7일(168시간) 전력 사용률 목록
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index.js';
import { z } from 'zod';

export const gpuPowerRoutes = Router();

const upsertSchema = z.object({
  timestamp: z.string().refine((val) => !isNaN(Date.parse(val)), 'timestamp must be a valid ISO 8601 datetime'),
  power_avg_usage_ratio: z.number().min(0).max(100),
});

gpuPowerRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
    }

    const { timestamp, power_avg_usage_ratio } = parsed.data;
    // 분/초를 버리고 시간 단위로 정규화
    const tsObj = new Date(timestamp);
    tsObj.setMinutes(0, 0, 0);

    const record = await prisma.gpuPowerUsage.upsert({
      where: { timestamp: tsObj },
      update: { powerAvgUsageRatio: power_avg_usage_ratio },
      create: { timestamp: tsObj, powerAvgUsageRatio: power_avg_usage_ratio },
    });

    // 감사 로그
    prisma.auditLog.create({
      data: {
        loginid: 'external:gpu-power',
        action: 'SUBMIT_GPU_POWER',
        target: record.id,
        targetType: 'GpuPowerUsage',
        details: JSON.parse(JSON.stringify({
          timestamp: tsObj.toISOString(),
          power_avg_usage_ratio,
        })),
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
      },
    }).catch(() => {});

    res.json({
      message: 'GPU power usage saved',
      data: {
        timestamp: record.timestamp.toISOString(),
        power_avg_usage_ratio: record.powerAvgUsageRatio,
      },
    });
  } catch (error) {
    console.error('Save GPU power usage error:', error);
    res.status(500).json({ error: 'Failed to save GPU power usage' });
  }
});

gpuPowerRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setMinutes(0, 0, 0);

    const records = await prisma.gpuPowerUsage.findMany({
      where: { timestamp: { gte: sevenDaysAgo } },
      orderBy: { timestamp: 'asc' },
    });

    const data = records.map(r => ({
      timestamp: r.timestamp.toISOString(),
      power_avg_usage_ratio: r.powerAvgUsageRatio,
    }));

    res.json({ data });
  } catch (error) {
    console.error('Get GPU power usage error:', error);
    res.status(500).json({ error: 'Failed to get GPU power usage' });
  }
});
