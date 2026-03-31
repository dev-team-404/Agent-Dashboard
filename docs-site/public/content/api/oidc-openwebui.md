# Open WebUI 연동 가이드

Open WebUI에서 Agent Platform SSO 로그인을 연동하는 방법입니다.

## 사전 요구사항

- Open WebUI가 설치되어 브라우저에서 접근 가능한 상태
- Agent Platform 서버(`http://a2g.samsungds.net:8090`)에 네트워크 접근 가능

## 환경변수 설정

Open WebUI의 `.env` 또는 Docker Compose에 아래 환경변수를 추가하세요.

```env
# 본인의 Open WebUI 주소 (브라우저에서 접근하는 URL)
WEBUI_URL=http://본인서버주소:포트

# OIDC 로그인
ENABLE_OAUTH_SIGNUP=true
OAUTH_PROVIDER_NAME=Agent Platform
OPENID_PROVIDER_URL=http://a2g.samsungds.net:8090/.well-known/openid-configuration
OAUTH_CLIENT_ID=open-webui
OAUTH_CLIENT_SECRET=open-webui-secret
OAUTH_SCOPES=openid profile

# LLM API (Agent Platform Gateway 경유)
OPENAI_API_BASE_URL=http://a2g.samsungds.net:8090/v1
OPENAI_API_KEY=sk-placeholder
```

| 환경변수 | 값 | 설명 |
|---------|-----|------|
| `WEBUI_URL` | 본인의 Open WebUI URL | **필수**. 로그인 후 돌아올 주소(redirect_uri)가 이 값 기반으로 자동 생성됩니다: `{WEBUI_URL}/oauth/oidc/callback`. 별도로 redirect_uri를 설정할 필요 없습니다. |
| `OPENID_PROVIDER_URL` | `http://a2g.samsungds.net:8090/.well-known/openid-configuration` | 전체 경로를 입력하세요. base URL만 넣으면 Discovery가 실패합니다. |
| `OAUTH_CLIENT_ID` | `open-webui` | 사전 등록된 값. 변경 불필요. |
| `OAUTH_CLIENT_SECRET` | `open-webui-secret` | 사전 등록된 값. 변경 불필요. |
| `OAUTH_SCOPES` | `openid profile` | 변경 불필요. |
| `OPENAI_API_KEY` | 아무 값 | Gateway는 API Key를 검증하지 않습니다. |

### Docker Compose 예시

```yaml
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    ports:
      - "3000:8080"
    environment:
      WEBUI_URL: "http://본인서버주소:3000"
      ENABLE_OAUTH_SIGNUP: "true"
      OAUTH_PROVIDER_NAME: "Agent Platform"
      OPENID_PROVIDER_URL: "http://a2g.samsungds.net:8090/.well-known/openid-configuration"
      OAUTH_CLIENT_ID: "open-webui"
      OAUTH_CLIENT_SECRET: "open-webui-secret"
      OAUTH_SCOPES: "openid profile"
      OPENAI_API_BASE_URL: "http://a2g.samsungds.net:8090/v1"
      OPENAI_API_KEY: "sk-placeholder"
```

> 포트를 변경하려면 `ports`와 `WEBUI_URL`의 포트를 함께 변경하세요.

## 동작 확인

### 1. Open WebUI 접근 확인

설정 후 재시작하고, 브라우저에서 본인의 Open WebUI URL에 접속되는지 먼저 확인하세요.

### 2. OIDC Discovery 확인

Open WebUI 컨테이너가 Agent Platform에 접근 가능한지 확인:

```bash
docker exec {컨테이너명} curl -s http://a2g.samsungds.net:8090/.well-known/openid-configuration
```

JSON 응답이 나오면 정상입니다.

### 3. 로그인 테스트

1. Open WebUI 로그인 페이지에서 **"Agent Platform으로 로그인"** 클릭
2. Samsung SSO 로그인 (사번/비밀번호)
3. Open WebUI로 돌아와 로그인 완료

### 4. 채팅 테스트

모델 선택 후 메시지를 보내면, 사용량이 Agent Dashboard에 사용자별로 자동 집계됩니다.

## 문제 해결

### ERR_CONNECTION_REFUSED (SSO 인증 후 연결 거부)

SSO 로그인은 성공했지만, Open WebUI로 돌아올 때 연결이 안 되는 경우입니다.

- `WEBUI_URL`이 브라우저에서 실제로 접근 가능한 주소인지 확인
- 방화벽에서 해당 포트가 열려있는지 확인
- Open WebUI 컨테이너가 실행 중인지 확인: `docker ps`

### https / http 프로토콜 불일치

redirect가 `https://`로 가는데 Open WebUI는 `http://`인 경우 — `WEBUI_URL`의 프로토콜을 실제 서비스와 정확히 맞추세요.

### OIDC Provider 연결 실패

Open WebUI 컨테이너에서 Agent Platform까지 네트워크가 안 되는 경우:
```bash
docker exec {컨테이너명} curl -s http://a2g.samsungds.net:8090/.well-known/openid-configuration
```

응답이 없으면 방화벽, DNS, Docker 네트워크 설정을 확인하세요.

## 다음 단계

- [OIDC 인증 개요](/docs/api/oidc-overview) — OIDC 체계 전반
- [OIDC 연동 예제 코드](/docs/api/oidc-examples) — Python, JavaScript, curl 예제
- [Google ADK / Python SDK 연동](/docs/api/oidc-adk) — ADK에서 OIDC 연동
