/**
 * GPU Power Usage Routes
 *
 * DT GPU 전력 사용률 집계
 * - POST /admin/gpu-power: 일자별 전력 사용률 등록/업데이트
 * - GET  /admin/gpu-power: 최근 30일 전력 사용률 목록
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';

export const gpuPowerRoutes = Router();

const upsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  power_avg_usage_ratio: z.number().min(0).max(100),
});

/**
 * @swagger
 * /admin/gpu-power:
 *   post:
 *     summary: GPU 전력 사용률 등록/업데이트
 *     tags: [GPU Power]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, power_avg_usage_ratio]
 *             properties:
 *               date:
 *                 type: string
 *                 example: "2026-03-25"
 *               power_avg_usage_ratio:
 *                 type: number
 *                 example: 72.35
 *     responses:
 *       200:
 *         description: 등록/업데이트 성공
 */
gpuPowerRoutes.post(
  '/',
  authenticateToken,
  requireAdmin as RequestHandler,
  async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const { date, power_avg_usage_ratio } = parsed.data;
      const dateObj = new Date(date + 'T00:00:00.000Z');

      const record = await prisma.gpuPowerUsage.upsert({
        where: { date: dateObj },
        update: { powerAvgUsageRatio: power_avg_usage_ratio },
        create: { date: dateObj, powerAvgUsageRatio: power_avg_usage_ratio },
      });

      res.json({
        message: 'GPU power usage saved',
        data: {
          date: record.date.toISOString().split('T')[0],
          power_avg_usage_ratio: record.powerAvgUsageRatio,
        },
      });
    } catch (error) {
      console.error('Save GPU power usage error:', error);
      res.status(500).json({ error: 'Failed to save GPU power usage' });
    }
  }
);

/**
 * @swagger
 * /admin/gpu-power:
 *   get:
 *     summary: 최근 30일 GPU 전력 사용률 목록
 *     tags: [GPU Power]
 *     responses:
 *       200:
 *         description: 성공
 */
gpuPowerRoutes.get(
  '/',
  authenticateToken,
  requireAdmin as RequestHandler,
  async (_req: AuthenticatedRequest, res) => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const records = await prisma.gpuPowerUsage.findMany({
        where: { date: { gte: thirtyDaysAgo } },
        orderBy: { date: 'asc' },
      });

      const data = records.map(r => ({
        date: r.date.toISOString().split('T')[0],
        power_avg_usage_ratio: r.powerAvgUsageRatio,
      }));

      res.json({ data });
    } catch (error) {
      console.error('Get GPU power usage error:', error);
      res.status(500).json({ error: 'Failed to get GPU power usage' });
    }
  }
);
