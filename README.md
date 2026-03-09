# Agent Dashboard

LLM 서비스 통합 관리 대시보드 — 3-Tier 권한, 헤더 기반 인증, LLM 가시성 제어

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                Docker Compose Stack                   │
│                                                       │
│   ┌─────────┐   ┌──────────┐   ┌────────┐  ┌─────┐  │
│   │  Nginx  │──►│   API    │──►│Postgres│  │Redis│  │
│   │  :8090  │   │  :3000   │   │ :5432  │  │:6379│  │
│   │         │   └──────────┘   └────────┘  └─────┘  │
│   │  /      │──► Dashboard (React SPA)               │
│   │  /api/* │──► API Server                          │
│   │  /v1/*  │──► LLM Proxy (Header-based Auth)       │
│   │  /docs  │──► Docs Site (React SPA)               │
│   └─────────┘                                        │
└──────────────────────────────────────────────────────┘
```

## Core Features

- **3-Tier 권한 시스템**: Super Admin → Admin (부서 범위) → User (자동 등록, 본인 사용량만)
- **헤더 기반 LLM 프록시**: `x-service-id`, `x-user-id`, `x-dept-name` 헤더로 인증
- **LLM 가시성 제어**: PUBLIC / BUSINESS_UNIT / TEAM / ADMIN_ONLY 4단계
- **서비스 등록제**: 대시보드에서 서비스 등록 후 API 호출 가능
- **서비스 타입**: STANDARD (사용자 추적) / BACKGROUND (배치/자동화)
- **실시간 통계**: 30초 자동 갱신, 애니메이션 카운터, 부서별 분석
- **iOS 디자인**: 프로스티드 글래스, 부드러운 애니메이션, 카드 기반 레이아웃

## Quick Start

```bash
# 1. 환경 설정
cp .env.example .env
nano .env

# 2. SSO 인증서
mkdir -p ./cert && cp /path/to/cert.cer ./cert/

# 3. 빌드 & 시작
docker-compose up -d --build

# 4. 로그 확인
docker-compose logs -f
```

API 서버 시작 시 자동으로 `prisma db push`로 스키마를 동기화합니다.

## Access Points

| Service | URL | Description |
|---------|-----|-------------|
| Dashboard | http://localhost:8090 | 관리 대시보드 |
| API | http://localhost:8090/api | REST API |
| LLM Proxy | http://localhost:8090/v1 | OpenAI 호환 프록시 |
| Docs | http://localhost:8090/docs | 사용 가이드 |

## 3-Tier 권한

| Role | 설명 | 범위 |
|------|------|------|
| **Super Admin** | 하드코딩 + 지정된 관리자 | 전체 시스템 |
| **Admin** | 서비스 등록 시 자동 부여 | 본인 부서 범위 |
| **User** | SSO 로그인 시 자동 등록 | 본인 사용량만 |

Super Admin 하드코딩: `syngha.han`, `young87.kim`, `byeongju.lee`

## LLM Proxy API

서비스가 LLM을 호출할 때 헤더 기반 인증을 사용합니다.

### Standard 서비스 (사용자 추적)

```bash
curl http://localhost:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: my-service" \
  -H "x-user-id: user.loginid" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Background 서비스 (배치/자동화)

```bash
curl http://localhost:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-service-id: batch-service" \
  -H "x-dept-name: SW혁신팀(S.LSI)" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PROXY_PORT` | Nginx 프록시 포트 | 8090 |
| `POSTGRES_DB` | DB 이름 | agent_stats |
| `POSTGRES_USER` | DB 유저 | agent_stats |
| `POSTGRES_PASSWORD` | DB 비밀번호 | agent_stats_2026! |
| `JWT_SECRET` | JWT 서명 키 | (필수 변경) |
| `DEVELOPERS` | Super Admin 목록 | syngha.han,young87.kim,byeongju.lee |

## Project Structure

```
Agent-Dashboard/
├── packages/
│   ├── api/                    # Express.js API Server
│   │   ├── src/
│   │   │   ├── routes/         # API & Proxy 라우트
│   │   │   ├── middleware/     # Auth, ProxyAuth, Logging
│   │   │   └── index.ts
│   │   └── prisma/
│   │       └── schema.prisma   # DB 스키마 (v2)
│   │
│   └── dashboard/              # React + Vite + Tailwind
│       └── src/
│           ├── pages/          # 페이지 컴포넌트
│           ├── components/     # 재사용 컴포넌트
│           └── services/       # API 클라이언트
│
├── docs-site/                  # React 문서 사이트
│   ├── src/                    # Admin/User/API 가이드
│   └── public/content/         # 마크다운 콘텐츠
│
├── nginx/nginx.conf            # Nginx (1000+ 동시접속)
├── docker-compose.yml
└── .env.example
```

## Development

```bash
# API
cd packages/api && npm install && npm run dev

# Dashboard
cd packages/dashboard && npm install && npm run dev

# Docs
cd docs-site && npm install && npm run dev
```

## License

Internal Use Only - Samsung DS
