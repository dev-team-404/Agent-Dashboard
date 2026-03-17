# API Only 서비스 가이드

프록시를 통하지 않고, 자체 시스템 API를 통해 사용 기록을 직접 전송하는 서비스를 위한 가이드입니다.

## API Only란?

일반 서비스는 LLM 프록시(`/v1/chat/completions`)를 통해 호출하며, 프록시가 자동으로 사용량을 기록합니다. 반면 **API Only** 서비스는 자체 시스템에서 LLM을 직접 호출하고, 일별 사용 기록을 별도 API로 전송합니다.

### 일반 서비스 vs API Only

| 구분 | 일반 서비스 | API Only 서비스 |
|------|-----------|----------------|
| LLM 호출 | 프록시 경유 | 자체 시스템에서 직접 호출 |
| 사용량 기록 | 프록시가 자동 기록 | `/api/external-usage/by-user` 로 전송 |
| 인증 헤더 | `x-service-id`, `x-user-id`, `x-dept-name` | 불필요 (공개 API) |
| 기록 단위 | 개별 요청 (실시간) | 일별 사용자별 집계 |
| 부서 정보 | 헤더로 직접 전달 | Knox ID 기반 자동 조회 |

---

## 연동 흐름

```
1. Dashboard에서 서비스 생성 (API Only 토글 ON)
       ↓
2. 서비스에 사용할 모델(ServiceModel alias) 등록
       ↓
3. 서비스 배포
       ↓
4. POST /api/external-usage/by-user 로 사용자별 사용 기록 전송
       ↓
5. Dashboard에서 사용량 확인 (DAU/MAU, 팀별, Top K Users 등)
```

---

## 1단계: 서비스 등록

### Dashboard에서 서비스 생성

1. **내 서비스** → **+ 새 서비스** 클릭
2. 서비스 코드, 이름, 설명 입력
3. 서비스 타입 선택 (STANDARD / BACKGROUND)
4. **API Only** 토글을 **ON** 으로 설정
5. 카테고리, 링크 등 입력 후 생성

### 모델 등록

서비스에 사용하는 모델을 **ServiceModel alias**로 등록해야 합니다. 전송할 `modelName`과 alias를 일치시키세요.

1. 서비스 상세 → **모델 관리** 탭
2. 사용하는 모델 추가 (alias 이름 = 전송할 modelName)

> 예: alias `gpt-4o` 등록 → 전송 시 `"modelName": "gpt-4o"` 사용

### 서비스 배포

생성 후 반드시 **배포**해야 API로 데이터를 전송할 수 있습니다. 배포 전에는 403 에러가 발생합니다.

---

## 2단계: 사용 기록 전송 (by-user)

### POST /api/external-usage/by-user

사용자(Knox ID) 단위로 일별 사용 기록을 전송합니다. 같은 `(date, userId, modelName, serviceId)` 조합은 **덮어씁니다**.

시스템이 자동으로 처리하는 것:
- **Knox ID → User 자동 등록**: 미등록 사용자는 Knox Employee API로 조회 후 자동 등록
- **부서 정보 자동 설정**: Knox에서 조회된 부서명으로 자동 세팅 (직접 전달 불필요)
- **UserService 관계 추적**: 사용자-서비스 관계 자동 업데이트

### 요청 예시

```bash
curl -X POST http://a2g.samsungds.net:8090/api/external-usage/by-user \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "my-chatbot",
    "data": [
      {
        "date": "2026-03-15",
        "userId": "hong.gildong",
        "modelName": "gpt-4o",
        "requestCount": 50,
        "totalInputTokens": 100000,
        "totalOutputTokens": 50000
      },
      {
        "date": "2026-03-15",
        "userId": "kim.chulsu",
        "modelName": "gpt-4o",
        "requestCount": 30,
        "totalInputTokens": 60000,
        "totalOutputTokens": 30000
      },
      {
        "date": "2026-03-16",
        "userId": "hong.gildong",
        "modelName": "gpt-4o",
        "requestCount": 45,
        "totalInputTokens": 90000,
        "totalOutputTokens": 45000
      }
    ]
  }'
```

### 필드 설명

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `serviceId` | string | O | 서비스 코드 (name, UUID 아님) |
| `data` | array | O | 사용자별 일별 기록 배열 (1~5000건) |
| `data[].date` | string | O | 날짜 (`YYYY-MM-DD`) |
| `data[].userId` | string | O | Knox 로그인 ID (사번 아이디) |
| `data[].modelName` | string | O | 모델 alias 또는 모델명 |
| `data[].requestCount` | integer | O | 해당 날짜/사용자/모델의 총 요청 수 |
| `data[].totalInputTokens` | integer | O | 총 입력 토큰 |
| `data[].totalOutputTokens` | integer | O | 총 출력 토큰 |

> `deptName`이 없습니다. Knox ID로 자동 조회됩니다.

### 성공 응답 (200)

```json
{
  "success": true,
  "service": { "name": "my-chatbot", "type": "STANDARD", "apiOnly": true },
  "result": { "total": 3, "upserted": 3, "skipped": 0, "errors": 0 },
  "users": { "total": 2, "resolved": 2, "failed": 0 },
  "models": { "total": 1, "resolved": 1, "failed": 0 }
}
```

**응답 필드:**
- `result.skipped`: Knox 인증 실패 또는 모델 매칭 실패로 건너뛴 레코드 수
- `users.failed`: Knox에서 찾을 수 없는 사용자 수
- `models.failed`: 등록되지 않은 모델 수
- `warnings`: 실패 상세 (어떤 사용자/모델이 실패했는지)

