/**
 * Holiday Routes
 *
 * 휴일 관리를 위한 API 엔드포인트
 * - GET /holidays: 휴일 목록 조회
 * - GET /holidays/:year: 특정 연도 휴일 목록
 * - POST /holidays: 휴일 추가 (SUPER_ADMIN)
 * - POST /holidays/bulk: 휴일 일괄 추가 (SUPER_ADMIN)
 * - PUT /holidays/:id: 휴일 수정 (SUPER_ADMIN)
 * - DELETE /holidays/:id: 휴일 삭제 (SUPER_ADMIN)
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, requireSuperAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';

// ─── 감사 로그 헬퍼 ────────────────────────────────────────
function recordAudit(req: AuthenticatedRequest, action: string, target: string | null, details: Record<string, unknown>) {
  prisma.auditLog.create({
    data: {
      adminId: req.adminId || null,
      loginid: req.user?.loginid || 'unknown',
      action,
      target,
      targetType: 'Holiday',
      details: JSON.parse(JSON.stringify(details)),
      ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
    },
  }).catch(() => {});
}

export const holidaysRoutes = Router();

// Validation schemas
const createHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  name: z.string().min(1).max(100),
  type: z.enum(['NATIONAL', 'COMPANY', 'CUSTOM']).default('NATIONAL'),
});

const bulkCreateSchema = z.object({
  holidays: z.array(createHolidaySchema).min(1).max(100),
});

const updateHolidaySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['NATIONAL', 'COMPANY', 'CUSTOM']).optional(),
});

/**
 * GET /holidays
 * 모든 휴일 목록 조회 (옵션: year, month)
 */
holidaysRoutes.get('/', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const year = req.query['year'] ? parseInt(req.query['year'] as string) : undefined;
    const month = req.query['month'] ? parseInt(req.query['month'] as string) : undefined;

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (year) {
      if (month) {
        // 특정 년월
        startDate = new Date(year, month - 1, 1);
        endDate = new Date(year, month, 0, 23, 59, 59, 999);
      } else {
        // 특정 연도
        startDate = new Date(year, 0, 1);
        endDate = new Date(year, 11, 31, 23, 59, 59, 999);
      }
    }

    const holidays = await prisma.holiday.findMany({
      where: startDate && endDate ? {
        date: {
          gte: startDate,
          lte: endDate,
        },
      } : undefined,
      orderBy: { date: 'asc' },
    });

    res.json({ holidays });
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({ error: 'Failed to get holidays' });
  }
});

/**
 * GET /holidays/dates
 * 휴일 날짜만 조회 (DAU 계산용, 경량 API)
 */
holidaysRoutes.get('/dates', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query['days'] as string) || 365));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const holidays = await prisma.holiday.findMany({
      where: {
        date: { gte: startDate },
      },
      select: { date: true },
      orderBy: { date: 'asc' },
    });

    // Return as array of date strings (YYYY-MM-DD)
    const dates = holidays.map(h => {
      const d = new Date(h.date);
      return d.toISOString().split('T')[0];
    });

    res.json({ dates });
  } catch (error) {
    console.error('Get holiday dates error:', error);
    res.status(500).json({ error: 'Failed to get holiday dates' });
  }
});

/**
 * GET /holidays/:year
 * 특정 연도 휴일 목록 조회
 */
holidaysRoutes.get('/:year', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const year = parseInt(req.params['year'] as string);
    if (isNaN(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Invalid year' });
    }

    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

    const holidays = await prisma.holiday.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    res.json({ holidays, year });
  } catch (error) {
    console.error('Get holidays by year error:', error);
    res.status(500).json({ error: 'Failed to get holidays' });
  }
});

/**
 * POST /holidays
 * 휴일 추가 (SUPER_ADMIN 전용)
 */
holidaysRoutes.post(
  '/',
  authenticateToken,
  requireSuperAdmin as RequestHandler,
  async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = createHolidaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const { date, name, type } = parsed.data;
      const dateObj = new Date(date + 'T00:00:00.000Z');

      // Check if holiday already exists for this date
      const existing = await prisma.holiday.findUnique({
        where: { date: dateObj },
      });

      if (existing) {
        return res.status(409).json({ error: 'Holiday already exists for this date', existing });
      }

      const holiday = await prisma.holiday.create({
        data: {
          date: dateObj,
          name,
          type,
        },
      });

      recordAudit(req, 'CREATE_HOLIDAY', holiday.id, { date, name, type });

      res.status(201).json({ holiday });
    } catch (error) {
      console.error('Create holiday error:', error);
      res.status(500).json({ error: 'Failed to create holiday' });
    }
  }
);

/**
 * POST /holidays/bulk
 * 휴일 일괄 추가 (SUPER_ADMIN 전용)
 */
holidaysRoutes.post(
  '/bulk',
  authenticateToken,
  requireSuperAdmin as RequestHandler,
  async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = bulkCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const { holidays } = parsed.data;
      const results = {
        created: [] as Array<{ date: string; name: string }>,
        skipped: [] as Array<{ date: string; reason: string }>,
      };

      for (const holidayData of holidays) {
        const dateObj = new Date(holidayData.date + 'T00:00:00.000Z');

        try {
          const existing = await prisma.holiday.findUnique({
            where: { date: dateObj },
          });

          if (existing) {
            results.skipped.push({ date: holidayData.date, reason: 'Already exists' });
            continue;
          }

          await prisma.holiday.create({
            data: {
              date: dateObj,
              name: holidayData.name,
              type: holidayData.type,
            },
          });

          results.created.push({ date: holidayData.date, name: holidayData.name });
        } catch (err) {
          results.skipped.push({ date: holidayData.date, reason: 'Database error' });
        }
      }

      recordAudit(req, 'BULK_CREATE_HOLIDAYS', null, {
        created: results.created.length,
        skipped: results.skipped.length,
        dates: results.created.map(h => h.date),
      });

      res.status(201).json({
        message: `Created ${results.created.length} holidays, skipped ${results.skipped.length}`,
        ...results,
      });
    } catch (error) {
      console.error('Bulk create holidays error:', error);
      res.status(500).json({ error: 'Failed to create holidays' });
    }
  }
);

/**
 * PUT /holidays/:id
 * 휴일 수정 (SUPER_ADMIN 전용)
 */
holidaysRoutes.put(
  '/:id',
  authenticateToken,
  requireSuperAdmin as RequestHandler,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const parsed = updateHolidaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const existing = await prisma.holiday.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Holiday not found' });
      }

      const holiday = await prisma.holiday.update({
        where: { id },
        data: parsed.data,
      });

      recordAudit(req, 'UPDATE_HOLIDAY', id, {
        date: existing.date.toISOString().split('T')[0],
        name: existing.name,
        changes: parsed.data,
      });

      res.json({ holiday });
    } catch (error) {
      console.error('Update holiday error:', error);
      res.status(500).json({ error: 'Failed to update holiday' });
    }
  }
);

/**
 * DELETE /holidays/:id
 * 휴일 삭제 (SUPER_ADMIN 전용)
 */
holidaysRoutes.delete(
  '/:id',
  authenticateToken,
  requireSuperAdmin as RequestHandler,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;

      const existing = await prisma.holiday.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Holiday not found' });
      }

      await prisma.holiday.delete({ where: { id } });

      recordAudit(req, 'DELETE_HOLIDAY', id, {
        date: existing.date.toISOString().split('T')[0],
        name: existing.name,
      });

      res.json({ message: 'Holiday deleted successfully' });
    } catch (error) {
      console.error('Delete holiday error:', error);
      res.status(500).json({ error: 'Failed to delete holiday' });
    }
  }
);
