# 서비스 등록 가이드

Dashboard에서 서비스를 등록하고 API를 호출하기까지의 전체 과정을 안내합니다.

## 개요

API를 호출하려면 먼저 Dashboard에서 **서비스를 등록**해야 합니다. 서비스는 API 호출의 기본 단위이며, 등록된 서비스의 Service ID를 사용하여 인증합니다.

> **참고**: 서비스 등록은 누구나 할 수 있습니다. Dashboard에 로그인하면 바로 서비스를 생성할 수 있습니다.

## 1단계: Dashboard에서 서비스 등록

### 등록 절차

1. Dashboard에 로그인
2. 좌측 메뉴에서 **서비스 관리** 클릭
3. **서비스 등록** 버튼 클릭
4. 서비스 정보 입력
5. **저장** 클릭

### 서비스 ID 선택

서비스 ID는 API 호출 시 `x-service-id` 헤더에 사용되는 고유 식별자입니다.

**규칙:**
- 소문자 알파벳, 숫자, 하이픈(-) 만 사용 가능
- 영문 소문자로 시작
- 3~50자
- **중복 불가** — 이미 등록된 Service ID는 사용할 수 없음

```
# 좋은 서비스 ID 예시
my-chatbot
code-review-bot
data-analysis-v2
internal-api

# 사용할 수 없는 예시
My-Service       # 대문자 포함
123-bot          # 숫자로 시작
my_bot           # 언더스코어 사용
ab               # 3자 미만
```

## 2단계: 서비스 타입 선택

### 일반 서비스

사용자별로 API 호출을 추적하는 일반적인 서비스입니다.

- 사용자가 직접 사용하는 챗봇, 코딩 도구 등에 적합
- API 호출 시 `x-user-id` 헤더가 **필수**
- 사용자별 사용량 추적 가능

```bash
# 일반 서비스 API 호출
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"안녕하세요"}]}'
```

### Background 서비스

사용자 식별 없이 서비스 단위로 동작하는 자동화 서비스입니다.

- 배치 작업, 크론 잡, 자동화 파이프라인에 적합
- API 호출 시 `x-user-id` 헤더가 **불필요**
- 서비스 단위로 사용량 추적

```bash
# Background 서비스 API 호출
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: batch-pipeline" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"데이터를 분석해주세요"}]}'
```

### 어떤 타입을 선택해야 할까?

| 사용 사례 | 추천 타입 |
|-----------|-----------|
| 사내 챗봇 | 일반 |
| 코드 리뷰 도구 | 일반 |
| IDE 플러그인 | 일반 |
| 데이터 파이프라인 | Background |
| 주기적 배치 작업 | Background |
| CI/CD 통합 | Background |

## 3단계: 등록 후 API 호출

서비스 등록이 완료되면 바로 API를 호출할 수 있습니다.

### 사용 가능 모델 확인

먼저 등록한 서비스에서 사용 가능한 모델을 확인합니다.

```bash
curl -X GET http://a2g.samsungds.net:8090/v1/models \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)"
```

### 첫 번째 API 호출

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "system",
        "content": "당신은 사내 업무를 도와주는 AI 어시스턴트입니다."
      },
      {
        "role": "user",
        "content": "안녕하세요, 테스트 메시지입니다."
      }
    ]
  }'
```

### 예상 응답

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "안녕하세요! 어떤 업무를 도와드릴까요?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 35,
    "completion_tokens": 15,
    "total_tokens": 50
  }
}
```

## 전체 흐름 요약

```
1. Dashboard 로그인
       ↓
2. 서비스 관리 → 서비스 등록
       ↓
3. Service ID 입력 + 타입 선택
       ↓
4. 저장
       ↓
5. 사용 가능 모델 확인 (GET /v1/models)
       ↓
6. API 호출 시작 (POST /v1/chat/completions)
```

## 자주 묻는 질문

### 서비스를 등록했는데 API 호출이 안 됩니다

- `x-service-id` 헤더 값이 등록한 Service ID와 정확히 일치하는지 확인하세요.
- `x-dept-name` 헤더 값이 올바른 형식(`팀명(사업부)`)인지 확인하세요.
- 일반 서비스인 경우 `x-user-id` 헤더가 포함되어 있는지 확인하세요.

### 모델 목록이 비어 있습니다

- Admin이 LLM 모델을 등록했는지 확인하세요.
- 등록된 LLM의 공개 범위가 서비스에 접근 가능한 범위인지 확인하세요.

### Service ID를 변경하고 싶습니다

- Service ID는 등록 후 변경할 수 없습니다.
- 기존 서비스를 삭제하고 새 Service ID로 다시 등록해야 합니다.
- 기존 Service ID를 사용 중인 모든 코드/설정도 함께 변경해야 합니다.

## 다음 단계

- [API 인증](/docs/api/authentication) — 인증 헤더 상세 설명
- [Chat Completions API](/docs/api/chat-completions) — API 호출 상세 가이드
- [Models API](/docs/api/models) — 모델 목록 조회 API
- [서비스 관리 (Admin)](/docs/admin/service-management) — Admin 관점의 서비스 관리
