# API Only 서비스 가이드

이 프록시를 통하지 않고, 자체 시스템 API를 통해 사용 기록을 직접 전송하는 서비스를 위한 가이드입니다.

## API Only란?

일반 서비스는 LLM 프록시(`/v1/chat/completions`)를 통해 호출하며, 프록시가 자동으로 사용량을 기록합니다. 반면 **API Only** 서비스는 자체 시스템에서 LLM을 직접 호출하고, 일별 사용 기록을 별도 API로 전송합니다.

### 일반 서비스 vs API Only

| 구분 | 일반 서비스 | API Only 서비스 |
|------|-----------|----------------|
| LLM 호출 | 프록시 경유 | 자체 시스템에서 직접 호출 |
| 사용량 기록 | 프록시가 자동 기록 | `POST /api/external-usage/daily`로 전송 |
| 인증 헤더 | `x-service-id`, `x-user-id`, `x-dept-name` | 불필요 (공개 API) |
| 기록 단위 | 개별 요청 (실시간) | 일별 집계 |
| M/M 관리 | Dashboard에서 관리 | Dashboard에서 동일하게 관리 |

---

## 연동 흐름

```
1. Dashboard에서 서비스 생성 (API Only 토글 ON)
       ↓
2. 서비스 배포
       ↓
3. 자체 시스템에서 POST /api/external-usage/daily 로 일별 사용 기록 전송
       ↓
4. GET /api/external-usage/daily 로 전송된 데이터 확인
       ↓
5. Dashboard에서 사용량 확인 (DAU/MAU, 팀별 사용량 등)
```

---

## 1단계: 서비스 등록

### Dashboard에서 서비스 생성

1. **내 서비스** → **+ 새 서비스** 클릭
2. 서비스 코드, 이름, 설명 입력
3. 서비스 타입 선택 (STANDARD / BACKGROUND)
4. **API Only** 토글을 **ON** 으로 설정
5. 카테고리, 링크 등 입력 후 생성

> **API Only 토글**: 서비스 분류 단계(2단계)에서 서비스 타입 선택 아래에 위치합니다.

### 서비스 배포

생성 후 반드시 **배포**해야 API로 데이터를 전송할 수 있습니다. 배포 전에는 403 에러가 발생합니다.

---

## 2단계: 사용 기록 전송

### POST /api/external-usage/daily

일별 사용 기록을 전송합니다. 같은 `(date, serviceId, deptName, modelName)` 조합이 이미 존재하면 **덮어씁니다**.

### STANDARD 서비스 요청 예시

STANDARD 서비스는 `dailyActiveUsers` (일별 사용자 수)를 **반드시 포함**해야 합니다.

```bash
curl -X POST http://a2g.samsungds.net:8090/api/external-usage/daily \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "my-chatbot",
    "data": [
      {
        "date": "2026-03-15",
        "deptName": "S/W혁신팀(S.LSI)",
        "modelName": "gpt-4o",
        "dailyActiveUsers": 15,
        "llmRequestCount": 230,
        "totalInputTokens": 50000,
        "totalOutputTokens": 30000
      },
      {
        "date": "2026-03-15",
        "deptName": "AI플랫폼팀(DS)",
        "modelName": "gpt-4o",
        "dailyActiveUsers": 8,
        "llmRequestCount": 120,
        "totalInputTokens": 25000,
        "totalOutputTokens": 15000
      },
      {
        "date": "2026-03-16",
        "deptName": "S/W혁신팀(S.LSI)",
        "modelName": "gpt-4o",
        "dailyActiveUsers": 12,
        "llmRequestCount": 180,
        "totalInputTokens": 40000,
        "totalOutputTokens": 25000
      },
      {
        "date": "2026-03-16",
        "deptName": "S/W혁신팀(S.LSI)",
        "modelName": "claude-sonnet",
        "dailyActiveUsers": 5,
        "llmRequestCount": 50,
        "totalInputTokens": 10000,
        "totalOutputTokens": 8000
      }
    ]
  }'
```

### BACKGROUND 서비스 요청 예시

BACKGROUND 서비스는 `dailyActiveUsers`를 **보내지 않습니다**. DAU/MAU는 시스템이 자동으로 역산합니다.

