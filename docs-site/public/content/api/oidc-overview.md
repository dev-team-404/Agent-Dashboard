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
┌─────────────────────┐              ┌─────────────────────────┐
│   Auth Server        │              │   Gateway (:8090)        │
│   (:9050 HTTPS)      │              │                         │
│                     │              │  • body.user로 사용자 식별 │
│  • OIDC Provider    │  ② 토큰 발급  │  • 사용자별 사용량 집계    │
│  • JWT 토큰 발급     │─────────────▶│  • LLM 프록시            │
│  • 사용자 인증       │              │                         │
└─────────────────────┘              └─────────────────────────┘
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
GET https://a2g.samsungds.net:9050/.well-known/openid-configuration
```

### 응답 예시

```json
{
  "issuer": "https://a2g.samsungds.net:9050",
  "authorization_endpoint": "https://a2g.samsungds.net:9050/oidc/authorize",
  "token_endpoint": "https://a2g.samsungds.net:9050/oidc/token",
  "userinfo_endpoint": "https://a2g.samsungds.net:9050/oidc/userinfo",
  "jwks_uri": "https://a2g.samsungds.net:9050/oidc/jwks",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["HS256"]
}
```

## 주요 엔드포인트

| 엔드포인트 | URL | 설명 |
|-----------|-----|------|
| Authorization | `https://a2g.samsungds.net:9050/oidc/authorize` | 사용자 인증 및 Authorization Code 발급 |
| Token | `https://a2g.samsungds.net:9050/oidc/token` | Authorization Code를 Access Token으로 교환 |
| UserInfo | `https://a2g.samsungds.net:9050/oidc/userinfo` | Access Token으로 사용자 정보 조회 |

## 사전 등록된 클라이언트

아래 클라이언트는 사전 등록되어 있어 별도 설정 없이 사용할 수 있습니다.

| Client ID | 용도 | Redirect URI |
|-----------|------|-------------|
| `agent-dashboard` | Agent Dashboard 웹 UI | `https://a2g.samsungds.net:8090/callback` |
| `open-webui` | Open WebUI 웹 UI | `https://a2g.samsungds.net:3000/oauth/oidc/callback` |
| `cli-default` | CLI / Python SDK | `http://localhost:*/callback` (동적 포트) |

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
  "iss": "https://a2g.samsungds.net:9050",
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

## 인증서 배치 가이드

OIDC Auth Server는 HTTPS로 동작하므로 SSL 인증서가 필요합니다. 하지만 **직접 해야 할 것은 하나**뿐입니다.

### 필요한 파일: `cert/cert.cer`

삼성 SSO 공개 인증서 파일을 `cert/cert.cer` 경로에 배치합니다. 이 파일은 SSO팀에서 발급받아야 합니다.

```
cert/
├── cert.cer        ← 이것만 수동 배치 (SSO 공개 인증서)
├── server.crt      ← deploy.sh가 자동 생성 (HTTPS 서버 인증서)
├── server.key      ← deploy.sh가 자동 생성 (HTTPS 서버 개인키)
└── sso.cer         ← deploy.sh가 cert.cer에서 자동 복사
```

> HTTPS 서버 인증서(`server.crt`/`server.key`)는 `deploy.sh`가 없으면 자체서명 인증서를 자동 생성합니다. 운영 환경에서는 사내 CA 인증서로 교체하면 브라우저 경고가 사라집니다.

### 배포 방법

```bash
# 1. cert/cert.cer 배치 확인 후
./deploy.sh
```

`deploy.sh` 한 번이면 모든 것이 자동으로 처리됩니다.

- `server.crt`/`server.key` 없으면 자체서명 인증서 자동 생성 (SAN에 서버 IP 포함)
- `sso.cer` 없으면 `cert.cer`에서 자동 복사
- `OIDC_ISSUER` 자동 설정: 서버의 실제 IP를 감지하여 `https://{감지된IP}:9050/oidc`로 자동 구성

> `OIDC_ISSUER`를 수동으로 설정할 필요가 없습니다. `deploy.sh`가 `hostname -I` 또는 네트워크 인터페이스에서 서버 IP를 자동 감지하여 설정합니다.

## 다음 단계

- [Open WebUI 연동 가이드](/docs/api/oidc-openwebui) — Open WebUI에서 OIDC 연동 설정
- [Google ADK / Python SDK 연동 가이드](/docs/api/oidc-adk) — ADK 및 Python SDK에서 OIDC 연동
- [OIDC 연동 예제 코드](/docs/api/oidc-examples) — Python, JavaScript, LangChain, ADK, curl 예제
- [API 인증 가이드](/docs/api/authentication) — 기존 헤더 기반 인증 방식
