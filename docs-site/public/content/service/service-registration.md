# 서비스 등록 가이드

"내 서비스" 페이지에서 새 서비스를 생성하고, 서비스 목록에 배포하는 전체 과정을 안내합니다.

## 서비스 생성하기

### 생성 절차

1. Dashboard 좌측 메뉴에서 **내 서비스** 클릭
2. 우측 상단 **+ 새 서비스** 버튼 클릭
3. 서비스 정보 입력
4. **생성** 클릭

### 입력 항목

서비스 등록은 **5단계 마법사** 형태로 진행됩니다.

| 항목 | 필수 | 단계 | 설명 |
|------|------|------|------|
| 서비스 코드 (name) | O | 1단계 | API 호출 시 `x-service-id`로 사용하는 고유 식별자 |
| 서비스 이름 (displayName) | O | 1단계 | Dashboard에서 표시되는 이름 |
| 설명 | - | 1단계 | 서비스 용도에 대한 설명 |
| 서비스 타입 | O | 2단계 | STANDARD 또는 BACKGROUND |
| 서비스 카테고리 | O | 2단계 | 아래 7개 분류 중 택1 |
| 목표 MM (targetMM) | O | 3단계 | 프로젝트의 목표 인력 투입량 (Men/Month) |
| 표준 M/D (standardMD) | △ | 3단계 | BACKGROUND 서비스의 단위 업무당 표준 공수 (Man/Day) |
| 로고 URL (iconUrl) | - | 4단계 | 서비스 아이콘 이미지 URL |
| 서비스 URL (serviceUrl) | - | 4단계 | 서비스 바로가기 URL |
| API 문서 URL (docsUrl) | - | 4단계 | API 연동 가이드 문서 URL |
| Jira 티켓 (jiraTicket) | - | 4단계 | 관련 Jira 티켓 URL |

> △: BACKGROUND 타입 선택 시 필수

### 서비스 카테고리 (7종)

| 카테고리 |
|----------|
| 설계 자동화 및 최적화 |
| 코드 생성 및 리뷰 |
| 테스트 자동화 |
| 문서화 및 지식 관리 |
| 데이터 분석 및 시각화 |
| 백그라운드 업무 자동화 |
| 기타 AI 응용 |

## 서비스 코드 네이밍 규칙

서비스 코드(`name`)는 API 호출 시 `x-service-id` 헤더에 사용되는 고유 식별자입니다. 아래 규칙을 반드시 따라야 합니다.

### 규칙 요약

- **소문자 알파벳**, **숫자**, **하이픈(-)** 만 사용 가능
- **영문 소문자로 시작**해야 함
- 최소 3자, 최대 50자
- 공백 및 언더스코어(`_`) 사용 불가
- **중복 불가** -- 이미 등록된 서비스 코드는 사용할 수 없음

### 올바른 예시와 잘못된 예시

```
# 올바른 예시
my-chatbot
data-pipeline-v2
code-review-bot

# 잘못된 예시
My-Chatbot       (대문자 사용)
123-service      (숫자로 시작)
my chatbot       (공백 포함)
my_chatbot       (언더스코어 사용)
ab               (3자 미만)
```

> **주의**: 서비스 코드는 생성 후 변경할 수 없습니다. 신중하게 결정하세요.

## 서비스 타입

서비스 생성 시 **STANDARD**와 **BACKGROUND** 중 하나를 선택합니다.

### STANDARD (일반 서비스)

사용자를 식별하여 API를 호출하는 일반적인 서비스입니다.

- 인증 헤더: `x-service-id`, `x-user-id`, `x-dept-name` 모두 필수
- 사용자별 사용량 추적 가능
- 사용자별 Rate Limit 설정 가능
- 챗봇, 코드 리뷰 도구 등 **사용자 인터랙션이 있는 서비스**에 적합

```bash
# STANDARD 서비스 API 호출
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-chatbot" \
  -H "x-user-id: gildong.hong" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"안녕하세요"}]}'
```

### BACKGROUND (백그라운드 서비스)

사용자 식별 없이 서비스 단위로 API를 호출하는 자동화 서비스입니다.

- 인증 헤더: `x-service-id`, `x-dept-name`만 필수
- `x-user-id` 불필요 (전달해도 무시됨)
- 서비스 단위 사용량만 추적
- 배치 작업, 자동화 파이프라인, 크론 잡 등에 적합

