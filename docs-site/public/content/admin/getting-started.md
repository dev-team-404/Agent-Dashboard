# Admin 시작하기

Agent Dashboard에서 Admin 역할로 서비스와 LLM을 관리하는 방법을 안내합니다.

## Dashboard 접속

브라우저에서 Agent Dashboard URL에 접속합니다. SSO 인증을 통해 자동으로 로그인됩니다.

```
http://a2g.samsungds.net:8090
```

로그인이 완료되면 대시보드 메인 화면이 표시됩니다.

## Admin 권한이란?

Admin은 **자신이 속한 dept(부서) 내에서** 서비스, LLM, 사용자를 관리할 수 있는 권한입니다.

| 권한 | 설명 |
|------|------|
| 서비스 관리 | dept 내 서비스 등록, 수정, 삭제 |
| LLM 관리 | LLM 모델 등록, 공개 범위 설정, 서브모델 관리 |
| 사용자 관리 | dept 내 사용자 목록 확인, Admin 지정/해제 |
| 통계 확인 | dept 내 서비스/사용자/모델별 통계 조회 |

> **참고**: Admin 권한은 기존 Admin으로부터 부여받습니다. 신규 부서의 경우 담당자에게 문의하세요.

## 첫 설정 순서

Dashboard에 처음 접근한 Admin은 아래 순서로 설정을 진행합니다.

### 1단계: 서비스 등록

먼저 API를 사용할 서비스를 등록합니다. 서비스는 API 호출의 단위이며, 각 서비스에는 고유한 Service ID가 부여됩니다.

- Dashboard 좌측 메뉴에서 **서비스 관리** 클릭
- **서비스 등록** 버튼 클릭
- 서비스 ID, 이름, 타입(일반/Background) 입력
- 저장

> 서비스 등록에 대한 자세한 내용은 [서비스 관리](/docs/admin/service-management) 문서를 참고하세요.

### 2단계: LLM 등록

서비스에서 사용할 LLM 모델을 등록합니다.

- Dashboard 좌측 메뉴에서 **LLM 관리** 클릭
- **LLM 등록** 버튼 클릭
- 모델명, 엔드포인트, 공개 범위 설정
- 필요시 서브모델(로드밸런싱) 추가
- 저장

> LLM 등록에 대한 자세한 내용은 [LLM 관리](/docs/admin/llm-management) 문서를 참고하세요.

### 3단계: 사용자 안내

서비스와 LLM 등록이 완료되면 팀원들에게 아래 정보를 안내합니다.

- **Service ID**: API 호출 시 `x-service-id` 헤더에 사용
- **사용 가능한 모델 목록**: `GET /v1/models`로 확인 가능
- **인증 헤더 형식**: `x-service-id`, `x-user-id`, `x-dept-name`

```bash
# 팀원이 사용할 API 호출 예시
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: hong.gildong" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "안녕하세요"}]
  }'
```

## API 문서 (Swagger)

등록된 API의 전체 스펙을 Swagger UI에서 확인하고 테스트할 수 있습니다.

```
http://a2g.samsungds.net:8090/api/api-docs/ui
```

> Swagger UI는 Admin 권한이 있는 사용자만 접근할 수 있습니다. Dashboard 사이드바의 **API 문서** 링크에서도 접근 가능합니다.

## 다음 단계

- [서비스 관리](/docs/admin/service-management) — 서비스 등록, 수정, 삭제 방법
- [LLM 관리](/docs/admin/llm-management) — LLM 등록 및 공개 범위 설정
- [사용자/권한 관리](/docs/admin/user-management) — 사용자 목록 및 Admin 지정
- [통계 활용](/docs/admin/stats) — 대시보드 통계 보기
- [Swagger API 문서](http://a2g.samsungds.net:8090/api/api-docs/ui) — API 스펙 확인 및 테스트
