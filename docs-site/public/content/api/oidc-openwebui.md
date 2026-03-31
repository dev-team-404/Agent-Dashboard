# Open WebUI 연동 가이드

Open WebUI에서 Agent Platform SSO 로그인을 연동하는 방법입니다.

## 사전 요구사항

- Open WebUI가 설치되어 브라우저에서 접근 가능한 상태
- Agent Platform 서버 접근 가능 (`http://a2g.samsungds.net:8090`)

## 환경변수 설정

Open WebUI의 `.env` 또는 Docker Compose에 아래 환경변수를 추가하세요.

```env
# 본인의 Open WebUI 주소 (브라우저에서 접근하는 URL)
WEBUI_URL=http://{본인의 Open WebUI 주소}

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

| 환경변수 | 설명 |
|---------|------|
| `WEBUI_URL` | 본인의 Open WebUI 주소. 이 값 기반으로 로그인 콜백 URL이 생성됩니다. |
| `OPENID_PROVIDER_URL` | `/.well-known/openid-configuration`까지 포함한 전체 URL을 입력하세요. |
| `OAUTH_CLIENT_ID` | `open-webui` (사전 등록됨) |
| `OAUTH_CLIENT_SECRET` | `open-webui-secret` (사전 등록됨) |
| `OPENAI_API_KEY` | 아무 값이나 입력 (Gateway는 API Key를 검증하지 않음) |

### Docker Compose 예시

```yaml
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    ports:
      - "3000:8080"
    environment:
      WEBUI_URL: "http://{본인의 Open WebUI 주소}:3000"
      ENABLE_OAUTH_SIGNUP: "true"
      OAUTH_PROVIDER_NAME: "Agent Platform"
      OPENID_PROVIDER_URL: "http://a2g.samsungds.net:8090/.well-known/openid-configuration"
      OAUTH_CLIENT_ID: "open-webui"
      OAUTH_CLIENT_SECRET: "open-webui-secret"
      OAUTH_SCOPES: "openid profile"
      OPENAI_API_BASE_URL: "http://a2g.samsungds.net:8090/v1"
      OPENAI_API_KEY: "sk-placeholder"
```

## 동작 확인

1. Open WebUI 접속
2. **"Agent Platform으로 로그인"** 버튼 클릭
3. Samsung SSO 로그인 (사번/비밀번호)
4. Open WebUI로 돌아와 로그인 완료
5. 채팅 시 사용량이 Agent Dashboard에 자동 집계됨

## 문제 해결

### ERR_CONNECTION_REFUSED

SSO 인증 후 Open WebUI로 돌아올 때 연결 거부 에러가 나는 경우:

1. `WEBUI_URL`이 브라우저에서 접근 가능한 주소인지 확인
2. Open WebUI 컨테이너가 실행 중인지 확인: `docker ps`
3. 방화벽에서 해당 포트가 열려있는지 확인

### https / http 프로토콜 불일치

redirect가 `https://`로 가는데 Open WebUI는 `http://`인 경우 — `WEBUI_URL`의 프로토콜을 실제 서비스와 맞추세요.

### OIDC Provider 연결 실패

Open WebUI 컨테이너에서 Agent Platform에 접근 가능한지 확인:
```bash
docker exec open-webui curl -s http://a2g.samsungds.net:8090/.well-known/openid-configuration
```

## 다음 단계

- [OIDC 인증 개요](/docs/api/oidc-overview) — OIDC 체계 전반
- [OIDC 연동 예제 코드](/docs/api/oidc-examples) — Python, JavaScript, curl 예제
- [Google ADK / Python SDK 연동](/docs/api/oidc-adk) — ADK에서 OIDC 연동
