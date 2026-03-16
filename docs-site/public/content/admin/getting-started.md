# 시스템 관리자 시작하기

Agent Registry에서 시스템 관리자(System Admin) 역할로 LLM과 사용자를 관리하는 방법을 안내합니다.

> **용어 안내**: "시스템 관리자"는 부서 단위의 전체 관리 권한(LLM 등록, 통계 등)을 가진 역할입니다. 서비스 내에서 모델/멤버를 관리하는 "서비스 관리자"와 구분됩니다. 시스템 관리자는 슈퍼관리자(Super Admin)가 지정합니다.

## Dashboard 접속

브라우저에서 Agent Registry URL에 접속합니다. SSO 인증을 통해 자동으로 로그인됩니다.

```
http://a2g.samsungds.net:8090
```

로그인이 완료되면 대시보드 메인 화면이 표시됩니다.

## 시스템 관리자 권한이란?

시스템 관리자는 **자신이 속한 dept(부서) 내에서** LLM, 서비스, 사용자를 관리할 수 있는 권한입니다.

| 권한 | 시스템 관리자 | 슈퍼관리자 |
|------|:---:|:---:|
| LLM 관리 (등록, 공개 범위 설정) | O | O |
| 서비스 관리 (dept 내 조회, 수정, 삭제, Rate Limit) | O | O |
| 사용자 관리 (dept 내 목록 확인) | O (팀만) | O (전체) |
| 통계 확인 (dept 내 서비스/사용자/모델별) | O | O |
| 요청 로그 조회 | X | O |
| 감사 로그 조회 | X | O |
| 휴일 관리 | X | O |
| 시스템 관리자 / 슈퍼관리자 지정 | X | O |

> **참고**: 시스템 관리자 권한은 슈퍼관리자로부터 부여받습니다. 요청 로그, 감사 로그, 휴일 관리 등은 슈퍼관리자 전용 기능으로 시스템 관리자에게는 메뉴가 노출되지 않습니다. 신규 부서의 경우 담당자에게 문의하세요.

### 시스템 관리자 vs 서비스 관리자

| 구분 | 시스템 관리자 (System Admin) | 서비스 관리자 (Service Admin) |
|------|------|------|
| 범위 | 부서 전체 | 특정 서비스 내 |
| 지정 방법 | 슈퍼관리자가 지정 | 서비스 OWNER가 지정 |
| 주요 역할 | LLM 등록, 통계 조회, 사용자 관리 | 서비스 모델/멤버/Rate Limit 관리 |
| Rate Limit | 모든 서비스의 Rate Limit 설정 가능 | 자신이 관리하는 서비스만 설정 가능 |

## 첫 설정 순서

Dashboard에 처음 접근한 시스템 관리자는 아래 순서로 설정을 진행합니다.

### 1단계: LLM 등록

시스템 관리자의 핵심 역할은 **LLM 모델 등록 및 공개 범위 설정**입니다. 등록된 LLM은 공개 범위에 따라 사용자들이 자신의 서비스에 추가할 수 있습니다.

- Dashboard 좌측 메뉴의 **시스템 관리** 섹션에서 **LLM 관리** 클릭
- **LLM 등록** 버튼 클릭
- 모델명, 엔드포인트, 공개 범위 설정
- 필요시 서브모델(로드밸런싱) 추가
- 저장

> LLM 등록에 대한 자세한 내용은 [LLM 관리](/docs/admin/llm-management) 문서를 참고하세요.

### 2단계: 서비스 확인

사용자들이 직접 서비스를 생성합니다. 시스템 관리자는 **서비스 관리** 페이지에서 dept 내 모든 서비스를 조회하고 필요시 수정/삭제할 수 있습니다.

- Dashboard 좌측 메뉴에서 **서비스 관리** 클릭
- dept 내 서비스 목록 확인
- 필요시 서비스 설정 수정 또는 Rate Limit 설정

> 서비스 관리에 대한 자세한 내용은 [서비스 관리](/docs/admin/service-management) 문서를 참고하세요.

### 3단계: 사용자 안내

LLM 등록이 완료되면 팀원들에게 아래 정보를 안내합니다.

- 사용 가능한 **LLM 모델 목록**
- **서비스 생성 방법**: 서비스 관리 → 새 서비스 만들기
- **인증 헤더 형식**: `x-service-id`, `x-user-id`, `x-dept-name`

```bash
# 팀원이 사용할 API 호출 예시
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "안녕하세요"}]
  }'
```

> **팁**: 사용자에게 [서비스 등록 가이드](/docs/user/service-registration)를 공유하면 서비스 생성부터 배포까지 스스로 진행할 수 있습니다.

## API 문서 (Swagger)

등록된 API의 전체 스펙을 Swagger UI에서 확인하고 테스트할 수 있습니다.

```
http://a2g.samsungds.net:8090/api/api-docs/ui
```

> Swagger UI는 시스템 관리자 권한이 있는 사용자만 접근할 수 있습니다. Dashboard 사이드바의 **API 문서** 링크에서도 접근 가능합니다.

## 다음 단계

- [LLM 관리](/docs/admin/llm-management) — LLM 등록 및 공개 범위 설정
- [서비스 관리](/docs/admin/service-management) — dept 내 서비스 조회 및 관리
- [사용자/권한 관리](/docs/admin/user-management) — 사용자 목록 및 시스템 관리자 지정
- [통계 활용](/docs/admin/stats) — 대시보드 통계 보기
- [서비스 등록 가이드](/docs/user/service-registration) — 사용자 관점의 서비스 생성/배포 가이드
- [Swagger API 문서](http://a2g.samsungds.net:8090/api/api-docs/ui) — API 스펙 확인 및 테스트
