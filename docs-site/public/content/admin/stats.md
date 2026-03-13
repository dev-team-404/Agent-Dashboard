# 통계 활용

Dashboard에서 제공하는 통계 기능을 활용하는 방법을 안내합니다.

## 대시보드 통계 보는 법

Dashboard 메인 화면에서 핵심 통계 지표를 한눈에 확인할 수 있습니다.

### 메인 대시보드 지표

| 지표 | 설명 |
|------|------|
| 총 요청 수 | 오늘/이번 주/이번 달 기준 API 호출 수 |
| 활성 서비스 | 현재 활성화된 서비스 수 |
| 등록 모델 | 사용 가능한 LLM 모델 수 |
| 활성 사용자 | 최근 API를 사용한 사용자 수 |

### 기간별 조회

통계 데이터는 기간별로 조회할 수 있습니다.

- **오늘**: 당일 데이터
- **이번 주**: 이번 주 월요일부터 현재까지
- **이번 달**: 이번 달 1일부터 현재까지
- **커스텀**: 시작일~종료일 직접 지정

## 서비스별 통계

각 서비스의 사용 현황을 상세하게 확인할 수 있습니다.

### 확인 방법

1. Dashboard 좌측 메뉴에서 **통계** 클릭
2. **서비스별** 탭 선택
3. 조회 기간 설정

### 조회 항목

| 항목 | 설명 |
|------|------|
| 요청 수 | 서비스별 API 호출 횟수 |
| 토큰 사용량 | 서비스별 입력/출력 토큰 수 |
| 성공/실패 비율 | API 호출 성공률 |
| 평균 응답 시간 | API 평균 응답 시간 |

### 서비스 비교

여러 서비스의 사용량을 비교하여 리소스 분배를 최적화할 수 있습니다.

```
서비스별 요청 수 (이번 주)
━━━━━━━━━━━━━━━━━━━━━━━━━
chatbot-api     ████████████████  1,234건
data-pipeline   ████████          678건
code-review     ████              345건
batch-job       ██                123건
```

## 사용자별 통계

dept 내 사용자들의 API 사용 현황을 확인할 수 있습니다.

### 확인 방법

1. **통계** 페이지에서 **사용자별** 탭 선택
2. 조회 기간 설정

### 조회 항목

| 항목 | 설명 |
|------|------|
| 사용자 ID | API를 호출한 사용자 |
| 요청 수 | 사용자별 API 호출 횟수 |
| 토큰 사용량 | 사용자별 토큰 사용량 |
| 주 사용 모델 | 가장 많이 사용한 모델 |
| 주 사용 서비스 | 가장 많이 사용한 서비스 |

## 모델별 통계

등록된 LLM 모델의 사용 현황을 확인할 수 있습니다.

### 확인 방법

1. **통계** 페이지에서 **모델별** 탭 선택
2. 조회 기간 설정

### 조회 항목

| 항목 | 설명 |
|------|------|
| 모델명 | LLM 모델 이름 |
| 요청 수 | 모델별 API 호출 횟수 |
| 입력 토큰 | 총 입력 토큰 수 |
| 출력 토큰 | 총 출력 토큰 수 |
| 평균 응답 시간 | 모델별 평균 응답 시간 |

## DAU (일간 활성 사용자) 확인

일별 활성 사용자 수 추이를 확인할 수 있습니다.

### DAU란?

DAU(Daily Active Users)는 하루 동안 LLM API를 한 번 이상 호출한 **고유 사용자 수**입니다. 주말과 공휴일을 제외한 **영업일 기준**으로 산출됩니다.

### 서비스 타입별 DAU 산출 방식

Agent 플랫폼에는 두 가지 서비스 타입이 있으며, 각각 DAU 산출 방식이 다릅니다.

| 서비스 타입 | DAU 산출 | 설명 |
|------------|---------|------|
| **STANDARD** | 실측 DAU | 사용자가 `x-user-id` 헤더를 통해 식별되므로, 실제 고유 사용자 수를 직접 집계 |
| **BACKGROUND** | **추정 DAU** | 사용자 정보 없이 서비스 ID만으로 호출되므로, 아래 산식으로 추정 |

### BACKGROUND 서비스 — 추정 DAU 산식

BACKGROUND 서비스는 사용자 인증 헤더(`x-user-id`)를 보내지 않기 때문에 실제 사용자 수를 알 수 없습니다. 대신 STANDARD 서비스들의 데이터를 기반으로 "1인당 하루 평균 API 호출 수"를 구하고, 이를 역으로 적용하여 추정합니다.