```bash
curl -X POST http://a2g.samsungds.net:8090/api/external-usage/daily \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "batch-pipeline",
    "data": [
      {
        "date": "2026-03-15",
        "deptName": "S/W혁신팀(S.LSI)",
        "modelName": "gpt-4o",
        "llmRequestCount": 500,
        "totalInputTokens": 100000,
        "totalOutputTokens": 60000
      },
      {
        "date": "2026-03-16",
        "deptName": "S/W혁신팀(S.LSI)",
        "modelName": "gpt-4o",
        "llmRequestCount": 480,
        "totalInputTokens": 95000,
        "totalOutputTokens": 55000
      }
    ]
  }'
```

### 필드 설명

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `serviceId` | string | O | 서비스 코드 (name, UUID 아님) |
| `data` | array | O | 일별 사용 기록 배열 (1~1000건) |
| `data[].date` | string | O | 날짜 (`YYYY-MM-DD`) |
| `data[].deptName` | string | O | 부서명 — `팀명(사업부)` 형식 |
| `data[].modelName` | string | O | LLM 모델 이름 (예: `gpt-4o`) |
| `data[].dailyActiveUsers` | integer | △ | 일별 사용자 수 (**STANDARD만 필수**) |
| `data[].llmRequestCount` | integer | O | LLM API 총 호출 수 |
| `data[].totalInputTokens` | integer | O | 총 입력 토큰 |
| `data[].totalOutputTokens` | integer | O | 총 출력 토큰 |

> △: STANDARD 타입 서비스만 필수. BACKGROUND 타입은 전달해도 무시되며, 시스템이 자동 역산합니다.

### `deptName` 형식

프록시 헤더 `x-dept-name`과 동일한 `팀명(사업부)` 형식을 사용합니다. 시스템이 괄호 안의 사업부를 자동 추출합니다.

```
팀명(사업부)
```

예시:
- `S/W혁신팀(S.LSI)` → businessUnit 자동 추출: `S.LSI`
- `AI플랫폼팀(DS)` → businessUnit 자동 추출: `DS`
- `DevOps팀(네트워크)` → businessUnit 자동 추출: `네트워크`

### 성공 응답 (200)

```json
{
  "success": true,
  "service": { "name": "my-chatbot", "type": "STANDARD", "apiOnly": true },
  "result": { "total": 4, "upserted": 4, "errors": 0 }
}
```

### 에러 응답

**400 — 요청 형식 오류**

```json
{
  "error": "Invalid request body",
  "details": [
    { "path": "data.0.deptName", "message": "Required" },
    { "path": "data.0.llmRequestCount", "message": "Required" }
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

---

## 3단계: 전송된 데이터 확인

API Only로 전송된 데이터는 **별도 조회 API 없이** 기존 공개 API에 자동으로 합산됩니다.

| 기존 API | 설명 | API Only 데이터 |
|----------|------|----------------|
| `GET /api/public/stats/dau-mau` | 서비스별 DAU/MAU | 포함 (STANDARD: 직접, BACKGROUND: 역산) |
| `GET /api/public/stats/team-usage` | 특정 서비스 팀별 사용량 | 합산 |
| `GET /api/public/stats/team-usage-all` | 전체 서비스 팀별 사용량 | 합산 |
| `GET /api/public/stats/services` | 서비스 목록 | `apiOnly: true` 표시 |

> 자세한 API 사용법은 [Swagger UI](/api-docs/ui)를 참조하세요.

---

## STANDARD vs BACKGROUND 비교

| 항목 | STANDARD API Only | BACKGROUND API Only |
|------|-------------------|---------------------|
| `dailyActiveUsers` | **필수** — 일별 사용자 수 | 불필요 (전달해도 무시) |
| DAU/MAU 산출 | 전송된 값을 직접 사용 | 시스템이 자동 역산 |
| 역산 공식 | — | `추정 DAU = 서비스 일 평균 호출 수 ÷ STANDARD 1인당 일 평균 호출 수` |
| 적합한 서비스 | 사용자 로그인이 있는 웹/앱 | 배치 잡, 자동화 파이프라인, 크론 잡 |

---

## 덮어쓰기 (Upsert)

같은 `(date, serviceId, deptName, modelName)` 조합으로 다시 전송하면 기존 데이터를 **덮어씁니다**. 이를 활용해:

- 잘못된 데이터를 수정할 수 있습니다
- 정산 후 최종 값으로 업데이트할 수 있습니다

```bash
# 같은 조합으로 다시 전송 → 기존 값 덮어쓰기
curl -X POST http://a2g.samsungds.net:8090/api/external-usage/daily \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "my-chatbot",
    "data": [{
      "date": "2026-03-15",
      "deptName": "S/W혁신팀(S.LSI)",
      "modelName": "gpt-4o",
      "dailyActiveUsers": 18,
      "llmRequestCount": 250,
      "totalInputTokens": 55000,
      "totalOutputTokens": 33000
    }]
  }'
