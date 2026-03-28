# deploy.sh 사용 설명서

## 명령어 요약

```bash
./deploy.sh                  # 프로덕션 Blue-Green 무중단 배포
./deploy.sh --with-docs      # docs-site 포함 배포 (nginx 재시작, 1~2초 끊김)
./deploy.sh status           # 프로덕션 활성 슬롯 확인
./deploy.sh init             # 최초 설치 (전체 빌드 + 순차 시작)
./deploy.sh migrate          # DB 스키마만 동기화 (컨테이너 재빌드 없음)
./deploy.sh dev              # Dev/QA 서버 빌드 + 시작
./deploy.sh dev-stop         # Dev/QA 서버 중지
./deploy.sh dev-status       # Dev/QA 서버 상태 확인
```

---

## 아키텍처

```
                    ┌─────────────────────────────────────────────┐
                    │              PostgreSQL (8091)               │
                    │              Redis (8092)                    │
                    └──────────┬──────────────────┬───────────────┘
                               │                  │
              ┌────────────────┴───┐          ┌───┴────────────────┐
              │   프로덕션 (8090)   │          │   Dev/QA (8095)    │
              │                    │          │                    │
              │  nginx             │          │  nginx-dev         │
              │    ├─ api-blue     │          │    ├─ api-dev      │
              │    ├─ api-green    │          │    └─ dashboard-dev│
              │    ├─ dashboard-blue│         │                    │
              │    └─ dashboard-green│        │  Redis DB 15       │
              │                    │          │  (캐시만 분리)      │
              │  Redis DB 0        │          │                    │
              └────────────────────┘          └────────────────────┘
```

- 프로덕션과 Dev는 **같은 PostgreSQL** 사용 (같은 데이터 조회/기록)
- Redis 캐시만 분리: 프로덕션 DB 0, Dev DB 15 (1~14는 프로덕션 캐시 확장 예약)
- 포트/컨테이너/nginx가 완전 분리되어 **프로덕션에 영향 0**

---

## 포트 구성

| 포트 | 용도 |
|------|------|
| 8090 | 프로덕션 (Nginx proxy) |
| 8091 | PostgreSQL |
| 8092 | Redis |
| 8095 | Dev/QA 서버 (Nginx proxy) |

---

## 1. 최초 설치

서버에 처음 배포할 때 한 번만 실행합니다.

```bash
./deploy.sh init
```

순서: PostgreSQL/Redis 시작 -> Blue 슬롯 빌드+시작(DB 마이그레이션) -> Green 슬롯 빌드+시작 -> Nginx 빌드+시작

---

## 2. 프로덕션 배포 (일반)

코드 수정 후 프로덕션에 반영합니다. **다운타임 0.**

```bash
git pull
./deploy.sh
```

내부 동작:
1. 비활성 슬롯(예: green) 빌드 + 재시작
2. 헬스체크 통과 후 nginx reload로 트래픽 전환
3. 구 활성 슬롯(예: blue)도 업데이트
4. 양쪽 모두 최신, 서비스 중단 없음

docs-site도 함께 배포할 때:
```bash
./deploy.sh --with-docs
```
> nginx 컨테이너가 교체되므로 1~2초 끊김 발생

---

## 3. Dev/QA 서버

배포 전 동작 검증용. 프로덕션과 완전 독립된 별도 포트에서 운영합니다.

### 시작
```bash
./deploy.sh dev
```
-> `http://<서버IP>:8095` 에서 접속

### 상태 확인
```bash
./deploy.sh dev-status
```

### 중지
```bash
./deploy.sh dev-stop
```

### 권장 워크플로우

```
코드 수정 -> ./deploy.sh dev -> :8095에서 QA
                                    |
                              이상 없음?
                                    |
                              ./deploy.sh  -> 프로덕션 배포 (:8090)
```

### Dev 서버 안전장치

| 항목 | 동작 |
|------|------|
| DB 스키마 변경 | **차단됨** - prisma db push 실행 안 됨 |
| 스키마 변경 감지 시 | 경고 출력 + `syngha.han` 승인 후 `./deploy.sh migrate` 안내 |
| Redis 캐시 | DB 15 사용 (프로덕션 DB 0과 격리) |
| PostgreSQL | 프로덕션과 공유 (실 데이터로 테스트) |

---

## 4. DB 스키마 변경 (migrate)

Prisma 스키마가 변경된 경우, **프로덕션에서만** 실행합니다.

```bash
./deploy.sh migrate
```

> Dev 서버에서는 스키마 변경이 자동으로 차단됩니다.
> 반드시 `syngha.han` 확인 후 실행하세요.

내부 동작:
1. 현재 활성 API 컨테이너에 최신 schema.prisma 복사
2. `prisma db push` 실행 (safe mode 먼저, 실패 시 --accept-data-loss 재시도)
3. 스키마 동기화 완료 (Prisma Client는 다음 deploy 시 재생성)

---

## 5. 상태 확인

```bash
./deploy.sh status       # 프로덕션: 활성 슬롯(blue/green) + 컨테이너 목록
./deploy.sh dev-status   # Dev 서버 컨테이너 상태
```

---

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DEV_PORT` | 8095 | Dev 서버 포트 |
| `PROXY_PORT` | 8090 | 프로덕션 Nginx 포트 |
| `POSTGRES_PORT` | 8091 | PostgreSQL 포트 |
| `REDIS_PORT` | 8092 | Redis 포트 |

---

## Redis DB 번호 할당

| DB | 용도 |
|----|------|
| 0 | 프로덕션 (기본) |
| 1~14 | 프로덕션 캐시 확장 예약 |
| 15 | Dev/QA 서버 |

---

## 트러블슈팅

### 헬스체크 실패
```bash
# 컨테이너 로그 확인
docker logs agent-registry-api-blue
docker logs agent-registry-api-dev
```

### Dev 서버가 안 뜰 때
```bash
# 인프라(postgres, redis)가 실행 중인지 확인
docker compose ps postgres redis

# 안 뜨면 프로덕션 init 또는 수동 시작
docker compose up -d postgres redis
```

### 스키마 변경 경고가 뜨는데 서버가 제대로 안 될 때
```bash
# syngha.han 승인 후 스키마 동기화
./deploy.sh migrate

# Dev 서버 재시작
./deploy.sh dev
```
