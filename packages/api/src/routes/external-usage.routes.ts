/**
 * External Usage Routes
 *
 * API Only 서비스가 자체 시스템 API를 통해 일별 사용 기록을 전송하는 엔드포인트
 * - 인증 불필요 (공개 API)
 * - 서비스가 apiOnly=true로 등록되어 있어야 전송 가능
 *
 * 두 가지 엔드포인트:
 * 1. POST /daily        (레거시) 팀 단위 집계 → ExternalDailyUsage 테이블
 * 2. POST /by-user      (권장)  사용자 단위 → DailyUsageStat + UserService (프록시와 동일 경로)
 *    - Knox ID 기반 사용자 자동 등록/인증
 *    - 통합 대시보드 중복제거 + Top K Users 반영
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index.js';
import { extractBusinessUnit } from '../middleware/auth.js';
import { lookupEmployeesBatch } from '../services/knoxEmployee.service.js';
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

    // 5. 감사 로그 기록
    const dates = data.map(d => d.date).sort();
    const depts = [...new Set(data.map(d => d.deptName))];
    try {
      await prisma.auditLog.create({
        data: {
          loginid: `external:${service.name}`,
          action: 'SUBMIT_EXTERNAL_USAGE',
          target: service.id,
          targetType: 'ExternalUsage',
          details: JSON.parse(JSON.stringify({
            serviceName: service.name,
            serviceType: service.type,
            recordCount: data.length,
            upserted,
            errors: errors.length,
            dateRange: dates.length > 0 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '',
            departments: depts,
          })),
          ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
        },
      });
    } catch (logErr) {
      console.error('[AuditLog] Failed to record external usage:', logErr);
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

// ─── Validation Schema (by-user) ────────────────────────────

const byUserItemSchema = z.object({
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format')
    .refine(s => !isNaN(new Date(s + 'T00:00:00.000Z').getTime()), 'date is not a valid calendar date'),
  userId: z.string().min(1, 'userId (Knox login ID) is required'),
  modelName: z.string().min(1, 'modelName is required'),
  requestCount: z.number().int().min(0),
  totalInputTokens: z.number().int().min(0),
  totalOutputTokens: z.number().int().min(0),
});

const byUserSchema = z.object({
  serviceId: z.string().min(1, 'serviceId (service name) is required'),
  data: z.array(byUserItemSchema)
    .min(1, 'data array must have at least 1 item')
    .max(5000, 'data array must have at most 5000 items'),
});

// ─── POST /external-usage/by-user ───────────────────────────
/**
 * 사용자(Knox ID) 단위 사용량 제출 (권장)
 *
 * 프록시 서비스와 동일한 DailyUsageStat + UserService에 기록되어
 * 통합 대시보드 중복제거, Top K Users 등 모든 통계에 자연스럽게 반영됩니다.
 *
 * 흐름:
 * 1. userId(Knox ID) → DB User 조회 (knoxVerified 확인)
 * 2. 미등록/미인증 → Knox Employee API 일괄 조회 → User upsert
 * 3. modelName → ServiceModel alias → Model 매칭
 * 4. DailyUsageStat upsert (date, userId, modelId, serviceId)
 * 5. UserService upsert (user-service 관계 추적)
 */
