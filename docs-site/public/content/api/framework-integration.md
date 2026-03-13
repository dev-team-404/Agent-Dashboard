# 프레임워크별 연동 가이드

::: warning
이 문서는 **2026년 3월 11일** 기준 각 프레임워크의 공식 문서 및 소스코드를 기반으로 작성되었습니다. 프레임워크 버전 업데이트에 따라 API가 변경될 수 있으니, 문제 발생 시 해당 프레임워크의 최신 공식 문서를 확인하세요.
:::

Agent Dashboard LLM Proxy는 **OpenAI 호환 API**를 제공합니다. 기존 OpenAI SDK를 그대로 사용하면서 `base_url`만 변경하고, 인증 헤더 3개를 추가하면 됩니다.

## 필수 인증 헤더

모든 프레임워크에서 아래 헤더를 반드시 전달해야 합니다.

| 헤더 | 필수 | 설명 | 예시 |
|------|------|------|------|
| `x-service-id` | O | Dashboard에 등록된 서비스 ID | `my-chatbot` |
| `x-user-id` | O* | API 호출 사용자 ID | `gildong.hong` |
| `x-dept-name` | O | 부서명 (`팀명(사업부)` 형식) | `S/W혁신팀(S.LSI)` |

> *Background 서비스는 `x-user-id` 생략 가능

```
BASE_URL = http://a2g.samsungds.net:8090/v1
```

---

## 1. 직접 HTTP 호출 (SDK 없이)

SDK를 사용하지 않고 OpenAI 호환 엔드포인트를 직접 호출하는 방법입니다.

### Python — requests

> 확인 버전: `requests 2.32.x` (2026-03-11 기준)

```python
import requests

response = requests.post(
    "http://a2g.samsungds.net:8090/v1/chat/completions",
    headers={
        "Content-Type": "application/json",
        "x-service-id": "my-chatbot",
        "x-user-id":    "gildong.hong",
        "x-dept-name":  "S/W혁신팀(S.LSI)",
    },
    json={
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": "당신은 친절한 AI 어시스턴트입니다."},
            {"role": "user", "content": "안녕하세요"}
        ],
        "temperature": 0.7,
        "max_tokens": 1024,
    },
)

result = response.json()
print(result["choices"][0]["message"]["content"])
```

#### 스트리밍 (requests + SSE)

```python
import requests
import json

response = requests.post(
    "http://a2g.samsungds.net:8090/v1/chat/completions",
    headers={
        "Content-Type": "application/json",
        "x-service-id": "my-chatbot",
        "x-user-id":    "gildong.hong",
        "x-dept-name":  "S/W혁신팀(S.LSI)",
    },
    json={
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "Python 장점을 알려주세요"}],
        "stream": True,
    },
    stream=True,
)

for line in response.iter_lines():
    if line:
        line = line.decode("utf-8")
        if line.startswith("data: ") and line != "data: [DONE]":
            chunk = json.loads(line[6:])
            content = chunk["choices"][0].get("delta", {}).get("content", "")
            if content:
                print(content, end="", flush=True)
```

#### 비동기 (httpx)

```python
import httpx
import asyncio

async def main():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://a2g.samsungds.net:8090/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "x-service-id": "my-chatbot",
                "x-user-id":    "gildong.hong",
                "x-dept-name":  "S/W혁신팀(S.LSI)",
            },
            json={
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "안녕하세요"}],
            },
            timeout=60.0,
        )
        result = response.json()
        print(result["choices"][0]["message"]["content"])

asyncio.run(main())
```

### JavaScript / TypeScript — fetch

```typescript
const response = await fetch("http://a2g.samsungds.net:8090/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-service-id": "my-chatbot",
    "x-user-id":    "gildong.hong",
    "x-dept-name":  "S/W혁신팀(S.LSI)",
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "당신은 친절한 AI 어시스턴트입니다." },
      { role: "user", content: "안녕하세요" },
    ],
    temperature: 0.7,
    max_tokens: 1024,
  }),
});

const result = await response.json();
console.log(result.choices[0].message.content);
```

