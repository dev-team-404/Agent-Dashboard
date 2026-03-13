# Rate Limit 설정

서비스 단위 또는 사용자 단위로 토큰 사용량을 제한하는 Rate Limit 기능을 안내합니다.

## Rate Limit 개요

Rate Limit은 특정 시간 윈도우 내에서 사용할 수 있는 **최대 토큰 수**를 제한하는 기능입니다. 과도한 사용을 방지하고, 비용을 통제하는 데 활용됩니다.

### Rate Limit 종류

| 종류 | 적용 범위 | 설명 |
|------|-----------|------|
| **서비스 Rate Limit** (공통) | 서비스 내 모든 사용자 | 모든 멤버에게 동일하게 적용 |
| **사용자 Rate Limit** (개별) | 특정 사용자 1명 | 개별 사용자에게만 적용 |

### 적용 우선순위

사용자 Rate Limit과 서비스 Rate Limit이 모두 설정된 경우, **사용자 Rate Limit이 우선** 적용됩니다.

```
API 요청 수신
  └── 사용자 Rate Limit 존재?
        ├── Yes → 사용자 Rate Limit 적용
        └── No  → 서비스 Rate Limit 존재?
                    ├── Yes → 서비스 Rate Limit 적용
                    └── No  → Rate Limit 없음 (무제한)
```

## Rate Limit 윈도우

Rate Limit은 시간 윈도우를 기준으로 토큰 사용량을 집계합니다.

| 윈도우 | 기간 | 설명 |
|--------|------|------|
| **FIVE_HOURS** | 5시간 | 최근 5시간 내 사용량 기준 |
| **DAY** | 24시간 | 최근 24시간 내 사용량 기준 |

### 윈도우 동작 방식

Rate Limit 윈도우는 **슬라이딩 윈도우** 방식으로 동작합니다. 즉, 현재 시점을 기준으로 과거 N시간의 사용량을 합산합니다.

```
예시: DAY (24시간) 윈도우, maxTokens = 100,000

현재 시각: 15:00
  └── 집계 범위: 어제 15:00 ~ 오늘 15:00
  └── 이 범위 내 총 토큰 사용량 < 100,000이면 허용

현재 시각: 16:00
  └── 집계 범위: 어제 16:00 ~ 오늘 16:00
  └── 윈도우가 1시간 앞으로 이동 → 어제 15:00~16:00 사용량은 제외됨
```

### 윈도우 선택 가이드

| 상황 | 추천 윈도우 |
|------|-------------|
| 짧은 시간 내 폭발적 사용 방지 | FIVE_HOURS |
| 일일 사용량 통제 | DAY |
| 실시간 대화형 서비스 | FIVE_HOURS |
| 배치 작업 혼합 서비스 | DAY |

## 서비스 Rate Limit (공통) 설정

서비스 내 모든 사용자에게 동일하게 적용되는 Rate Limit입니다.

### 설정 절차

1. **내 서비스** 페이지에서 서비스 선택
2. 서비스 상세 화면에서 **Rate Limit** 설정 영역 확인
3. **서비스 Rate Limit** 항목에서:
   - **최대 토큰 수** 입력
   - **윈도우** 선택 (5시간 / 24시간)
   - **활성화** 토글 ON
4. **저장** 클릭

### 설정 항목

| 항목 | 필수 | 설명 |
|------|------|------|
| 최대 토큰 수 (maxTokens) | O | 윈도우 내 인당 최대 토큰 |
| 윈도우 (window) | O | FIVE_HOURS 또는 DAY |
| 활성화 (enabled) | O | ON/OFF 토글 |

### 예시

```
서비스: my-chatbot
서비스 Rate Limit:
  maxTokens: 100,000
  window: DAY
  enabled: true

→ 모든 멤버가 24시간 내 최대 100,000 토큰까지 사용 가능
```

## 사용자 Rate Limit (개별) 설정

특정 사용자에게만 적용되는 개별 Rate Limit입니다. 서비스 Rate Limit과 별도로 설정하며, 설정된 사용자에게는 서비스 Rate Limit 대신 이 값이 적용됩니다.

### 설정 절차

1. **내 서비스** 페이지에서 서비스 선택
2. 서비스 상세 화면에서 **멤버** 탭 확인
3. Rate Limit을 설정할 멤버의 **Rate Limit** 컬럼 클릭
4. 개별 Rate Limit 설정:
   - **최대 토큰 수** 입력
   - **윈도우** 선택 (5시간 / 24시간)
   - **활성화** 토글 ON
5. **저장** 클릭

### 설정 항목

| 항목 | 필수 | 설명 |
|------|------|------|
| 최대 토큰 수 (maxTokens) | O | 윈도우 내 해당 사용자의 최대 토큰 |
| 윈도우 (window) | O | FIVE_HOURS 또는 DAY |
| 활성화 (enabled) | O | ON/OFF 토글 |

### 활용 예시

```
서비스: my-chatbot
서비스 Rate Limit: 100,000 tokens / DAY (전체 기본)

사용자별 Rate Limit:
  gildong.hong  → 200,000 tokens / DAY (파워 유저, 상향)
  kim.chulsoo   → 50,000 tokens / DAY (제한 필요, 하향)
  lee.younghee  → (미설정) → 서비스 Rate Limit 100,000 적용
```

## Rate Limit 초과 시 동작

Rate Limit을 초과하면 API 호출이 거부됩니다.

### 응답 형식

```json
{
  "error": {
    "message": "Rate limit exceeded. Token usage limit reached.",
    "type": "rate_limit_error",
    "code": 429
  }
}
```

### HTTP 상태 코드

- **429 Too Many Requests**: Rate Limit 초과

### 초과 후 재사용

- 슬라이딩 윈도우가 이동하면서 이전 사용량이 윈도우에서 빠지면 자동으로 다시 사용 가능
- 별도의 리셋 작업은 불필요

## Rate Limit 비활성화

설정된 Rate Limit을 일시적으로 비활성화할 수 있습니다.

- **비활성화**: enabled 토글을 OFF로 변경
- **비활성화 시**: Rate Limit이 적용되지 않음 (무제한)
- 설정값은 유지되므로, 다시 활성화하면 이전 설정이 그대로 적용됨

## 다음 단계

- [서비스 등록 가이드](/docs/service/service-registration) -- 서비스 생성 방법
- [서비스 사용자 관리](/docs/service/service-users) -- 서비스 멤버 관리
- [사용량 분석](/docs/service/usage-analytics) -- Rate Limit 현황 모니터링
- [API 인증](/docs/api/authentication) -- API 호출 시 인증 방법
