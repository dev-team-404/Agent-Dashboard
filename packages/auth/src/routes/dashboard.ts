/**
 * Auth Server 관리 대시보드 UI
 * 서버 상태, 로그인 기록, 토큰 정보 확인
 */
import { Router, Request, Response } from 'express';
import { config } from '../config.js';

const router = Router();

// 로그인 기록 (메모리, 최근 100건)
interface LoginRecord {
  timestamp: string;
  loginid: string;
  username: string;
  deptname: string;
  clientId: string;
  ip: string;
  method: string; // 'oidc' | 'mock-sso'
}

const loginHistory: LoginRecord[] = [];
const MAX_HISTORY = 100;

/** 로그인 기록 추가 (oidc.ts에서 호출) */
export function recordLogin(record: Omit<LoginRecord, 'timestamp'>) {
  loginHistory.unshift({ ...record, timestamp: new Date().toISOString() });
  if (loginHistory.length > MAX_HISTORY) loginHistory.pop();
}

/** 대시보드 UI */
router.get('/', (_req: Request, res: Response) => {
  const uptime = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const uptimeStr = `${h}h ${m}m`;

  const recentLogins = loginHistory.slice(0, 20);

  res.type('html').send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Auth Server Dashboard</title>
  <meta http-equiv="refresh" content="30">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Pretendard',-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:24px}
    .container{max-width:1100px;margin:0 auto}
    h1{font-size:22px;font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:10px}
    h1 span{color:#818cf8}
    .sub{font-size:12px;color:#64748b;margin-bottom:24px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
    .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}
    .card-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:6px}
    .card-value{font-size:22px;font-weight:800;color:#f1f5f9}
    .card-value.ok{color:#10b981}
    .card-value.warn{color:#f59e0b}
    .card-value.err{color:#ef4444}
    .card-sub{font-size:11px;color:#475569;margin-top:4px}
    .section{background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;margin-bottom:20px}
    .section-header{padding:14px 20px;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between}
    .section-header h2{font-size:14px;font-weight:700}
    .section-header span{font-size:11px;color:#64748b}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{text-align:left;padding:10px 16px;color:#64748b;font-weight:600;border-bottom:1px solid #334155;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    td{padding:10px 16px;border-bottom:1px solid #334155/30;color:#cbd5e1}
    tr:hover td{background:#334155/20}
    .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700}
    .badge-oidc{background:#312e81;color:#818cf8}
    .badge-mock{background:#422006;color:#fbbf24}
    .mono{font-family:'SF Mono',monospace;font-size:11px;color:#94a3b8}
    .empty{text-align:center;padding:40px;color:#475569;font-size:13px}
    .json-box{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:'SF Mono',monospace;font-size:11px;color:#94a3b8;max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:12px 16px 16px}
    .links{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
    .link{padding:6px 14px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#818cf8;text-decoration:none;font-size:11px;font-weight:600;transition:all .2s}
    .link:hover{border-color:#818cf8;background:#312e81}
  </style>
</head>
<body>
  <div class="container">
    <h1><span>Auth</span> Server Dashboard</h1>
    <p class="sub">OIDC Provider 상태 모니터링 · 30초마다 자동 갱신</p>

    <div class="links">
      <a class="link" href="/.well-known/openid-configuration" target="_blank">OIDC Discovery</a>
      <a class="link" href="/tools/decode" target="_blank">Token Decoder</a>
      <a class="link" href="/health" target="_blank">Health Check</a>
      ${config.mockSso.enabled ? `<a class="link" href="http://${_req.hostname}:${config.mockSsoPort}/mock-sso/login?redirect_uri=https://${_req.hostname}:${config.authPort}/oidc/sso-callback" target="_blank">Mock SSO Login</a>` : ''}
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">Status</div>
        <div class="card-value ok">Healthy</div>
        <div class="card-sub">Uptime: ${uptimeStr}</div>
      </div>
      <div class="card">
        <div class="card-label">SSL</div>
        <div class="card-value ${config.ssl.enabled ? 'ok' : 'warn'}">${config.ssl.enabled ? 'HTTPS' : 'HTTP'}</div>
        <div class="card-sub">Port ${config.authPort}</div>
      </div>
      <div class="card">
        <div class="card-label">SSO Mode</div>
        <div class="card-value ${config.mockSso.enabled ? 'warn' : 'ok'}">${config.mockSso.enabled ? 'Mock' : 'Real SSO'}</div>
        <div class="card-sub">${config.mockSso.enabled ? 'Mock SSO :' + config.mockSsoPort : config.sso.idpEntityId?.substring(0, 30) || 'N/A'}</div>
      </div>
      <div class="card">
        <div class="card-label">Total Logins</div>
        <div class="card-value">${loginHistory.length}</div>
        <div class="card-sub">최근 ${MAX_HISTORY}건 보관</div>
      </div>
      <div class="card">
        <div class="card-label">OIDC Issuer</div>
        <div class="card-value" style="font-size:13px;word-break:break-all">${config.oidc.issuer}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>최근 로그인</h2>
        <span>${recentLogins.length}건</span>
      </div>
      ${recentLogins.length === 0
        ? '<div class="empty">아직 로그인 기록이 없습니다</div>'
        : `<table>
          <thead><tr><th>시각</th><th>Login ID</th><th>이름</th><th>부서</th><th>Client</th><th>Method</th></tr></thead>
          <tbody>
          ${recentLogins.map(r => `
            <tr>
              <td class="mono">${r.timestamp.replace('T', ' ').substring(0, 19)}</td>
              <td style="color:#818cf8;font-weight:600">${esc(r.loginid)}</td>
              <td>${esc(r.username)}</td>
              <td style="color:#94a3b8">${esc(r.deptname)}</td>
              <td class="mono">${esc(r.clientId)}</td>
              <td><span class="badge ${r.method === 'mock-sso' ? 'badge-mock' : 'badge-oidc'}">${r.method}</span></td>
            </tr>
          `).join('')}
          </tbody>
        </table>`
      }
    </div>

    <div class="section">
      <div class="section-header">
        <h2>서버 설정 (Raw JSON)</h2>
      </div>
      <div class="json-box">${esc(JSON.stringify({
        issuer: config.oidc.issuer,
        authPort: config.authPort,
        mockSsoEnabled: config.mockSso.enabled,
        mockSsoPort: config.mockSsoPort,
        sslEnabled: config.ssl.enabled,
        ssoEnabled: config.sso.enabled,
        ssoClientId: config.sso.clientId,
        idpEntityId: config.sso.idpEntityId,
        ssoResponseMode: config.sso.responseMode,
      }, null, 2))}</div>
    </div>
  </div>
</body>
</html>`);
});

/** 로그인 기록 API (JSON) */
router.get('/api/logins', (_req: Request, res: Response) => {
  res.json({ total: loginHistory.length, records: loginHistory });
});

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { router as dashboardRouter };
