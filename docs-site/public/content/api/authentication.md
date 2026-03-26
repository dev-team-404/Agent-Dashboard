# API 인증 가이드

Agent Registry API의 인증 방식을 안내합니다.

## 인증 방식 개요

Agent Registry API는 **헤더 기반 인증**을 사용합니다. Bearer 토큰이 아닌 커스텀 HTTP 헤더로 서비스와 사용자를 식별합니다.

## Standard 서비스 인증

Standard 서비스는 사용자를 식별하여 API를 호출합니다. 아래 2개의 헤더가 필수입니다.

| 헤더 | 필수 | 설명 |
|------|------|------|
| `x-service-id` | O | 등록된 서비스 ID |
| `x-user-id` | O | API를 호출하는 사용자 ID |

> **부서 정보 자동 처리**: `x-dept-name` 헤더는 불필요합니다. 최초 호출 시 Knox 임직원 API를 통해 부서 정보가 자동으로 등록되며, 이후에는 DB에서 자동 조회됩니다.

### 요청 예시

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: gildong.hong" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "안녕하세요"}
    ]
  }'
```

## Background 서비스 인증

Background 서비스는 사용자 식별 없이 서비스 단위로 API를 호출합니다.

| 헤더 | 필수 | 설명 |
|------|------|------|
| `x-service-id` | O | 등록된 서비스 ID |
| `x-dept-name` | O | 서비스의 부서명 (시스템에 등록된 부서만 허용) |

> **부서 검증**: `x-dept-name`에 입력하는 부서명은 시스템 조직도에 등록된 부서여야 합니다. 한글명(`S/W혁신팀(S.LSI)`) 또는 영문명 모두 사용 가능합니다. 등록되지 않은 부서명은 거부됩니다.

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

## x-dept-name 형식 (Background 서비스 전용)

Background 서비스에서 사용하는 `x-dept-name` 헤더는 아래 형식을 따릅니다. 한글명 또는 영문명 모두 지원됩니다.

### 한글 형식

```
형식: 팀명(사업부)
```

| x-dept-name 값 | 설명 |
|-----------------|------|
| `S/W혁신팀(S.LSI)` | S.LSI 사업부 S/W혁신팀 |
| `플랫폼개발팀(MX)` | MX 사업부 플랫폼개발팀 |
| `AI연구팀(DS)` | DS 사업부 AI연구팀 |

### 영문 형식

조직도에 등록된 영문 부서명도 사용 가능합니다 (예: `SW Innovation Team`).

> **중요**: `x-dept-name` 값은 시스템 조직도(DB)에 등록된 부서명과 일치해야 합니다. 등록되지 않은 부서명을 사용하면 `403 Unknown department` 에러가 반환됩니다.

## 인증 헤더 요약

```
┌─────────────────────────────────────────────────────┐
│                  Standard 서비스                      │
│                                                     │
│  x-service-id: my-service        (필수)             │
│  x-user-id: gildong.hong         (필수)             │
│  x-dept-name:                     (불필요 — 자동)    │
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
  "error": "x-service-id header is required",
  "message": "All API calls must include x-service-id header."
}
```

### 사용자 ID가 없는 경우 (Standard 서비스)

```json
{
  "error": "x-user-id header is required for standard services",
  "message": "Standard services must include x-user-id header."
}
```

### 부서명이 없는 경우 (Background 서비스)

```json
{
  "error": "x-dept-name header is required for background services",
  "message": "Background services must include x-dept-name header."
}
```

### 등록되지 않은 부서명 (Background 서비스)

```json
{
  "error": "Unknown department",
  "message": "부서 'UNKNOWN팀'이(가) 시스템에 등록되지 않은 부서입니다. 조직도에 등록된 부서명(한글/영문)을 사용해 주세요."
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
