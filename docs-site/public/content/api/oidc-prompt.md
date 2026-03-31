# Agent용 인증 연동 프롬프트

AI Agent(Claude Code, Cursor 등)에게 **코드 블록 하나만 복사**해서 붙여넣으면 바로 연동 + 테스트까지 실행합니다. 코드 블록에 마우스를 올리면 복사 버튼이 나타납니다.

> **사전 준비**: 코드의 `내서비스ID`와 `모델명`을 실제 값으로 바꿔야 합니다. 서비스를 아직 등록하지 않았다면 [서비스 등록 가이드](/docs/service/service-registration)를 참고하여 먼저 등록하세요. 서비스 ID는 대시보드 → 서비스 상세 페이지에서 확인할 수 있습니다.

---

## Python (OpenAI SDK)

```text
다음을 순서대로 실행해.

서버: http://a2g.samsungds.net:8090 (Gateway + OIDC 전부)
규칙: api_key는 아무 값, x-service-id는 대시보드에 등록된 서비스ID 필수 (없으면 사용자에게 서비스 등록 여부와 ID를 먼저 확인할 것)

1. SDK 다운로드
curl http://a2g.samsungds.net:8090/sdk/agent_platform_auth.py -o agent_platform_auth.py

2. test_openai.py 파일 생성 (내용):
from agent_platform_auth import setup_auth
setup_auth(gateway_url="http://a2g.samsungds.net:8090")
from openai import OpenAI
client = OpenAI(base_url="http://a2g.samsungds.net:8090/v1", api_key="sk-placeholder", default_headers={"x-service-id": "내서비스ID"})
r = client.chat.completions.create(model="모델명", messages=[{"role": "user", "content": "안녕"}], max_tokens=20)
print(r.choices[0].message.content)

3. 실행: python test_openai.py
브라우저가 열리면 로그인. 이후 모든 호출에 user 자동 주입됨.
```

---

## LangChain

```text
다음을 순서대로 실행해.

서버: http://a2g.samsungds.net:8090 (Gateway + OIDC 전부)
규칙: api_key는 아무 값, x-service-id는 대시보드에 등록된 서비스ID 필수 (없으면 사용자에게 서비스 등록 여부와 ID를 먼저 확인할 것)

1. SDK 다운로드
curl http://a2g.samsungds.net:8090/sdk/agent_platform_auth.py -o agent_platform_auth.py

2. 의존성 설치
pip install langchain-openai

3. test_langchain.py 파일 생성 (내용):
from agent_platform_auth import setup_auth
setup_auth(gateway_url="http://a2g.samsungds.net:8090")
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="모델명", base_url="http://a2g.samsungds.net:8090/v1", api_key="sk-placeholder", default_headers={"x-service-id": "내서비스ID"})
print(llm.invoke("안녕하세요").content)

4. 실행: python test_langchain.py
```

---

## Google ADK

```text
다음을 순서대로 실행해.

서버: http://a2g.samsungds.net:8090 (Gateway + OIDC 전부)
규칙: api_key는 아무 값, x-service-id는 대시보드에 등록된 서비스ID 필수 (없으면 사용자에게 서비스 등록 여부와 ID를 먼저 확인할 것)

1. SDK 다운로드
curl http://a2g.samsungds.net:8090/sdk/agent_platform_auth.py -o agent_platform_auth.py

2. 의존성 설치
pip install "google-adk[extensions]"

3. 환경변수 설정
export OPENAI_API_BASE=http://a2g.samsungds.net:8090/v1
export OPENAI_API_KEY=sk-placeholder

4. test_adk.py 파일 생성 (내용):
from agent_platform_auth import setup_auth
setup_auth(gateway_url="http://a2g.samsungds.net:8090")
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
agent = Agent(name="test", model="openai/모델명", instruction="한국어로 짧게 답해")
runner = Runner(agent=agent, app_name="test", session_service=InMemorySessionService())
print("Agent 생성 성공:", agent.name)

5. 실행: python test_adk.py
```

---

## FastAPI 웹 서비스

```text
다음을 순서대로 실행해.

서버: http://a2g.samsungds.net:8090 (Gateway + OIDC 전부)
규칙: api_key는 아무 값, x-service-id는 대시보드에 등록된 서비스ID 필수 (없으면 사용자에게 서비스 등록 여부와 ID를 먼저 확인할 것)

1. SDK 다운로드
curl http://a2g.samsungds.net:8090/sdk/agent_platform_auth.py -o agent_platform_auth.py

2. 의존성 설치
pip install fastapi uvicorn langchain-openai

3. server.py 파일 생성 (내용):
from fastapi import FastAPI
from agent_platform_auth import setup_auth, set_user
from langchain_openai import ChatOpenAI
app = FastAPI()
setup_auth(gateway_url="http://a2g.samsungds.net:8090")
llm = ChatOpenAI(model="모델명", base_url="http://a2g.samsungds.net:8090/v1", api_key="sk-placeholder", default_headers={"x-service-id": "내서비스ID"})
@app.get("/chat")
async def chat(q: str = "안녕", user: str = "test.user"):
    set_user(user)
    return {"response": llm.invoke(q).content}

4. 실행: uvicorn server:app --reload
5. 테스트: curl "http://localhost:8000/chat?q=hello&user=syngha.han"
```

---

## curl (인증 테스트)

```text
이 명령어로 Gateway body.user 인증을 확인해:

curl -s -X POST http://a2g.samsungds.net:8090/v1/chat/completions -H "Content-Type: application/json" -H "x-service-id: 내서비스ID" -d '{"model":"모델명","messages":[{"role":"user","content":"hi"}],"user":"syngha.han","max_tokens":5}'

성공: {"choices":[...]} 또는 LLM 관련 에러 (인증은 통과)
실패: {"error":"x-user-id header is required..."} → body.user 미지원

모델 목록: curl http://a2g.samsungds.net:8090/v1/models -H "x-service-id: 내서비스ID"
```

---

## Open WebUI (Docker)

```text
Open WebUI를 OIDC 연동해서 Docker로 띄워.
WEBUI_URL은 반드시 Open WebUI를 호스팅하는 본인 서버 주소로 변경해야 해.
이 값으로 로그인 후 돌아올 redirect_uri가 자동 생성됨 ({WEBUI_URL}/oauth/oidc/callback). 별도 redirect_uri 설정은 필요 없어.

docker run -d --name open-webui -p 3000:8080 \
  -e WEBUI_URL="http://본인서버주소:3000" \
  -e ENABLE_OAUTH_SIGNUP=true \
  -e OAUTH_PROVIDER_NAME="Agent Platform" \
  -e OPENID_PROVIDER_URL="http://a2g.samsungds.net:8090/.well-known/openid-configuration" \
  -e OAUTH_CLIENT_ID=open-webui \
  -e OAUTH_CLIENT_SECRET=open-webui-secret \
  -e OAUTH_SCOPES="openid profile" \
  -e OPENAI_API_BASE_URL="http://a2g.samsungds.net:8090/v1" \
  -e OPENAI_API_KEY=sk-placeholder \
  ghcr.io/open-webui/open-webui:main

접속해서 "Continue with Agent Platform" 버튼이 보이면 성공.
```
