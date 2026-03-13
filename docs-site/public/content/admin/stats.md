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

## DAU/MAU 개요

> **모든 날짜/시간은 KST (한국 표준시, UTC+9) 기준입니다.**

DAU/MAU는 서비스의 실제 사용자 규모를 파악하기 위한 핵심 지표입니다.

| 지표 | 정의 |
|------|------|
| **DAU** (Daily Active Users) | 하루 동안 LLM API를 1회 이상 호출한 **고유 사용자 수** (영업일 기준, 주말/공휴일 제외) |
| **MAU** (Monthly Active Users) | 한 달 동안 LLM API를 1회 이상 호출한 **고유 사용자 수** |

---

## STANDARD 서비스: 실측 DAU/MAU

STANDARD 서비스는 모든 API 호출 시 `x-user-id` 헤더로 사용자를 식별하므로, **실제 고유 사용자 수를 직접 집계**합니다.

| 지표 | 산출 방식 |
|------|----------|
| **DAU** | 해당 영업일에 1회 이상 API를 호출한 고유 사용자 수 (실측) |
| **MAU** | 해당 월에 1회 이상 API를 호출한 고유 사용자 수 (실측) |

---

## BACKGROUND 서비스: 추정 DAU/MAU

BACKGROUND 서비스는 사용자 인증 헤더(`x-user-id`)를 보내지 않기 때문에 실제 사용자 수를 알 수 없습니다. 대신 **STANDARD 서비스들의 사용 패턴 데이터를 기반으로 추정**합니다.

### 추정 MAU 산식

#### Step 1: STANDARD 1인당 월 평균 호출 수 산출

```
STANDARD 1인당 월 평균 호출 수 =
    STANDARD 서비스 월 총 호출 수
    ÷ STANDARD 서비스 MAU
```

**예시:**
- STANDARD 서비스들의 해당 월 총 API 호출 수: 32,000건
- STANDARD 서비스들의 해당 월 MAU: 210명
- **STANDARD 1인당 월 평균: 32,000 ÷ 210 = 152.4건**

#### Step 2: BACKGROUND 서비스 추정 MAU 계산

```
추정 MAU =
    BACKGROUND 서비스 월 총 호출 수
    ÷ STANDARD 1인당 월 평균 호출 수
```

**예시:**
- 어떤 BACKGROUND 서비스의 해당 월 총 API 호출 수: 5,060건
- STANDARD 1인당 월 평균: 152.4건
- **추정 MAU: 5,060 ÷ 152.4 ≈ 33명**

### 추정 DAU 산식

DAU도 동일한 방식으로 산출하되, **영업일(주말/공휴일 제외) 기준**입니다.

#### Step 1: STANDARD 1인당 하루 평균 호출 수 산출

```
STANDARD 1인당 하루 평균 호출 수 =
    STANDARD 서비스의 영업일 하루 평균 API 호출 수
    ÷ STANDARD 서비스의 영업일 하루 평균 DAU
```

**예시:**
- STANDARD 서비스들의 영업일 하루 평균 API 호출 수: 1,500건
- STANDARD 서비스들의 영업일 하루 평균 DAU: 98명
- **STANDARD 1인당 하루 평균: 1,500 ÷ 98 = 15.3건**

#### Step 2: BACKGROUND 서비스 추정 DAU 계산

```
추정 DAU =
    BACKGROUND 서비스의 영업일 하루 평균 API 호출 수
    ÷ STANDARD 1인당 하루 평균 호출 수
```

**예시:**
- 어떤 BACKGROUND 서비스의 영업일 하루 평균 API 호출 수: 230건
- STANDARD 1인당 하루 평균: 15.3건
- **추정 DAU: 230 ÷ 15.3 ≈ 15명**

---

## 과거 월 vs 이번 달

DAU/MAU 값은 **조회 대상 월이 과거인지 현재인지**에 따라 산출 방식이 다릅니다.

### 과거 월 (지난 달 이전): 고정값

지난 달 이전의 MAU는 **해당 월의 STANDARD 데이터로 이미 확정된 고정값**입니다. 조회 시점에 관계없이 항상 동일한 값이 반환됩니다.

| 항목 | 설명 |
|------|------|
| STANDARD MAU | 해당 월에 실제 호출한 고유 사용자 수 (확정) |
| BACKGROUND 추정 MAU | 해당 월의 STANDARD 1인당 월 평균 호출 수로 계산 (확정) |
| STANDARD DAU | 해당 월의 영업일 기준 하루 평균 고유 사용자 수 (확정) |
| BACKGROUND 추정 DAU | 해당 월의 STANDARD 1인당 하루 평균 호출 수로 계산 (확정) |

**예시:**
- 2026년 2월 MAU를 3월 1일에 조회하든 3월 31일에 조회하든, **동일한 값**이 반환됩니다.

### 이번 달 (현재 월): 실시간 추정

이번 달의 DAU/MAU는 **1일부터 현재까지의 누적 데이터를 기반으로 실시간 산출**됩니다. 날이 지날수록 데이터가 누적되어 **점점 더 정확해집니다**.

| 항목 | 설명 |
|------|------|
| STANDARD MAU | 이번 달 1일부터 오늘까지 호출한 고유 사용자 수 (실시간 누적) |
| BACKGROUND 추정 MAU | 이번 달 누적 호출 수 ÷ 이번 달 STANDARD 1인당 평균 호출 수 (실시간) |

> **참고**: 이번 달 초에는 데이터가 적어 추정 오차가 클 수 있으며, 월말에 가까워질수록 안정적인 값에 수렴합니다.

---

## DAU/MAU 산출 기준 요약

| 항목 | STANDARD 서비스 | BACKGROUND 서비스 |
|------|----------------|-------------------|
| DAU | 영업일 기준, `x-user-id`로 고유 사용자 직접 집계 (실측) | STANDARD 1인당 하루 평균 호출 수로 역산 (추정) |
| MAU | 해당 월 고유 사용자 직접 집계 (실측) | STANDARD 1인당 월 평균 호출 수로 역산 (추정) |
| 과거 월 | 확정값 (고정) | 해당 월 STANDARD 데이터 기반 확정값 (고정) |
| 이번 달 | 실시간 누적 집계 | 실시간 누적 데이터 기반 추정 (매일 갱신) |
| 주말/공휴일 | DAU 산출 시 제외 | DAU 산출 시 제외 |
| 시간대 | KST (한국 표준시) | KST (한국 표준시) |

### 주의사항

> **추정 DAU/MAU는 STANDARD 서비스의 사용 패턴을 기반으로 산출됩니다.** BACKGROUND 서비스의 실제 사용 패턴이 STANDARD와 크게 다른 경우 (예: 배치 처리로 소수의 사용자가 대량 호출), 추정값과 실제 값 사이에 오차가 발생할 수 있습니다. 추정값은 **참고 지표**로 활용하시기 바랍니다.

### 대시보드 표시

- STANDARD 서비스: DAU/MAU 실측값 표시
- BACKGROUND 서비스: **추정 DAU/MAU** 라벨과 함께 추정값 표시, 산출 근거(호출 수, 1인당 평균) 포함
- MAU 월별 변화를 선 그래프로 확인 가능 (최대 12개월)
- 메인 대시보드 상단에 **평균 MAU** 지표 표시 (최근 3개월 평균)

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
