# Chat Completions API

Chat Completions API를 사용하여 LLM에 메시지를 보내고 응답을 받는 방법을 안내합니다.

## 엔드포인트

```
POST /v1/chat/completions
```

## 요청 형식

### 헤더

```
Content-Type: application/json
x-service-id: <서비스 ID>
x-user-id: <사용자 ID>          # Standard 서비스 필수
```

> 부서 정보는 최초 호출 시 Knox에서 자동 등록됩니다. 자세한 내용은 [API 인증 가이드](/docs/api/authentication)를 참고하세요.

### 요청 본문

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `model` | string | O | 사용할 모델 이름 |
| `messages` | array | O | 대화 메시지 배열 |
| `stream` | boolean | - | 스트리밍 응답 여부 (기본: `false`) |
| `temperature` | number | - | 응답의 무작위성 (0~2, 기본: 1) |
| `max_tokens` | number | - | 최대 출력 토큰 수 |
| `top_p` | number | - | 핵 샘플링 파라미터 (0~1) |

### messages 배열

각 메시지 객체는 `role`과 `content`를 포함합니다.

| role | 설명 |
|------|------|
| `system` | 시스템 프롬프트 (AI의 행동 지침) |
| `user` | 사용자 메시지 |
| `assistant` | AI 응답 (대화 이력에 포함할 때) |

## 기본 요청 예시

### curl

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: gildong.hong" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "system",
        "content": "당신은 친절한 AI 어시스턴트입니다."
      },
      {
        "role": "user",
        "content": "Docker 컨테이너를 실행하는 방법을 알려주세요."
      }
    ],
    "temperature": 0.7,
    "max_tokens": 1024
  }'
```

### Python

```python
import requests

response = requests.post(
    "http://a2g.samsungds.net:8090/v1/chat/completions",
    headers={
        "Content-Type": "application/json",
        "x-service-id": "my-service",
        "x-user-id": "gildong.hong",
    },
    json={
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": "당신은 친절한 AI 어시스턴트입니다."},
            {"role": "user", "content": "Docker 컨테이너를 실행하는 방법을 알려주세요."}
        ],
        "temperature": 0.7,
        "max_tokens": 1024
    }
)

result = response.json()
print(result["choices"][0]["message"]["content"])
```

## 응답 형식

### 성공 응답 (200 OK)

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1709827200,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Docker 컨테이너를 실행하려면..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 45,
    "completion_tokens": 120,
    "total_tokens": 165
  }
}
```

### 응답 필드 설명

| 필드 | 설명 |
|------|------|
| `id` | 응답 고유 식별자 |
| `model` | 사용된 모델 |
| `choices` | 응답 메시지 배열 |
| `choices[].message.content` | AI가 생성한 응답 텍스트 |
| `choices[].finish_reason` | 응답 종료 이유 (`stop`, `length`, `content_filter`) |
| `usage.prompt_tokens` | 입력 토큰 수 |
| `usage.completion_tokens` | 출력 토큰 수 |
| `usage.total_tokens` | 총 토큰 수 |

## 스트리밍 사용법

`stream: true`를 설정하면 응답이 SSE(Server-Sent Events) 형식으로 실시간 전달됩니다.

### 스트리밍 요청

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: gildong.hong" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Python의 장점을 설명해주세요."}
    ],
    "stream": true
  }'
```

### 스트리밍 응답 형식

```
data: {"id":"chatcmpl-abc123","choices":[{"delta":{"role":"assistant"},"index":0}]}

data: {"id":"chatcmpl-abc123","choices":[{"delta":{"content":"Python"},"index":0}]}

data: {"id":"chatcmpl-abc123","choices":[{"delta":{"content":"은"},"index":0}]}

data: {"id":"chatcmpl-abc123","choices":[{"delta":{"content":" 간결한"},"index":0}]}

...

data: [DONE]
```

### Python 스트리밍 예시

```python
import requests

response = requests.post(
    "http://a2g.samsungds.net:8090/v1/chat/completions",
    headers={
        "Content-Type": "application/json",
        "x-service-id": "my-service",
        "x-user-id": "gildong.hong",
    },
    json={
        "model": "gpt-4o",
        "messages": [
            {"role": "user", "content": "Python의 장점을 설명해주세요."}
        ],
        "stream": True
    },
    stream=True
)

for line in response.iter_lines():
    if line:
        line = line.decode("utf-8")
        if line.startswith("data: ") and line != "data: [DONE]":
            import json
            chunk = json.loads(line[6:])
            content = chunk["choices"][0].get("delta", {}).get("content", "")
            if content:
                print(content, end="", flush=True)
```

### JavaScript 스트리밍 예시

```javascript
const response = await fetch('http://a2g.samsungds.net:8090/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-service-id': 'my-service',
    'x-user-id': 'gildong.hong',
  },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Python의 장점을 설명해주세요.' }],
    stream: true,
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  const lines = text.split('\n').filter(line => line.startsWith('data: '));

  for (const line of lines) {
    if (line === 'data: [DONE]') break;
    const chunk = JSON.parse(line.slice(6));
    const content = chunk.choices[0]?.delta?.content || '';
    process.stdout.write(content);
  }
}
```

## 멀티턴 대화

이전 대화 내용을 `messages` 배열에 포함하여 멀티턴 대화를 구현할 수 있습니다.

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: gildong.hong" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Python이란 무엇인가요?"},
      {"role": "assistant", "content": "Python은 높은 수준의 범용 프로그래밍 언어입니다..."},
      {"role": "user", "content": "Python으로 웹 개발을 할 수 있나요?"}
    ]
  }'
```

## 에러 처리

### 주요 에러 코드

| HTTP 코드 | 의미 | 대응 방법 |
|-----------|------|-----------|
| 400 | 잘못된 요청 | 요청 본문 형식 확인 |
| 401 | 인증 실패 | 인증 헤더 확인 |
| 403 | 권한 없음 | 모델 접근 권한 확인 |
| 404 | 모델 없음 | 모델명 확인 |
| 429 | 요청 제한 초과 | 잠시 후 재시도 |
| 500 | 서버 오류 | 관리자 문의 |

### 에러 응답 예시

```json
{
  "error": {
    "message": "Model 'gpt-5' not found",
    "type": "invalid_request_error",
    "code": 404
  }
}
```

## 다음 단계

- [Models API](/docs/api/models) — 사용 가능 모델 목록 조회
- [API 인증](/docs/api/authentication) — 인증 헤더 상세 설명
- [서비스 등록 가이드](/docs/api/service-registration) — API 사용을 위한 서비스 등록
