# Open WebUI 연동 가이드

Open WebUI에서 Agent Platform SSO 로그인을 연동하는 방법입니다.

## 사전 요구사항

- Open WebUI가 설치되어 브라우저에서 접근 가능한 상태
- Agent Platform 서버(`http://a2g.samsungds.net:8090`)에 네트워크 접근 가능

## 환경변수 ���정

Open WebUI의 `.env` 또는 Docker Compose에 아래 환경변수를 추가하세요.

```env
# ── 필수: Open WebUI 기본 설정 ──
WEBUI_URL=http://본인서버주소:포트

# ── OIDC 로그인 ──
ENABLE_OAUTH_SIGNUP=true
OAUTH_PROVIDER_NAME=Agent Platform
OPENID_PROVIDER_URL=http://a2g.samsungds.net:8090/.well-known/openid-configuration
OPENID_REDIRECT_URI=http://본인서버주소:포트/oauth/oidc/callback
OAUTH_CLIENT_ID=open-webui
OAUTH_CLIENT_SECRET=open-webui-secret
OAUTH_SCOPES=openid email profile

# ── 로그아웃 ──
# 로그아웃 시 OIDC 세션도 함께 정리하려면 아래 설정 추가
# post_logout_redirect_uri에 본인 Open WebUI 주소를 넣으면 로그아웃 후 돌아옴
WEBUI_AUTH_SIGNOUT_REDIRECT_URL=http://a2g.samsungds.net:8090/oidc/logout?post_logout_redirect_uri=http://본인서버주소:포트

# ── LLM API (Agent Platform Gateway 경유) ──
OPENAI_API_BASE_URL=http://a2g.samsungds.net:8090/v1
OPENAI_API_KEY=sk-placeholder

# ── 환경변수 우선 적용 (선택) ──
# Open WebUI는 기본적으로 최초 기동 시 OAuth 설정을 DB에 저장하고,
# 이후에는 환경변수를 무시합니다. 환경변수를 항상 우선 적용하려면:
ENABLE_OAUTH_PERSISTENT_CONFIG=false
```

| 환경변수 | 값 | 설명 |
|---------|-----|------|
| `WEBUI_URL` | `http://본인서버주소:포트` | **필수.** Open WebUI의 외부 접근 URL. |
| `OPENID_PROVIDER_URL` | `http://a2g.samsungds.net:8090/.well-known/openid-configuration` | OIDC Discovery URL. 전체 경로 필수. |
| `OPENID_REDIRECT_URI` | `{WEBUI_URL}/oauth/oidc/callback` | **OIDC 콜백 URL.** `WEBUI_URL`과 동일한 주소 + `/oauth/oidc/callback` 경로. |
| `OAUTH_CLIENT_ID` | `open-webui` | 사전 등록됨. 변경 불필요. |
| `OAUTH_CLIENT_SECRET` | `open-webui-secret` | 사전 등록됨. 변경 불필요. |
| `OAUTH_SCOPES` | `openid email profile` | 변경 불필요. |
| `OPENAI_API_KEY` | 아무 값 | Gateway는 검증하지 않음. |
| `WEBUI_AUTH_SIGNOUT_REDIRECT_URL` | (아래 참고) | 로그아웃 시 OIDC 세션 정리 후 돌아올 URL. 아래 형식으로 설정: `http://a2g.samsungds.net:8090/oidc/logout?post_logout_redirect_uri={WEBUI_URL}` |
| `ENABLE_OAUTH_PERSISTENT_CONFIG` | `false` | 환경변수 변경 시 재시작만으로 반영되게 하려면 `false`로 설정. 기본값 `true`면 최초 기동 후 DB 설정이 우선됨. |

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
      ENABLE_OAUTH_PERSISTENT_CONFIG: "false"
      OAUTH_PROVIDER_NAME: "Agent Platform"
      OPENID_PROVIDER_URL: "http://a2g.samsungds.net:8090/.well-known/openid-configuration"
      OPENID_REDIRECT_URI: "http://본인서버주소:3000/oauth/oidc/callback"
      OAUTH_CLIENT_ID: "open-webui"
      OAUTH_CLIENT_SECRET: "open-webui-secret"
      OAUTH_SCOPES: "openid email profile"
      WEBUI_AUTH_SIGNOUT_REDIRECT_URL: "http://a2g.samsungds.net:8090/oidc/logout?post_logout_redirect_uri=http://본인서버주소:3000"
      OPENAI_API_BASE_URL: "http://a2g.samsungds.net:8090/v1"
      OPENAI_API_KEY: "sk-placeholder"
```

> 포트를 변경하려면 `ports`, `WEBUI_URL`, `OPENID_REDIRECT_URI` 세 곳의 포트를 함께 변경하세요.

## 동작 확인

1. Open WebUI가 브라우저에서 접근되는지 확인
2. 로그인 페이지에서 **"Agent Platform으로 로그인"** 버튼 확인
3. 클릭 → Samsung SSO 로그인 → Open WebUI로 돌아오면 성공

## 문제 해결

### ERR_CONNECTION_REFUSED (SSO 인증 후 연결 거부)

SSO 로그인은 성공했지만 Open WebUI로 돌아올 때 연결 거부:
- `WEBUI_URL`과 `OPENID_REDIRECT_URI`가 브라우저에서 접근 가능한 주소인지 확인
- 방화벽에서 해당 포트가 열려있는지 확인
- Open WebUI 컨테이너 실행 중인지: `docker ps`

### https / http 프로토콜 불일치

redirect가 `https://`로 가는데 실제로는 `http://`인 경우:
- `WEBUI_URL`과 `OPENID_REDIRECT_URI`의 프로토콜을 실제 서비스와 맞추세요

### 환경변수 변경이 반영 안 됨

Open WebUI는 기본적으로 최초 기동 시 OAuth 설정을 DB에 저장합니다. 이후 환경변수를 바꿔도 무시됩니다.
- `ENABLE_OAUTH_PERSISTENT_CONFIG=false`로 설정하면 환경변수가 항상 우선 적용됩니다

### OIDC Provider 연결 실패

```bash
docker exec {컨테이너명} curl -s http://a2g.samsungds.net:8090/.well-known/openid-configuration
```

JSON 응답이 안 나오면 네트워크/방화벽 확인.

## 다음 단계

- [OIDC 인증 개요](/docs/api/oidc-overview) — OIDC 체계 전반
- [OIDC 연동 예제 코드](/docs/api/oidc-examples) — Python, JavaScript, curl 예제
- [Google ADK / Python SDK 연동](/docs/api/oidc-adk) — ADK에서 OIDC 연동
