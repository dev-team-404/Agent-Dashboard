/**
 * External Usage Routes
 *
 * API Only 서비스가 자체 시스템 API를 통해 일별 사용 기록을 전송하는 엔드포인트
 * - 인증 불필요 (공개 API)
 * - 서비스가 apiOnly=true로 등록되어 있어야 전송 가능
 * - 같은 (date, serviceId, deptName, modelName) 조합은 upsert (덮어쓰기)
 * - deptName 형식: "팀명(사업부)" → businessUnit 자동 추출
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index.js';
import { extractBusinessUnit } from '../middleware/auth.js';
import { z } from 'zod';

export const externalUsageRoutes = Router();

// ─── Validation Schema ───────────────────────────────────────

const externalUsageItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format'),
  deptName: z.string().min(1, 'deptName is required (format: "팀명(사업부)")'),
  modelName: z.string().min(1, 'modelName is required'),
  dailyActiveUsers: z.number().int().min(0).optional().nullable(),
  llmRequestCount: z.number().int().min(0),
  totalInputTokens: z.number().int().min(0),
  totalOutputTokens: z.number().int().min(0),
});

const externalUsageSchema = z.object({
  serviceId: z.string().min(1, 'serviceId (service name) is required'),
  data: z.array(externalUsageItemSchema).min(1, 'data array must have at least 1 item').max(1000, 'data array must have at most 1000 items'),
});

// ─── POST /external-usage/daily ──────────────────────────────

externalUsageRoutes.post('/daily', async (req: Request, res: Response) => {
  try {
    // 1. Validate request body
    const validation = externalUsageSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: validation.error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { serviceId, data } = validation.data;

    // 2. Verify service exists and is apiOnly
    const service = await prisma.service.findUnique({
      where: { name: serviceId },
      select: { id: true, name: true, type: true, apiOnly: true, enabled: true },
    });

    if (!service) {
      res.status(404).json({
        error: `Service "${serviceId}" not found. 등록되지 않은 서비스입니다.`,
      });
      return;
    }

    if (!service.apiOnly) {
      res.status(403).json({
        error: `Service "${serviceId}" is not an API Only service. apiOnly 서비스로 등록되어야 합니다.`,
      });
      return;
    }

    if (!service.enabled) {
      res.status(403).json({
        error: `Service "${serviceId}" is disabled. 비활성화된 서비스입니다.`,
      });
      return;
    }

    // 3. Validate: STANDARD services should have dailyActiveUsers, BACKGROUND should not
    const isStandard = service.type === 'STANDARD';
    const warnings: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i]!;
      if (isStandard && (item.dailyActiveUsers == null)) {
        warnings.push(`data[${i}]: STANDARD 서비스는 dailyActiveUsers 필드를 포함해야 합니다. (date: ${item.date}, dept: ${item.deptName})`);
      }
      if (!isStandard && item.dailyActiveUsers != null) {
        // BACKGROUND 서비스인데 dailyActiveUsers가 들어온 경우 → 무시 (경고만)
        warnings.push(`data[${i}]: BACKGROUND 서비스는 dailyActiveUsers를 무시합니다. 시스템이 자동 역산합니다.`);
      }
    }

    // 4. Upsert each record (트랜잭션으로 일괄 처리)
    let upserted = 0;
    const errors: Array<{ index: number; error: string }> = [];

    const upsertOps = data.map((item, i) => {
      const dateObj = new Date(item.date + 'T00:00:00.000Z');
      const businessUnit = extractBusinessUnit(item.deptName);
      return { i, item, dateObj, businessUnit };
    });

    // 100건 단위로 트랜잭션 분할
    const BATCH_SIZE = 100;
    for (let batch = 0; batch < upsertOps.length; batch += BATCH_SIZE) {
      const chunk = upsertOps.slice(batch, batch + BATCH_SIZE);
      try {
        await prisma.$transaction(
          chunk.map(({ item, dateObj, businessUnit }) =>
            prisma.externalDailyUsage.upsert({
              where: {
                date_serviceId_deptName_modelName: {
                  date: dateObj,
                  serviceId: service.id,
                  deptName: item.deptName,
                  modelName: item.modelName,
                },
              },
              update: {
                dailyActiveUsers: isStandard ? (item.dailyActiveUsers ?? null) : null,
                llmRequestCount: item.llmRequestCount,
                totalInputTokens: item.totalInputTokens,
                totalOutputTokens: item.totalOutputTokens,
                businessUnit,
              },
              create: {
                date: dateObj,
                serviceId: service.id,
                deptName: item.deptName,
                businessUnit,
                modelName: item.modelName,
                dailyActiveUsers: isStandard ? (item.dailyActiveUsers ?? null) : null,
                llmRequestCount: item.llmRequestCount,
                totalInputTokens: item.totalInputTokens,
                totalOutputTokens: item.totalOutputTokens,
              },
            })
          )
        );
        upserted += chunk.length;
      } catch (err) {
        // 배치 실패 시 개별 재시도
        for (const { i, item, dateObj, businessUnit } of chunk) {
          try {
            await prisma.externalDailyUsage.upsert({
              where: {
                date_serviceId_deptName_modelName: {
                  date: dateObj,
                  serviceId: service.id,
                  deptName: item.deptName,
                  modelName: item.modelName,
                },
              },
              update: {
                dailyActiveUsers: isStandard ? (item.dailyActiveUsers ?? null) : null,
                llmRequestCount: item.llmRequestCount,
                totalInputTokens: item.totalInputTokens,
                totalOutputTokens: item.totalOutputTokens,
                businessUnit,
              },
              create: {
                date: dateObj,
                serviceId: service.id,
                deptName: item.deptName,
                businessUnit,
                modelName: item.modelName,
                dailyActiveUsers: isStandard ? (item.dailyActiveUsers ?? null) : null,
                llmRequestCount: item.llmRequestCount,
                totalInputTokens: item.totalInputTokens,
                totalOutputTokens: item.totalOutputTokens,
              },
            });
            upserted++;
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            errors.push({ index: i, error: msg.substring(0, 200) });
          }
        }
      }
    }

    res.json({
      success: true,
      service: { name: service.name, type: service.type, apiOnly: true },
      result: {
        total: data.length,
        upserted,
        errors: errors.length,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(errors.length > 0 ? { errorDetails: errors } : {}),
    });
  } catch (err) {
    console.error('External usage POST error:', err);
    res.status(500).json({ error: '사용 기록 저장에 실패했습니다.' });
  }
});

// ─── GET /external-usage/daily ───────────────────────────────

/**
 * API Only 서비스의 외부 사용 기록 조회
 */
