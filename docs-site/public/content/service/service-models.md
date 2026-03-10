# 서비스 모델 관리

서비스에서 사용할 LLM 모델을 추가/제거하고, 모델 접근 권한이 어떻게 동작하는지 안내합니다.

## 서비스 모델이란?

서비스 모델은 **특정 서비스에서 사용할 수 있는 LLM 모델 목록**입니다. 서비스에 모델을 추가해야만 해당 서비스의 API 호출에서 그 모델을 사용할 수 있습니다.

```
서비스: my-chatbot
  ├── gpt-4o          (추가됨 → 사용 가능)
  ├── claude-sonnet    (추가됨 → 사용 가능)
  └── gemini-pro       (추가 안 됨 → 사용 불가)
```

## 모델 추가하기

### 추가 절차

1. **내 서비스** 페이지에서 모델을 추가할 서비스 선택
2. 서비스 상세 화면에서 **모델** 탭 확인
3. **모델 추가** 버튼 클릭
4. 사용 가능한 모델 목록에서 추가할 모델 선택
5. **추가** 클릭

### 사용 가능한 모델

모델 추가 시 표시되는 목록은 아래 조건을 모두 만족하는 모델입니다:

| 조건 | 설명 |
|------|------|
| 활성화 상태 | `enabled: true`인 모델만 표시 |
| 공개 범위 충족 | 본인의 부서/사업부가 모델의 공개 범위에 포함 |
| 미추가 상태 | 이미 서비스에 추가된 모델은 목록에서 제외 |

### 모델 공개 범위 (Visibility)

모델은 등록 시 설정된 공개 범위에 따라 접근이 제한됩니다.

| 공개 범위 | 접근 가능 대상 |
|-----------|---------------|
| **PUBLIC** | 모든 사용자 |
| **BUSINESS_UNIT** | 지정된 사업부에 속한 사용자 |
| **TEAM** | 지정된 팀에 속한 사용자 |
| **ADMIN_ONLY** | 관리자(ADMIN + SUPER_ADMIN)만 |
| **SUPER_ADMIN_ONLY** | 슈퍼 관리자만 |

> **팁**: 본인이 접근 가능한 모델만 서비스에 추가할 수 있습니다. 필요한 모델이 목록에 보이지 않으면, 해당 모델의 공개 범위를 관리자에게 확인하세요.

## 모델 제거하기

1. 서비스 상세 화면에서 **모델** 탭 확인
2. 제거할 모델의 **삭제** 아이콘 클릭
3. 확인 다이얼로그에서 삭제 확인

> **주의**: 모델을 제거하면 해당 서비스에서 그 모델로의 API 호출이 즉시 차단됩니다. 제거 전에 해당 모델을 사용 중인 곳이 없는지 확인하세요.

## 프록시 인증과 서비스 모델

API 호출 시 프록시 서버는 아래 순서로 모델 접근을 검증합니다.

### 인증 흐름

```
1. 요청 수신
   └── 헤더 확인: x-service-id, x-user-id, x-dept-name

2. 서비스 검증
   └── x-service-id에 해당하는 서비스가 존재하는지 확인
   └── 서비스가 활성화(enabled) 상태인지 확인

3. 모델 검증
   └── 요청 body의 model이 서비스에 추가된 모델인지 확인
   └── 해당 모델이 활성화(enabled) 상태인지 확인

4. Rate Limit 확인
   └── 서비스/사용자별 토큰 사용량 확인

5. 프록시 전달
   └── 검증 통과 시 실제 LLM 엔드포인트로 요청 전달
```

### 인증 실패 시 응답

| 상황 | HTTP 상태 | 에러 메시지 |
|------|-----------|------------|
| 서비스 ID 없음 | 400 | Missing x-service-id header |
| 서비스 미등록 | 404 | Service not found |
| 서비스 비활성화 | 403 | Service is disabled |
| 모델 미등록 | 403 | Model not available for this service |
| Rate Limit 초과 | 429 | Rate limit exceeded |

### API 호출 예시

```bash
# 서비스에 gpt-4o가 추가된 경우 → 성공
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"안녕"}]}'
# → 200 OK

# 서비스에 gemini-pro가 추가되지 않은 경우 → 실패
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{"model":"gemini-pro","messages":[{"role":"user","content":"안녕"}]}'
# → 403 Forbidden: Model not available for this service
```

## 서비스에서 사용 가능한 모델 확인 (API)

서비스에 추가된 모델 목록은 Models API로 조회할 수 있습니다.

```bash
curl http://a2g.samsungds.net:8090/v1/models \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)"
```

응답에는 해당 서비스에 추가된 모델만 포함됩니다.

## 모델 타입

서비스에 추가할 수 있는 모델은 아래 타입을 가집니다.

| 모델 타입 | 설명 | API 엔드포인트 |
|-----------|------|---------------|
| **CHAT** | 채팅 완성 모델 | `/v1/chat/completions` |
| **IMAGE** | 이미지 생성 모델 | `/v1/images/generations` |
| **EMBEDDING** | 임베딩 모델 | `/v1/embeddings` |
| **RERANKING** | 리랭킹 모델 | `/v1/rerank` |

## 다음 단계

- [서비스 등록 가이드](/docs/service/service-registration) -- 서비스 생성 방법
- [서비스 사용자 관리](/docs/service/service-users) -- 서비스 멤버 관리
- [API 인증](/docs/api/authentication) -- API 헤더 기반 인증 상세
- [Chat Completions API](/docs/api/chat-completions) -- 채팅 API 호출 방법
