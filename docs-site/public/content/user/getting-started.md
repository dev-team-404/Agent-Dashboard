# 사용자 시작하기

Agent Dashboard에 일반 사용자로 접속하여 사용하는 방법을 안내합니다.

## Dashboard 로그인

### 접속 방법

1. 브라우저에서 Agent Dashboard URL에 접속합니다.
2. SSO 인증을 통해 자동으로 로그인됩니다.
3. 로그인 완료 후 대시보드 메인 화면이 표시됩니다.

```
https://<dashboard-url>
```

> **참고**: SSO 인증이 자동으로 처리되므로 별도의 회원가입이나 로그인 절차가 필요하지 않습니다.

## Dashboard에서 할 수 있는 것

일반 사용자(USER 역할)는 아래 기능을 사용할 수 있습니다.

### 본인 사용량 확인

- **오늘/이번 주/이번 달** 기간별 API 사용량 조회
- **모델별** 사용량 확인 (어떤 모델을 가장 많이 사용했는지)
- **서비스별** 사용량 확인 (어떤 서비스를 통해 API를 호출했는지)
- **최근 사용 이력** 조회

### 대시보드 메인 화면

메인 화면에서는 본인의 사용 현황 요약을 확인할 수 있습니다.

| 표시 항목 | 설명 |
|-----------|------|
| 오늘 요청 수 | 오늘 호출한 API 횟수 |
| 이번 달 토큰 | 이번 달 사용한 총 토큰 수 |
| 주 사용 모델 | 가장 많이 사용한 모델 |
| 최근 활동 | 최근 API 호출 이력 |

> 사용량 확인에 대한 자세한 내용은 [사용량 확인](/docs/user/my-usage) 문서를 참고하세요.

## API 사용을 위한 서비스 등록

API를 통해 LLM을 호출하려면 **서비스**가 등록되어 있어야 합니다. 서비스 등록은 Admin 권한이 필요합니다.

### 서비스가 이미 등록된 경우

팀의 Admin이 이미 서비스를 등록해두었다면, Admin에게 아래 정보를 확인하세요.

- **Service ID**: API 호출 시 `x-service-id` 헤더에 사용
- **사용 가능 모델**: 어떤 LLM 모델을 사용할 수 있는지

확인 후 아래와 같이 API를 호출할 수 있습니다.

```bash
curl -X POST https://<api-url>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "안녕하세요"}
    ]
  }'
```

### 서비스가 아직 없는 경우

서비스가 등록되어 있지 않다면 팀의 Admin에게 서비스 등록을 요청하세요.

**Admin에게 전달할 정보:**

- 서비스 용도 (예: 챗봇, 코드 리뷰, 데이터 분석 등)
- 서비스 타입 (일반/Background)
- 희망하는 Service ID

> Admin이 누구인지 모르는 경우 Dashboard 관리자에게 문의하세요.

## 사용 가능 모델 확인

본인이 사용할 수 있는 LLM 모델 목록은 API로 확인할 수 있습니다.

```bash
curl -X GET https://<api-url>/v1/models \
  -H "x-service-id: my-service" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)"
```

## 다음 단계

- [사용량 확인](/docs/user/my-usage) — 내 API 사용량 상세 조회 방법
- [API 인증](/docs/api/authentication) — API 인증 헤더 상세 설명
- [Chat Completions API](/docs/api/chat-completions) — API 호출 방법 상세 가이드