```bash
# BACKGROUND 서비스 API 호출
curl -X POST http://a2g.samsungds.net:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: batch-pipeline" \
  -H "x-dept-name: S/W혁신팀(S.LSI)" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"데이터 요약해줘"}]}'
```

### 타입 선택 가이드

| 조건 | 추천 타입 |
|------|-----------|
| 사용자 로그인이 있는 웹/앱 서비스 | STANDARD |
| 사용자별 사용량 추적이 필요한 경우 | STANDARD |
| Rate Limit을 사용자별로 다르게 적용해야 하는 경우 | STANDARD |
| 서버 간 통신, 배치 잡, 크론 잡 | BACKGROUND |
| 자동화 파이프라인 (CI/CD, 데이터 처리) | BACKGROUND |
| 사용자 구분 없이 서비스 전체로 관리하는 경우 | BACKGROUND |

## 서비스 라이프사이클

서비스는 **개발(DEVELOPMENT)** 과 **배포(DEPLOYED)** 두 가지 상태를 가집니다.

### 상태 흐름

```
서비스 생성 → [개발] → 배포 → [배포 완료]
                ↑                    ↓
                └── 배포 취소 ←──────┘
```

### 개발 (DEVELOPMENT)

- 서비스 생성 시 기본 상태
- **서비스 목록에 노출되지 않음**
- API 호출은 정상 작동 (개발/테스트 가능)
- 서비스 설정을 자유롭게 수정 가능

### 배포 완료 (DEPLOYED)

- 서비스 목록에 노출됨
- 다른 사용자들이 서비스를 검색하고 확인 가능
- API 호출 정상 작동

### 서비스 목록에 배포하기

1. **내 서비스** 페이지에서 배포할 서비스 선택
2. 서비스 상세 화면에서 **배포** 버튼 클릭
3. 서비스 상태가 `DEPLOYED`로 변경됨
4. 서비스 목록에 해당 서비스가 노출됨

> **팁**: 배포 전에 서비스 설명, 문서 URL, 아이콘 등을 미리 설정해두면 서비스 목록에서 더 좋은 인상을 줄 수 있습니다.

## 서비스 수정

등록된 서비스의 정보를 수정할 수 있습니다.

1. **내 서비스** 페이지에서 수정할 서비스의 **편집** 아이콘 클릭
2. 수정할 항목 편집
3. **저장** 클릭

### 수정 가능 항목

| 항목 | 수정 가능 | 비고 |
|------|-----------|------|
| 서비스 코드 (name) | X | 생성 후 변경 불가 |
| 서비스 이름 (displayName) | O | |
| 서비스 타입 | O | STANDARD/BACKGROUND 변경 가능 |
| 설명 | O | |
| 서비스 카테고리 | O | 7개 분류 중 변경 가능 |
| 목표 MM | O | |
| 표준 M/D | O | BACKGROUND 서비스에만 해당 |
| 아이콘 URL | O | |
| 서비스 URL | O | |
| 문서 URL | O | |
| Jira 티켓 | O | |

## 서비스 삭제

더 이상 사용하지 않는 서비스를 삭제할 수 있습니다.

1. **내 서비스** 페이지에서 삭제할 서비스의 **삭제** 버튼 클릭
2. 확인 다이얼로그에서 삭제 확인

### 사용 데이터가 있는 서비스

사용 이력(요청 로그)이 있는 서비스를 삭제하면 추가 경고가 표시됩니다. 삭제 시 아래 항목이 모두 함께 제거됩니다:

- 요청 로그 및 일별 사용량 통계
- 서비스 모델 연결 (alias 그룹 포함)
- 서비스 멤버 목록
- Rate Limit 설정

> **주의**: 서비스를 삭제하면 해당 Service ID로의 모든 API 호출이 즉시 차단되고, 관련 데이터가 복구 불가능하게 삭제됩니다. 삭제 전에 필요한 통계 데이터를 미리 CSV로 내보내세요.

## 다음 단계

- [서비스 모델 관리](/docs/service/service-models) -- 서비스에 LLM 모델 추가하기
- [서비스 사용자 관리](/docs/service/service-users) -- 서비스 멤버 추가 및 역할 관리
- [Rate Limit 설정](/docs/service/rate-limits) -- 서비스/사용자별 토큰 제한 설정
- [사용량 분석](/docs/service/usage-analytics) -- 서비스 사용 현황 확인
