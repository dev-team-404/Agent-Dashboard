/**
 * GPU Power Usage Routes (인증 불필요)
 *
 * DT GPU 전력 사용률 집계 (시간별)
 * - GET  /gpu-power: 최근 7일(168시간) 전력 사용률 목록
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index.js';

export const gpuPowerRoutes = Router();

gpuPowerRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setMinutes(0, 0, 0);

    const records = await prisma.gpuPowerUsage.findMany({
      where: { timestamp: { gte: sevenDaysAgo } } as any,
      orderBy: { timestamp: 'asc' } as any,
    });

    const data = records.map((r: any) => ({
      timestamp: (r.timestamp || r.date)?.toISOString?.() || '',
      power_avg_usage_ratio: r.powerAvgUsageRatio,
    }));

    res.json({ data });
  } catch (error) {
    console.error('Get GPU power usage error:', error);
    res.status(500).json({ error: 'Failed to get GPU power usage' });
  }
});