#### 스트리밍 (fetch + ReadableStream)

```typescript
const response = await fetch("http://a2g.samsungds.net:8090/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-service-id": "my-chatbot",
    "x-user-id":    "gildong.hong",
    "x-dept-name":  "S/W혁신팀(S.LSI)",
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Python 장점을 알려주세요" }],
    stream: true,
  }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      const chunk = JSON.parse(line.slice(6));
      const content = chunk.choices[0]?.delta?.content || "";
      process.stdout.write(content);
    }
  }
}
```

### Go — net/http

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

func main() {
    body, _ := json.Marshal(map[string]any{
        "model": "gpt-4o",
        "messages": []map[string]string{
            {"role": "user", "content": "안녕하세요"},
        },
    })

    req, _ := http.NewRequest("POST",
        "http://a2g.samsungds.net:8090/v1/chat/completions",
        bytes.NewReader(body),
    )
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("x-service-id", "my-chatbot")
    req.Header.Set("x-user-id", "gildong.hong")
    req.Header.Set("x-dept-name", "S/W혁신팀(S.LSI)")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    defer resp.Body.Close()

    data, _ := io.ReadAll(resp.Body)

    var result map[string]any
    json.Unmarshal(data, &result)

    choices := result["choices"].([]any)
    msg := choices[0].(map[string]any)["message"].(map[string]any)
    fmt.Println(msg["content"])
}
```

### curl

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "안녕하세요"}
    ]
  }'
```

---

## 2. Python — OpenAI SDK

> `pip install openai>=1.0` — 확인 버전: `openai 1.82.x` (2026-03-11 기준)

### 클라이언트 레벨 설정 (추천)

```python
from openai import OpenAI

client = OpenAI(
    api_key="not-used",                             # 프록시에서 무시됨
    base_url="http://a2g.samsungds.net:8090/v1",
    default_headers={
        "x-service-id": "my-chatbot",
        "x-user-id":    "gildong.hong",
        "x-dept-name":  "S/W혁신팀(S.LSI)",
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
        "x-dept-name":  "S/W혁신팀(S.LSI)",
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
        "x-user-id":    "gildong.hong",
        "x-dept-name":  "S/W혁신팀(S.LSI)",
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

## 3. JavaScript / TypeScript — OpenAI SDK

> `npm install openai` — 확인 버전: `openai 4.x` (2026-03-11 기준)

### Node.js / TypeScript

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "not-used",
  baseURL: "http://a2g.samsungds.net:8090/v1",
  defaultHeaders: {
    "x-service-id": "my-chatbot",
    "x-user-id":    "gildong.hong",
    "x-dept-name":  "S/W혁신팀(S.LSI)",
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

### 스트리밍

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

## 4. Go — OpenAI SDK

### 방법 A: 공식 SDK (추천)

> `go get github.com/openai/openai-go` — 확인 버전: `openai-go v0.1.x` (2026-03-11 기준)

공식 OpenAI Go SDK는 `option.WithHeader()`로 커스텀 헤더를 직접 지원합니다.

```go
package main

import (
    "context"
    "fmt"

    "github.com/openai/openai-go"
    "github.com/openai/openai-go/option"
)

