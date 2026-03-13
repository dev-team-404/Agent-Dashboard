# Agent Stats — 데이터베이스 구조 및 데이터 흐름

## 테이블 구조 요약

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    Service   │    │     User     │    │    Model     │
│──────────────│    │──────────────│    │──────────────│
│ id (PK)      │    │ id (PK)      │    │ id (PK)      │
│ name (UQ)    │    │ loginid (UQ) │    │ name (UQ)    │
│ displayName  │    │ username     │    │ displayName  │
│ type         │    │ deptname     │    │ endpointUrl  │
│ enabled      │    │ businessUnit │    │ type         │
│ registeredBy │    │ firstSeen    │    │ visibility   │
│ ...          │    │ lastActive   │    │ enabled      │
└──────┬───────┘    │ isActive     │    │ ...          │
       │            └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────┐
│                     UsageLog                          │
│──────────────────────────────────────────────────────│
│ id (PK)                                              │
│ userId      → User.id        (NULL: 백그라운드 서비스) │
│ modelId     → Model.id                               │
│ serviceId   → Service.id                             │
│ inputTokens   (입력 토큰)                             │
│ outputTokens  (출력 토큰)                             │
│ totalTokens   (합계)                                  │
│ latencyMs     (응답 지연 ms)                          │
│ deptname      (요청 부서명)                           │
│ timestamp     (요청 시각)                             │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                   UserService                         │
│──────────────────────────────────────────────────────│
│ id (PK)                                              │
│ userId      → User.id                                │
│ serviceId   → Service.id                             │
│ firstSeen     (첫 사용 시각)                          │
│ lastActive    (마지막 활동)                           │
│ requestCount  (누적 요청 수)                          │
│ @@unique([userId, serviceId])                        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                  DailyUsageStat                       │
│──────────────────────────────────────────────────────│
│ id (PK)                                              │
│ date          (날짜)                                  │
│ userId      → User.id        (NULL: 백그라운드)       │
│ modelId     → Model.id                               │
│ serviceId   → Service.id                             │
│ deptname                                             │
│ totalInputTokens   (일별 입력 토큰 합계)              │
│ totalOutputTokens  (일별 출력 토큰 합계)              │
│ requestCount       (일별 요청 수)                     │
│ @@unique([date, userId, modelId, serviceId])         │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                  UserRateLimit                        │
│──────────────────────────────────────────────────────│
│ id (PK)                                              │
│ userId      → User.id                                │
│ serviceId   → Service.id                             │
│ maxTokens     (윈도우 내 최대 토큰)                   │
│ window        (FIVE_HOURS | DAY)                     │
│ enabled                                              │
│ @@unique([userId, serviceId])                        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                 RatingFeedback                        │
│──────────────────────────────────────────────────────│
│ id (PK)                                              │
│ modelName     (모델명)                                │
│ rating        (1~5점)                                │
│ serviceId   → Service.id                             │
│ timestamp                                            │
└──────────────────────────────────────────────────────┘
```

---

## API 호출 → DB 기록 흐름

사용자가 LLM API를 호출하면 다음 순서로 데이터가 기록됩니다.

```
 클라이언트
   │
   │  POST /v1/chat/completions
   │  Headers: x-service-id, x-user-id, x-dept-name
   │
   ▼
