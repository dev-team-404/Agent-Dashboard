/**
 * Mock SSO Server
 * 삼성 SSO를 시뮬레이션하는 개발용 인증 서버
 * form_post response mode를 포함한 실제 SSO와 동일한 흐름 구현
 */
import { Router, Request, Response } from 'express';
import { createMockIdToken, verifyToken, decodeToken, decodeSsoToken } from '../utils/jwt.js';

const router = Router();

// ============================================
// Mock 사용자 데이터베이스
// ============================================
const MOCK_USERS: Record<string, {
  loginid: string; username: string; mail: string;
  deptid: string; deptname: string; deptname_en: string; role: string;
  avatar: string; color: string;
}> = {
  dev1: {
    loginid: 'syngha.han', username: '한승하', mail: 'syngha.han@samsung.com',
    deptid: 'sw_innovation', deptname: 'S/W혁신팀(S.LSI)', deptname_en: 'SW Innovation Team',
    role: 'SUPER_ADMIN', avatar: 'SH', color: '#6366f1',
  },
  dev2: {
    loginid: 'young87.kim', username: '김영섭', mail: 'young87.kim@samsung.com',
    deptid: 'sw_innovation', deptname: 'S/W혁신팀(S.LSI)', deptname_en: 'SW Innovation Team',
    role: 'SUPER_ADMIN', avatar: 'YK', color: '#8b5cf6',
  },
  dev3: {
    loginid: 'byeongju.lee', username: '이병주', mail: 'byeongju.lee@samsung.com',
    deptid: 'sw_innovation', deptname: 'S/W혁신팀(S.LSI)', deptname_en: 'SW Innovation Team',
    role: 'SUPER_ADMIN', avatar: 'BL', color: '#a855f7',
  },
  dev4: {
    loginid: 'junhyung.ahn', username: '안준형', mail: 'junhyung.ahn@samsung.com',
    deptid: 'sw_innovation', deptname: 'S/W혁신팀(S.LSI)', deptname_en: 'SW Innovation Team',
    role: 'ADMIN', avatar: 'JA', color: '#ec4899',
  },
  user1: {
    loginid: 'test.user', username: '테스트사원', mail: 'test.user@samsung.com',
    deptid: 'qa_team', deptname: 'QA팀(S.LSI)', deptname_en: 'QA Team',
    role: 'USER', avatar: 'TU', color: '#14b8a6',
  },
  user2: {
    loginid: 'demo.viewer', username: '데모뷰어', mail: 'demo.viewer@samsung.com',
    deptid: 'design', deptname: '디자인팀(MX)', deptname_en: 'Design Team',
    role: 'USER', avatar: 'DV', color: '#f59e0b',
  },
  pending: {
    loginid: 'new.employee', username: '신입사원', mail: 'new.employee@samsung.com',
    deptid: 'new_dept', deptname: '신규부서', deptname_en: 'New Department',
    role: 'PENDING', avatar: 'NE', color: '#94a3b8',
  },
};

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SUPER_ADMIN: { label: 'Super Admin', color: '#dc2626', bg: '#fef2f2' },
  ADMIN: { label: 'Admin', color: '#9333ea', bg: '#faf5ff' },
  USER: { label: 'User', color: '#0d9488', bg: '#f0fdfa' },
  PENDING: { label: 'Pending', color: '#64748b', bg: '#f8fafc' },
};