#### Step 1: 1인당 하루 평균 API 호출 수 산출

STANDARD 서비스 전체를 대상으로 직전 30 영업일(주말/공휴일 제외) 데이터를 사용합니다.

```
1인당 하루 평균 API 호출 수 =
    STANDARD 서비스 전체의 "하루 평균 LLM API 호출 수 (영업일)"
    ÷ STANDARD 서비스 전체의 "하루 평균 DAU (영업일)"
```

**예시:**
- STANDARD 서비스들의 영업일 하루 평균 API 호출 수: 1,500건
- STANDARD 서비스들의 영업일 하루 평균 DAU: 98명
- → **1인당 하루 평균: 15.3건**

#### Step 2: BACKGROUND 서비스 추정 DAU 계산

```
추정 DAU =
    해당 BACKGROUND 서비스의 "하루 평균 LLM API 호출 수 (영업일)"
    ÷ 1인당 하루 평균 API 호출 수 (Step 1에서 산출)
```

**예시:**
- 어떤 BACKGROUND 서비스의 영업일 하루 평균 API 호출 수: 230건
- 1인당 하루 평균: 15.3건
- → **추정 DAU: 230 ÷ 15.3 ≈ 15명**

#### 대시보드 표시

BACKGROUND 서비스의 DAU는 대시보드에 다음과 같이 표시됩니다:
- **추정 DAU** 라벨과 함께 추정값 표시
- 해당 서비스의 영업일 하루 평균 API 호출 수 표시
- 산출 기준인 "1인당 하루 평균 API 호출 수" 표시
- 추정값임을 명확히 안내

> **참고**: 추정 DAU는 모든 사용자가 STANDARD 서비스와 동일한 패턴으로 API를 사용한다고 가정합니다. 실제로는 BACKGROUND 서비스의 사용 패턴이 다를 수 있으므로, 참고 지표로 활용하시기 바랍니다.

---

## MAU (월간 활성 사용자) 확인

월간 활성 사용자 수 추이를 확인할 수 있습니다.

### MAU란?

MAU(Monthly Active Users)는 한 달 동안 LLM API를 한 번 이상 호출한 **고유 사용자 수**입니다.

### 서비스 타입별 MAU 산출 방식

| 서비스 타입 | MAU 산출 | 설명 |
|------------|---------|------|
| **STANDARD** | 실측 MAU | 해당 월에 1회 이상 호출한 고유 사용자 수 직접 집계 |
| **BACKGROUND** | **추정 MAU** | 아래 산식으로 추정 |

### BACKGROUND 서비스 — 추정 MAU 산식

추정 DAU와 동일한 논리를 **월 단위**로 확장합니다.

#### Step 1: 1인당 월 평균 API 호출 수 산출

```
1인당 월 평균 API 호출 수 =
    STANDARD 서비스 전체의 "직전 30일 총 LLM API 호출 수"
    ÷ STANDARD 서비스 전체의 "직전 30일 MAU"
```

> DAU 산식에서는 "하루 평균"끼리 나누지만, MAU 산식에서는 "월 누적"끼리 나누는 것이 핵심 차이입니다. 같은 사용자가 여러 날에 걸쳐 사용하는 패턴이 자연스럽게 반영됩니다.

**예시:**
- STANDARD 서비스들의 직전 30일 총 API 호출 수: 32,000건
- STANDARD 서비스들의 직전 30일 MAU: 210명
- → **1인당 월 평균: 152.4건**

#### Step 2: BACKGROUND 서비스 추정 MAU 계산

```
추정 MAU =
    해당 BACKGROUND 서비스의 "해당 월 총 LLM API 호출 수"
    ÷ 1인당 월 평균 API 호출 수 (Step 1에서 산출)
```

**예시:**
- 어떤 BACKGROUND 서비스의 해당 월 총 API 호출 수: 5,060건
- 1인당 월 평균: 152.4건
- → **추정 MAU: 5,060 ÷ 152.4 ≈ 33명**

### MAU 월별 변화 차트

대시보드에서 서비스별 MAU의 월별 변화를 선 그래프로 확인할 수 있습니다.

- **X축**: 월 (YYYY-MM)
- **Y축**: MAU (명)
- 최대 12개월까지 조회 가능
- STANDARD 서비스: 실측 MAU
- BACKGROUND 서비스: 추정 MAU (추정 표시 포함)

