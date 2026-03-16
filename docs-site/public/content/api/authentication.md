# API 인증 가이드

Agent Registry API의 인증 방식을 안내합니다.

## 인증 방식 개요

Agent Registry API는 **헤더 기반 인증**을 사용합니다. Bearer 토큰이 아닌 커스텀 HTTP 헤더로 서비스와 사용자를 식별합니다.

## 일반 서비스 인증

일반 서비스는 사용자를 식별하여 API를 호출합니다. 아래 3개의 헤더가 필수입니다.

| 헤더 | 필수 | 설명 |
|------|------|------|
| `x-service-id` | O | 등록된 서비스 ID |
| `x-user-id` | O | API를 호출하는 사용자 ID |
| `x-dept-name` | O | 사용자의 부서명 |

### 요청 예시

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

## Background 서비스 인증

Background 서비스는 사용자 식별 없이 서비스 단위로 API를 호출합니다. `x-user-id`가 필요하지 않습니다.

| 헤더 | 필수 | 설명 |
|------|------|------|
| `x-service-id` | O | 등록된 서비스 ID |
| `x-dept-name` | O | 서비스의 부서명 |

### 요청 예시

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: batch-pipeline" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "데이터를 분석해주세요"}
    ]
  }'
```

## x-dept-name 형식

`x-dept-name` 헤더의 값은 아래 형식을 따릅니다.

```
형식: 팀명(사업부)
```

### 예시

| x-dept-name 값 | 설명 |
|-----------------|------|
| `S/W혁신팀(S.LSI)` | S.LSI 사업부 S/W혁신팀 |
| `플랫폼개발팀(MX)` | MX 사업부 플랫폼개발팀 |
| `AI연구팀(DS)` | DS 사업부 AI연구팀 |

> **중요**: `x-dept-name`은 Dashboard에 등록된 부서명과 정확히 일치해야 합니다. 대소문자와 괄호를 포함하여 정확하게 입력하세요.

## 인증 헤더 요약

```
┌─────────────────────────────────────────────────────┐
│                    일반 서비스                         │
│                                                     │
│  x-service-id: my-service        (필수)             │
│  x-user-id: gildong.hong         (필수)             │
│  x-dept-name: S/W혁신팀(S.LSI)     (필수)             │
├─────────────────────────────────────────────────────┤
│                  Background 서비스                    │
│                                                     │
│  x-service-id: batch-pipeline    (필수)             │
│  x-dept-name: S/W혁신팀(S.LSI)     (필수)             │
│  x-user-id:                       (불필요)           │
└─────────────────────────────────────────────────────┘
```

## 에러 응답

인증에 실패하면 아래와 같은 에러 응답이 반환됩니다.

### 서비스 ID가 없거나 잘못된 경우

```json
{
  "error": {
    "message": "Invalid or missing x-service-id header",
    "type": "authentication_error",
    "code": 401
  }
}
```

### 사용자 ID가 없는 경우 (일반 서비스)

```json
{
  "error": {
    "message": "x-user-id header is required for this service",
    "type": "authentication_error",
    "code": 401
  }
}
```

### 부서명이 없거나 잘못된 경우

```json
{
  "error": {
    "message": "Invalid or missing x-dept-name header",
    "type": "authentication_error",
    "code": 401
  }
}
```

### 권한이 없는 모델 요청

```json
{
  "error": {
    "message": "Model not available for this service",
    "type": "permission_error",
    "code": 403
  }
}
```

## 프로그래밍 언어별 예시

### Python

```python
import requests

headers = {
    "Content-Type": "application/json",
    "x-service-id": "my-service",
    "x-user-id": "gildong.hong",
    "x-dept-name": "S/W혁신팀(S.LSI)",
}

data = {
    "model": "gpt-4o",
    "messages": [
        {"role": "user", "content": "안녕하세요"}
    ]
}

response = requests.post(
    "http://a2g.samsungds.net:8090/v1/chat/completions",
    headers=headers,
    json=data
)

print(response.json())
```

### JavaScript (Node.js)

```javascript
const response = await fetch('http://a2g.samsungds.net:8090/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-service-id': 'my-service',
    'x-user-id': 'gildong.hong',
    'x-dept-name': 'S/W혁신팀(S.LSI)',
  },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: '안녕하세요' }
    ],
  }),
});

const result = await response.json();
console.log(result);
```

## 다음 단계

- [Chat Completions API](/docs/api/chat-completions) — API 호출 방법 상세 가이드
- [Models API](/docs/api/models) — 사용 가능 모델 목록 조회
- [서비스 등록 가이드](/docs/api/service-registration) — 서비스 등록 방법
