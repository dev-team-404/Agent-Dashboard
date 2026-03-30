# Open WebUI 연동 가이드

Open WebUI에서 Agent Platform OIDC 인증을 연동하여 사용자별 사용량을 자동 추적하는 방법을 안내합니다.

## 사전 요구사항

- Open WebUI가 설치되어 실행 중이어야 합니다
- Agent Platform 서버에 접근 가능해야 합니다 (`:8090` — OIDC와 Gateway 모두 동일 포트)
- Open WebUI의 관리자 권한이 필요합니다

> **서버 IP 확인 방법**: Agent Platform은 `a2g.samsungds.net`에서 서비스됩니다

## Step 1: OIDC 클라이언트 확인

Agent Platform에는 Open WebUI용 OIDC 클라이언트가 **사전 등록**되어 있습니다.

| 항목 | 값 |
|------|-----|
| Client ID | `open-webui` |
| Client Secret | `open-webui-secret` |
| Redirect URI | `http://a2g.samsungds.net:3000/oauth/oidc/callback` |

> 별도의 클라이언트 등록 과정 없이 바로 사용할 수 있습니다.

## Step 2: Open WebUI 환경변수 설정

Open WebUI의 `.env` 파일 또는 Docker Compose 환경변수에 아래 OIDC 설정을 추가합니다.

### OIDC 인증 설정

```env
ENABLE_OAUTH_SIGNUP=true
OAUTH_PROVIDER_NAME=Agent Platform
OPENID_PROVIDER_URL=http://a2g.samsungds.net:8090/.well-known/openid-configuration
OAUTH_CLIENT_ID=open-webui
OAUTH_CLIENT_SECRET=open-webui-secret
OAUTH_SCOPES=openid profile email
```

| 환경변수 | 설명 |
|---------|------|
| `ENABLE_OAUTH_SIGNUP` | OAuth 로그인 시 자동 회원가입 허용 |
| `OAUTH_PROVIDER_NAME` | 로그인 버튼에 표시될 이름 |
| `OPENID_PROVIDER_URL` | OIDC Discovery URL (전체 경로 포함) |
| `OAUTH_CLIENT_ID` | 사전 등록된 클라이언트 ID |
| `OAUTH_CLIENT_SECRET` | 클라이언트 시크릿 |
| `OAUTH_SCOPES` | 요청할 OIDC scope |

> **주의**: `OPENID_PROVIDER_URL`에는 `/.well-known/openid-configuration`까지 포함한 전체 URL을 입력해야 합니다. base path만 입력하면 Discovery 실패가 발생합니다.

## Step 3: LLM API 연결 설정

Open WebUI가 Agent Platform Gateway를 통해 LLM을 호출하도록 설정합니다.

```env
OPENAI_API_BASE_URL=http://a2g.samsungds.net:8090/v1
OPENAI_API_KEY=sk-placeholder
```

| 환경변수 | 설명 |
|---------|------|
| `OPENAI_API_BASE_URL` | Agent Platform Gateway 주소 |
| `OPENAI_API_KEY` | 임의 값 (Gateway는 API Key 대신 body.user로 인증) |

> `OPENAI_API_KEY`는 OpenAI SDK 호환을 위해 필요하지만, 실제 인증에는 사용되지 않습니다. 아무 값이나 입력하면 됩니다.

### Docker Compose 예시

```yaml
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    ports:
      - "3000:8080"
    environment:
      # OIDC 인증
      ENABLE_OAUTH_SIGNUP: "true"
      OAUTH_PROVIDER_NAME: "Agent Platform"
      OPENID_PROVIDER_URL: "http://a2g.samsungds.net:8090/.well-known/openid-configuration"
      OAUTH_CLIENT_ID: "open-webui"
      OAUTH_CLIENT_SECRET: "open-webui-secret"
      OAUTH_SCOPES: "openid profile"
      # LLM API
      OPENAI_API_BASE_URL: "http://a2g.samsungds.net:8090/v1"
      OPENAI_API_KEY: "sk-placeholder"
```

### Docker 실행 명령어 (docker run)