externalUsageRoutes.get('/daily', async (req: Request, res: Response) => {
  try {
    const serviceName = req.query['serviceId'] as string | undefined;
    const startStr = req.query['startDate'] as string | undefined;
    const endStr = req.query['endDate'] as string | undefined;

    if (!serviceName || !startStr || !endStr) {
      res.status(400).json({ error: 'serviceId, startDate, endDate are required (format: YYYY-MM-DD)' });
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startStr) || !dateRegex.test(endStr)) {
      res.status(400).json({ error: 'startDate and endDate must be in YYYY-MM-DD format' });
      return;
    }

    const service = await prisma.service.findUnique({
      where: { name: serviceName },
      select: { id: true, name: true, type: true, apiOnly: true },
    });

    if (!service || !service.apiOnly) {
      res.status(404).json({ error: `API Only service "${serviceName}" not found.` });
      return;
    }

    const startDate = new Date(startStr + 'T00:00:00.000Z');
    const endDate = new Date(endStr + 'T00:00:00.000Z');

    const records = await prisma.externalDailyUsage.findMany({
      where: {
        serviceId: service.id,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: [{ date: 'asc' }, { deptName: 'asc' }, { modelName: 'asc' }],
    });

    res.json({
      service: { name: service.name, type: service.type, apiOnly: true },
      data: records.map(r => ({
        date: r.date.toISOString().split('T')[0],
        deptName: r.deptName,
        businessUnit: r.businessUnit,
        modelName: r.modelName,
        dailyActiveUsers: r.dailyActiveUsers,
        llmRequestCount: r.llmRequestCount,
        totalInputTokens: r.totalInputTokens,
        totalOutputTokens: r.totalOutputTokens,
      })),
    });
  } catch (err) {
    console.error('External usage GET error:', err);
    res.status(500).json({ error: '사용 기록 조회에 실패했습니다.' });
  }
});