### 에러 응답

**400 — 요청 형식 오류**

```json
{
  "error": "Invalid request body",
  "details": [
    { "path": "data.0.userId", "message": "userId (Knox login ID) is required" }
  ]
}
```

**403 — API Only가 아닌 서비스**

```json
{
  "error": "Service \"my-service\" is not an API Only service. apiOnly 서비스로 등록되어야 합니다."
}
```

**404 — 등록되지 않은 서비스**

```json
{
  "error": "Service \"unknown-svc\" not found. 등록되지 않은 서비스입니다."
}
```

### 부분 성공 처리

일부 사용자나 모델이 매칭되지 않아도 나머지는 정상 처리됩니다.

```json
{
  "success": true,
  "result": { "total": 5, "upserted": 3, "skipped": 2, "errors": 0 },
  "users": { "total": 3, "resolved": 2, "failed": 1 },
  "models": { "total": 1, "resolved": 1, "failed": 0 },
  "warnings": [
    "User \"retired.user\": Knox에서 임직원 정보를 확인할 수 없습니다 (재직/휴직 상태만 허용)"
  ]
}
```

---

## 3단계: 데이터 확인

`/by-user`로 전송된 데이터는 프록시 서비스와 **동일한 테이블**에 저장되므로, 모든 통계 API에 자연스럽게 합산됩니다.

| 기존 API | API Only 데이터 반영 |
|----------|---------------------|
| `GET /api/public/stats/dau-mau` | DAU/MAU에 포함 (userId 기반 정확한 집계) |
| `GET /api/public/stats/team-usage` | 팀별 사용량에 합산 |
| `GET /api/public/stats/team-usage-all` | 전체 서비스 팀별 사용량에 합산 |
| `GET /api/public/stats/top-users` | **Top K 사용자 랭킹에 반영** |
| `GET /api/public/stats/top-users-by-dept` | **부서별 Top K에 반영** |

> 자세한 통계 API 스펙과 DAU/MAU 산출 방식은 [Swagger UI](/api-docs/ui)를 참조하세요.

---

## 덮어쓰기 (Upsert)

같은 `(date, userId, modelName, serviceId)` 조합으로 다시 전송하면 기존 데이터를 **덮어씁니다**. 이를 활용해:

- 잘못된 데이터를 수정할 수 있습니다
- 정산 후 최종 값으로 업데이트할 수 있습니다

---

## 대시보드 통합

API Only 서비스의 데이터는 다른 서비스와 동일하게 대시보드에 표시됩니다:

- **통합 대시보드**: DAU/MAU 차트, M/M 목표 달성 차트에 포함
- **서비스 마켓**: "API Only" 배지와 함께 표시
- **팀별 사용량**: 팀(사업부)별 집계에 합산
- **Top K Users**: 사용자별 랭킹에 반영
- **서비스 목표 관리**: targetMM / savedMM 설정 가능

---

## 연동 예시

### Python

```python
import requests
from datetime import date, timedelta

URL = "http://a2g.samsungds.net:8090/api/external-usage/by-user"

response = requests.post(URL, json={
    "serviceId": "my-chatbot",
    "data": [
        {
            "date": str(date.today() - timedelta(days=1)),
            "userId": "hong.gildong",
            "modelName": "gpt-4o",
            "requestCount": 50,
            "totalInputTokens": 100000,
            "totalOutputTokens": 50000,
        },
        {
            "date": str(date.today() - timedelta(days=1)),
            "userId": "kim.chulsu",
            "modelName": "gpt-4o",
            "requestCount": 30,
            "totalInputTokens": 60000,
            "totalOutputTokens": 30000,
        },
    ],
})
result = response.json()
print(f"전송: {result['result']['upserted']}건, 스킵: {result['result']['skipped']}건")
```

### JavaScript (Node.js)

```javascript
const URL = "http://a2g.samsungds.net:8090/api/external-usage/by-user";

const response = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    serviceId: "my-chatbot",
    data: [
      {
        date: "2026-03-15",
        userId: "hong.gildong",
        modelName: "gpt-4o",
        requestCount: 50,
        totalInputTokens: 100000,
        totalOutputTokens: 50000,
      },
    ],
  }),
});
const result = await response.json();
console.log(`전송: ${result.result.upserted}건`);
```

---

## FAQ

### Q: 여러 날짜를 한 번에 보낼 수 있나요?

네. `data` 배열에 여러 날짜의 레코드를 최대 5000건까지 포함할 수 있습니다.

### Q: 같은 날짜/사용자/모델을 다시 보내면?

같은 `(date, userId, modelName, serviceId)` 조합은 **덮어씁니다**. 중복 전송 걱정 없이 보내면 됩니다.

### Q: Knox에서 못 찾는 사용자가 있으면?

해당 사용자의 레코드만 스킵되고, 나머지는 정상 저장됩니다. 응답의 `warnings`에 실패 사유가 표시됩니다.

### Q: 모델이 등록되어 있지 않으면?

해당 모델 관련 레코드가 스킵됩니다. 서비스에 **ServiceModel alias**를 먼저 등록하세요.

### Q: 부서 정보를 직접 보내고 싶은데?

부서 정보는 Knox API에서 사용자의 실제 소속 부서를 자동 조회합니다. 직접 전달할 수 없습니다.

### Q: 서비스를 API Only로 등록하지 않고 전송하면?

403 에러가 발생합니다. Dashboard에서 서비스 수정 → API Only 토글을 켜주세요.

### Q: 배포하지 않은 서비스에 전송하면?

403 에러가 발생합니다. 서비스를 먼저 배포해주세요.