externalUsageRoutes.post('/by-user', async (req: Request, res: Response) => {
  try {
    // 1. Validate
    const validation = byUserSchema.safeParse(req.body);
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

    const { serviceId: serviceName, data } = validation.data;

    // 2. Verify service
    const service = await prisma.service.findUnique({
      where: { name: serviceName },
      select: { id: true, name: true, type: true, apiOnly: true, enabled: true },
    });

    if (!service) {
      res.status(404).json({
        error: `Service "${serviceName}" not found. 등록되지 않은 서비스입니다.`,
      });
      return;
    }

    if (!service.apiOnly) {
      res.status(403).json({
        error: `Service "${serviceName}" is not an API Only service. apiOnly 서비스로 등록되어야 합니다.`,
      });
      return;
    }

    if (!service.enabled) {
      res.status(403).json({
        error: `Service "${serviceName}" is disabled. 비활성화된 서비스입니다.`,
      });
      return;
    }

    // 3. Resolve users: collect unique Knox IDs
    const uniqueLoginIds = [...new Set(data.map(d => d.userId))];

    // 3a. DB에서 기존 사용자 일괄 조회
    const existingUsers = await prisma.user.findMany({
      where: { loginid: { in: uniqueLoginIds } },
      select: { id: true, loginid: true, username: true, deptname: true, knoxVerified: true, businessUnit: true },
    });
    const userByLoginId = new Map(existingUsers.map(u => [u.loginid, u]));

    // 3b. Knox 인증이 필요한 사용자 식별 (미등록 또는 knoxVerified=false)
    const needKnoxLookup = uniqueLoginIds.filter(lid => {
      const u = userByLoginId.get(lid);
      return !u || !u.knoxVerified;
    });

    // 3c. Knox API 일괄 조회 + User upsert
    const knoxErrors: Array<{ userId: string; error: string }> = [];
    if (needKnoxLookup.length > 0) {
      const knoxMap = await lookupEmployeesBatch(needKnoxLookup);

      for (const loginid of needKnoxLookup) {
        const emp = knoxMap.get(loginid);
        if (!emp) {
          knoxErrors.push({ userId: loginid, error: `Knox에서 임직원 정보를 확인할 수 없습니다 (재직/휴직 상태만 허용)` });
          continue;
        }

        const deptname = emp.departmentName || '';
        const businessUnit = extractBusinessUnit(deptname);

        const user = await prisma.user.upsert({
          where: { loginid },
          update: {
            username: emp.fullName,
            deptname,
            businessUnit,
            enDeptName: emp.enDepartmentName || null,
            departmentCode: emp.departmentCode || null,
            knoxVerified: true,
            lastActive: new Date(),
          },
          create: {
            loginid,
            username: emp.fullName,
            deptname,
            businessUnit,
            enDeptName: emp.enDepartmentName || null,
            departmentCode: emp.departmentCode || null,
            knoxVerified: true,
          },
        });

        userByLoginId.set(loginid, {
          id: user.id,
          loginid: user.loginid,
          username: user.username,
          deptname: user.deptname,
          knoxVerified: true,
          businessUnit: user.businessUnit,
        });
      }
    }

    // Knox 조회 실패한 사용자들의 loginid Set
    const failedLoginIds = new Set(knoxErrors.map(e => e.userId));

    // 4. Resolve models: collect unique modelNames → find via ServiceModel alias → Model.name fallback
    const uniqueModelNames = [...new Set(data.map(d => d.modelName))];

    // 4a. ServiceModel alias로 조회
    const serviceModelAliases = await prisma.serviceModel.findMany({
      where: {
        serviceId: service.id,
        aliasName: { in: uniqueModelNames },
        enabled: true,
        model: { enabled: true },
      },
      include: { model: { select: { id: true, name: true, displayName: true } } },
    });

    const modelByName = new Map<string, { id: string; name: string; displayName: string }>();
    for (const sm of serviceModelAliases) {
      modelByName.set(sm.aliasName, sm.model);
    }

    // 4b. alias에서 못 찾은 모델 → Model.name으로 직접 조회
    // Model.name은 중복 가능하므로 sortOrder ASC로 첫 번째 선택
    const unresolvedModels = uniqueModelNames.filter(n => !modelByName.has(n));
    if (unresolvedModels.length > 0) {
      const globalModels = await prisma.model.findMany({
        where: {
          name: { in: unresolvedModels },
          enabled: true,
        },
        select: { id: true, name: true, displayName: true },
        orderBy: { sortOrder: 'asc' },
      });
      for (const m of globalModels) {
        // 중복 이름일 경우 sortOrder가 가장 낮은 (먼저 나온) 모델만 사용
        if (!modelByName.has(m.name)) {
          modelByName.set(m.name, m);
        }
      }
    }

    // 모델 매칭 실패 목록
    const modelErrors = uniqueModelNames
      .filter(n => !modelByName.has(n))
      .map(n => `Model "${n}" not found. ServiceModel alias 또는 등록된 모델명을 사용하세요.`);

    const failedModelNames = new Set(uniqueModelNames.filter(n => !modelByName.has(n)));

    // 5. Upsert DailyUsageStat + UserService
    let upserted = 0;
    let skipped = 0;
    const recordErrors: Array<{ index: number; error: string }> = [];

    // 배치 처리용 데이터 준비
    const validOps: Array<{
      index: number;
      dateObj: Date;
      userDbId: string;
      deptname: string;
      modelId: string;
      requestCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    }> = [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i]!;

      // 사용자 검증 실패 → skip
      if (failedLoginIds.has(item.userId)) {
        skipped++;
        continue;
      }

      // 모델 미발견 → skip
      if (failedModelNames.has(item.modelName)) {
        skipped++;
        continue;
      }

      const user = userByLoginId.get(item.userId);
      const model = modelByName.get(item.modelName);

      if (!user || !model) {
        skipped++;
        continue;
      }

      validOps.push({
        index: i,
        dateObj: new Date(item.date + 'T00:00:00.000Z'),
        userDbId: user.id,
        deptname: user.deptname,
        modelId: model.id,
        requestCount: item.requestCount,
        totalInputTokens: item.totalInputTokens,
        totalOutputTokens: item.totalOutputTokens,
      });
    }

    // 100건 단위로 트랜잭션 분할
    const BATCH_SIZE = 100;
    for (let batch = 0; batch < validOps.length; batch += BATCH_SIZE) {
      const chunk = validOps.slice(batch, batch + BATCH_SIZE);
      try {
        await prisma.$transaction(
          chunk.map(op =>
            prisma.dailyUsageStat.upsert({
              where: {
                date_userId_modelId_serviceId: {
                  date: op.dateObj,
                  userId: op.userDbId,
                  modelId: op.modelId,
                  serviceId: service.id,
                },
              },
              update: {
                totalInputTokens: op.totalInputTokens,
                totalOutputTokens: op.totalOutputTokens,
                requestCount: op.requestCount,
                deptname: op.deptname,
              },
              create: {
                date: op.dateObj,
                userId: op.userDbId,
                modelId: op.modelId,
                serviceId: service.id,
                deptname: op.deptname,
                totalInputTokens: op.totalInputTokens,
                totalOutputTokens: op.totalOutputTokens,
                requestCount: op.requestCount,
              },
            })
          )
        );
        upserted += chunk.length;
      } catch (err) {
        // 배치 실패 시 개별 재시도
        for (const op of chunk) {
          try {
            await prisma.dailyUsageStat.upsert({
              where: {
                date_userId_modelId_serviceId: {
                  date: op.dateObj,
                  userId: op.userDbId,
                  modelId: op.modelId,
                  serviceId: service.id,
                },
              },
              update: {
                totalInputTokens: op.totalInputTokens,
                totalOutputTokens: op.totalOutputTokens,
                requestCount: op.requestCount,
                deptname: op.deptname,
              },
              create: {
                date: op.dateObj,
                userId: op.userDbId,
                modelId: op.modelId,
                serviceId: service.id,
                deptname: op.deptname,
                totalInputTokens: op.totalInputTokens,
                totalOutputTokens: op.totalOutputTokens,
                requestCount: op.requestCount,
              },
            });
            upserted++;
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            recordErrors.push({ index: op.index, error: msg.substring(0, 200) });
          }
        }
      }
    }

    // 6. UserService upsert (서비스별 사용자 추적)
    // DailyUsageStat에서 해당 사용자-서비스 조합의 실제 총 requestCount를 재집계
    // → increment 대신 정확한 값을 세팅하여 재전송 시 이중 누적 방지
    const affectedUserDbIds = [...new Set(validOps.map(op => op.userDbId))];

    if (affectedUserDbIds.length > 0) {
      const userServiceAgg = await prisma.dailyUsageStat.groupBy({
        by: ['userId'],
        where: {
          serviceId: service.id,
          userId: { in: affectedUserDbIds },
        },
        _sum: { requestCount: true },
        _max: { date: true },
      });

      for (const agg of userServiceAgg) {
        if (!agg.userId) continue;
        const totalRequests = agg._sum.requestCount ?? 0;
        const latestDate = agg._max.date ?? new Date();

        try {
          await prisma.userService.upsert({
            where: { userId_serviceId: { userId: agg.userId, serviceId: service.id } },
            update: {
              lastActive: latestDate,
              requestCount: totalRequests,
            },
            create: {
              userId: agg.userId,
              serviceId: service.id,
              firstSeen: latestDate,
              lastActive: latestDate,
              requestCount: totalRequests,
            },
          });
        } catch (err) {
          console.error(`[ExternalUsage] UserService upsert failed for user ${agg.userId}:`, err);
        }
      }
    }

    // 7. 감사 로그
    const dates = data.map(d => d.date).sort();
    const userIds = [...new Set(data.map(d => d.userId))];
    try {
      await prisma.auditLog.create({
        data: {
          loginid: `external:${service.name}`,
          action: 'SUBMIT_EXTERNAL_USAGE_BY_USER',
          target: service.id,
          targetType: 'DailyUsageStat',
          details: JSON.parse(JSON.stringify({
            serviceName: service.name,
            serviceType: service.type,
            recordCount: data.length,
            uniqueUsers: uniqueLoginIds.length,
            upserted,
            skipped,
            errors: recordErrors.length,
            knoxErrors: knoxErrors.length,
            modelErrors: modelErrors.length,
            dateRange: dates.length > 0 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '',
            userSample: userIds.slice(0, 10),
          })),
          ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
        },
      });
    } catch (logErr) {
      console.error('[AuditLog] Failed to record external usage by-user:', logErr);
    }

    // 8. Response
    const warnings: string[] = [];
    if (knoxErrors.length > 0) {
      warnings.push(...knoxErrors.map(e => `User "${e.userId}": ${e.error}`));
    }
    if (modelErrors.length > 0) {
      warnings.push(...modelErrors);
    }

    res.json({
      success: true,
      service: { name: service.name, type: service.type, apiOnly: true },
      result: {
        total: data.length,
        upserted,
        skipped,
        errors: recordErrors.length,
      },
      users: {
        total: uniqueLoginIds.length,
        resolved: uniqueLoginIds.length - failedLoginIds.size,
        failed: failedLoginIds.size,
      },
      models: {
        total: uniqueModelNames.length,
        resolved: uniqueModelNames.length - failedModelNames.size,
        failed: failedModelNames.size,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(recordErrors.length > 0 ? { errorDetails: recordErrors } : {}),
    });
  } catch (err) {
    console.error('External usage by-user POST error:', err);
    res.status(500).json({ error: '사용자별 사용 기록 저장에 실패했습니다.' });
  }
});

// GET endpoint 제거: API Only 데이터는 기존 public stats API에 자동 합산
// - /public/stats/dau-mau: DAU/MAU에 포함
// - /public/stats/team-usage: 팀별 사용량에 포함
// - /public/stats/team-usage-all: 전체 팀별 사용량에 포함
// - /public/stats/top-users: Top K 사용자에 포함 (by-user 사용 시)
