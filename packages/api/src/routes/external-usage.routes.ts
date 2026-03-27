/**
 * External Usage Routes
 *
 * API Only 서비스가 자체 시스템 API를 통해 사용 기록을 전송하는 엔드포인트
 * - 인증 불필요 (공개 API)
 * - 서비스가 apiOnly=true로 등록되어 있어야 전송 가능
 *
 * POST /by-user: 사용량 기록 → usageLog + UserService (프록시와 동일 테이블)
 *    - STANDARD 서비스: userId(Knox ID) 필수, deptName 선택
 *    - BACKGROUND 서비스: userId 선택, userId 없으면 deptName 필수
 *    - Knox ID 기반 사용자 자동 등록/인증
 *    - 통합 대시보드 중복제거 + Top K Users 반영
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index.js';
import { extractBusinessUnit } from '../middleware/auth.js';
import { lookupEmployeesBatch } from '../services/knoxEmployee.service.js';
import { z } from 'zod';

export const externalUsageRoutes = Router();

// ─── Validation Schema (by-user) ────────────────────────────

const byUserItemSchema = z.object({
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format')
    .refine(s => !isNaN(new Date(s + 'T00:00:00.000Z').getTime()), 'date is not a valid calendar date'),
  userId: z.string().optional().default(''),    // STANDARD 필수, BACKGROUND 선택
  deptName: z.string().optional().default(''),   // BACKGROUND 필수, STANDARD 선택 (user의 부서로 자동 설정)
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
 * 프록시 서비스와 동일한 usageLog 테이블에 기록되어
 * 통합 대시보드의 모든 통계에 자연스럽게 반영됩니다.
 *
 * 흐름:
 * 1. userId(Knox ID) → DB User 조회 (knoxVerified 확인)
 * 2. 미등록/미인증 → Knox Employee API 일괄 조회 → User upsert
 * 3. modelName → ServiceModel alias → Model 매칭 → 자동 생성 fallback
 * 4. usageLog upsert (동일 date+userId+modelId+serviceId → 삭제 후 재삽입)
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

    const isBackground = service.type === 'BACKGROUND';

    // STANDARD 서비스: userId 필수
    if (!isBackground) {
      const missingUserItems = data.filter(d => !d.userId);
      if (missingUserItems.length > 0) {
        res.status(400).json({
          error: 'STANDARD 서비스는 userId(Knox login ID)가 필수입니다.',
        });
        return;
      }
    }

    // BACKGROUND 서비스: deptName 필수 (userId 없는 항목)
    if (isBackground) {
      const missingDept = data.filter(d => !d.userId && !d.deptName);
      if (missingDept.length > 0) {
        res.status(400).json({
          error: 'BACKGROUND 서비스에서 userId가 없는 항목은 deptName이 필수입니다.',
        });
        return;
      }
    }

    // userId가 있는 항목과 없는 항목 분리
    const dataWithUser = data.filter(d => d.userId);
    const dataWithoutUser = data.filter(d => !d.userId);

    // 3. Resolve users: collect unique Knox IDs (userId가 있는 항목만)
    const uniqueLoginIds = [...new Set(dataWithUser.map(d => d.userId))];

    // 3a. DB에서 기존 사용자 일괄 조회
    const userByLoginId = new Map<string, { id: string; loginid: string; username: string; deptname: string; knoxVerified: boolean; businessUnit: string | null }>();
    if (uniqueLoginIds.length > 0) {
      const existingUsers = await prisma.user.findMany({
        where: { loginid: { in: uniqueLoginIds } },
        select: { id: true, loginid: true, username: true, deptname: true, knoxVerified: true, businessUnit: true },
      });
      for (const u of existingUsers) {
        userByLoginId.set(u.loginid, u);
      }
    }

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
        if (!modelByName.has(m.name)) {
          modelByName.set(m.name, m);

          // 이 서비스에 ServiceModel alias가 없으면 자동 연결
          try {
            await prisma.serviceModel.upsert({
              where: { serviceId_modelId_aliasName: { serviceId: service.id, modelId: m.id, aliasName: m.name } },
              update: {},
              create: {
                serviceId: service.id,
                modelId: m.id,
                aliasName: m.name,
                enabled: true,
                addedBy: `external:${service.name}`,
              },
            });
          } catch (_) { /* 실패해도 데이터 기록에는 지장 없음 */ }
        }
      }
    }

    // 4c. 여전히 미해결 모델 → 자동 생성 (API Only 서비스는 사전 등록이 어려우므로)
    const stillUnresolved = uniqueModelNames.filter(n => !modelByName.has(n));
    if (stillUnresolved.length > 0) {
      for (const modelName of stillUnresolved) {
        try {
          const newModel = await prisma.model.create({
            data: {
              name: modelName,
              displayName: modelName,
              endpointUrl: 'external://auto-created',
              enabled: true,
              sortOrder: 9999,
            },
          });

          await prisma.serviceModel.upsert({
            where: { serviceId_modelId_aliasName: { serviceId: service.id, modelId: newModel.id, aliasName: modelName } },
            update: {},
            create: {
              serviceId: service.id,
              modelId: newModel.id,
              aliasName: modelName,
              enabled: true,
              addedBy: `external:${service.name}`,
            },
          });

          modelByName.set(modelName, { id: newModel.id, name: newModel.name, displayName: newModel.displayName });
          console.log(`[ExternalUsage] Auto-created model "${modelName}" for service "${service.name}"`);
        } catch (autoErr) {
          console.error(`[ExternalUsage] Failed to auto-create model "${modelName}":`, autoErr);
        }
      }
    }

    // 모델 매칭 실패 목록 (자동 생성도 실패한 경우)
    const modelErrors = uniqueModelNames
      .filter(n => !modelByName.has(n))
      .map(n => `Model "${n}" auto-creation failed. 자동 생성에 실패했습니다.`);

    const failedModelNames = new Set(uniqueModelNames.filter(n => !modelByName.has(n)));

    // 5. usageLog에 기록 (동일 date+user+model+service → 삭제 후 재삽입)
    let upserted = 0;
    let skipped = 0;
    const recordErrors: Array<{ index: number; error: string }> = [];

    // 유효한 데이터 분류
    const validOps: Array<{
      index: number;
      dateObj: Date;
      nextDateObj: Date;
      userDbId: string | null;
      deptname: string | null;
      modelId: string;
      requestCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    }> = [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i]!;

      if (failedModelNames.has(item.modelName)) { skipped++; continue; }

      const model = modelByName.get(item.modelName);
      if (!model) { skipped++; continue; }

      // requestCount=0이면 기록할 필요 없음
      if (item.requestCount === 0 && item.totalInputTokens === 0 && item.totalOutputTokens === 0) {
        skipped++;
        continue;
      }

      // userId가 있는 항목: 사용자 resolve 필요
      if (item.userId) {
        if (failedLoginIds.has(item.userId)) { skipped++; continue; }
        const user = userByLoginId.get(item.userId);
        if (!user) { skipped++; continue; }

        const dateObj = new Date(item.date + 'T00:00:00.000Z');
        const nextDateObj = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);

        validOps.push({
          index: i,
          dateObj,
          nextDateObj,
          userDbId: user.id,
          deptname: user.deptname,
          modelId: model.id,
          requestCount: Math.max(item.requestCount, 1),
          totalInputTokens: item.totalInputTokens,
          totalOutputTokens: item.totalOutputTokens,
        });
      } else {
        // BACKGROUND 서비스: userId 없이 서비스 레벨로 기록 (deptName 사용)
        const dateObj = new Date(item.date + 'T00:00:00.000Z');
        const nextDateObj = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);

        validOps.push({
          index: i,
          dateObj,
          nextDateObj,
          userDbId: null,
          deptname: item.deptName || null,
          modelId: model.id,
          requestCount: Math.max(item.requestCount, 1),
          totalInputTokens: item.totalInputTokens,
          totalOutputTokens: item.totalOutputTokens,
        });
      }
    }

    // 배치 처리: 100건씩 트랜잭션
    const BATCH_SIZE = 100;
    for (let batch = 0; batch < validOps.length; batch += BATCH_SIZE) {
      const chunk = validOps.slice(batch, batch + BATCH_SIZE);
      try {
        await prisma.$transaction(async (tx) => {
          // 1) 기존 데이터 삭제 (동일 date+user+model+service)
          for (const op of chunk) {
            await tx.usageLog.deleteMany({
              where: {
                serviceId: service.id,
                userId: op.userDbId,
                modelId: op.modelId,
                timestamp: { gte: op.dateObj, lt: op.nextDateObj },
              },
            });
          }

          // 2) 새 데이터 삽입 (1 row, requestCount에 요청 수 저장)
          await tx.usageLog.createMany({
            data: chunk.map(op => ({
              userId: op.userDbId,
              modelId: op.modelId,
              serviceId: service.id,
              deptname: op.deptname,
              inputTokens: op.totalInputTokens,
              outputTokens: op.totalOutputTokens,
              totalTokens: op.totalInputTokens + op.totalOutputTokens,
              requestCount: op.requestCount,
              timestamp: op.dateObj,
            })),
          });
        });
        upserted += chunk.length;
      } catch (err) {
        // 배치 실패 시 개별 재시도
        for (const op of chunk) {
          try {
            await prisma.$transaction(async (tx) => {
              await tx.usageLog.deleteMany({
                where: {
                  serviceId: service.id,
                  userId: op.userDbId,
                  modelId: op.modelId,
                  timestamp: { gte: op.dateObj, lt: op.nextDateObj },
                },
              });
              await tx.usageLog.create({
                data: {
                  userId: op.userDbId,
                  modelId: op.modelId,
                  serviceId: service.id,
                  deptname: op.deptname,
                  inputTokens: op.totalInputTokens,
                  outputTokens: op.totalOutputTokens,
                  totalTokens: op.totalInputTokens + op.totalOutputTokens,
                  requestCount: op.requestCount,
                  timestamp: op.dateObj,
                },
              });
            });
            upserted++;
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            recordErrors.push({ index: op.index, error: msg.substring(0, 200) });
          }
        }
      }
    }

    // 6. UserService upsert (서비스별 사용자 추적, userId가 있는 항목만)
    const affectedUserDbIds = [...new Set(validOps.map(op => op.userDbId).filter((id): id is string => id != null))];

    if (affectedUserDbIds.length > 0) {
      const userServiceAgg = await prisma.usageLog.groupBy({
        by: ['userId'],
        where: {
          serviceId: service.id,
          userId: { in: affectedUserDbIds },
        },
        _sum: { requestCount: true },
        _max: { timestamp: true },
      });

      for (const agg of userServiceAgg) {
        if (!agg.userId) continue;
        const totalRequests = agg._sum.requestCount ?? 0;
        const latestDate = agg._max.timestamp ?? new Date();

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
    const userIds = [...new Set(data.map(d => d.userId).filter(Boolean))];
    try {
      await prisma.auditLog.create({
        data: {
          loginid: `external:${service.name}`,
          action: 'SUBMIT_EXTERNAL_USAGE_BY_USER',
          target: service.id,
          targetType: 'UsageLog',
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
        ...(dataWithoutUser.length > 0 ? { serviceLevelRecords: dataWithoutUser.length } : {}),
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