```

---

## 대시보드 통합

API Only 서비스의 데이터는 다른 서비스와 동일하게 대시보드에 표시됩니다:

- **통합 대시보드**: DAU/MAU 차트, M/M 목표 달성 차트에 포함
- **서비스 마켓**: "API Only" 배지와 함께 표시
- **팀별 사용량**: 팀(사업부)별 집계에 합산
- **서비스 목표 관리**: targetMM / savedMM 설정 가능

---

## 연동 예시

### Python

```python
import requests
from datetime import date, timedelta

BASE_URL = "http://a2g.samsungds.net:8090/api/external-usage/daily"

# ── 사용 기록 전송 ──
response = requests.post(BASE_URL, json={
    "serviceId": "my-chatbot",
    "data": [
        {
            "date": str(date.today() - timedelta(days=1)),
            "deptName": "S/W혁신팀(S.LSI)",
            "modelName": "gpt-4o",
            "dailyActiveUsers": 15,
            "llmRequestCount": 230,
            "totalInputTokens": 50000,
            "totalOutputTokens": 30000,
        },
        {
            "date": str(date.today() - timedelta(days=1)),
            "deptName": "AI플랫폼팀(DS)",
            "modelName": "gpt-4o",
            "dailyActiveUsers": 8,
            "llmRequestCount": 120,
            "totalInputTokens": 25000,
            "totalOutputTokens": 15000,
        },
    ],
})
result = response.json()
print(f"전송 결과: {result['result']['upserted']}건 저장")

# ── 전송된 데이터 확인 ──
yesterday = str(date.today() - timedelta(days=1))
check = requests.get(BASE_URL, params={
    "serviceId": "my-chatbot",
    "startDate": yesterday,
    "endDate": yesterday,
})
print(f"저장된 레코드: {len(check.json()['data'])}건")
```

### JavaScript (Node.js)

```javascript
const BASE_URL = "http://a2g.samsungds.net:8090/api/external-usage/daily";

// 사용 기록 전송
const response = await fetch(BASE_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    serviceId: "my-chatbot",
    data: [
      {
        date: "2026-03-15",
        deptName: "S/W혁신팀(S.LSI)",
        modelName: "gpt-4o",
        dailyActiveUsers: 15,
        llmRequestCount: 230,
        totalInputTokens: 50000,
        totalOutputTokens: 30000,
      },
    ],
  }),
});
const result = await response.json();
console.log(`전송 결과: ${result.result.upserted}건 저장`);
```

---

## FAQ

### Q: 여러 날짜를 한 번에 보낼 수 있나요?

네. `data` 배열에 여러 날짜의 레코드를 최대 1000건까지 포함할 수 있습니다. 날짜, 부서, 모델을 자유롭게 조합하세요.

### Q: 같은 날짜를 다시 보내면 어떻게 되나요?

같은 `(date, serviceId, deptName, modelName)` 조합은 **덮어씁니다**. 중복 전송 걱정 없이 보내면 됩니다.

### Q: BACKGROUND 서비스인데 dailyActiveUsers를 보내면?

무시됩니다. 경고 메시지가 응답에 포함되지만 데이터는 정상 저장됩니다.

### Q: 서비스를 API Only로 등록하지 않고 전송하면?

403 에러가 발생합니다. Dashboard에서 서비스 수정 → API Only 토글을 켜주세요.

### Q: 배포하지 않은 서비스에 전송하면?

403 에러가 발생합니다. 서비스를 먼저 배포해주세요.

### Q: M/M 목표 관리는 어떻게 하나요?

다른 서비스와 동일합니다. Dashboard의 **서비스 목표 관리** 페이지에서 targetMM / savedMM을 설정하세요.
