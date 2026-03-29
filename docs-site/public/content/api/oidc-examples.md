# OIDC 연동 예제 코드

Agent Platform LLM API를 다양한 언어와 프레임워크에서 호출하는 예제를 제공합니다. 모든 예제는 실제 테스트를 거쳤습니다.

## 인증 방식 요약

Agent Platform Gateway(:8090)는 두 가지 방식으로 사용자를 식별합니다.

| 방식 | 필드 | 용도 |
|------|------|------|
| 헤더 기반 | `x-service-id`, `x-user-id` | 백엔드 서비스 간 호출 |
| body.user 기반 | `body.user` (OpenAI 호환) | OIDC 로그인 사용자, SDK 호출 |

> `body.user` 필드에 사용자 ID를 넣으면 Gateway가 자동으로 사용자별 사용량을 집계합니다.

---

## Python (requests)

OIDC 인증 후 LLM API를 호출하는 가장 기본적인 예제입니다.

```python
# OIDC 토큰으로 LLM API 호출 예제
import requests

# 1. 사용자 인증 (setup_auth 사용)
from agent_platform_auth import setup_auth
setup_auth(gateway_url="https://a2g.samsungds.net:9050")

# 2. LLM 호출 (user 자동 주입됨)
import litellm
response = litellm.completion(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "안녕하세요"}],
    api_base="http://a2g.samsungds.net:8090/v1",
    api_key="sk-placeholder",
)
print(response.choices[0].message.content)
```

### 직접 requests로 호출하기

```python
import requests

response = requests.post(
    "http://a2g.samsungds.net:8090/v1/chat/completions",
    headers={
        "Content-Type": "application/json",
        "x-service-id": "my-service",
    },
    json={
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "안녕하세요"}],
        "user": "syngha.han",  # body.user로 사용자별 집계
    },
)
print(response.json()["choices"][0]["message"]["content"])
```

---

## Python (OpenAI SDK)

OpenAI 공식 SDK를 사용하는 예제입니다. `base_url`만 Gateway로 변경하면 됩니다.

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://a2g.samsungds.net:8090/v1",
    api_key="sk-placeholder",  # Gateway는 API Key 검증하지 않음
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "안녕하세요"}],
    user="syngha.han",  # body.user로 사용자별 집계
)
print(response.choices[0].message.content)
```

### 스트리밍 응답

```python
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Python의 장점을 3가지 알려주세요"}],
    user="syngha.han",
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

---

## JavaScript (Node.js)

Node.js의 `fetch` API를 사용하는 예제입니다.

```javascript
const response = await fetch('http://a2g.samsungds.net:8090/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-service-id': 'my-service',
  },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: '안녕하세요' }],
    user: 'syngha.han',  // body.user로 사용자별 집계
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

### OpenAI Node.js SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://a2g.samsungds.net:8090/v1',
  apiKey: 'sk-placeholder',
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: '안녕하세요' }],
  user: 'syngha.han',
});

console.log(response.choices[0].message.content);
```

---

## LangChain (Python)

LangChain에서 Agent Platform을 LLM 백엔드로 사용하는 예제입니다.

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-4o",
    base_url="http://a2g.samsungds.net:8090/v1",
    api_key="sk-placeholder",
    default_headers={"x-service-id": "my-langchain-service"},
    model_kwargs={"user": "syngha.han"},
)

response = llm.invoke("안녕하세요")
print(response.content)
```

### 체인 활용 예제

```python
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages([
    ("system", "당신은 한국어 번역가입니다. 영어를 한국어로 번역해주세요."),
    ("user", "{text}"),
])

chain = prompt | llm
result = chain.invoke({"text": "Hello, how are you today?"})
print(result.content)
```

---

## Google ADK (Agent Development Kit)

Google ADK에서 OIDC `setup_auth`를 사용하여 사용자 인증 후 LLM을 호출하는 예제입니다.

```python
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

# 1. OIDC 인증 (브라우저 기반 로그인)
from agent_platform_auth import setup_auth
setup_auth(gateway_url="https://a2g.samsungds.net:9050")

# 2. Agent 정의
agent = Agent(
    name="my_agent",
    model="openai/gpt-4o",
    instruction="당신은 친절한 AI 어시스턴트입니다.",
)

# 3. Runner 실행
session_service = InMemorySessionService()
runner = Runner(agent=agent, app_name="my_app", session_service=session_service)

# 4. 대화
from google.adk.agents import UserContent
session = await session_service.create_session(app_name="my_app", user_id="syngha.han")

async for event in runner.run_async(
    user_id="syngha.han",
    session_id=session.id,
    new_message=UserContent(parts=["안녕하세요"]),
):
    if event.content and event.content.parts:
        print(event.content.parts[0])
```

### ADK 환경 설정

ADK가 Agent Platform Gateway를 사용하도록 환경변수를 설정합니다.

```bash
export OPENAI_API_BASE=http://a2g.samsungds.net:8090/v1
export OPENAI_API_KEY=sk-placeholder
```

---

## curl

가장 간단한 테스트 방법입니다. 터미널에서 바로 실행할 수 있습니다.

### 기본 호출

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "안녕하세요"}],
    "user": "syngha.han"
  }'
```

### 스트리밍 호출

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Python의 장점 3가지"}],
    "user": "syngha.han",
    "stream": true
  }' --no-buffer
```

### 모델 목록 조회

```bash
curl http://a2g.samsungds.net:8090/v1/models \
  -H "x-service-id: my-service"
```

---

## 공통 주의사항

### API Key
- `api_key` / `OPENAI_API_KEY`는 OpenAI SDK 호환을 위해 필요하지만, Gateway는 실제로 검증하지 않습니다
- 아무 값이나 입력해도 됩니다 (예: `sk-placeholder`)

### 사용자 식별
- `body.user` 필드 또는 `x-user-id` 헤더로 사용자를 식별합니다
- OIDC 로그인 사용자는 `body.user`가 자동 주입되므로 별도 설정 불필요
- 헤더 기반 인증 시에는 `x-service-id`와 `x-user-id`를 함께 전달합니다

### 모델명
- Gateway에 등록된 모델만 사용 가능합니다
- 사용 가능한 모델은 `GET /v1/models` API로 확인하세요

---

## 다음 단계

- [OIDC 인증 개요](/docs/api/oidc-overview) -- OIDC 인증 체계 전반
- [Open WebUI 연동](/docs/api/oidc-openwebui) -- Open WebUI OIDC 설정
- [ADK / Python SDK 연동](/docs/api/oidc-adk) -- Google ADK 연동 가이드
- [API 인증 가이드](/docs/api/authentication) -- 헤더 기반 인증 방식
