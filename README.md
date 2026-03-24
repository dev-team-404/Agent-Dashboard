# LLM Gateway & Monitoring Portal

<p align="center">
  <img src="logo.png" alt="LLM Gateway" width="120" />
</p>

<p align="center">
  <strong>1,000+ 동시 사용자를 지원하는 엔터프라이즈 LLM API Gateway & 통합 모니터링 포털</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/Nginx-Reverse_Proxy-009639?logo=nginx&logoColor=white" />
</p>

---

## Overview

조직 내 다수의 서비스가 다양한 LLM(Large Language Model)을 **안전하고 효율적으로** 사용할 수 있도록 설계된 **API Gateway + 모니터링 플랫폼**입니다.

단일 엔드포인트(`/v1/*`)를 통해 Chat, Embedding, Reranking, Image Generation, ASR(음성인식) 등 **5가지 모델 유형**의 요청을 라우팅하며, 서비스별 사용량 추적·장애 감지·자동 Failover·실시간 대시보드를 제공합니다.

**1,000명 이상**이 동시에 LLM을 호출하고, 관리자는 22개 페이지의 대시보드에서 전체 시스템 상태를 실시간으로 모니터링합니다.

### Production Metrics

| Metric | Value |
|--------|-------|
| **Daily Active Users** | 1,000+ |
| **Registered Services** | 50+ |
| **Available LLM Models** | 30+ |
| **Daily API Calls** | 100,000+ |
| **Routing Overhead** | < 200ms |
| **Uptime** | 99.9% (Blue-Green Deploy) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Nginx Reverse Proxy (:8090)                     │
│                      Blue/Green Upstream Switching                   │
├──────────┬──────────────────────────────────┬───────────────────────┤
│  /api/*  │            /v1/*                 │         /*            │
│ REST API │       LLM Proxy Routes           │    Dashboard SPA      │
├──────────┴──────────────────────────────────┴───────────────────────┤
│                                                                     │
│  ┌────────────────────── API Server (Express) ───────────────────┐  │
│  │                                                               │  │
│  │  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌────────────┐  │  │
│  │  │   Auth   │  │   Rate    │  │   Model   │  │  Failover  │  │  │
│  │  │Middleware│  │  Limiter  │  │  Router   │  │  Engine    │  │  │
│  │  └────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬─────┘  │  │
│  │       │              │              │               │         │  │
│  │  ┌────▼──────────────▼──────────────▼───────────────▼──────┐  │  │
│  │  │                  Request Pipeline                       │  │  │
│  │  │  Auth → Rate Limit → Resolve Model → Route → Log       │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                               │  │
│  │  ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐    │  │
│  │  │  Health Check  │  │    Usage     │  │  AI Estimation  │    │  │
│  │  │  Cron (10min)  │  │  Analytics   │  │  Cron (Daily)   │    │  │
│  │  └───────────────┘  └──────────────┘  └─────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────┐                            ┌──────────────────┐   │
│  │ PostgreSQL 15│  Usage Logs, Services,     │     Redis 7      │   │
│  │              │  Models, Users,            │                  │   │
│  │  15+ Models  │  Audit Trail               │  Rate Limits,    │   │
│  │  16+ Migr.   │                            │  Active Users,   │   │
│  │              │                            │  Aggregation     │   │
│  └──────────────┘                            └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────┐
                    │    External LLM APIs     │
                    │  GPT · Claude · Gemini   │
                    │  Embedding · Reranking   │
                    │  DALL-E · ComfyUI · ASR  │
                    └──────────────────────────┘
```

---

## Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| **Node.js 24** + **Express 4** | API Server & LLM Proxy |
| **Prisma 5** | Type-safe ORM with 16+ versioned migrations |
| **PostgreSQL 15** | Primary DB — 1,000 max connections, 2GB shared_buffers |
| **Redis 7** | Rate Limiting, Active User Tracking, Usage Aggregation |
| **Zod** | Runtime Request/Response Validation |
| **JSON Web Token** | Stateless Authentication (24h expiry) |

### Frontend
| Technology | Purpose |
|------------|---------|
| **React 18** + **TypeScript** | SPA Dashboard (22 pages) |
| **Vite 5** | Build & HMR Dev Server |
| **Tailwind CSS 3.4** | Custom Design System (Samsung-inspired palette) |
| **Recharts** + **Chart.js** | 7 Reusable Chart Components |
| **React Router 6** | Code-Splitting & Lazy Loading |
| **Axios** | API Client with Interceptor (auto token refresh) |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| **Docker Compose** | 7-Service Container Orchestration |
| **Nginx** | Reverse Proxy, SSL, Gzip, Static Serving |
| **Blue-Green Deploy** | Zero-Downtime Release via Nginx Reload |

---

## Core Features

### 1. LLM API Gateway (Proxy Router)

OpenAI-compatible 엔드포인트(`/v1/*`)를 통해 다양한 LLM 백엔드로 요청을 라우팅합니다.

```
Client  →  /v1/chat/completions     →  GPT, Claude, Gemini, On-Prem 모델 등
        →  /v1/embeddings           →  Embedding 모델
        →  /v1/rerank               →  Reranking 모델
        →  /v1/images/generations   →  DALL-E, ComfyUI, Gemini, Stock API
        →  /v1/audio/transcriptions →  Whisper, ASR 모델
```

**핵심 기능:**

| Feature | Description |
|---------|-------------|
| **서비스별 모델 매핑** | 각 서비스가 사용할 모델을 독립적으로 관리, Alias를 통해 내부 모델명 추상화 |
| **Round-Robin 로드밸런싱** | SubModel 단위 가중치(1-10) 기반 분배 |
| **자동 Failover** | 실패 시 다른 엔드포인트로 자동 재시도 (max retries 설정 가능) |
| **SSE Streaming** | Server-Sent Events 기반 실시간 응답 스트리밍 |
| **토큰 기반 Rate Limiting** | 요청 수가 아닌 실제 토큰 소비량 기반 제한 |
| **멀티파트 업로드** | ASR 오디오 파일 최대 500MB 지원 |

### 2. 3-Tier 권한 시스템 (RBAC)

역할 기반 접근 제어로 22개 페이지를 세분화하여 관리합니다.

```
SUPER_ADMIN ──────────────────────────────── 전체 시스템 관리
    │
    ├── 모델 등록/수정/삭제, 시스템 설정
    ├── 사용자 권한 승격/강등
    ├── 감사 로그, 에러 관리, 요청 로그
    └── 부서 매핑, 직원 인증 이력, 휴일 관리

ADMIN (서비스 등록자) ────────────────────── 서비스 범위 관리
    │
    ├── 서비스 생성/배포/관리
    ├── 서비스별 모델 할당 및 순서 관리
    ├── 멤버 관리 (OWNER/ADMIN/USER)
    └── Rate Limit 설정 (서비스/사용자 단위)

USER (자동 등록) ─────────────────────────── 개인 범위
    │
    ├── 서비스 마켓플레이스 브라우징
    ├── 개인 사용량 조회 (오늘/주간/월간)
    └── Admin 권한 요청, 모델 평가
```

**모델 가시성 5단계:**
`PUBLIC` → `BUSINESS_UNIT` → `TEAM` → `ADMIN_ONLY` → `SUPER_ADMIN_ONLY`

### 3. 실시간 모니터링 대시보드 (22 Pages)

#### System Dashboard — 전체 현황
- 서비스 수, 사용자 수, 총 요청 수, 토큰 사용량 **애니메이션 카운터**
- 일별 활성 사용자 추이 (DAU/MAU)
- 서비스별 사용량 Top 10 + 전체 테이블
- 부서별 토큰 사용량 비교
- **응답 지연 추이 차트** (10분 간격, 서버 시간 실시간 표시)
- 모델 성능 & 헬스체크 상태 패널

#### Usage Analytics — 분석 도구
- **4개 탭**: Overview / User / Model / Department
- **기간 프리셋**: 7일 / 30일 / 90일 / 180일
- **영업일 필터링**: 주말 + 공휴일 자동 제외 (글로벌 토글)
- **CSV 내보내기** 기능
- KST 시간대 기반 Tooltip

#### Business Insight — 경영진용 분석
- 사업부별 AI 활용률 (MAU, 절감 M/M)
- 팀 × 서비스 사용량 매트릭스
- 월별 트렌드 (전월 대비), 서비스별 일간 토큰 Stacked Bar

### 4. 모델 관리 (5 Types)

| Type | Description | 관리자 테스트 기능 |
|------|-------------|---------------------|
| **CHAT** | 텍스트 대화 (GPT, Claude 등) | Chat completion + Tool call |
| **IMAGE** | 이미지 생성 (DALL-E, ComfyUI 등) | 프롬프트 기반 생성 테스트 |
| **EMBEDDING** | 텍스트 벡터화 | 벡터 변환 테스트 |
| **RERANKING** | 문서 관련도 재정렬 | Query-Document 테스트 |
| **ASR** | 음성 → 텍스트 | 오디오 파일 변환 테스트 |

**관리 기능:**
- Extra Headers / Extra Body JSON 커스텀 설정
- Vision 지원 플래그 (멀티모달)
- SubModel 기반 멀티 엔드포인트 로드밸런싱
- 가시성 범위(Scope) 세분화 — 부서/사업부 멀티셀렉트
- 정렬 순서, 최대 토큰 수 설정
- 원클릭 Enable/Disable 토글

### 5. 서비스 마켓플레이스 & 셀프서비스

```
서비스 생성  →  모델 할당  →  멤버 초대  →  Rate Limit 설정  →  배포
    │              │             │               │                │
    ▼              ▼             ▼               ▼                ▼
 이름/설명     서비스에서      OWNER/ADMIN     토큰 한도       배포 범위
 타입 선택     사용할 모델     /USER 역할      시간 윈도우     ALL/BU/TEAM
 카테고리      Alias 매핑      권한 부여       서비스/유저별   즉시 활성
```

**서비스 유형:**
- `STANDARD` — 사용자별 추적 (개인 사용량 기록, x-user-id 필수)
- `BACKGROUND` — 배치/자동화 (부서 단위 집계, x-user-id 선택)

**배포 범위(Deploy Scope):**
- `ALL` — 전 조직 공개 / `BUSINESS_UNIT` — 사업부 한정 / `TEAM` — 팀 한정

### 6. 헬스체크 & 장애 감지

```
┌──────────────────── 10분 간격 자동 실행 ────────────────────┐
│                                                             │
│  ┌─────────┐   CHAT → 실제 프롬프트 호출                     │
│  │ Health  │   EMBEDDING → 벡터 변환 테스트                   │
│  │ Check   │   RERANKING → 문서 관련도 테스트                 │
│  │ Cron    │   IMAGE → 서버 상태 확인                        │
│  │         │   ASR → Silent WAV 파일 테스트                  │
│  └────┬────┘                                                │
│       │                                                     │
│       ├── Redis 분산 잠금 (다중 인스턴스 중복 방지)             │
│       ├── Latency 차트 (10분 단위 추이 시각화)                │
│       ├── Timeout 감지 (9.5분 초과 시 자동 중단)              │
│       └── 7일 로그 자동 정리                                  │
└─────────────────────────────────────────────────────────────┘
```

### 7. 에러 분석 & 자동 Failover

- **에러 유형 자동 분류**: Timeout / Connection / HTTP 4xx·5xx / Stream Error
- **자동 Failover**: Round-Robin으로 다른 SubModel 엔드포인트 시도 → Fallback 모델 전환
- **시도별 상세 기록**: 각 Failover Attempt의 엔드포인트, Latency, Status Code 시각화
- **AI 기반 분석**: LLM이 에러의 심각도·원인·해결 방안을 자동 생성

### 8. 감사 추적 (Audit Trail)

- **30+ 액션 유형**: 서비스 CRUD, 모델 변경, 배포, 사용자 권한 변경, 설정 변경 등
- **기록 항목**: 관리자 ID, 액션, 대상, IP 주소, 타임스탬프
- **필터/검색**: 사용자, 액션 유형, 대상 유형, 날짜 범위
- **변경 전/후 비교**: 복합 액션의 상세 변경 이력

### 9. AI 기반 M/M 절감 추정

- **Daily Cron**: 매일 자정 서비스별 DAU·호출 패턴 기반 M/M 절감 효과 자동 추정
- **서비스 + 부서 Granularity**: 조직 단위로 절감 효과 집계
- **AI 산출 근거**: Confidence Level + 추론 근거 한국어 제공
- **90일 보관**: 트렌드 분석 가능

---

## Data Visualization

7개의 재사용 가능한 차트 컴포넌트를 통해 데이터를 시각화합니다.

| Component | Chart Type | 용도 |
|-----------|-----------|------|
| `UsageAnalytics` | Area / Bar / Line | 종합 사용량 분석 (4개 탭, CSV 내보내기) |
| `EnhancedServiceCharts` | Stacked Area / Bar | 서비스별 누적 사용량 (6개 탭) |
| `WeeklyBusinessDAUChart` | Line | 주간 DAU 트렌드 (일/주 단위 전환) |
| `ModelUsageChart` | Multi-Line | 모델별 일간 사용 추이 (14~365일) |
| `UserStatsChart` | Area | 활성/누적 사용자 추이 |
| `UsersByModelChart` | Horizontal Bar | 모델별 Top 10 사용자 |
| `ModelRatingChart` | Pie | 모델 평점 분포 |

**공통 기능:**
- 영업일 필터링 (주말 + 공휴일 제외, 글로벌 토글)
- KST Timezone Tooltip
- 반응형 레이아웃 (Responsive Container)
- 숫자 축약 포맷 (K, M, B)
- 15색 컬러 팔레트

---

## Page Map (22 Pages)

### System Admin (7)
| Page | Description |
|------|-------------|
| System Dashboard | 전체 KPI, 헬스체크, 실시간 Latency 차트 |
| Models | LLM 모델 CRUD, 테스트, SubModel, 가시성 관리 |
| Users | 사용자 관리, 권한 승격/강등, Rate Limit |
| Service Targets | M/M 목표 vs 실적, 부서별 절감 현황 |
| Insight - Usage Rate | 사업부별 AI 활용률 (MAU + 절감 M/M) |
| Insight - Service Usage | 서비스별 일간 토큰 Stacked Bar |
| Admin Requests | 관리자 권한 요청 승인/거절 워크플로우 |

### Super Admin (7)
| Page | Description |
|------|-------------|
| System LLM Settings | 시스템 LLM 설정, M/M 추정 Job, 로고 생성 |
| API Key Settings | 공개 통계 API 인증키 관리 |
| Request Logs | 전체 API 요청 상세 로그 (필터/보관 기간 설정) |
| Audit Logs | 관리자 행위 감사 로그 (30+ 액션) |
| Error Management | 에러 추적, AI 분석, Failover 시각화 |
| Holidays | 공휴일/사내 휴일 달력 (벌크 임포트 지원) |
| Dept Mapping | 부서 코드 → 조직 계층 매핑 |

### User (6 + Public)
| Page | Description |
|------|-------------|
| Service Marketplace | 서비스 카탈로그 검색/브라우징 |
| My Services | 서비스 생성/관리, 모델 할당, 멤버 관리 |
| Service Detail | 서비스 대시보드, 멤버, Rate Limit, 로그 (5탭) |
| My Usage | 개인 사용량 (오늘/주간/월간), 30~180일 트렌드 |
| Admin Request | 관리자 권한 요청 제출/상태 추적 |
| Public Dashboard | DAU/MAU, 토큰, 서비스 랭킹 (인증 불필요) |

---

## Infrastructure

### Blue-Green Zero-Downtime Deployment

```bash
./deploy.sh              # Blue-Green 무중단 배포 (다운타임 0)
./deploy.sh --with-docs  # docs-site 포함 배포 (nginx 재시작, 1~2초 끊김)
./deploy.sh status       # 현재 활성 슬롯 확인
./deploy.sh init         # 최초 설치 (전체 빌드 + 순차 시작)
./deploy.sh migrate      # DB 스키마만 동기화 (컨테이너 재빌드 없음)
```

**원리:** 항상 Blue/Green 2세트를 운영합니다. 비활성 쪽을 먼저 업데이트한 뒤 nginx reload로 트래픽을 전환하고, 구 활성 쪽도 업데이트합니다. 양쪽 모두 최신 상태가 되며 다운타임은 0입니다.

```
              ┌──────────────────┐
              │      Nginx       │ ← upstream.conf 원자적 교체
              │      :8090       │   (nginx -s reload)
              └────────┬─────────┘
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
     ┌─────────────┐       ┌─────────────┐
     │  Blue Slot  │       │ Green Slot  │
     │ api-blue    │       │ api-green   │
     │ dash-blue   │       │ dash-green  │
     │  (Active)   │       │  (Standby)  │
     └─────────────┘       └─────────────┘
```

#### 배포 5단계 프로세스 (deploy.sh)

```
Step 1/5 ─ 이미지 빌드 (비활성 슬롯)
│  docker compose build --no-cache api-{inactive} dashboard-{inactive}
│  ✓ 기존 서비스는 계속 운영 — 사용자 영향 없음
│
Step 2/5 ─ 비활성 슬롯 컨테이너 재시작 + 헬스체크
│  docker compose up -d api-{inactive} dashboard-{inactive}
│  ✓ API: /health 엔드포인트 (최대 90초 대기)
│  ✓ Dashboard: 컨테이너 running 상태 확인 (최대 30초)
│  ✗ 헬스체크 실패 시 → 배포 즉시 중단 (기존 서비스 영향 없음)
│
Step 3/5 ─ 트래픽 전환 (다운타임 0)
│  cp upstream-{inactive}.conf → active-upstream.conf
│  docker compose exec nginx nginx -s reload
│  ✓ Graceful reload — 기존 연결 유지, 새 연결만 전환
│  ✗ 실패 시 → backup에서 자동 롤백
│
Step 4/5 ─ 구 활성 슬롯 업데이트
│  docker compose build + up api-{active} dashboard-{active}
│  ✓ 트래픽은 이미 새 슬롯에서 처리 중
│  △ 헬스체크 실패해도 서비스 영향 없음 (경고만 출력)
│
Step 5/5 ─ 상태 저장 + 완료
   echo "{inactive}" > .deploy-state
   ✓ 다음 배포 시 슬롯 자동 교대
```

#### 초기 설치 (init)

```
Step 1/4 ─ 인프라 시작 (postgres, redis) + 헬스체크
Step 2/4 ─ Blue 슬롯 빌드 + 시작 (DB 마이그레이션 자동 실행)
Step 3/4 ─ Green 슬롯 빌드 + 시작 (마이그레이션 완료 후)
Step 4/4 ─ Nginx(docs 포함) 빌드 + 시작
```

#### DB 마이그레이션 (migrate)

컨테이너 재빌드 없이 스키마만 동기화합니다.
```
1. 호스트의 최신 schema.prisma → 활성 컨테이너에 복사
2. prisma db push 실행 (safe mode → 실패 시 --accept-data-loss 재시도)
3. API 서버 재시작이 필요하면 ./deploy.sh 실행
```

### Docker Compose (7 Services)

```yaml
services:
  nginx:           # Reverse Proxy + Blue-Green Switcher
  api-blue:        # Express API (Active or Standby)
  api-green:       # Express API (Active or Standby)
  dashboard-blue:  # React SPA  (Active or Standby)
  dashboard-green: # React SPA  (Active or Standby)
  postgres:        # PostgreSQL 15 (shared_buffers=2GB, 1000 conn)
  redis:           # Redis 7 (maxclients=10000, AOF)
```

### Nginx Tuning (1,000+ Concurrent)

| Setting | Value | Purpose |
|---------|-------|---------|
| `worker_processes` | auto | CPU 코어별 자동 스케일 |
| `worker_connections` | 8,192 | 동시 연결 수 |
| `gzip` | level 6 | JSON, JS, CSS 압축 |
| `proxy_buffers` | 8 × 32K | 프록시 버퍼링 |
| `client_max_body_size` | 50MB (audio: 500MB) | 업로드 제한 |
| **LLM Proxy timeout** | 600s | SSE Streaming 대응 |
| **API timeout** | 300s | REST API |

### Database Tuning

```
PostgreSQL 15:
  max_connections:    1,000
  shared_buffers:     2 GB
  effective_cache_size: 6 GB
  connection_pool:    200 (Prisma)
  migrations:         16+ versioned

Redis 7:
  maxclients: 10,000
  persistence: AOF (appendonly)
  key TTL:    7 days
```

---

## API Reference

### LLM Proxy (`/v1/*`)
```http
POST /v1/chat/completions       # Chat (SSE Streaming 지원)
POST /v1/embeddings              # Text Embedding
POST /v1/rerank                  # Document Reranking
POST /v1/images/generations      # Image Generation (Multi-Provider)
POST /v1/audio/transcriptions    # Speech-to-Text (max 500MB)
GET  /v1/models                  # Available Models for Service
```

**인증 헤더:**
```http
x-service-id: my-service        # 서비스 식별자 (필수)
x-user-id: user.loginid         # 사용자 ID (STANDARD 필수)
x-dept-name: AI팀(기술본부)       # 부서명 (필수)
```

### Dashboard API (`/api/*`)
```http
# Auth
POST /auth/login                 # SSO 연동 로그인
GET  /auth/me                    # 현재 사용자 정보

# Services (CRUD + Deploy)
GET|POST   /services
PUT|DELETE /services/:id
POST       /services/:id/deploy

# Models (CRUD + Test)
GET|POST   /models
PUT|DELETE /models/:id
PATCH      /models/:id/toggle

# Analytics
GET /usage/summary               # 전체 사용량 요약
GET /usage/daily                  # 일별 사용량 추이
GET /usage/by-model               # 모델별 사용량
GET /usage/by-user                # 사용자별 사용량
GET /my-usage/summary             # 개인 사용량

# Public (인증 불필요)
GET /public/stats/*               # 공개 통계 API
```

---

## Monorepo Structure

```
├── docker-compose.yml            # Production (7 services)
├── docker-compose.dev.yml        # Development (Hot Reload)
├── deploy.sh                     # Blue-Green Deploy Script
│
├── nginx/
│   ├── nginx.conf                # Reverse Proxy (8,192 conn)
│   ├── upstream-blue.conf        # Blue Slot Upstream
│   └── upstream-green.conf       # Green Slot Upstream
│
├── packages/
│   ├── api/                      # ─── Backend ───
│   │   ├── src/
│   │   │   ├── routes/           # 19 Route Modules
│   │   │   ├── middleware/       # Auth, Rate Limit, Proxy Auth, Logger
│   │   │   ├── services/        # HealthCheck, Redis, Image, AI Estimation
│   │   │   └── index.ts         # Entry (Graceful Shutdown, Cron Init)
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # 15+ Models
│   │   │   └── migrations/      # 16+ Versioned Migrations
│   │   └── Dockerfile           # 2-Stage Build (Node 24 → Production)
│   │
│   └── dashboard/                # ─── Frontend ───
│       ├── src/
│       │   ├── pages/            # 22 Pages (Lazy Loaded)
│       │   ├── components/       # 7 Chart Components + Layout
│       │   ├── hooks/            # useBusinessDayToggle, useHolidayDates
│       │   ├── services/        # Axios API Client (Token Interceptor)
│       │   └── utils/           # Business Day Filter
│       ├── tailwind.config.js   # Custom Design System
│       └── Dockerfile           # 2-Stage Build (Vite → Nginx)
│
├── docs-site/                    # ─── Documentation ───
│   ├── src/                      # React 19 + Markdown
│   └── Dockerfile               # Vite → Nginx
│
└── tests/                        # ─── Testing ───
    ├── mock_llm_server.py        # Mock LLM for Integration Test
    └── stress_test.py            # Load Testing (Python)
```

---

## Getting Started

```bash
# 1. 환경 설정
cp .env.example .env
vi .env                         # DB, JWT_SECRET, LLM 엔드포인트 등

# 2. 전체 스택 빌드 & 실행
docker compose up -d --build

# 3. 배포 확인
curl http://localhost:8090/health

# 4. 개발 모드 (Hot Reload)
docker compose -f docker-compose.dev.yml up -d
```

| Access Point | URL |
|-------------|-----|
| Dashboard | `http://localhost:8090` |
| API | `http://localhost:8090/api` |
| LLM Proxy | `http://localhost:8090/v1` |
| Documentation | `http://localhost:8090/docs` |
| Swagger UI | `http://localhost:8090/api/api-docs/ui` |

---

## Security

| Layer | Implementation |
|-------|---------------|
| **Authentication** | JWT (24h expiry) + SSO Integration |
| **Authorization** | 3-Tier RBAC (Super Admin → Admin → User) |
| **Rate Limiting** | Token-based + IP-based (이중 제한) |
| **Security Headers** | Helmet (X-Frame-Options, X-XSS-Protection, HSTS) |
| **CORS** | Configurable Origin Policy |
| **Audit Trail** | 관리자 전 행위 기록 (IP, Timestamp, Action) |
| **API Key** | 공개 엔드포인트 선택적 인증 |
| **Request Logging** | 전체 요청/응답 추적, 보관 기간 설정 |

---

## Performance & Scalability

```
                    ┌─────── 1,000+ Concurrent Users ───────┐
                    │                                       │
    Nginx           │  8,192 worker_connections              │
    ────────────────│  Gzip Level 6                          │
                    │  1-Year Immutable Asset Cache          │
                    │                                       │
    Express API     │  Stateless (JWT) → 수평 확장 가능       │
    ────────────────│  Blue-Green 인스턴스 이중화              │
                    │  Streaming Response (Chunked)          │
                    │                                       │
    PostgreSQL      │  1,000 max connections                 │
    ────────────────│  200 connection pool (Prisma)          │
                    │  2GB shared_buffers + 6GB cache        │
                    │                                       │
    Redis           │  10,000 max clients                   │
    ────────────────│  AOF Persistence                      │
                    │  Sorted Set (Active User Tracking)    │
                    │                                       │
    React SPA       │  Code Splitting (Lazy Loading)        │
    ────────────────│  Auto Chunk Reload on Deploy           │
                    │  localStorage State Persistence       │
                    └───────────────────────────────────────┘
```

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **토큰 기반 Rate Limit** (vs 요청 수) | LLM 비용은 토큰에 비례 — 요청 수 제한은 비용 제어에 무의미 |
| **SubModel Round-Robin** (vs 단일 엔드포인트) | 같은 모델의 복수 엔드포인트를 가중치로 분배, 장애 격리 |
| **Blue-Green** (vs Rolling Update) | Nginx reload 한 줄로 원자적 전환, 롤백 즉시 가능 |
| **Prisma** (vs Raw SQL) | Type-safe ORM + versioned migration으로 스키마 안전성 확보 |
| **헤더 기반 인증** (vs API Key) | 서비스 → 사용자 → 부서 3차원 추적, 기존 HTTP 인프라 호환 |
| **Recharts** (vs D3 직접 구현) | 7개 차트 컴포넌트 빠른 개발, React 생태계 통합 |
| **영업일 필터링** | KPI 왜곡 방지 — 주말/공휴일 데이터가 평균을 끌어내리는 문제 해결 |

---

## Built With

**Backend** — TypeScript · Express · Prisma · PostgreSQL · Redis · Zod · JWT
**Frontend** — React 18 · Vite · Tailwind CSS · Recharts · Chart.js · Lucide · Axios
**Infra** — Docker Compose · Nginx · Blue-Green Deploy
**Docs** — React 19 · react-markdown · Vite 6
**Test** — Python (Mock LLM Server, Stress Test)

---

<p align="center">
  <sub>Designed & built for enterprise-scale LLM operations — routing, monitoring, and governance in one platform.</sub>
</p>
