# 프레임워크별 연동 가이드

Agent Dashboard LLM Proxy는 **OpenAI 호환 API**를 제공합니다. 기존 OpenAI SDK를 그대로 사용하면서 `base_url`만 변경하고, 인증 헤더 3개를 추가하면 됩니다.

## 필수 인증 헤더

모든 프레임워크에서 아래 헤더를 반드시 전달해야 합니다.

| 헤더 | 필수 | 설명 | 예시 |
|------|------|------|------|
| `x-service-id` | O | Dashboard에 등록된 서비스 ID | `my-chatbot` |
| `x-user-id` | O* | API 호출 사용자 ID | `hong.gildong` |
| `x-dept-name` | O | 부서명 (`팀명(사업부)` 형식) | `SW혁신팀(S.LSI)` |

> *Background 서비스는 `x-user-id` 생략 가능

```
BASE_URL = http://a2g.samsungds.net:8090/v1
```

---

## 1. Python — OpenAI SDK (직접 호출)

> `pip install openai>=1.0`

### 클라이언트 레벨 설정 (추천)

```python
from openai import OpenAI

client = OpenAI(
    api_key="not-used",                             # 프록시에서 무시됨
    base_url="http://a2g.samsungds.net:8090/v1",
    default_headers={
        "x-service-id": "my-chatbot",
        "x-user-id":    "hong.gildong",
        "x-dept-name":  "SW혁신팀(S.LSI)",
    },
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "안녕하세요"}],
)
print(response.choices[0].message.content)
```

### 요청별 헤더 (동적 사용자)

```python
# 클라이언트는 서비스 헤더만 설정
client = OpenAI(
    api_key="not-used",
    base_url="http://a2g.samsungds.net:8090/v1",
    default_headers={
        "x-service-id": "my-chatbot",
        "x-dept-name":  "SW혁신팀(S.LSI)",
    },
)

# 요청마다 사용자 변경
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "안녕하세요"}],
    extra_headers={"x-user-id": "kim.minsu"},
)
```

### 비동기 (AsyncOpenAI)

```python
from openai import AsyncOpenAI
import asyncio

client = AsyncOpenAI(
    api_key="not-used",
    base_url="http://a2g.samsungds.net:8090/v1",
    default_headers={
        "x-service-id": "my-chatbot",
        "x-user-id":    "hong.gildong",
        "x-dept-name":  "SW혁신팀(S.LSI)",
    },
)

async def main():
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "안녕하세요"}],
    )
    print(response.choices[0].message.content)

asyncio.run(main())
```

### 스트리밍

```python
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Python 장점을 알려주세요"}],
    stream=True,
)

for chunk in stream:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
```

---

## 2. JavaScript / TypeScript — OpenAI SDK

> `npm install openai`

### Node.js / TypeScript

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "not-used",
  baseURL: "http://a2g.samsungds.net:8090/v1",
  defaultHeaders: {
    "x-service-id": "my-chatbot",
    "x-user-id":    "hong.gildong",
    "x-dept-name":  "SW혁신팀(S.LSI)",
  },
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "안녕하세요" }],
});

console.log(response.choices[0].message.content);
```

### 요청별 헤더

```typescript
const response = await client.chat.completions.create(
  {
    model: "gpt-4o",
    messages: [{ role: "user", content: "안녕하세요" }],
  },
  {
    headers: { "x-user-id": "kim.minsu" },
  }
);
```

### 스트리밍 (Node.js)

```typescript
const stream = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Python 장점을 알려주세요" }],
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || "";
  process.stdout.write(content);
}
```

---

## 3. Go — OpenAI SDK

> `go get github.com/sashabaranov/go-openai`

Go SDK는 `default_headers` 파라미터를 직접 지원하지 않으므로, **커스텀 HTTP Transport**를 사용합니다.

```go
package main

import (
    "context"
    "fmt"
    "net/http"

    openai "github.com/sashabaranov/go-openai"
)

// 커스텀 헤더를 자동 주입하는 Transport
type headerTransport struct {
    base    http.RoundTripper
    headers map[string]string
}

func (t *headerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    for key, value := range t.headers {
        req.Header.Set(key, value)
    }
    return t.base.RoundTrip(req)
}