```bash
docker run -d \
  --name open-webui \
  -p 3000:8080 \
  -e ENABLE_OAUTH_SIGNUP=true \
  -e OAUTH_PROVIDER_NAME="Agent Platform" \
  -e OPENID_PROVIDER_URL="http://a2g.samsungds.net:8090/.well-known/openid-configuration" \
  -e OAUTH_CLIENT_ID=open-webui \
  -e OAUTH_CLIENT_SECRET=open-webui-secret \
  -e OAUTH_SCOPES="openid profile" \
  -e OPENAI_API_BASE_URL="http://a2g.samsungds.net:8090/v1" \
  -e OPENAI_API_KEY=sk-placeholder \
  ghcr.io/open-webui/open-webui:main
```

## Step 4: 동작 확인

설정 완료 후 아래 순서로 정상 동작을 확인합니다.

### 1. 로그인 확인

1. Open WebUI 접속 (`http://a2g.samsungds.net:3000`)
2. 로그인 페이지에서 **"Agent Platform으로 로그인"** 버튼 클릭
3. Agent Platform 로그인 페이지에서 사번/비밀번호 입력
4. Open WebUI로 리다이렉트되어 로그인 완료

### 2. 채팅 확인

1. 모델 선택 (예: `gpt-4o`)
2. 메시지 입력 및 전송
3. LLM 응답 정상 수신 확인

### 3. 사용량 추적 확인

1. Agent Dashboard 접속
2. 사용량 분석 페이지에서 본인 사번으로 사용 기록 확인
3. Open WebUI에서 호출한 내역이 사용자별로 집계되는지 확인

## 사용량 추적 원리

Open WebUI의 OIDC 연동 시 사용량 추적이 자동으로 이루어지는 과정입니다.

```
① 사용자가 Open WebUI에서 OIDC 로그인
   → JWT 토큰 발급 (sub: "syngha.han")

② 사용자가 채팅 메시지 전송
   → Open WebUI가 LLM API 호출 시 body.user 필드에
     OIDC 로그인 사용자 ID를 자동 포함

③ Gateway (:8090)가 요청 수신
   → body.user 필드에서 사용자 ID 추출
   → 사용자별 토큰 사용량 집계

④ Dashboard에서 사용자별 사용량 확인 가능
```

> **핵심**: Open WebUI는 OIDC로 로그인한 사용자의 ID를 `body.user` 필드에 자동으로 포함시킵니다. Gateway는 이 필드를 읽어 사용자별 사용량을 집계합니다.

## 문제 해결

### redirect_uri 불일치

**증상:**

```
Error: redirect_uri_mismatch
The redirect URI in the request does not match the registered redirect URI.
```

**해결 방법:**

1. Open WebUI의 실제 콜백 URL 확인: `https://{Open WebUI 주소}/oauth/oidc/callback`
2. Agent Platform의 OIDC 클라이언트 설정에서 redirect_uri가 일치하는지 확인
3. 포트 번호, 프로토콜(http/https), 경로가 정확히 일치해야 합니다

### OIDC Provider에 연결할 수 없음

**증상:**

```
Error: connect ECONNREFUSED a2g.samsungds.net:8090
```

**해결 방법:**

1. Agent Platform이 실행 중인지 확인: `docker ps`
2. 방화벽에서 8090 포트가 열려있는지 확인
3. Open WebUI 컨테이너에서 Agent Platform 서버로 네트워크 접근이 가능한지 확인

### 로그인 후 사용량이 추적되지 않음

**확인 사항:**

1. Open WebUI 버전이 OIDC `body.user` 주입을 지원하는지 확인
2. Gateway 로그에서 `body.user` 필드가 포함된 요청이 오는지 확인
3. `OPENAI_API_BASE_URL`이 Agent Platform Gateway 주소로 정확히 설정되었는지 확인

## 다음 단계

- [OIDC 인증 개요](/docs/api/oidc-overview) — OIDC 인증 체계 전반
- [OIDC 연동 예제 코드](/docs/api/oidc-examples) — Python, JavaScript, LangChain, ADK, curl 예제
- [Google ADK / Python SDK 연동 가이드](/docs/api/oidc-adk) — ADK에서 OIDC 연동
- [API 인증 가이드](/docs/api/authentication) — 헤더 기반 인증 방식
