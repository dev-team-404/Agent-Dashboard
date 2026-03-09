# 서비스 관리

Dashboard에서 서비스를 등록하고 관리하는 방법을 안내합니다.

## 서비스란?

서비스는 API 호출의 기본 단위입니다. 각 서비스에는 고유한 **Service ID**가 부여되며, API 요청 시 `x-service-id` 헤더로 식별됩니다.

서비스는 Admin이 등록한 **LLM 권한을 계승**합니다. 즉, Admin이 사용 가능한 LLM 모델을 서비스도 동일하게 사용할 수 있습니다.

## 서비스 등록

### 등록 절차

1. Dashboard 좌측 메뉴에서 **서비스 관리** 클릭
2. **서비스 등록** 버튼 클릭
3. 필수 정보 입력
4. **저장** 클릭

### 입력 항목

| 항목 | 필수 | 설명 |
|------|------|------|
| 서비스 ID | O | API 호출 시 사용하는 고유 식별자 |
| 서비스 이름 | O | 서비스 표시 이름 |
| 서비스 타입 | O | 일반 또는 Background |
| 설명 | - | 서비스 용도 설명 |

### 서비스 ID 규칙

서비스 ID는 아래 규칙을 따라야 합니다.

- **소문자 알파벳**, **숫자**, **하이픈(-)** 만 사용 가능
- 영문 소문자로 시작해야 함
- 최소 3자, 최대 50자
- 공백 사용 불가
- **중복 불가** — 이미 등록된 Service ID는 사용할 수 없음

```
# 올바른 예시
my-service
chatbot-api
data-pipeline-v2

# 잘못된 예시
My-Service       (대문자 사용)
123-service      (숫자로 시작)
my service       (공백 포함)
my_service       (언더스코어 사용)
```

### 서비스 타입

#### 일반 서비스

사용자를 식별하여 API를 호출하는 일반적인 서비스입니다.

- 인증 헤더: `x-service-id`, `x-user-id`, `x-dept-name`
- 사용자별 사용량 추적 가능
- 대부분의 서비스에 적합

#### Background 서비스

사용자 식별 없이 서비스 단위로 API를 호출하는 배치/자동화 서비스입니다.

- 인증 헤더: `x-service-id`, `x-dept-name`
- `x-user-id` 불필요
- 배치 작업, 자동화 파이프라인, 크론 잡 등에 적합

```bash
# 일반 서비스 API 호출
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{"model":"gpt-4o","messages":[...]}'

# Background 서비스 API 호출
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "x-service-id: batch-pipeline" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{"model":"gpt-4o","messages":[...]}'
```

## 서비스 수정

등록된 서비스의 정보를 수정할 수 있습니다.

1. **서비스 관리** 페이지에서 해당 서비스 클릭
2. 수정할 항목 편집
3. **저장** 클릭

> **주의**: Service ID는 등록 후 변경할 수 없습니다. 변경이 필요한 경우 기존 서비스를 삭제하고 새로 등록해야 합니다.

## 서비스 삭제

더 이상 사용하지 않는 서비스를 삭제할 수 있습니다.

1. **서비스 관리** 페이지에서 해당 서비스 클릭
2. **삭제** 버튼 클릭
3. 확인 다이얼로그에서 삭제 확인

> **주의**: 서비스를 삭제하면 해당 Service ID로의 모든 API 호출이 즉시 차단됩니다. 삭제 전에 해당 서비스를 사용 중인 곳이 없는지 확인하세요.

## LLM 권한 계승 구조

서비스는 등록한 Admin의 LLM 권한을 계승합니다.

```
Admin (LLM 접근 권한 보유)
  └── 서비스 A → Admin과 동일한 LLM 사용 가능
  └── 서비스 B → Admin과 동일한 LLM 사용 가능
```

- Admin에게 특정 LLM 접근 권한이 있으면, 해당 Admin이 등록한 모든 서비스에서 그 LLM을 사용할 수 있습니다.
- Admin의 LLM 권한이 변경되면 해당 Admin이 등록한 서비스의 사용 가능 모델도 함께 변경됩니다.

## 다음 단계

- [LLM 관리](/docs/admin/llm-management) — 서비스에서 사용할 LLM 등록
- [API 인증](/docs/api/authentication) — 서비스 등록 후 API 호출 방법
- [서비스 등록 가이드 (API)](/docs/api/service-registration) — API 관점의 서비스 등록 가이드
