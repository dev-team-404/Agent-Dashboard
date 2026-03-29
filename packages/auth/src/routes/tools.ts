/**
 * 토큰 디코딩 & 디버그 도구
 * 브라우저 UI + API 제공
 */
import { Router, Request, Response } from 'express';
import { verifyToken, decodeToken, decodeSsoToken } from '../utils/jwt.js';

const router = Router();

// ============================================
// 토큰 디코더 웹 UI
// ============================================
router.get('/decode', (_req: Request, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Token Decoder - Agent Platform</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'SF Mono',monospace,sans-serif;
         background:#0f172a;color:#e2e8f0;min-height:100vh;padding:32px}
    .container{max-width:900px;margin:0 auto}
    h1{font-size:22px;font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:10px}
    h1 span{color:#818cf8}
    .sub{font-size:13px;color:#64748b;margin-bottom:28px}
    .tabs{display:flex;gap:8px;margin-bottom:20px}
    .tab{padding:8px 16px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#94a3b8;
         font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
    .tab.active{background:#6366f1;border-color:#6366f1;color:#fff}
    .tab:hover:not(.active){border-color:#6366f1;color:#c7d2fe}
    .input-area{position:relative;margin-bottom:20px}
    textarea{width:100%;height:120px;padding:16px;background:#1e293b;border:1px solid #334155;border-radius:12px;
             color:#e2e8f0;font-family:'SF Mono',monospace;font-size:13px;resize:vertical;outline:none;transition:border-color .2s}
    textarea:focus{border-color:#6366f1}
    textarea::placeholder{color:#475569}
    .btn-row{display:flex;gap:10px;margin-bottom:20px}
    .btn{padding:10px 24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:10px;
         font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
    .btn:hover{filter:brightness(1.1)}
    .btn-outline{background:transparent;border:1px solid #334155;color:#94a3b8}
    .btn-outline:hover{border-color:#6366f1;color:#c7d2fe;filter:none}
    .result{background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden}
    .result-header{padding:14px 20px;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between}
    .result-header h3{font-size:13px;font-weight:700;color:#f1f5f9}
    .status{font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px}
    .status.valid{color:#10b981;background:#064e3b}
    .status.invalid{color:#ef4444;background:#450a0a}
    .status.decoded{color:#f59e0b;background:#451a03}
    .result-body{padding:20px}
    pre{font-family:'SF Mono',monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-all;color:#cbd5e1}
    pre .key{color:#818cf8}
    pre .str{color:#34d399}
    pre .num{color:#fbbf24}
    pre .bool{color:#f472b6}
    pre .null{color:#64748b}
    .parts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px}
    .part{padding:14px;background:#1e293b;border:1px solid #334155;border-radius:10px}
    .part-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .part-label.header{color:#f472b6}
    .part-label.payload{color:#818cf8}
    .part-label.signature{color:#34d399}
    .part-value{font-family:'SF Mono',monospace;font-size:11px;color:#94a3b8;word-break:break-all;max-height:60px;overflow:auto}
    .hidden{display:none}
    .examples{margin-top:24px;padding:20px;background:#1e293b;border:1px solid #334155;border-radius:12px}
    .examples h3{font-size:13px;font-weight:700;margin-bottom:12px;color:#94a3b8}
    .example{padding:8px 14px;background:#0f172a;border-radius:8px;font-family:'SF Mono',monospace;font-size:11px;color:#64748b;
             margin-bottom:8px;cursor:pointer;transition:all .2s;border:1px solid transparent}
    .example:hover{border-color:#334155;color:#94a3b8}
    .example strong{color:#818cf8}
  </style>
</head>
<body>
  <div class="container">
    <h1><span>Token</span> Decoder</h1>
    <p class="sub">JWT, SSO Token(sso.xxx), Base64 토큰을 디코딩합니다</p>

    <div class="tabs">
      <div class="tab active" data-mode="auto">Auto Detect</div>
      <div class="tab" data-mode="jwt">JWT</div>
      <div class="tab" data-mode="sso">SSO (sso.xxx)</div>
      <div class="tab" data-mode="base64">Base64</div>
    </div>

    <div class="input-area">
      <textarea id="tokenInput" placeholder="토큰을 붙여넣으세요...&#10;JWT: eyJhbGciOiJIUzI1NiIs...&#10;SSO: sso.eyJsb2dpbmlkIjoi...&#10;Base64: eyJsb2dpbmlkIjoi..."></textarea>
    </div>

    <div class="btn-row">
      <button class="btn" onclick="decode()">Decode</button>
      <button class="btn btn-outline" onclick="document.getElementById('tokenInput').value='';document.getElementById('result').classList.add('hidden')">Clear</button>
    </div>

    <div id="jwtParts" class="parts hidden">
      <div class="part"><div class="part-label header">Header</div><div class="part-value" id="partHeader"></div></div>
      <div class="part"><div class="part-label payload">Payload</div><div class="part-value" id="partPayload"></div></div>
      <div class="part"><div class="part-label signature">Signature</div><div class="part-value" id="partSignature"></div></div>
    </div>

    <div id="result" class="result hidden">
      <div class="result-header">
        <h3 id="resultTitle">Decoded</h3>
        <span id="resultStatus" class="status decoded">decoded</span>
      </div>
      <div class="result-body">
        <pre id="resultBody"></pre>
      </div>
    </div>

    <div class="examples">
      <h3>Examples (click to load)</h3>
      <div class="example" onclick="loadExample('jwt')"><strong>JWT:</strong> eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...</div>
      <div class="example" onclick="loadExample('sso')"><strong>SSO:</strong> sso.eyJsb2dpbmlkIjoic3luZ2hhLmhhbiIs...</div>
    </div>
  </div>

  <script>
    let mode = 'auto';
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      mode = t.dataset.mode;
    }));

    function syntaxHighlight(json) {
      return JSON.stringify(json, null, 2)
        .replace(/(".*?"):/g, '<span class="key">$1</span>:')
        .replace(/: (".*?")/g, ': <span class="str">$1</span>')
        .replace(/: (\\d+\\.?\\d*)/g, ': <span class="num">$1</span>')
        .replace(/: (true|false)/g, ': <span class="bool">$1</span>')
        .replace(/: (null)/g, ': <span class="null">$1</span>');
    }

    async function decode() {
      const token = document.getElementById('tokenInput').value.trim();
      if (!token) return;

      try {
        const resp = await fetch('/tools/decode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, mode }),
        });
        const data = await resp.json();

        document.getElementById('result').classList.remove('hidden');
        document.getElementById('resultTitle').textContent = data.type + ' Token';
        const st = document.getElementById('resultStatus');
        if (data.verified) { st.textContent = 'verified'; st.className = 'status valid'; }
        else if (data.error) { st.textContent = 'invalid'; st.className = 'status invalid'; }
        else { st.textContent = 'decoded'; st.className = 'status decoded'; }

        document.getElementById('resultBody').innerHTML = syntaxHighlight(data.payload || data);

        if (data.type === 'JWT' && data.parts) {
          document.getElementById('jwtParts').classList.remove('hidden');
          document.getElementById('partHeader').textContent = JSON.stringify(data.parts.header);
          document.getElementById('partPayload').textContent = token.split('.')[1]?.substring(0, 80) + '...';
          document.getElementById('partSignature').textContent = token.split('.')[2]?.substring(0, 40) + '...';
        } else {
          document.getElementById('jwtParts').classList.add('hidden');
        }
      } catch (e) {
        document.getElementById('result').classList.remove('hidden');
        document.getElementById('resultBody').textContent = 'Error: ' + e.message;
      }
    }

    function loadExample(type) {
      if (type === 'jwt') {
        fetch('/mock-sso/do-login?redirect_uri=/tools/decode&user=dev1', { redirect: 'manual' });
        document.getElementById('tokenInput').value = 'Generating... Click Decode after pasting a real token.';
      } else {
        const json = JSON.stringify({loginid:'syngha.han',username:'한승하',deptname:'S/W혁신팀(S.LSI)',timestamp:Date.now()});
        const b64 = btoa(unescape(encodeURIComponent(json)));
        document.getElementById('tokenInput').value = 'sso.' + b64;
        decode();
      }
    }

    document.getElementById('tokenInput').addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') decode(); });
  </script>
</body>
</html>`);
});

// ============================================
// 토큰 디코딩 API
// ============================================
router.post('/decode', (req: Request, res: Response) => {
  const { token, mode = 'auto' } = req.body;
  if (!token) { res.status(400).json({ error: 'token is required' }); return; }

  const detectedMode = mode === 'auto' ? detectTokenType(token) : mode;

  switch (detectedMode) {
    case 'sso': {
      const base64Part = token.startsWith('sso.') ? token.substring(4) : token;
      const payload = decodeSsoToken(base64Part);
      res.json({ type: 'SSO (Base64)', payload, verified: false, note: 'SSO tokens have no signature' });
      break;
    }
    case 'jwt': {
      const verified = verifyToken(token);
      if (verified) {
        const parts = token.split('.');
        const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
        res.json({ type: 'JWT', payload: verified, verified: true, parts: { header } });
      } else {
        const decoded = decodeToken(token);
        if (decoded) {
          const parts = token.split('.');
          const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
          res.json({ type: 'JWT', payload: decoded, verified: false, error: 'Signature mismatch', parts: { header } });
        } else {
          res.json({ type: 'JWT', error: 'Failed to decode token' });
        }
      }
      break;
    }
    case 'base64': {
      try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        res.json({ type: 'Base64 JSON', payload: decoded, verified: false });
      } catch {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        res.json({ type: 'Base64 String', payload: { raw: decoded }, verified: false });
      }
      break;
    }
    default:
      res.status(400).json({ error: 'Unknown token format' });
  }
});

function detectTokenType(token: string): string {
  if (token.startsWith('sso.')) return 'sso';
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
      return 'jwt';
    } catch { /* not jwt */ }
  }
  return 'base64';
}

export { router as toolsRouter };
