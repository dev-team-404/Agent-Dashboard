/**
 * Agent Registry API Server (v2)
 *
 * 3단계 권한 체계 + 헤더 기반 프록시 인증
 */

// Force noproxy
delete process.env['HTTP_PROXY'];
delete process.env['HTTPS_PROXY'];
delete process.env['http_proxy'];
delete process.env['https_proxy'];

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { createRedisClient } from './services/redis.service.js';
import { authRoutes } from './routes/auth.routes.js';
import { modelsRoutes } from './routes/models.routes.js';
import { usageRoutes } from './routes/usage.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';
import { myUsageRoutes } from './routes/my-usage.routes.js';
import { ratingRoutes } from './routes/rating.routes.js';
import { serviceRoutes } from './routes/service.routes.js';
import { holidaysRoutes } from './routes/holidays.routes.js';
import { publicStatsRoutes } from './routes/public-stats.routes.js';
import { adminLogsRoutes } from './routes/admin-logs.routes.js';
import { serviceTargetsRoutes } from './routes/service-targets.routes.js';
import { systemSettingsRoutes } from './routes/system-settings.routes.js';
import { adminRequestRoutes } from './routes/admin-requests.routes.js';
import { externalUsageRoutes } from './routes/external-usage.routes.js';
import { errorLogsRoutes } from './routes/error-logs.routes.js';
import { deptSavedMMRoutes } from './routes/dept-saved-mm.routes.js';
import { insightRoutes, publicInsightRoutes } from './routes/insight.routes.js';
import { deptMappingRoutes } from './routes/dept-mapping.routes.js';
import { swaggerSpec, getSwaggerUiHtml } from './swagger.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { requestLogger } from './middleware/requestLogger.js';
import { startImageCleanupCron } from './services/imageStorage.service.js';
import { startHealthCheckCron } from './services/healthCheck.service.js';
import { startAiEstimationCron } from './services/aiEstimation.service.js';
import { extractBusinessUnit } from './middleware/auth.js';
import { getDepartmentHierarchy, lookupEmployee } from './services/knoxEmployee.service.js';

import 'dotenv/config';

const app = express();
const PORT = process.env['PORT'] || 3000;

app.set('trust proxy', 1);

export const prisma = new PrismaClient();
export const redis = createRedisClient();