func main() {
    // 커스텀 헤더 설정
    transport := &headerTransport{
        base: http.DefaultTransport,
        headers: map[string]string{
            "x-service-id": "my-chatbot",
            "x-user-id":    "hong.gildong",
            "x-dept-name":  "SW혁신팀(S.LSI)",
        },
    }

    config := openai.DefaultConfig("not-used")
    config.BaseURL = "http://a2g.samsungds.net:8090/v1"
    config.HTTPClient = &http.Client{Transport: transport}

    client := openai.NewClientWithConfig(config)

    resp, err := client.CreateChatCompletion(
        context.Background(),
        openai.ChatCompletionRequest{
            Model: "gpt-4o",
            Messages: []openai.ChatCompletionMessage{
                {Role: openai.ChatMessageRoleUser, Content: "안녕하세요"},
            },
        },
    )

    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }

    fmt.Println(resp.Choices[0].Message.Content)
}
```

### Go 스트리밍

```go
stream, err := client.CreateChatCompletionStream(
    context.Background(),
    openai.ChatCompletionRequest{
        Model: "gpt-4o",
        Messages: []openai.ChatCompletionMessage{
            {Role: openai.ChatMessageRoleUser, Content: "Python 장점을 알려주세요"},
        },
        Stream: true,
    },
)
if err != nil {
    fmt.Printf("Error: %v\n", err)
    return
}
defer stream.Close()

for {
    resp, err := stream.Recv()
    if err != nil {
        break
    }
    fmt.Print(resp.Choices[0].Delta.Content)
}
```

---

## 4. LangChain (Python)

> `pip install langchain-openai`

### ChatOpenAI 기본 설정

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-4o",
    base_url="http://a2g.samsungds.net:8090/v1",
    api_key="not-used",
    default_headers={
        "x-service-id": "my-chatbot",
        "x-user-id":    "hong.gildong",
        "x-dept-name":  "SW혁신팀(S.LSI)",
    },
)

response = llm.invoke("안녕하세요")
print(response.content)
```

### Chain 연결

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

prompt = ChatPromptTemplate.from_messages([
    ("system", "당신은 {role} 전문가입니다."),
    ("user", "{question}"),
])

chain = prompt | llm | StrOutputParser()
result = chain.invoke({"role": "Python", "question": "데코레이터를 설명해주세요"})
print(result)
```

### 스트리밍

```python
for chunk in llm.stream("Python의 장점을 알려주세요"):
    print(chunk.content, end="", flush=True)
```

---

## 5. LangGraph (Python)

> `pip install langgraph langchain-openai`

LangGraph는 LangChain의 `ChatOpenAI`를 그대로 사용합니다. 위 LangChain 설정과 동일하게 `default_headers`를 전달하면 됩니다.

### ReAct Agent 예시

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool

# 동일한 헤더 설정
llm = ChatOpenAI(
    model="gpt-4o",
    base_url="http://a2g.samsungds.net:8090/v1",
    api_key="not-used",
    default_headers={
        "x-service-id": "my-agent-service",
        "x-user-id":    "hong.gildong",
        "x-dept-name":  "SW혁신팀(S.LSI)",
    },
)

@tool
def get_weather(city: str) -> str:
    """도시의 날씨를 조회합니다."""
    return f"{city}의 현재 날씨: 맑음, 22°C"

# ReAct Agent 생성
agent = create_react_agent(llm, tools=[get_weather])

# 실행
result = agent.invoke(
    {"messages": [{"role": "user", "content": "서울 날씨 알려줘"}]}
)

for msg in result["messages"]:
    print(f"[{msg.type}] {msg.content}")
```

### StateGraph (커스텀 그래프)

```python
from langgraph.graph import StateGraph, MessagesState, START, END

def chatbot(state: MessagesState):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

graph = StateGraph(MessagesState)
graph.add_node("chatbot", chatbot)
graph.add_edge(START, "chatbot")
graph.add_edge("chatbot", END)

app = graph.compile()
result = app.invoke({"messages": [{"role": "user", "content": "안녕하세요"}]})
print(result["messages"][-1].content)
```

---

## 6. LangChain (JavaScript / TypeScript)

> `npm install @langchain/openai`

```typescript
import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
  model: "gpt-4o",
  configuration: {
    baseURL: "http://a2g.samsungds.net:8090/v1",
    defaultHeaders: {
      "x-service-id": "my-chatbot",
      "x-user-id":    "hong.gildong",
      "x-dept-name":  "SW혁신팀(S.LSI)",
    },
  },
  apiKey: "not-used",
});

const response = await llm.invoke("안녕하세요");
console.log(response.content);
```

---

## 7. Google ADK (Agent Development Kit)

> `pip install google-adk`

Google ADK는 **LiteLLM 커넥터**를 통해 OpenAI 호환 엔드포인트에 연결합니다.

### 기본 설정

```python
from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm

agent = LlmAgent(
    model=LiteLlm(
        model="openai/gpt-4o",
        api_base="http://a2g.samsungds.net:8090/v1",
        api_key="not-used",
        extra_headers={
            "x-service-id": "my-adk-agent",
            "x-user-id":    "hong.gildong",
            "x-dept-name":  "SW혁신팀(S.LSI)",
        },
    ),
    name="my_agent",
    instruction="당신은 친절한 AI 어시스턴트입니다.",
)
```

### Tool 사용 Agent

