# Models API

사용 가능한 LLM 모델 목록을 조회하는 API를 안내합니다.

## 모델 목록 조회

### 엔드포인트

```
GET /v1/models
```

### 요청

```bash
curl -X GET http://a2g.samsungds.net:8090/v1/models \
  -H "x-service-id: my-service" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)"
```

> **참고**: Background 서비스의 경우 `x-user-id` 헤더를 생략합니다.

### 응답 (서비스 모델이 설정된 경우)

서비스에 모델 설정(표시 모델명/alias)이 구성되어 있으면, **표시 모델명만 반환**됩니다.

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1709827200,
      "owned_by": "agent-dashboard"
    },
    {
      "id": "claude",
      "object": "model",
      "created": 1709827200,
      "owned_by": "agent-dashboard"
    }
  ]
}
```

위 예시에서 `gpt-4o`와 `claude`는 서비스 관리자가 설정한 **표시 모델명(alias)**입니다. 같은 alias 뒤에 여러 실제 LLM 모델이 가중치 기반 라운드로빈으로 연결되어 있을 수 있습니다.

### 응답 (서비스 모델이 설정되지 않은 경우)

서비스에 모델을 아직 설정하지 않았으면, 접근 가능한 전체 LLM 모델 목록이 반환됩니다.

```json
{
  "object": "list",
  "data": [
    {
      "id": "GPT-4o",
      "object": "model",
      "created": 1709827200,
      "owned_by": "agent-dashboard"
    },
    {
      "id": "Claude Sonnet 4.6",
      "object": "model",
      "created": 1709827200,
      "owned_by": "agent-dashboard"
    }
  ]
}
```

### 응답 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `object` | string | 항상 `"list"` |
| `data` | array | 모델 객체 배열 |
| `data[].id` | string | 모델 ID (API 호출 시 `model` 파라미터에 사용). 서비스 모델 설정이 있으면 표시 모델명(alias), 없으면 실제 모델 displayName |
| `data[].object` | string | 항상 `"model"` |
| `data[].created` | number | 타임스탬프 |
| `data[].owned_by` | string | `"agent-dashboard"` |

## 특정 모델 정보 조회

### 엔드포인트

```
GET /v1/models/:name
```

### 요청

```bash
curl -X GET http://a2g.samsungds.net:8090/v1/models/gpt-4o \
  -H "x-service-id: my-service" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)"
```

### 응답

```json
{
  "id": "gpt-4o",
  "object": "model",
  "created": 1709827200,
  "owned_by": "agent-dashboard"
}
```

### 모델이 존재하지 않는 경우

```json
{
  "error": {
    "message": "Model 'gpt-5' not found",
    "type": "invalid_request_error",
    "code": 404
  }
}
```

## 서비스별 모델 목록이 다른 이유

각 서비스는 **모델 설정** 페이지에서 독자적인 표시 모델명(alias)을 구성할 수 있습니다. 따라서 동일한 LLM 모델이라도 서비스마다 다른 이름으로 노출될 수 있습니다.

```
서비스 A의 v1/models → ["gpt-4o", "claude"]
서비스 B의 v1/models → ["chat-model", "code-model"]
서비스 C (미설정)    → ["GPT-4o", "Claude Sonnet 4.6"] (전체 모델)
```

자세한 설정 방법은 [서비스 모델 관리](/docs/service/service-models)를 참고하세요.

## 활용 예시

### Python - 사용 가능 모델 목록 출력

```python
import requests

response = requests.get(
    "http://a2g.samsungds.net:8090/v1/models",
    headers={
        "x-service-id": "my-service",
        "x-user-id": "hong.gildong",
        "x-dept-name": "SW혁신팀(S.LSI)",
    }
)

models = response.json()["data"]
for model in models:
    print(f"- {model['id']}")
```

### JavaScript - 모델 목록을 드롭다운에 표시

```javascript
const response = await fetch('http://a2g.samsungds.net:8090/v1/models', {
  headers: {
    'x-service-id': 'my-service',
    'x-user-id': 'hong.gildong',
    'x-dept-name': 'SW혁신팀(S.LSI)',
  },
});

const { data: models } = await response.json();

// 모델 목록으로 드롭다운 생성
const select = document.getElementById('model-select');
models.forEach(model => {
  const option = document.createElement('option');
  option.value = model.id;
  option.textContent = model.id;
  select.appendChild(option);
});
```

### 특정 모델 존재 여부 확인

```python
import requests

def is_model_available(model_name):
    response = requests.get(
        f"http://a2g.samsungds.net:8090/v1/models/{model_name}",
        headers={
            "x-service-id": "my-service",
            "x-user-id": "hong.gildong",
            "x-dept-name": "SW혁신팀(S.LSI)",
        }
    )
    return response.status_code == 200

# 사용 예시
if is_model_available("gpt-4o"):
    print("gpt-4o 모델을 사용할 수 있습니다.")
else:
    print("gpt-4o 모델을 사용할 수 없습니다.")
```

## 에러 처리

| HTTP 코드 | 의미 | 대응 방법 |
|-----------|------|-----------|
| 401 | 인증 실패 | 인증 헤더 확인 |
| 403 | 권한 없음 | 서비스의 모델 접근 권한 확인 |
| 404 | 모델 없음 | 모델명 확인 (서비스 모델 설정이 변경되었을 수 있음) |
| 500 | 서버 오류 | 관리자 문의 |

## 다음 단계

- [Chat Completions API](/docs/api/chat-completions) — 모델로 대화 API 호출
- [API 인증](/docs/api/authentication) — 인증 헤더 상세 설명
- [서비스 모델 관리](/docs/service/service-models) — 서비스별 모델 설정 및 라운드로빈 구성
