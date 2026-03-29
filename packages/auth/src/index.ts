/**
 * Agent Platform Auth Server
 *
 * - Mock SSO Server (개발용, :9999)
 * - OIDC Provider + 토큰 디코더 (HTTPS, :9050)
 */
import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { mockSsoRouter } from './routes/mock-sso.js';
import { toolsRouter } from './routes/tools.js';
import { oidcRouter } from './routes/oidc.js';
import { dashboardRouter } from './routes/dashboard.js';

// ============================================
// Mock SSO Server (:9999) — 항상 HTTP
// ============================================
function startMockSso() {
  const app = express();
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/mock-sso', mockSsoRouter);

  // Root → redirect to login page with demo callback
  app.get('/', (_req, res) => {
    res.json({
      service: 'Mock SSO Server',
      version: '1.0.0',
      endpoints: {
        login: '/mock-sso/login?redirect_uri=https://localhost:9050/oidc/callback',
        users: '/mock-sso/users',
        verify: '/mock-sso/verify?token=xxx',
        health: '/mock-sso/health',
      },
    });
  });

  app.listen(config.mockSsoPort, '0.0.0.0', () => {
    console.log(`\x1b[35m[Mock SSO]\x1b[0m http://0.0.0.0:${config.mockSsoPort}`);
    console.log(`          Login UI: http://localhost:${config.mockSsoPort}/mock-sso/login?redirect_uri=https://localhost:${config.authPort}/oidc/callback`);
  });
}

// ============================================
// Auth Server (:9050) — HTTPS or HTTP
// ============================================
function startAuthServer() {
  const app = express();
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'agent-platform-auth',
      ssl: config.ssl.enabled,
      mockSso: config.mockSso.enabled,
    });
  });

  // 관리 대시보드 UI
  app.use('/dashboard', dashboardRouter);

  // 토큰 디코더 도구
  app.use('/tools', toolsRouter);

  // SDK 다운로드 엔드포인트
  app.get('/sdk/agent_platform_auth.py', (_req, res) => {
    const filePath = new URL('../tools/agent_platform_auth.py', import.meta.url).pathname;
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="agent_platform_auth.py"');
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.status(404).json({ error: 'SDK file not found' });
    }
  });

  // OIDC Provider (/.well-known/*, /oidc/*)
  app.use('/', oidcRouter);

  // Root
  app.get('/', (_req, res) => {
    res.json({
      service: 'Agent Platform Auth',
      version: '1.0.0',
      ssl: config.ssl.enabled,
      endpoints: {
        discovery: '/.well-known/openid-configuration',
        authorize: '/oidc/authorize',
        token: '/oidc/token',
        userinfo: '/oidc/userinfo',
        tokenDecoder: '/tools/decode',
        health: '/health',
      },
      mockSso: config.mockSso.enabled
        ? `http://localhost:${config.mockSsoPort}/mock-sso/login`
        : 'disabled',
    });
  });

  // Start server (HTTPS or HTTP)
  if (config.ssl.enabled && fs.existsSync(config.ssl.certFile) && fs.existsSync(config.ssl.keyFile)) {
    const sslOptions = {
      cert: fs.readFileSync(config.ssl.certFile),
      key: fs.readFileSync(config.ssl.keyFile),
    };
    https.createServer(sslOptions, app).listen(config.authPort, '0.0.0.0', () => {
      console.log(`\x1b[36m[Auth Server]\x1b[0m https://0.0.0.0:${config.authPort} (HTTPS)`);
      console.log(`              Decoder: https://localhost:${config.authPort}/tools/decode`);
    });
  } else {
    if (config.ssl.enabled) {
      console.warn('\x1b[33m[WARN]\x1b[0m SSL enabled but cert files not found. Run: npm run gen-cert');
      console.warn(`       Looking for: ${config.ssl.certFile}, ${config.ssl.keyFile}`);
    }
    http.createServer(app).listen(config.authPort, '0.0.0.0', () => {
      console.log(`\x1b[36m[Auth Server]\x1b[0m http://0.0.0.0:${config.authPort} (HTTP - no SSL)`);
      console.log(`              Decoder: http://localhost:${config.authPort}/tools/decode`);
    });
  }
}

// ============================================
// 시작
// ============================================
console.log('');
console.log('\x1b[1m  Agent Platform Auth Server\x1b[0m');
console.log('  ─────────────────────────────');

if (config.mockSso.enabled) {
  startMockSso();
}
startAuthServer();

console.log('');
console.log('\x1b[32m  Ready!\x1b[0m');
console.log('');
