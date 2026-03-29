# Samsung DS SSO 인증 스펙 문서

> 이 문서는 Agent Dashboard 플랫폼의 SSO 인증 체계를 기록합니다.
> 현재 구현(genai 경유)과 목표 구현(직통 SSO + OIDC Provider)을 모두 포함합니다.

---

## 1. 현재 구현: genai.samsungds.net 경유 방식

### 흐름

```
1. 브라우저 → https://genai.samsungds.net:36810/direct_sso?redirect_url={콜백URL}
2. genai 서버 → 실제 삼성 SSO 서버로 리다이렉트 (내부 처리)
3. 사용자 → 삼성 계정으로 인증
4. 삼성 SSO → genai 서버로 인증 결과 전달
5. genai 서버 → 콜백URL?data={URL인코딩된 JSON} 으로 리다이렉트
6. 프론트엔드 → data 파라미터에서 사용자 정보 추출
```

### 콜백 데이터 형식

```
URL: https://dashboard.example.com/?data=%7B%22loginid%22%3A%22syngha.han%22%2C...%7D

디코딩된 data:
{
  "loginid": "syngha.han",
  "username": "한승하",
  "deptname": "S/W혁신팀(S.LSI)"
}
```

### 특징
- **비표준 프로토콜**: OIDC/OAuth2가 아닌 자체 redirect 방식
- **평문 전달**: 사용자 정보가 URL 파라미터에 평문 JSON으로 노출
- **서명 없음**: 데이터 위변조 검증 불가
- **중간자 의존**: genai.samsungds.net 서버가 중간에서 relay 역할

### 현재 토큰 처리 (Agent Dashboard)

```
1. 프론트엔드가 data JSON을 Base64 인코딩
   → "sso." + btoa(encodeURIComponent(JSON))
   → 예: "sso.eyJsb2dpbmlkIjoic3luZ2hhLmhhbiIs..."

2. POST /auth/login, Authorization: Bearer sso.{base64}

3. 백엔드가 Base64 디코딩 → JSON 파싱 → loginid 추출

4. Knox API로 사원 확인 (최초 1회)
   → https://openapi.samsung.net/employee/api/v2.0
   → 재직 상태 B(재직) 또는 V(휴직) 확인

5. 내부 JWT 발급 (24시간 만료)
   → { loginid, deptname, username }
```

---

## 2. 실제 삼성 SSO 직통 연동 스펙

> A2A-Agent-Platform에서 구현했던 방식 기반

### SSO 파라미터

| 파라미터 | 값 | 설명 |
|---|---|---|
| `client_id` | `41211cae-1fda-49f7-a462-f01d51ed4b6d` | SSO 등록 시 발급받은 클라이언트 ID |
| `redirect_uri` | `https://{서버IP}:{PORT}/oidc/callback` | 인증 후 콜백 URL (**HTTPS 필수**) |
| `response_mode` | `form_post` | 응답 방식: HTML form 자동 submit |
| `response_type` | `code id_token` | 인증 코드 + ID 토큰 동시 수신 |
| `scope` | `openid profile` | 요청 범위 |
| `nonce` | UUID v4 | CSRF 방지용 일회성 값 |
| `client-request-id` | UUID v4 | 요청 추적용 |
| `pullStatus` | `0` | 고정값 |

### SSO 엔드포인트

```
인증 요청 (authorize):
  GET https://{IDP_ENTITY_ID}/?client_id={...}&redirect_uri={...}&response_mode=form_post&...

콜백 수신 (form_post):
  POST https://{redirect_uri}
  Content-Type: application/x-www-form-urlencoded
  Body: id_token={JWT}&code={AUTH_CODE}
```

### form_post 응답 방식

```
삼성 SSO가 인증 완료 후 브라우저에 HTML을 반환:

<html>
<body onload="document.forms[0].submit()">
  <form method="POST" action="https://{redirect_uri}">
    <input type="hidden" name="id_token" value="{JWT}" />
    <input type="hidden" name="code" value="{AUTH_CODE}" />
  </form>
</body>
</html>

→ 브라우저가 자동으로 form을 submit
→ redirect_uri로 POST 요청 (id_token이 body에 포함)
```

### ID Token (JWT) 구조

```json
{
  "loginid": "syngha.han",
  "username": "한승하",
  "mail": "syngha.han@samsung.com",
  "deptid": "ai_platform",
  "deptname": "AI 플랫폼팀",
  "deptname_en": "AI Platform Team",
  "role": "ADMIN",
  "iat": 1709000000,
  "exp": 1709003600,
  "iss": "samsung-sso",
  "aud": "41211cae-1fda-49f7-a462-f01d51ed4b6d"
}
```

### 토큰 검증

| 환경 | 알고리즘 | 검증 방식 |
|---|---|---|
| 개발 (Mock SSO) | HS256 | 공유 시크릿 키로 서명 검증 |
| 운영 (삼성 SSO) | RS256 | SSO 공개 인증서(`.cer`)로 서명 검증 |

```
인증서 파일 위치: /app/cert/sso.cer
형식: PEM 또는 DER (X.509)
용도: id_token의 RS256 서명 검증
```

---

## 3. 목표: OIDC Provider 구현

