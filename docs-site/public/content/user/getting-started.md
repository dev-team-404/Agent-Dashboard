# 사용자 시작하기

Agent Registry에 접속하여 서비스를 만들고 API를 호출하는 방법을 안내합니다.

## Dashboard 로그인

### 접속 방법

1. 브라우저에서 Agent Registry URL에 접속합니다.
2. SSO 인증을 통해 자동으로 로그인됩니다.
3. 로그인 완료 후 대시보드 메인 화면이 표시됩니다.

```
http://a2g.samsungds.net:8090
```

> **참고**: SSO 인증이 자동으로 처리되므로 별도의 회원가입이나 로그인 절차가 필요하지 않습니다.

## Dashboard에서 할 수 있는 것

모든 사용자는 아래 기능을 사용할 수 있습니다.

### 서비스 생성 및 관리

- **내 서비스** 페이지에서 직접 서비스를 생성할 수 있습니다.
- 서비스 모델 추가/제거, 멤버 관리, Rate Limit 설정 등을 직접 수행합니다.
- 서비스를 마켓에 배포하여 다른 사용자에게 공유할 수 있습니다.

> 서비스 등록에 대한 자세한 내용은 [서비스 등록 가이드](/docs/user/service-registration)를 참고하세요.

### 본인 사용량 확인

- **오늘/이번 주/이번 달** 기간별 API 사용량 조회
- **모델별** 사용량 확인 (어떤 모델을 가장 많이 사용했는지)
- **서비스별** 사용량 확인 (어떤 서비스를 통해 API를 호출했는지)
- **최근 사용 이력** 조회

### 대시보드 메인 화면

메인 화면에서는 사용 현황 요약을 확인할 수 있습니다.

| 표시 항목 | 설명 |
|-----------|------|
| 오늘 요청 수 | 오늘 호출한 API 횟수 |
| 이번 달 토큰 | 이번 달 사용한 총 토큰 수 |
| 주 사용 모델 | 가장 많이 사용한 모델 |
| 최근 활동 | 최근 API 호출 이력 |

> 사용량 확인에 대한 자세한 내용은 [사용량 확인](/docs/user/my-usage) 문서를 참고하세요.

## 빠른 시작: API 호출까지 3단계

### 1단계: 서비스 생성

1. 좌측 메뉴에서 **내 서비스** 클릭
2. **새 서비스 만들기** 버튼 클릭
3. 서비스 코드, 이름, 타입 입력 후 **생성**

### 2단계: 모델 추가

1. 생성된 서비스를 클릭
2. **모델** 탭에서 **모델 추가** 클릭
3. 사용할 LLM 모델을 선택하여 추가

### 3단계: API 호출

```bash
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "안녕하세요"}
    ]
  }'
```

## 사용 가능 모델 확인

본인의 서비스에서 사용할 수 있는 LLM 모델 목록은 API로 확인할 수 있습니다.

```bash
curl -X GET http://a2g.samsungds.net:8090/v1/models \
  -H "x-service-id: my-service" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)"
```

## 서비스 목록

다른 사용자가 배포한 서비스를 **서비스 목록**에서 검색하고 확인할 수 있습니다. 좌측 메뉴에서 **서비스 목록**을 클릭하세요.

## 다음 단계

- [서비스 등록 가이드](/docs/user/service-registration) — 서비스 생성 및 배포 방법
- [사용량 확인](/docs/user/my-usage) — 내 API 사용량 상세 조회 방법
- [API 인증](/docs/api/authentication) — API 인증 헤더 상세 설명
- [프레임워크별 연동](/docs/api/framework-integration) — Python/JS/Go 등 프레임워크별 코드 예시
- [Chat Completions API](/docs/api/chat-completions) — API 호출 방법 상세 가이드
