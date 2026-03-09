/**
 * Agent Dashboard API Server (v2)
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
import { swaggerSpec, getSwaggerUiHtml } from './swagger.js';
import { requestLogger } from './middleware/requestLogger.js';

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
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

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

// LLM Proxy Routes (Header-based auth: x-service-id, x-user-id, x-dept-name)
app.use('/v1', proxyRoutes);

// Public Stats API (인증 불필요)
app.use('/api/public/stats', publicStatsRoutes);

// Swagger / OpenAPI documentation
app.get('/api-docs', (_req, res) => {
  res.json(swaggerSpec);
});
app.get('/api-docs/ui',
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        connectSrc: ["'self'", "https://unpkg.com"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  }),
  (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    // nginx가 /api/ prefix를 strip하므로, 브라우저에서는 /api/api-docs로 접근해야 함
    res.send(getSwaggerUiHtml('/api/api-docs'));
  },
);

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

// Start server
async function main() {
  try {
    await prisma.$connect();
    console.log('Database connected');

    await redis.ping();
    console.log('Redis connected');

    const server = app.listen(PORT, () => {
      console.log(`Agent Dashboard API server running on port ${PORT}`);
    });
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