### 평균 MAU 카드

메인 대시보드 상단에 **평균 MAU** 지표가 표시됩니다. 이는 최근 3개월간의 월별 MAU를 평균한 값입니다.

---

## DAU/MAU 산출 기준 요약

| 항목 | STANDARD 서비스 | BACKGROUND 서비스 |
|------|----------------|-------------------|
| DAU | 영업일 기준, `x-user-id` 로 고유 사용자 직접 집계 | "STANDARD 1인당 하루 평균 호출 수"로 역산 (추정) |
| MAU | 월간 고유 사용자 직접 집계 | "STANDARD 1인당 월 평균 호출 수"로 역산 (추정) |
| 기준 기간 | 실시간 집계 | 직전 30일 STANDARD 데이터 기반 |
| 주말/공휴일 | DAU 산출 시 제외 | DAU 산출 시 제외 |

### 확인 방법

1. **통계** 페이지 메인 대시보드에서 DAU/MAU 차트 확인
2. 기간/월을 설정하여 추이 확인
3. 서비스 상세 페이지에서 개별 서비스의 DAU/MAU 확인

### 활용 방법

- **사용량 추이 파악**: DAU/MAU 추이를 통해 서비스 활성화 정도를 판단
- **리소스 계획**: DAU/MAU가 증가하는 경우 서버/모델 리소스 확장 검토
- **이벤트 분석**: 특정 날짜/월에 DAU/MAU가 급증/급감한 원인 분석
- **BACKGROUND 서비스 모니터링**: 추정 DAU/MAU를 통해 실제 사용 규모를 파악

---

## Public API: DAU/MAU 조회

외부 시스템에서 서비스별 DAU/MAU를 조회할 수 있는 공개 API를 제공합니다.

### 엔드포인트

```
GET /api/public/stats/dau-mau?year=2026&month=3
```

### 파라미터

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| year | O | 조회 연도 (예: 2026) |
| month | O | 조회 월 (1~12) |

### 응답 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| serviceId | string | 서비스 UUID |
| name | string | 서비스 시스템명 |
| displayName | string | 서비스 표시명 |
| type | string | `STANDARD` 또는 `BACKGROUND` |
| enabled | boolean | 활성 상태 |
| totalCallCount | integer | 해당 월 총 API 호출 수 |
| totalInputTokens | integer | 해당 월 총 입력 토큰 |
| totalOutputTokens | integer | 해당 월 총 출력 토큰 |
| totalTokens | integer | 해당 월 총 토큰 (입력 + 출력) |
| dau | integer | 영업일 평균 DAU (BACKGROUND=추정) |
| mau | integer | MAU (BACKGROUND=추정) |
| isEstimated | boolean | 추정값 여부 (BACKGROUND=true) |
| estimationDetail | object | BACKGROUND만 포함. 추정 산출 근거 |

### 응답 예시

```json
{
  "year": 2026,
  "month": 3,
  "data": [
    {
      "serviceId": "uuid-1",
      "name": "nexus-coder",
      "displayName": "Nexus Coder",
      "type": "STANDARD",
      "enabled": true,
      "totalCallCount": 3200,
      "totalInputTokens": 1200000,
      "totalOutputTokens": 600000,
      "totalTokens": 1800000,
      "dau": 45,
      "mau": 128,
      "isEstimated": false
    },
    {
      "serviceId": "uuid-2",
      "name": "auto-review",
      "displayName": "Auto Review Bot",
      "type": "BACKGROUND",
      "enabled": true,
      "totalCallCount": 5060,
      "totalInputTokens": 800000,
      "totalOutputTokens": 400000,
      "totalTokens": 1200000,
      "dau": 15,
      "mau": 33,
      "isEstimated": true,
      "estimationDetail": {
        "avgDailyApiCalls": 230,
        "totalMonthlyApiCalls": 5060,
        "avgCallsPerPersonPerDay": 15.3,
        "avgCallsPerPersonPerMonth": 152.4
      }
    }
  ]
}
```

> BACKGROUND 서비스의 경우 `isEstimated: true`로 표시되며, `estimationDetail`에 산출 근거가 포함됩니다.

## 다음 단계

- [서비스 관리](/docs/admin/service-management) — 서비스 현황 확인 및 관리
- [LLM 관리](/docs/admin/llm-management) — 모델별 성능 확인 후 설정 조정
- [사용자/권한 관리](/docs/admin/user-management) — 활성 사용자 권한 관리