┌─────────────────────────────────────────────────┐
│ 1. 프록시 인증 미들웨어 (validateProxyHeaders)    │
│    - x-service-id → Service 테이블 조회           │
│    - 서비스 존재 여부 & enabled 확인              │
│    - x-dept-name에서 businessUnit 추출            │
│    - 서비스의 registeredBy 정보로 LLM 접근권한 확인│
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ 2. 사용자 생성/갱신 (getOrCreateUser)            │
│    ※ BACKGROUND 서비스는 이 단계 건너뜀          │
│                                                  │
│    prisma.user.upsert({                          │
│      where: { loginid: x-user-id },              │
│      create: { loginid, username, deptname,       │
│                businessUnit, firstSeen: now() },  │
│      update: { lastActive: now(), deptname,       │
│                businessUnit }                     │
│    })                                            │
│                                                  │
│    ▶ User 테이블에 신규 생성 또는 lastActive 갱신  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ 3. Rate Limit 체크                               │
│    - UserRateLimit 조회 (userId + serviceId)     │
│    - 윈도우 내 UsageLog.totalTokens 합산         │
│    - 초과 시 429 반환 + Retry-After 헤더         │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ 4. LLM 엔드포인트 호출                           │
│    - Model + SubModel 라운드로빈 선택             │
│    - 실패 시 다음 엔드포인트로 failover           │
│    - 응답에서 토큰 사용량 추출:                   │
│      { prompt_tokens, completion_tokens }         │
│    - 응답 시간(latencyMs) 측정                   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ 5. 사용량 기록 (recordUsage)                     │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ A. UsageLog 생성                           │  │
│  │    prisma.usageLog.create({                │  │
│  │      userId,        ← NULL if background   │  │
│  │      modelId,                              │  │
│  │      serviceId,                            │  │
│  │      deptname,                             │  │
│  │      inputTokens,   ← prompt_tokens       │  │
│  │      outputTokens,  ← completion_tokens   │  │
│  │      totalTokens,   ← 합계                │  │
│  │      latencyMs                             │  │
│  │    })                                      │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ B. UserService upsert                      │  │
│  │    (userId + serviceId 존재 시에만)          │  │
│  │    prisma.userService.upsert({             │  │
│  │      where: { userId_serviceId },           │  │
│  │      create: { firstSeen, lastActive,       │  │
│  │               requestCount: 1 },            │  │
│  │      update: { lastActive: now(),           │  │
│  │               requestCount: { increment } } │  │
│  │    })                                      │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ C. Redis 카운터 갱신                        │  │
│  │    daily_usage:{날짜}     → +requests,      │  │
│  │                             +inputTokens,   │  │
│  │                             +outputTokens   │  │
│  │    user_usage:{uid}:{날짜} → +requests, ... │  │
│  │    model_usage:{mid}:{날짜} → +requests, ...│  │
│  │    active_users (sorted set) → 타임스탬프   │  │
│  │    (모두 TTL 7일)                           │  │
│  └────────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
          LLM 응답을 클라이언트에 반환
```

---

## 테이블별 역할 정리

| 테이블 | 역할 | 언제 기록되나 | 누가 읽나 |
|--------|------|---------------|-----------|
| **User** | 사용자 식별 & 활동 추적 | 첫 API 호출 시 생성, 매 요청마다 lastActive 갱신 | 모든 라우트, 인증 |
| **Service** | API 클라이언트 등록 정보 | 관리자가 대시보드에서 생성 | 프록시 인증, 정책 |
| **Model** | LLM 모델 설정 | 관리자가 대시보드에서 생성 | 모델 목록, 프록시 라우팅 |
| **UsageLog** | **개별 API 요청 상세 기록** | 매 LLM 요청마다 1건 생성 | 리포트, Rate Limit 계산, 분석 |
| **UserService** | 사용자↔서비스 관계 추적 | 매 요청마다 upsert (요청수 증가) | 활성 사용자 분석 |
| **DailyUsageStat** | 일별 집계 통계 | 집계 작업 (트리거/크론) | 대시보드 차트, Public API |
| **UserRateLimit** | 사용자별 토큰 할당량 | 관리자가 설정 | 매 요청 시 Rate Limit 체크 |
| **RatingFeedback** | 모델 품질 평가 | 사용자 피드백 API 호출 | 모델 평점 차트 |

---

## 토큰 카운팅 방식

```
LLM 응답 예시:
{
  "choices": [...],
  "usage": {
    "prompt_tokens": 1500,      ← inputTokens로 저장
    "completion_tokens": 800,   ← outputTokens로 저장
    "total_tokens": 2300        ← totalTokens로 저장
  }
}
```

| 항목 | 설명 | 저장 위치 |
|------|------|-----------|
| **inputTokens** | 프롬프트(질문) 토큰 수 | UsageLog, Redis, DailyUsageStat |
| **outputTokens** | 생성(응답) 토큰 수 | UsageLog, Redis, DailyUsageStat |
| **totalTokens** | input + output 합계 | UsageLog (Rate Limit 계산에 사용) |
| **latencyMs** | LLM 응답 시간 (밀리초) | UsageLog |

---

## 데이터 저장 레이어

```
┌─────────────────────────────────────────────────────┐
│              실시간 레이어 (Real-time)                │
│                                                     │
│  UsageLog (PostgreSQL)     Redis Cache (TTL 7일)    │
│  ┌───────────────────┐    ┌───────────────────────┐ │
│  │ 개별 요청 기록     │    │ daily_usage:{날짜}    │ │
│  │ - 전체 상세 정보   │    │ user_usage:{uid}:{날짜}│ │
│  │ - 무제한 보관      │    │ model_usage:{mid}:{날짜}│ │
│  │ - Rate Limit 계산  │    │ active_users (실시간) │ │
│  └───────────────────┘    └───────────────────────┘ │
│                                                     │
│  매 API 요청마다 동기적으로 기록                       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              분석 레이어 (Analytics)                  │
│                                                     │
│  DailyUsageStat (PostgreSQL)                        │
│  ┌─────────────────────────────────────────────┐    │
│  │ 일별 + 사용자별 + 모델별 + 서비스별 집계      │    │
│  │ - 대시보드 차트 데이터                        │    │
│  │ - Public Stats API                           │    │
│  │ - 빠른 범위 조회 (인덱스 최적화)              │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  별도 집계 작업으로 생성 (트리거 또는 크론)            │
└─────────────────────────────────────────────────────┘
```

---

## 테이블 관계도 (ER)

```
                    ┌─────────┐
                    │  Admin  │
                    │─────────│
                    │ loginid │
                    │ role    │
                    └────┬────┘
                         │ creates
                         ▼
