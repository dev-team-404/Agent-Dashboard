# OIDC 인증 개요

사용자별 사용량 추적이 필요한 서비스를 위한 OpenID Connect(OIDC) 인증 체계를 안내합니다.

## OIDC란?

OpenID Connect(OIDC)는 OAuth 2.0 위에 구축된 인증 프로토콜입니다. Agent Platform은 OIDC를 통해 **사용자 식별**과 **사용량 추적**을 자동화합니다.

기존 헤더 기반 인증(`x-service-id`, `x-user-id`)은 서비스 개발자가 직접 사용자 ID를 주입해야 합니다. OIDC를 사용하면 **사용자가 직접 로그인**하므로, 서비스 개발자가 사용자 ID를 관리할 필요 없이 자동으로 사용량이 추적됩니다.

### OIDC vs OAuth2 차이

| | OAuth2 | OIDC (OpenID Connect) |
|---|---|---|
| 목적 | **인가** (Authorization) — "이 앱이 내 데이터에 접근해도 되나?" | **인증** (Authentication) — "이 사람이 누구인가?" |
| 결과 | Access Token (API 호출 권한) | Access Token + **ID Token** (사용자 정보) |
| 사용자 정보 | 별도 API 호출 필요 | ID Token에 포함 (sub, name, email 등) |
| 표준 | RFC 6749 | OAuth2 위에 구축된 확장 표준 |
| 예시 | "GitHub에 내 레포 목록 조회 허용" | "GitHub 계정으로 로그인" |

Agent Platform은 **OIDC**를 사용합니다. OAuth2만으로는 "누가 이 API를 호출했는지" 알 수 없지만, OIDC는 로그인 과정에서 **사용자 신원(ID Token)**을 발급하므로 사용자별 사용량 추적이 가능합니다.

> 쉽게 말해: OAuth2는 "열쇠(권한)"만 주고, OIDC는 "열쇠 + 신분증(사용자 정보)"을 줍니다.

### 주요 이점

| 항목 | 헤더 기반 인증 | OIDC 인증 |
|------|---------------|-----------|
| 사용자 식별 | 서비스가 `x-user-id` 직접 주입 | 사용자 로그인으로 자동 식별 |
| 사용량 추적 | 서비스 단위 | 사용자 단위 (자동) |
| 적합한 케이스 | 백엔드 API 호출 | 웹 UI, CLI, SDK |

## 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                      사용자 (브라우저/CLI)                      │
└──────────┬───────────────────────────────────┬───────────────┘
           │ ① OIDC 로그인                      │ ③ LLM 호출
           │   (Authorization Code Flow)        │   (body.user 포함)
           ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  Nginx (:8090 HTTP)                          │
