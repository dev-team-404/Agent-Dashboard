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

## 서비스 등록

### 1. Dashboard에서 서비스 생성

1. **내 서비스** → **+ 새 서비스** 클릭
2. 서비스 코드, 이름, 설명 입력
3. 서비스 타입 선택 (STANDARD / BACKGROUND)
4. **API Only** 토글을 **ON** 으로 설정
5. 카테고리, 링크 등 입력 후 생성

> **API Only 토글**: 서비스 분류 단계에서 서비스 타입 아래에 위치합니다.

### 2. 서비스 배포

생성 후 반드시 **배포**해야 API로 데이터를 전송할 수 있습니다.

## 사용 기록 전송 API

### POST /api/external-usage/daily

일별 사용 기록을 전송합니다. 같은 `(date, serviceId, deptName, modelName)` 조합이 이미 존재하면 **덮어씁니다**.

#### 요청 형식

```json
{
  "serviceId": "my-api-service",
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
      "date": "2026-03-16",
      "deptName": "AI플랫폼팀(DS)",
      "modelName": "claude-sonnet",
      "llmRequestCount": 95,
      "totalInputTokens": 20000,
      "totalOutputTokens": 15000
    }
  ]
}
```

#### 필드 설명

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `serviceId` | string | O | 서비스 코드 (name, UUID 아님) |
| `data` | array | O | 일별 사용 기록 배열 (1~1000건) |
| `data[].date` | string | O | 날짜 (YYYY-MM-DD) |
| `data[].deptName` | string | O | 부서명 — `팀명(사업부)` 형식 |
| `data[].modelName` | string | O | LLM 모델 이름 (예: `gpt-4o`) |
| `data[].dailyActiveUsers` | integer | △ | 일별 사용자 수 (STANDARD만 필수) |
| `data[].llmRequestCount` | integer | O | LLM API 총 호출 수 |
| `data[].totalInputTokens` | integer | O | 총 입력 토큰 |
| `data[].totalOutputTokens` | integer | O | 총 출력 토큰 |

> △: STANDARD 타입 서비스만 필수. BACKGROUND 타입은 시스템이 자동 역산합니다.

#### `deptName` 형식

프록시 헤더 `x-dept-name`과 동일한 형식을 사용합니다.

```
팀명(사업부)
```

예시:
- `S/W혁신팀(S.LSI)` → businessUnit: `S.LSI`
- `AI플랫폼팀(DS)` → businessUnit: `DS`

#### 응답 예시

```json
{
  "success": true,
  "service": { "name": "my-api-service", "type": "STANDARD", "apiOnly": true },
  "result": { "total": 2, "upserted": 2, "errors": 0 }
}
```

#### 에러 응답

| HTTP 코드 | 상황 |
|-----------|------|
| 400 | 요청 형식 오류 (필수 필드 누락, 날짜 형식 등) |
| 403 | 서비스가 API Only가 아니거나 비활성화 |
| 404 | 등록되지 않은 서비스 |

### GET /api/external-usage/daily

전송된 사용 기록을 조회합니다.

```
GET /api/external-usage/daily?serviceId=my-api-service&startDate=2026-03-01&endDate=2026-03-31
```

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `serviceId` | O | 서비스 코드 (name) |
| `startDate` | O | 시작일 (YYYY-MM-DD) |
| `endDate` | O | 종료일 (YYYY-MM-DD) |

## STANDARD vs BACKGROUND

### STANDARD API Only

사용자를 식별할 수 있는 시스템에서 사용합니다.

- `dailyActiveUsers` 필드를 **반드시 포함**해야 합니다
- 이 값은 역산 baseline 계산에도 활용됩니다
- 대시보드에서 DAU/MAU가 직접 표시됩니다

### BACKGROUND API Only

사용자 식별 없이 호출량만 보내는 시스템에서 사용합니다.

- `dailyActiveUsers` 필드 **불필요** (전달해도 무시)
- DAU/MAU는 시스템이 STANDARD 데이터 기반으로 **자동 역산**
- 역산 공식: `추정 DAU = 해당 서비스 일 평균 호출 수 ÷ STANDARD 1인당 일 평균 호출 수`

## 덮어쓰기 (Upsert)

같은 `(date, serviceId, deptName, modelName)` 조합으로 다시 전송하면 기존 데이터를 **덮어씁니다**. 이를 활용해:

- 잘못된 데이터를 수정할 수 있습니다
- 정산 후 최종 값으로 업데이트할 수 있습니다

## 대시보드 통합

API Only 서비스의 데이터는 다른 서비스와 동일하게 대시보드에 표시됩니다:

- **통합 대시보드**: DAU/MAU 차트, M/M 목표 달성 차트에 포함
- **서비스 마켓**: "API Only" 배지와 함께 표시
- **팀별 사용량**: 팀(사업부)별 집계에 합산
- **서비스 목표 관리**: targetMM / savedMM 설정 가능

## 연동 예시 (Python)

```python
import requests
from datetime import date

# 일별 사용 기록 전송
response = requests.post(
    "http://a2g.samsungds.net:8090/api/external-usage/daily",
    json={
        "serviceId": "my-api-service",
        "data": [
            {
                "date": str(date.today()),
                "deptName": "S/W혁신팀(S.LSI)",
                "modelName": "gpt-4o",
                "dailyActiveUsers": 15,
                "llmRequestCount": 230,
                "totalInputTokens": 50000,
                "totalOutputTokens": 30000,
            }
        ],
    },
)
print(response.json())
```