func main() {
    client := openai.NewClient(
        option.WithBaseURL("http://a2g.samsungds.net:8090/v1"),
        option.WithAPIKey("not-used"),
        option.WithHeader("x-service-id", "my-chatbot"),
        option.WithHeader("x-user-id", "gildong.hong"),
        option.WithHeader("x-dept-name", "S/W혁신팀(S.LSI)"),
    )

    response, err := client.Chat.Completions.New(
        context.Background(),
        openai.ChatCompletionNewParams{
            Model: "gpt-4o",
            Messages: []openai.ChatCompletionMessageParamUnion{
                openai.UserMessage("안녕하세요"),
            },
        },
    )
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    fmt.Println(response.Choices[0].Message.Content)
}
```

요청별 헤더 오버라이드:

```go
response, err := client.Chat.Completions.New(
    context.Background(),
    params,
    option.WithHeader("x-user-id", "kim.minsu"),  // 이 요청만 다른 사용자
)
```

### 방법 B: 커뮤니티 SDK (sashabaranov)

> `go get github.com/sashabaranov/go-openai` — 확인 버전: `go-openai v1.36.x` (2026-03-11 기준)

이 라이브러리는 헤더 파라미터를 직접 지원하지 않으므로, **커스텀 HTTP Transport**를 사용합니다.

```go
package main