// ============================================
// 로그인 페이지 UI
// ============================================
router.get('/login', (req: Request, res: Response) => {
  const redirectUri = req.query['redirect_uri'] as string;
  const clientId = req.query['client_id'] as string || '';
  const state = req.query['state'] as string || '';
  const nonce = req.query['nonce'] as string || '';

  if (!redirectUri) {
    res.status(400).json({ error: 'redirect_uri is required' });
    return;
  }

  const userCards = Object.entries(MOCK_USERS).map(([key, u]) => {
    const rc = ROLE_CONFIG[u.role] || ROLE_CONFIG['USER'];
    return `
      <button class="user-card" onclick="selectUser('${key}')" title="${u.mail}">
        <div class="avatar" style="background:${u.color}">${u.avatar}</div>
        <div class="info">
          <div class="name">${u.username} <span class="loginid">${u.loginid}</span></div>
          <div class="dept">${u.deptname}</div>
        </div>
        <span class="role-badge" style="color:${rc.color};background:${rc.bg}">${rc.label}</span>
      </button>`;
  }).join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Samsung SSO - Mock Login</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .container{width:100%;max-width:560px}
    .header{text-align:center;margin-bottom:32px}
    .logo{display:inline-flex;align-items:center;gap:12px;margin-bottom:16px}
    .logo-icon{width:48px;height:48px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;display:flex;align-items:center;justify-content:center}
    .logo-icon svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .logo-text{font-size:24px;font-weight:800;color:#f8fafc;letter-spacing:-0.5px}
    .logo-text span{color:#818cf8}
    .subtitle{font-size:13px;color:#64748b;margin-top:4px}
    .dev-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#1e293b;border:1px solid #334155;border-radius:20px;font-size:11px;color:#fbbf24;margin-top:12px}
    .dev-badge::before{content:'';width:6px;height:6px;background:#fbbf24;border-radius:50%;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .card{background:#1e293b;border:1px solid #334155;border-radius:16px;overflow:hidden}
    .card-header{padding:20px 24px 16px;border-bottom:1px solid #334155/50}
    .card-header h2{font-size:15px;font-weight:700;color:#f1f5f9}
    .card-header p{font-size:12px;color:#64748b;margin-top:4px}
    .users-list{padding:8px}
    .user-card{width:100%;display:flex;align-items:center;gap:14px;padding:12px 16px;background:transparent;border:1px solid transparent;
               border-radius:12px;cursor:pointer;transition:all .2s;text-align:left;color:inherit;font-family:inherit;font-size:inherit}
    .user-card:hover{background:#334155/60;border-color:#475569}
    .user-card:active{transform:scale(.98)}
    .avatar{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0}
    .info{flex:1;min-width:0}
    .name{font-size:14px;font-weight:600;color:#f1f5f9}
    .loginid{font-size:12px;color:#64748b;font-weight:400;margin-left:6px}
    .dept{font-size:12px;color:#94a3b8;margin-top:2px}
    .role-badge{font-size:10px;font-weight:700;padding:4px 10px;border-radius:6px;flex-shrink:0;text-transform:uppercase;letter-spacing:.5px}
    .divider{height:1px;background:#334155;margin:0 24px}
    .custom-section{padding:20px 24px}
    .custom-section h3{font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:14px;display:flex;align-items:center;gap:8px}
    .custom-section h3::before{content:'';width:16px;height:2px;background:#6366f1;border-radius:1px}
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .form-grid .full{grid-column:1/-1}
    .input{width:100%;padding:10px 14px;background:#0f172a;border:1px solid #334155;border-radius:10px;color:#e2e8f0;font-size:13px;
           font-family:inherit;transition:border-color .2s;outline:none}
    .input::placeholder{color:#475569}
    .input:focus{border-color:#6366f1}
    .btn{padding:10px 20px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:10px;font-size:13px;
         font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
    .btn:hover{filter:brightness(1.1);transform:translateY(-1px)}
    .btn:active{transform:translateY(0)}
    .meta{text-align:center;margin-top:20px;font-size:11px;color:#475569}
    .meta code{background:#1e293b;padding:2px 8px;border-radius:4px;font-size:10px;color:#818cf8}
    .redirect-info{margin-top:8px;padding:10px 16px;background:#1e293b;border-radius:8px;font-size:11px;color:#64748b;word-break:break-all}
    .redirect-info strong{color:#94a3b8}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </div>
        <div>
          <div class="logo-text"><span>Samsung</span> SSO</div>
          <div class="subtitle">Enterprise Single Sign-On</div>
        </div>
      </div>
      <div class="dev-badge">Development Mode — Mock Authentication</div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Select Account</h2>
        <p>사용할 계정을 선택하세요. 실제 SSO에서는 삼성 계정으로 인증됩니다.</p>
      </div>

      <div class="users-list">
        ${userCards}
      </div>

      <div class="divider"></div>

      <div class="custom-section">
        <h3>Custom Account</h3>
        <div class="form-grid">
          <input class="input" id="c-loginid" placeholder="Login ID *" />
          <input class="input" id="c-username" placeholder="이름 *" />
          <input class="input" id="c-mail" placeholder="Email *" />
          <input class="input" id="c-dept" placeholder="부서명" />
          <div class="full" style="display:flex;gap:10px">
            <select class="input" id="c-role" style="flex:1">
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
            <button class="btn" onclick="customLogin()">Login</button>
          </div>
        </div>
      </div>
    </div>

    <div class="redirect-info">
      <strong>Callback:</strong> ${redirectUri}
      ${clientId ? `<br><strong>Client:</strong> ${clientId}` : ''}
    </div>
    <div class="meta">Mock SSO v1.0 &middot; Port 9999 &middot; <code>HS256</code></div>
  </div>

  <script>
    const params = {
      redirect_uri: ${JSON.stringify(redirectUri)},
      state: ${JSON.stringify(state)},
      nonce: ${JSON.stringify(nonce)},
      client_id: ${JSON.stringify(clientId)},
    };

    function selectUser(key) {
      const qs = new URLSearchParams({ ...params, user: key });
      window.location.href = '/mock-sso/do-login?' + qs.toString();
    }

    function customLogin() {
      const loginid = document.getElementById('c-loginid').value.trim();
      const username = document.getElementById('c-username').value.trim();
      const mail = document.getElementById('c-mail').value.trim();
      if (!loginid || !username || !mail) { alert('Login ID, 이름, Email은 필수입니다.'); return; }

      const qs = new URLSearchParams({
        ...params,
        custom_loginid: loginid,
        custom_username: username,
        custom_mail: mail,
        custom_dept: document.getElementById('c-dept').value.trim() || '커스텀팀',
        custom_role: document.getElementById('c-role').value,
      });
      window.location.href = '/mock-sso/do-login?' + qs.toString();
    }
  </script>
</body>
</html>`);
});

// ============================================
// 로그인 처리 → form_post 응답
// ============================================
router.get('/do-login', (req: Request, res: Response) => {
  const redirectUri = req.query['redirect_uri'] as string;
  const state = req.query['state'] as string || '';
  const userKey = req.query['user'] as string;

  let userData: typeof MOCK_USERS[string];

  if (req.query['custom_loginid']) {
    userData = {
      loginid: req.query['custom_loginid'] as string,
      username: req.query['custom_username'] as string || 'Custom User',
      mail: req.query['custom_mail'] as string || '',
      deptid: (req.query['custom_dept'] as string || 'custom').toLowerCase().replace(/\s+/g, '_'),
      deptname: req.query['custom_dept'] as string || '커스텀팀',
      deptname_en: req.query['custom_dept'] as string || 'Custom Team',
      role: req.query['custom_role'] as string || 'USER',
      avatar: 'CU', color: '#6b7280',
    };
  } else {
    userData = MOCK_USERS[userKey || 'dev1'] || MOCK_USERS['dev1']!;
  }

  const { avatar: _a, color: _c, ...tokenData } = userData;
  const idToken = createMockIdToken(tokenData);

  console.log(`[Mock SSO] Login: ${userData.loginid} (${userData.username}) → ${redirectUri}`);

  // form_post response mode — 실제 삼성 SSO와 동일한 방식
  res.type('html').send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Authenticating...</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Pretendard',-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;
         min-height:100vh;display:flex;align-items:center;justify-content:center}
    .wrap{text-align:center}
    .spinner{width:48px;height:48px;border:3px solid #334155;border-top-color:#818cf8;border-radius:50%;
             animation:spin .8s linear infinite;margin:0 auto 20px}
    @keyframes spin{to{transform:rotate(360deg)}}
    h2{font-size:18px;font-weight:700;margin-bottom:6px}
    p{font-size:13px;color:#64748b}
    .user{margin-top:16px;padding:12px 24px;background:#1e293b;border-radius:12px;display:inline-flex;align-items:center;gap:12px}
    .user-avatar{width:36px;height:36px;background:${userData.color || '#6366f1'};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff}
    .user-info{text-align:left}
    .user-name{font-size:14px;font-weight:600}
    .user-dept{font-size:11px;color:#64748b}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="spinner"></div>
    <h2>Authentication Successful</h2>
    <p>Redirecting to application...</p>
    <div class="user">
      <div class="user-avatar">${userData.avatar}</div>
      <div class="user-info">
        <div class="user-name">${userData.username} (${userData.loginid})</div>
        <div class="user-dept">${userData.deptname}</div>
      </div>
    </div>
  </div>

  <!-- form_post: 실제 삼성 SSO와 동일한 방식으로 id_token 전달 -->
  <form id="ssoForm" method="POST" action="${redirectUri}">
    <input type="hidden" name="id_token" value="${idToken}" />
    <input type="hidden" name="code" value="mock-auth-code-${Date.now()}" />
    ${state ? `<input type="hidden" name="state" value="${state}" />` : ''}
  </form>

  <script>
    setTimeout(function() { document.getElementById('ssoForm').submit(); }, 800);
  </script>
</body>
</html>`);
});

// ============================================
// 사용자 목록 API
// ============================================
router.get('/users', (_req: Request, res: Response) => {
  const users = Object.entries(MOCK_USERS).map(([key, u]) => ({
    key, loginid: u.loginid, username: u.username, department: u.deptname, role: u.role,
  }));
  res.json({ users });
});

// ============================================
// 토큰 검증 API (디버그용)
// ============================================
router.get('/verify', (req: Request, res: Response) => {
  const token = req.query['token'] as string;
  if (!token) { res.status(400).json({ error: 'token parameter required' }); return; }

  const payload = verifyToken(token);
  if (payload) {
    res.json({ valid: true, payload });
  } else {
    const decoded = decodeToken(token);
    res.json({ valid: false, error: 'Signature verification failed', decoded });
  }
});

// ============================================
// 로그아웃 (mock)
// ============================================
router.get('/logout', (req: Request, res: Response) => {
  const redirectUri = req.query['redirect_uri'] as string;
  if (redirectUri) {
    res.redirect(redirectUri);
  } else {
    res.json({ message: 'Logged out (mock)' });
  }
});

// ============================================
// 헬스체크
// ============================================
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'mock-sso', users: Object.keys(MOCK_USERS).length });
});

export { router as mockSsoRouter, MOCK_USERS };