│                                                             │
│  /oidc/*  /.well-known/*  →  Auth Server (내부)              │
│  /v1/*                    →  LLM Gateway (내부)              │
│                                                             │
│  • 사용자는 :8090 하나만 알면 됨                               │
│  • OIDC + LLM API 모두 동일 주소                              │
│  • body.user로 사용자 식별 → 사용량 자동 집계                   │
└─────────────────────────────────────────────────────────────┘
           ▲                                    ▲
           │                                    │
    ┌──────┴──────────────────────────┬─────────┴──────┐
    │                                │                │
┌───┴─────────┐  ┌──────────────┐  ┌┴───────────────┐
│ Open WebUI   │  │  Dashboard   │  │ ADK / Python   │
│ (웹 UI)      │  │  (웹 UI)     │  │ SDK (CLI)      │
└──────────────┘  └──────────────┘  └────────────────┘
```

## 지원하는 인증 흐름

### 1. Authorization Code Flow (웹 앱용)

웹 애플리케이션(Open WebUI, Dashboard 등)에서 사용하는 표준 OIDC 흐름입니다.

```
사용자 → 로그인 버튼 클릭
      → Auth Server 로그인 페이지로 리다이렉트
      → 로그인 성공
      → Authorization Code 발급
      → 클라이언트가 Code를 Token으로 교환
      → Access Token (JWT) 획득
```

### 2. Browser-based Login (CLI/SDK용)

CLI나 Python SDK에서 사용하는 흐름입니다. `setup_auth()` 함수가 자동으로 처리합니다.

```
CLI/SDK → 로컬 서버 시작 (localhost:callback_port)
        → 브라우저에서 Auth Server 로그인 페이지 열기
        → 사용자 로그인
        → Auth Server가 localhost로 Authorization Code 전달
        → Code를 Token으로 교환
        → 토큰을 로컬에 캐시 저장
```

## OIDC Discovery

OIDC Discovery 엔드포인트에서 모든 OIDC 설정 정보를 조회할 수 있습니다.

```
GET http://a2g.samsungds.net:8090/.well-known/openid-configuration
```

### 응답 예시

```json
{
  "issuer": "http://a2g.samsungds.net:8090",
  "authorization_endpoint": "http://a2g.samsungds.net:8090/oidc/authorize",
  "token_endpoint": "http://a2g.samsungds.net:8090/oidc/token",
  "userinfo_endpoint": "http://a2g.samsungds.net:8090/oidc/userinfo",
  "jwks_uri": "http://a2g.samsungds.net:8090/oidc/jwks",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["HS256"]
}
```

## 주요 엔드포인트

| 엔드포인트 | URL | 설명 |
|-----------|-----|------|
| Discovery | `http://a2g.samsungds.net:8090/.well-known/openid-configuration` | OIDC 설정 정보 조회 |
| Authorization | `http://a2g.samsungds.net:8090/oidc/authorize` | 사용자 인증 및 Authorization Code 발급 |
| Token | `http://a2g.samsungds.net:8090/oidc/token` | Authorization Code를 Access Token으로 교환 |
| UserInfo | `http://a2g.samsungds.net:8090/oidc/userinfo` | Access Token으로 사용자 정보 조회 |
| LLM API | `http://a2g.samsungds.net:8090/v1/` | LLM Gateway (동일 주소) |

## Samsung SSO 등록 vs OIDC 클라이언트

> **중요**: Samsung SSO(ADFS)에 등록하는 redirect_uri와, 각 OIDC 클라이언트의 redirect_uri는 **별개**입니다.

**Samsung SSO에 등록할 URL (1개만)**:
```
https://a2g.samsungds.net:9050/oidc/sso-callback
```
이것은 Samsung SSO가 인증 완료 후 form_post를 보내는 Auth Server 콜백 URL입니다.

**OIDC 클라이언트 redirect_uri**는 우리 Auth Server가 관리하며, Samsung SSO와는 무관합니다.

## 사전 등록된 클라이언트

아래 클라이언트는 사전 등록되어 있어 별도 설정 없이 사용할 수 있습니다. Redirect URI는 와일드카드(`*`)로 설정되어 있어 어떤 URL이든 허용됩니다.

| Client ID | 용도 | Redirect URI 예시 |
|-----------|------|------------------|
| `agent-dashboard` | Agent Dashboard 웹 UI | `http://a2g.samsungds.net:8090/` |
| `open-webui` | Open WebUI 웹 UI | `http://{Open WebUI 주소}/oauth/oidc/callback` |
| `cli-default` | CLI / Python SDK | `http://localhost:{동적포트}/callback` |

> Open WebUI의 redirect_uri는 **Open WebUI가 실제로 접근 가능한 주소**여야 합니다. 포트, 프로토콜(http/https)이 정확히 일치해야 하며, 방화벽에서 해당 포트가 열려있어야 합니다.

## 새 클라이언트 등록

### 방법 1: 관리자에게 요청

System Admin에게 아래 정보를 전달하여 등록을 요청합니다.

- **Client ID**: 원하는 클라이언트 식별자
- **Client Secret**: 사용할 시크릿 (또는 자동 생성 요청)
- **Redirect URI**: 인증 완료 후 리다이렉트될 URI

### 방법 2: 환경변수 설정 (서버 관리자)

Auth Server의 `OIDC_CLIENTS` 환경변수에 JSON 형식으로 클라이언트를 추가합니다.

```bash
OIDC_CLIENTS='{"my-new-app": {"secret": "my-secret-value", "redirectUris": ["https://my-app.example.com/callback"]}}'
```

설정 후 Auth Server를 재시작하면 적용됩니다.

## 토큰 형식

OIDC 토큰은 JWT(JSON Web Token) 형식이며, 아래 필드를 포함합니다.

```json
{
  "sub": "syngha.han",
  "name": "한승하",
  "email": "syngha.han@samsung.com",
  "dept": "S/W혁신팀(S.LSI)",
  "iat": 1711700000,
  "exp": 1711786400,
  "iss": "http://a2g.samsungds.net:8090",
  "aud": "agent-dashboard"
}
```

| 필드 | 설명 |
|------|------|
| `sub` | 사용자 로그인 ID (사번 기반) |
| `name` | 사용자 이름 |
| `email` | 사용자 이메일 |
| `dept` | 소속 부서명 |
| `iat` | 토큰 발급 시간 (Unix timestamp) |
| `exp` | 토큰 만료 시간 (Unix timestamp) |
| `iss` | 토큰 발급자 (Auth Server) |
| `aud` | 대상 클라이언트 ID |

## 배포

```bash
./deploy.sh
```

`deploy.sh` 한 번이면 모든 것이 자동으로 처리됩니다. Nginx가 `:8090` 포트에서 OIDC 엔드포인트와 LLM API를 모두 프록시하므로, 사용자 측에서 SSL 인증서를 설정할 필요가 없습니다.

## 다음 단계

- [Open WebUI 연동 가이드](/docs/api/oidc-openwebui) — Open WebUI에서 OIDC 연동 설정
- [Google ADK / Python SDK 연동 가이드](/docs/api/oidc-adk) — ADK 및 Python SDK에서 OIDC 연동
- [OIDC 연동 예제 코드](/docs/api/oidc-examples) — Python, JavaScript, LangChain, ADK, curl 예제
- [API 인증 가이드](/docs/api/authentication) — 기존 헤더 기반 인증 방식