import (
    "context"
    "fmt"
    "net/http"

    openai "github.com/sashabaranov/go-openai"
)

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
    transport := &headerTransport{
        base: http.DefaultTransport,
        headers: map[string]string{
            "x-service-id": "my-chatbot",
            "x-user-id":    "gildong.hong",
            "x-dept-name":  "S/W혁신팀(S.LSI)",
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

---

## 5. LangChain (Python)

> `pip install langchain-openai` — 확인 버전: `langchain-openai 0.3.x` (2026-03-11 기준)

### ChatOpenAI 기본 설정

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-4o",
    base_url="http://a2g.samsungds.net:8090/v1",
    api_key="not-used",
    default_headers={
        "x-service-id": "my-chatbot",
        "x-user-id":    "gildong.hong",
        "x-dept-name":  "S/W혁신팀(S.LSI)",
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

## 6. LangChain (JavaScript / TypeScript)

> `npm install @langchain/openai` — 확인 버전: `@langchain/openai 0.4.x` (2026-03-11 기준)

```typescript
import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
  model: "gpt-4o",
  configuration: {
    baseURL: "http://a2g.samsungds.net:8090/v1",
    defaultHeaders: {
      "x-service-id": "my-chatbot",
      "x-user-id":    "gildong.hong",
      "x-dept-name":  "S/W혁신팀(S.LSI)",
    },
  },
  apiKey: "not-used",
});

const response = await llm.invoke("안녕하세요");
console.log(response.content);
```

---

## 7. LangGraph (Python)

> `pip install langgraph langchain-openai` — 확인 버전: `langgraph 0.3.x` (2026-03-11 기준)

LangGraph는 LangChain의 `ChatOpenAI`를 그대로 사용합니다. 위 LangChain 설정과 동일하게 `default_headers`를 전달하면 됩니다.

### ReAct Agent 예시

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool

llm = ChatOpenAI(
    model="gpt-4o",
    base_url="http://a2g.samsungds.net:8090/v1",
    api_key="not-used",
    default_headers={
        "x-service-id": "my-agent-service",
        "x-user-id":    "gildong.hong",
        "x-dept-name":  "S/W혁신팀(S.LSI)",
    },
)

@tool
def get_weather(city: str) -> str:
    """도시의 날씨를 조회합니다."""
    return f"{city}의 현재 날씨: 맑음, 22°C"

agent = create_react_agent(llm, tools=[get_weather])
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

## 8. Google ADK — Python

> `pip install google-adk` — 확인 버전: `google-adk 1.x` (2026-03-11 기준)

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
            "x-user-id":    "gildong.hong",
            "x-dept-name":  "S/W혁신팀(S.LSI)",
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
            "x-user-id":    "gildong.hong",
            "x-dept-name":  "S/W혁신팀(S.LSI)",
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

## 9. Google ADK — TypeScript

> `npm install @google/adk` — 확인 버전: `@google/adk 0.x` (2026-03-11 기준, 2025-12 출시)

TypeScript ADK도 Python과 동일하게 LiteLLM 래퍼를 사용합니다.

```typescript
import { LlmAgent } from "@google/adk";
import { LiteLlm } from "@google/adk/models/lite_llm";

const agent = new LlmAgent({
  model: new LiteLlm({
    model: "openai/gpt-4o",
    api_base: "http://a2g.samsungds.net:8090/v1",
    api_key: "not-used",
    extra_headers: {
      "x-service-id": "my-adk-agent",
      "x-user-id":    "gildong.hong",
      "x-dept-name":  "S/W혁신팀(S.LSI)",
    },
  }),
  name: "my_agent",
  instruction: "당신은 친절한 AI 어시스턴트입니다.",
});
```

::: info
Google ADK TypeScript는 2025년 12월에 출시되었으며 빠르게 업데이트되고 있습니다. `LiteLlm` 임포트 경로가 변경될 수 있으니 공식 문서를 확인하세요: https://google.github.io/adk-docs/get-started/typescript/
:::

---

## 10. Google ADK — Go

> `go get google.golang.org/adk` — 확인 버전: `adk-go v0.x` (2026-03-11 기준)

Go ADK는 `model.LLM` 인터페이스를 사용합니다. OpenAI 호환 엔드포인트 연동 시 **LiteLLM Proxy 서버**를 경유하거나, 직접 `model.LLM` 인터페이스를 구현해야 합니다.

### 방법 A: LiteLLM Proxy 경유 (추천)

LiteLLM Proxy 서버를 별도로 띄워 Agent Dashboard를 upstream으로 설정하면, ADK Go에서 Gemini처럼 자연스럽게 사용할 수 있습니다.

### 방법 B: Go OpenAI SDK + ADK BeforeModelCallback

ADK Go의 콜백 기능과 Go OpenAI SDK를 조합하는 방식입니다.

```go
package main

import (
    "context"
    "fmt"

    "github.com/openai/openai-go"
    "github.com/openai/openai-go/option"
)

func main() {
    // ADK Go는 현재 Gemini 모델에 최적화되어 있으므로,
    // OpenAI 호환 프록시 직접 호출 시에는 Go OpenAI SDK를 사용하세요 (섹션 4 참고).

    client := openai.NewClient(
        option.WithBaseURL("http://a2g.samsungds.net:8090/v1"),
        option.WithAPIKey("not-used"),
        option.WithHeader("x-service-id", "my-chatbot"),
        option.WithHeader("x-user-id", "gildong.hong"),
        option.WithHeader("x-dept-name", "S/W혁신팀(S.LSI)"),
    )

    response, err := client.Chat.Completions.New(
        context.Background(),
        openai.ChatCompletionNewParams{
            Model: "gpt-4o",
            Messages: []openai.ChatCompletionMessageParamUnion{
                openai.UserMessage("안녕하세요"),
            },
        },
    )
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    fmt.Println(response.Choices[0].Message.Content)
}
```

::: warning
Google ADK Go는 현재 Gemini/Vertex AI 모델에 최적화되어 있으며, OpenAI 호환 엔드포인트에 대한 공식 LiteLLM 래퍼가 Go용으로는 아직 제공되지 않습니다 (2026-03-11 기준). OpenAI 호환 프록시를 직접 호출할 때는 **섹션 4의 Go OpenAI SDK**를 사용하세요.
:::

---

## 11. Agno (구 Phidata) — Python

> `pip install agno` — 확인 버전: `agno 1.x` (2026-03-11 기준, Python 전용)

::: info
Agno는 **Python 전용** 프레임워크입니다. JavaScript/Go SDK는 제공되지 않습니다 (2026-03-11 기준).
:::

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
            "x-user-id":    "gildong.hong",
            "x-dept-name":  "S/W혁신팀(S.LSI)",
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
            "x-user-id":    "gildong.hong",
            "x-dept-name":  "S/W혁신팀(S.LSI)",
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
            "x-user-id":    "gildong.hong",
            "x-dept-name":  "S/W혁신팀(S.LSI)",
        },
    ),
    tools=[DuckDuckGoTools()],
    show_tool_calls=True,
)