┌─────────┐        ┌──────────┐        ┌───────────────┐
│ Service │◄──────▶│  Model   │◄──────▶│   SubModel    │
│─────────│  used  │──────────│ parent │───────────────│
│ name    │  by    │ name     │        │ endpointUrl   │
│ type    │        │ type     │        │ modelName     │
│ enabled │        │ enabled  │        │ enabled       │
└────┬────┘        └────┬─────┘        └───────────────┘
     │                  │
     │    ┌─────────────┼────────────────┐
     │    │             │                │
     ▼    ▼             ▼                ▼
┌──────────────┐  ┌───────────┐  ┌──────────────────┐
│  UsageLog    │  │   User    │  │ DailyUsageStat   │
│──────────────│  │───────────│  │──────────────────│
│ inputTokens  │  │ loginid   │  │ date             │
│ outputTokens │  │ username  │  │ totalInputTokens │
│ totalTokens  │  │ deptname  │  │ totalOutputTokens│
│ latencyMs    │  │ firstSeen │  │ requestCount     │
│ timestamp    │  │ lastActive│  └──────────────────┘
└──────────────┘  └─────┬─────┘
                        │
              ┌─────────┼──────────┐
              ▼                    ▼
     ┌──────────────┐    ┌──────────────┐
     │ UserService  │    │UserRateLimit │
     │──────────────│    │──────────────│
     │ firstSeen    │    │ maxTokens    │
     │ lastActive   │    │ window       │
     │ requestCount │    │ enabled      │
     └──────────────┘    └──────────────┘
```

---

## 예시: 한 건의 API 호출이 만드는 DB 레코드

```sql
-- 사용자 gildong.hong이 test-service를 통해 gpt-4o 호출

-- 1. User (upsert - 이미 있으면 lastActive만 갱신)
UPDATE users SET last_active = NOW(), deptname = 'S/W혁신팀(S.LSI)'
WHERE loginid = 'gildong.hong';

-- 2. UsageLog (항상 INSERT)
INSERT INTO usage_logs (
  id, user_id, model_id, service_id, deptname,
  input_tokens, output_tokens, total_tokens,
  latency_ms, timestamp
) VALUES (
  'uuid-xxx',
  'user-uuid',           -- gildong.hong의 User.id
  'model-uuid',          -- gpt-4o의 Model.id
  'service-uuid',        -- test-service의 Service.id
  'S/W혁신팀(S.LSI)',
  1500,                  -- prompt_tokens
  800,                   -- completion_tokens
  2300,                  -- total
  245,                   -- 245ms 응답시간
  NOW()
);

-- 3. UserService (upsert - 요청수 증가)
INSERT INTO user_services (id, user_id, service_id, first_seen, last_active, request_count)
VALUES ('uuid-yyy', 'user-uuid', 'service-uuid', NOW(), NOW(), 1)
ON CONFLICT (user_id, service_id)
DO UPDATE SET last_active = NOW(), request_count = request_count + 1;

-- 4. Redis (실시간 카운터)
-- HINCRBY daily_usage:2026-03-09 requests 1
-- HINCRBY daily_usage:2026-03-09 inputTokens 1500
-- HINCRBY daily_usage:2026-03-09 outputTokens 800
-- ZADD active_users <timestamp> gildong.hong
```