```python
from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools import FunctionTool

def get_weather(city: str) -> dict:
    """도시의 날씨를 조회합니다."""
    return {"city": city, "weather": "맑음", "temp": "22°C"}

weather_tool = FunctionTool(func=get_weather)

agent = LlmAgent(
    model=LiteLlm(
        model="openai/gpt-4o",
        api_base="http://a2g.samsungds.net:8090/v1",
        api_key="not-used",
        extra_headers={
            "x-service-id": "my-adk-agent",
            "x-user-id":    "hong.gildong",
            "x-dept-name":  "SW혁신팀(S.LSI)",
        },
    ),
    name="weather_agent",
    instruction="사용자의 날씨 질문에 도구를 사용해 답변하세요.",
    tools=[weather_tool],
)
```

::: tip
Google ADK에서 `model` 파라미터에 `openai/` 접두사를 붙여야 LiteLLM이 OpenAI 호환 프로토콜을 사용합니다.
:::

---

## 8. Agno (구 Phidata)

> `pip install agno`

### OpenAILike 모델

```python
from agno.agent import Agent
from agno.models.openai.like import OpenAILike

agent = Agent(
    model=OpenAILike(
        id="gpt-4o",
        api_key="not-used",
        base_url="http://a2g.samsungds.net:8090/v1",
        default_headers={
            "x-service-id": "my-agno-service",
            "x-user-id":    "hong.gildong",
            "x-dept-name":  "SW혁신팀(S.LSI)",
        },
    ),
)

agent.print_response("안녕하세요, 자기소개 부탁드립니다.")
```

### OpenAIChat 직접 사용

```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat

agent = Agent(
    model=OpenAIChat(
        id="gpt-4o",
        api_key="not-used",
        base_url="http://a2g.samsungds.net:8090/v1",
        default_headers={
            "x-service-id": "my-agno-service",
            "x-user-id":    "hong.gildong",
            "x-dept-name":  "SW혁신팀(S.LSI)",
        },
    ),
)

agent.print_response("Python과 Go의 차이점을 알려주세요.")
```

### Tool 사용

```python
from agno.agent import Agent
from agno.models.openai.like import OpenAILike
from agno.tools.duckduckgo import DuckDuckGoTools

agent = Agent(
    model=OpenAILike(
        id="gpt-4o",
        api_key="not-used",
        base_url="http://a2g.samsungds.net:8090/v1",
        default_headers={
            "x-service-id": "my-agno-service",
            "x-user-id":    "hong.gildong",
            "x-dept-name":  "SW혁신팀(S.LSI)",
        },
    ),
    tools=[DuckDuckGoTools()],
    show_tool_calls=True,
)

agent.print_response("최신 AI 뉴스를 검색해주세요.")
```

---

## 빠른 비교표

| 프레임워크 | 언어 | 헤더 설정 방법 | 핵심 파라미터 |
|-----------|------|--------------|-------------|
| **OpenAI SDK** | Python | `default_headers` / `extra_headers` | `OpenAI(base_url=..., default_headers=...)` |
| **OpenAI SDK** | JS/TS | `defaultHeaders` | `new OpenAI({ baseURL, defaultHeaders })` |
| **OpenAI SDK** | Go | 커스텀 Transport | `config.HTTPClient = &http.Client{Transport: ...}` |
| **LangChain** | Python | `default_headers` | `ChatOpenAI(base_url=..., default_headers=...)` |
| **LangChain** | JS/TS | `configuration.defaultHeaders` | `new ChatOpenAI({ configuration: { defaultHeaders } })` |
| **LangGraph** | Python | LangChain과 동일 | `ChatOpenAI(default_headers=...)` |
| **Google ADK** | Python | `extra_headers` (via LiteLLM) | `LiteLlm(api_base=..., extra_headers=...)` |
| **Agno** | Python | `default_headers` | `OpenAILike(base_url=..., default_headers=...)` |

---

## 공통 주의사항

::: warning
- `api_key`는 프록시에서 무시되지만 SDK 초기화 시 필수이므로 `"not-used"` 등 임의 값을 입력하세요.
- `base_url`은 반드시 `/v1`까지 포함해야 합니다: `http://a2g.samsungds.net:8090/v1`
- `x-dept-name`은 반드시 `팀명(사업부)` 형식이어야 합니다 (예: `SW혁신팀(S.LSI)`)
- Background 서비스 타입으로 등록된 서비스만 `x-user-id`를 생략할 수 있습니다.
:::

## 다음 단계

- [API 인증 가이드](/docs/api/authentication) — 인증 헤더 상세 설명
- [Chat Completions API](/docs/api/chat-completions) — API 상세 스펙
- [서비스 등록 가이드](/docs/api/service-registration) — 서비스 등록 방법
- [서비스 모델 관리](/docs/service/service-models) — 모델 접근 권한 설정