agent.print_response("최신 AI 뉴스를 검색해주세요.")
```

---

## 빠른 비교표

| # | 프레임워크 | 언어 | 헤더 설정 방법 | 핵심 파라미터 |
|---|-----------|------|--------------|-------------|
| 1 | **직접 HTTP 호출** | Python | `headers={}` | `requests.post(url, headers=...)` |
| 1 | **직접 HTTP 호출** | JS/TS | `headers: {}` | `fetch(url, { headers })` |
| 1 | **직접 HTTP 호출** | Go | `req.Header.Set()` | `http.NewRequest` + `Header.Set` |
| 2 | **OpenAI SDK** | Python | `default_headers` / `extra_headers` | `OpenAI(base_url=..., default_headers=...)` |
| 3 | **OpenAI SDK** | JS/TS | `defaultHeaders` | `new OpenAI({ baseURL, defaultHeaders })` |
| 4 | **OpenAI SDK (공식)** | Go | `option.WithHeader()` | `openai.NewClient(option.WithHeader(...))` |
| 4 | **OpenAI SDK (커뮤니티)** | Go | 커스텀 Transport | `config.HTTPClient = &http.Client{...}` |
| 5 | **LangChain** | Python | `default_headers` | `ChatOpenAI(base_url=..., default_headers=...)` |
| 6 | **LangChain** | JS/TS | `configuration.defaultHeaders` | `new ChatOpenAI({ configuration: { defaultHeaders } })` |
| 7 | **LangGraph** | Python | LangChain과 동일 | `ChatOpenAI(default_headers=...)` |
| 8 | **Google ADK** | Python | `extra_headers` (via LiteLLM) | `LiteLlm(api_base=..., extra_headers=...)` |
| 9 | **Google ADK** | JS/TS | `extra_headers` (via LiteLLM) | `new LiteLlm({ extra_headers })` |
| 10 | **Google ADK** | Go | 공식 LiteLLM 래퍼 미지원 | Go OpenAI SDK 사용 권장 |
| 11 | **Agno** | Python | `default_headers` | `OpenAILike(base_url=..., default_headers=...)` |

---

## 공통 주의사항

::: warning
- `api_key`는 프록시에서 무시되지만 SDK 초기화 시 필수이므로 `"not-used"` 등 임의 값을 입력하세요.
- `base_url`은 반드시 `/v1`까지 포함해야 합니다: `http://a2g.samsungds.net:8090/v1`
- `x-dept-name`은 반드시 `팀명(사업부)` 형식이어야 합니다 (예: `S/W혁신팀(S.LSI)`)
- Background 서비스 타입으로 등록된 서비스만 `x-user-id`를 생략할 수 있습니다.
:::

## 참고 문서 (2026-03-11 기준)

| 프레임워크 | 공식 문서 |
|-----------|----------|
| OpenAI Python SDK | https://github.com/openai/openai-python |
| OpenAI Node.js SDK | https://github.com/openai/openai-node |
| OpenAI Go SDK (공식) | https://github.com/openai/openai-go |
| Go OpenAI (sashabaranov) | https://github.com/sashabaranov/go-openai |
| LangChain Python | https://python.langchain.com |
| LangChain JS | https://js.langchain.com |
| LangGraph | https://langchain-ai.github.io/langgraph |
| Google ADK | https://google.github.io/adk-docs |
| Google ADK TypeScript | https://github.com/google/adk-js |
| Google ADK Go | https://github.com/google/adk-go |
| Agno (구 Phidata) | https://docs.agno.com |

## 다음 단계

- [API 인증 가이드](/docs/api/authentication) — 인증 헤더 상세 설명
- [Chat Completions API](/docs/api/chat-completions) — API 상세 스펙
- [서비스 등록 가이드](/docs/api/service-registration) — 서비스 등록 방법
- [서비스 모델 관리](/docs/service/service-models) — 모델 접근 권한 설정