### 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  agent-platform-auth (:9050 HTTPS)                          │
│                                                             │
│  OIDC Provider (우리 서비스)                                  │
│  ├─ GET  /.well-known/openid-configuration                  │
│  ├─ GET  /oidc/authorize  → 삼성 SSO로 리다이렉트             │
│  ├─ POST /oidc/callback   → form_post로 id_token 수신        │
│  ├─ POST /oidc/token      → authorization code → JWT 교환    │
│  └─ GET  /oidc/userinfo   → 토큰으로 사용자 정보 조회          │
│                                                             │
│  Mock SSO (:9999, 개발 전용)                                 │
│  ├─ GET  /mock-sso/login  → 사용자 선택 UI                    │
│  ├─ GET  /mock-sso/do-login → form_post 응답                 │
│  └─ GET  /mock-sso/verify   → 토큰 검증 (디버그)              │
│                                                             │
│  디버그 도구                                                  │
│  ├─ GET  /tools/decode     → JWT/SSO 토큰 디코더 UI           │
│  └─ POST /tools/decode     → 토큰 디코딩 API                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### OIDC 인증 흐름 (전체)

```
1. 클라이언트(Open WebUI, Dashboard 등)
   → GET /oidc/authorize
     ?client_id=open-webui
     &redirect_uri=https://open-webui.com/callback
     &response_type=code
     &scope=openid profile
     &state=random123

2. OIDC Provider
   → 세션에 {client_id, redirect_uri, state} 저장
   → 삼성 SSO authorize URL로 리다이렉트

3. 삼성 SSO 인증 완료
   → form_post로 /oidc/callback에 id_token 전달

4. OIDC Provider
   → id_token 검증 (RS256 인증서)
   → authorization code 생성 (1회용, 5분 만료)
   → 클라이언트의 redirect_uri로 리다이렉트
     ?code=AUTH_CODE&state=random123

5. 클라이언트
   → POST /oidc/token
     code=AUTH_CODE
     client_id=open-webui
     client_secret=xxx
     grant_type=authorization_code
   → 응답: { access_token, id_token, token_type, expires_in }

6. 클라이언트
   → GET /oidc/userinfo
     Authorization: Bearer {access_token}
   → 응답: { sub, name, email, dept, ... }
```

### 리다이렉트 횟수 비교

```
현재 (genai 경유):
  브라우저 → genai → SSO → genai → 브라우저 → API   (5회)

직통 (목표):
  브라우저 → OIDC authorize → SSO → OIDC callback → 브라우저   (3회)
```

---

## 4. HTTPS 요구사항

### 삼성 SSO의 HTTPS 요구사항
- **redirect_uri는 반드시 HTTPS**여야 SSO 인증이 동작
- 자체 서명 인증서도 가능 (사내망)
- 인증서 파일: `.cer` (인증서), `.key` (개인키)

### 인증서 파일 구조

```
cert/
├── server.crt         # HTTPS 서버 인증서 (자체 서명 또는 사내 CA)
├── server.key         # HTTPS 서버 개인키
├── sso.cer            # 삼성 SSO 공개 인증서 (id_token RS256 검증용)
└── README.md          # 인증서 생성/교체 가이드
```

### 포트 계획

| 포트 | 프로토콜 | 용도 | 출처 |
|---|---|---|---|
| 9050 | HTTPS | OIDC Provider (Auth Server) | A2A 플랫폼 재사용 |
| 9999 | HTTP | Mock SSO (개발 전용) | A2A 플랫폼 재사용 |
| 8090 | HTTP | Agent Dashboard (기존 유지) | 기존 |

---

## 5. Mock SSO vs 실제 SSO 전환

```env
# 개발 환경 (.env)
ENABLE_MOCK_SSO=true
MOCK_SSO_URL=http://localhost:9999
SSO_JWT_ALGORITHM=HS256

# 운영 환경 (.env)
ENABLE_MOCK_SSO=false
SSO_ENABLED=true
SSO_CLIENT_ID=41211cae-1fda-49f7-a462-f01d51ed4b6d
IDP_ENTITY_ID=https://sso.samsung.com/oauth2/authorize
SSO_CERT_FILE=/app/cert/sso.cer
SSO_JWT_ALGORITHM=RS256
```

---

## 6. 연동 가이드 (서비스별)

### Agent Dashboard (우리 대시보드)
```
Login.tsx 수정:
  genai.samsungds.net 제거
  → /oidc/authorize로 리다이렉트
  → 콜백에서 code로 토큰 교환
```

### Open WebUI
```env
ENABLE_OAUTH_SIGNUP=true
OAUTH_PROVIDER_NAME=Agent Platform
OPENID_PROVIDER_URL=https://{서버IP}:9050/oidc
OAUTH_CLIENT_ID=open-webui
OAUTH_CLIENT_SECRET=xxx
```

### Google ADK (setup_auth)
```python
from agent_platform_auth import setup_auth
setup_auth(gateway_url="https://{서버IP}:9050")
# → 로컬 캐시 확인 → 없으면 브라우저 OIDC 로그인 → 토큰 캐시
```

---

## 부록: 토큰 디코딩 방법

### 1. 현재 SSO 토큰 (sso.xxx)
```javascript
const base64 = token.substring(4); // "sso." 제거
const binary = atob(base64);
const json = decodeURIComponent(
  binary.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
);
const payload = JSON.parse(json);
```

### 2. JWT 토큰
```javascript
const [header, payload, signature] = token.split('.');
const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
```

### 3. 디코더 도구
```
브라우저: https://{서버IP}:9050/tools/decode
CLI:      npx ts-node tools/decode-token.ts {토큰}
```