// Middleware
// HTTP 환경 (사내망) — HTTPS 전용 헤더 전부 비활성화
app.use(helmet({
  contentSecurityPolicy: false,           // CSP 비활성화 (upgrade-insecure-requests 방지)
  strictTransportSecurity: false,         // HSTS 비활성화 (브라우저 HTTPS 강제 캐시 방지)
  crossOriginOpenerPolicy: false,         // HTTP에서 무의미
  originAgentCluster: false,              // HTTP에서 무의미
  crossOriginEmbedderPolicy: false,       // HTTP에서 무의미
}));
app.use(cors({
  origin: process.env['CORS_ORIGIN'] || '*',
  credentials: true,
}));
// ASR audio_url 방식: base64 오디오가 JSON body에 포함 (최대 500MB)
app.use('/v1/chat/completions', express.json({ limit: '500mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(morgan('combined'));

// Rate limiting — Dashboard API only (proxy routes have their own token-based limits)
const dashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path.startsWith('/v1/') || req.path === '/health',
});
app.use(dashboardLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API Routes (Dashboard - JWT/SSO auth)
app.use('/auth', authRoutes);
app.use('/services', serviceRoutes);
app.use('/models', modelsRoutes);
app.use('/usage', usageRoutes);
app.use('/admin', adminRoutes);
app.use('/my-usage', myUsageRoutes);
app.use('/rating', ratingRoutes);
app.use('/holidays', holidaysRoutes);
app.use('/admin', adminLogsRoutes);
app.use('/admin', serviceTargetsRoutes);
app.use('/admin', deptSavedMMRoutes);
app.use('/admin', insightRoutes);
app.use('/admin', deptMappingRoutes);
app.use('/admin', systemSettingsRoutes);
app.use('/admin', errorLogsRoutes);
app.use('/', adminRequestRoutes);

// LLM Proxy Routes (Header-based auth: x-service-id, x-user-id, x-dept-name)
app.use('/v1', proxyRoutes);

// Public Stats API (인증 불필요)
app.use('/public/stats', publicStatsRoutes);
app.use('/public/stats', publicInsightRoutes);

// External Usage API (API Only 서비스용, 인증 불필요)
// nginx: /api/external-usage → /external-usage (proxy strips /api/ prefix)
app.use('/external-usage', externalUsageRoutes);

// Swagger UI 정적 에셋 (사내망 CDN 차단 대응 — 로컬 서빙)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const swaggerUiDistPath = join(__dirname, '..', 'node_modules', 'swagger-ui-dist');
app.use('/swagger-ui', express.static(swaggerUiDistPath, { maxAge: '1d' }));

// Swagger / OpenAPI documentation
app.get('/api-docs', (_req, res) => {
  res.json(swaggerSpec);
});
app.get('/api-docs/ui', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(getSwaggerUiHtml());
});

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      message: process.env['NODE_ENV'] === 'development' ? err.message : undefined,
    });
  }
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Crash protection
process.on('uncaughtException', (err) => {
  console.error(`[PID ${process.pid}] Uncaught exception:`, err);
  setTimeout(() => process.exit(1), 3000);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[PID ${process.pid}] Unhandled rejection:`, reason);
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// health_check_logs.model_name 스냅샷을 현재 models.displayName으로 일괄 동기화
async function syncHealthCheckModelNames() {
  try {
    const result = await prisma.$executeRaw`
      UPDATE health_check_logs h
      SET model_name = m."displayName"
      FROM models m
      WHERE h.model_id = m.id
        AND h.model_name IS DISTINCT FROM m."displayName"
    `;
    if (result > 0) {
      console.log(`[Sync] health_check_logs.model_name 갱신: ${result}건`);
    }
  } catch (err) {
    console.error('[Sync] health_check_logs model_name sync failed:', err);
  }
}

// 빈 visibilityScope를 가진 TEAM/BUSINESS_UNIT 모델을 owner 기준으로 자동 채움
async function backfillEmptyVisibilityScope() {
  try {
    const models = await prisma.model.findMany({
      where: {
        visibility: { in: ['TEAM', 'BUSINESS_UNIT'] },
        visibilityScope: { equals: [] },
      },
    });

    if (models.length === 0) return;

    console.log(`[Backfill] Found ${models.length} model(s) with empty visibilityScope`);

    for (const model of models) {
      let scope: string[] = [];
      if (model.visibility === 'TEAM' && model.createdByDept) {
        scope = [model.createdByDept];
      } else if (model.visibility === 'BUSINESS_UNIT') {
        const bu = model.createdByBusinessUnit || extractBusinessUnit(model.createdByDept || '');
        if (bu) scope = [bu];
      }

      if (scope.length > 0) {
        await prisma.model.update({
          where: { id: model.id },
          data: { visibilityScope: scope },
        });
        console.log(`[Backfill] Updated model "${model.displayName}" (${model.visibility}): scope = [${scope.join(', ')}]`);
      }
    }
  } catch (error) {
    console.error('[Backfill] Failed to backfill visibilityScope:', error);
  }
}

/**
 * departmentCode가 없는 사용자만 Knox 인증 리셋
 * → 다음 API 호출 시 Knox 재인증 + 영문 부서명/부서코드/계층 정보 수집
 * (departmentCode가 이미 있는 사용자는 이미 새 스키마로 인증된 것이므로 스킵)
 */
async function resetKnoxForMissingDeptCode() {
  try {
    const result = await prisma.user.updateMany({
      where: {
        knoxVerified: true,
        departmentCode: null,
      },
      data: { knoxVerified: false },
    });
    if (result.count > 0) {
      console.log(`[Backfill] Reset Knox verification for ${result.count} user(s) without departmentCode — will re-verify on next request`);
    }
  } catch (error) {
    console.error('[Backfill] Failed to reset Knox verifications:', error);
  }
}

/**
 * 기존 서비스의 영문 조직 계층 정보 자동 채움
 * registeredBy 사용자의 부서코드로 Knox Organization API 호출
 */
async function backfillServiceHierarchy() {
  try {
    // team이 비어있는 서비스 목록
    const services = await prisma.service.findMany({
      where: {
        team: null,
        registeredBy: { not: null },
      },
      select: {
        id: true,
        name: true,
        registeredBy: true,
        registeredByDept: true,
      },
    });

    if (services.length === 0) return;
    console.log(`[Backfill] Found ${services.length} service(s) without team hierarchy — backfilling...`);

    for (const svc of services) {
      try {
        if (!svc.registeredBy) continue;

        // 1. 사용자 DB에서 departmentCode 조회
        const user = await prisma.user.findUnique({ where: { loginid: svc.registeredBy } });

        let departmentCode = user?.departmentCode || '';
        let enDeptName = user?.enDeptName || '';
        let deptName = svc.registeredByDept || '';

        // 2. departmentCode가 없으면 Knox Employee API로 조회
        if (!departmentCode) {
          const employee = await lookupEmployee(svc.registeredBy);
          if (employee) {
            departmentCode = employee.departmentCode;
            enDeptName = employee.enDepartmentName;
            deptName = employee.departmentName || deptName;

            // 사용자 DB 업데이트
            if (user) {
              await prisma.user.update({
                where: { id: user.id },
                data: {
                  departmentCode: employee.departmentCode,
                  enDeptName: employee.enDepartmentName,
                },
              });
            }
          }
        }

        if (!departmentCode) {
          console.log(`[Backfill] Skipping service "${svc.name}" — no departmentCode for ${svc.registeredBy}`);
          continue;
        }

        // 3. 조직 계층 조회 (캐시 또는 API)
        const hierarchy = await getDepartmentHierarchy(departmentCode, deptName, enDeptName);

        if (hierarchy) {
          await prisma.service.update({
            where: { id: svc.id },
            data: {
              team: hierarchy.team || null,
              center2Name: hierarchy.center2Name || null,
              center1Name: hierarchy.center1Name || null,
            },
          });
          console.log(`[Backfill] Updated service "${svc.name}": team="${hierarchy.team}", center2="${hierarchy.center2Name}", center1="${hierarchy.center1Name}"`);
        }
      } catch (err) {
        console.error(`[Backfill] Failed to backfill service "${svc.name}":`, err);
      }
    }
  } catch (error) {
    console.error('[Backfill] Failed to backfill service hierarchy:', error);
  }
}

// Start server
async function main() {
  try {
    await prisma.$connect();
    console.log('Database connected');

    await redis.ping();
    console.log('Redis connected');

    // 빈 visibilityScope 자동 보정 (기존 모델 대상)
    await backfillEmptyVisibilityScope();

    // departmentCode 미수집 사용자 Knox 인증 리셋 (DB 쿼리만, 빠름)
    await resetKnoxForMissingDeptCode();

    // 만료 이미지 자동 삭제 (1시간마다)
    startImageCleanupCron();

    // health_check_logs의 model_name 스냅샷을 현재 displayName으로 일괄 갱신
    await syncHealthCheckModelNames();

    // LLM 헬스체크 (10분마다)
    startHealthCheckCron();
    startAiEstimationCron();

    const server = app.listen(PORT, () => {
      console.log(`Agent Registry API server running on port ${PORT}`);

      // 서비스 조직 계층 backfill — 서버 시작 후 비동기 실행
      // (Knox API 호출이 느릴 수 있으므로 헬스체크 타임아웃 방지)
      backfillServiceHierarchy().catch(err =>
        console.error('[Backfill] Service hierarchy backfill failed:', err)
      );
    });
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
