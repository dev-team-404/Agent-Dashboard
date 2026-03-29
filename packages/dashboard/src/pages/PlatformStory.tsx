import { useState } from 'react';
import {
  Server, Shield, Brain, BarChart3, Users, Layers, Zap,
  GitBranch, Database, Globe, Sparkles,
  Network, Container, ChevronRight, Terminal,
  MonitorSpeaker, BookOpen, ChevronDown,
} from 'lucide-react';
import commitsData from './commits-data.json';

// ── 타임라인 데이터 (커밋 히스토리 기반, 상세) ──
const timeline = [
  {
    date: '2026.01.15',
    title: 'Day 1 — 프로젝트 시작 & 기반 구축',
    desc: '하루 만에 45+ 커밋. 멀티서비스 대시보드 초기 구조 설계, LLM 프록시 라우팅, 서비스/모델 CRUD, 5단계 권한 시스템, 레거시 데이터 마이그레이션(PostgreSQL UUID 캐스팅과의 사투), 통합 대시보드, 부서별 사용량 차트, 모델 평점 시스템 구현. Nexus Coder → AX Portal로 첫 리브랜딩.',
    tags: ['프록시', 'CRUD', '권한 체계', '대시보드', '마이그레이션'],
  },
  {
    date: '2026.01.16 ~ 01.23',
    title: '안정화 & 모니터링 기반',
    desc: 'LLM 레이턴시 모니터링 추가, 모델 드래그앤드롭 정렬, docs-site 브랜드 랜딩페이지 리디자인, 서비스 필터링, 개발 환경(Hot-reload) 구축, express-rate-limit 연동, 프록시 로그에 사용자 정보 기록, 에러 retry 로직 추가.',
    tags: ['레이턴시', 'docs-site', '개발 환경', 'Rate Limit'],
  },
  {
    date: '2026.01.28 ~ 01.30',
    title: '휴일 관리 & 서비스 고도화',
    desc: '휴일 관리 + 영업일 기준 DAU 분석, 모델 가시성(Visibility) 본부/팀 제한, 서비스 삭제/데이터 초기화. AIPO → ONCE → 여러 차례 리브랜딩 시도. 수많은 UI 잘림/오버플로우 버그와의 싸움.',
    tags: ['휴일 관리', '가시성', '서비스 삭제', '리브랜딩'],
  },
  {
    date: '2026.02.03 ~ 02.06',
    title: 'SubModel & Failover 시스템',
    desc: 'SubModel 로드밸런싱(Redis 기반 라운드로빈), 자동 Failover, 엔드포인트 헬스체크(Chat+Tool Call 테스트), extraHeaders 지원, context window 초과 자동 복구, LLM 품질 테스트 자동 스케줄러 구현.',
    tags: ['SubModel', 'Failover', '헬스체크', 'LLM 테스트'],
  },
  {
    date: '2026.02.10 ~ 02.12',
    title: '인프라 하드닝 & 에러 텔레메트리',
    desc: 'Vision(VL) 모델 지원, 고동시성 안정화, 실시간 DAU 추적, 에러 텔레메트리 시스템(일괄 삭제/JSON 복사), OpenAI 표준 에러 포맷 호환.',
    tags: ['Vision', '고동시성', '에러 텔레메트리'],
  },
  {
    date: '2026.03.05',
    title: 'docs-site React 전면 리디자인',
    desc: 'VitePress → React + Vite + Tailwind으로 docs-site 완전 재구축. 로고/파비콘 교체, Nexus Bot 리네이밍, 서비스별 가이드 문서화.',
    tags: ['docs-site', 'React 리디자인'],
  },
  {
    date: '2026.03.09',
    title: 'v2 전면 리팩토링 — 대규모 재설계',
    desc: '하루 30+ 커밋의 대공사. 포트 체계 변경(8090/8091/8092), 컨테이너 리네이밍, 사이드바 접기/펼치기, 서비스 마켓플레이스, Rate Limit(서비스 공통+사용자별), 프리미엄 UI/UX 전면 리디자인(Linear/Vercel급), 통합 사용자 관리, Swagger UI 사내망 호환(CDN 차단 대응), Embedding·Rerank·Image 프록시 확장, 1000명 동시수용 최적화.',
    tags: ['v2 리팩토링', 'UI 리디자인', '프록시 확장', '성능 최적화'],
  },
  {
    date: '2026.03.10 ~ 03.13',
    title: '엔터프라이즈 기능 폭발',
    desc: 'Public API 설계, 서비스 배포 범위(전체/본부/팀), 모델 복사 기능, Samsung Knox 임직원 인증 통합, 공개 대시보드, Blue-Green 배포 스크립트 안정화. Agent Stats → Agent Registry 최종 리브랜딩.',
    tags: ['Knox 인증', '배포 관리', '공개 대시보드', '리브랜딩'],
  },
  {
    date: '2026.03.16 ~ 03.17',
    title: 'AI 기능 & 조직 연동 대거 추가',
    desc: 'ASR 모델 프록시, 조직 계층(team/center) 정보, Saved M/M 관리, AI M/M 자동 추정(5영업일 평균 기반), 관리자 권한 신청/승인 워크플로우, API Only 서비스(외부 사용 기록 수집), 에러 관리 + AI 자동 분석, 서비스 로고 AI 생성(IMAGE 모델), API 비밀번호 관리, 감사 로그 한글화. 하루 40+ 커밋.',
    tags: ['ASR', 'AI 추정', '에러 분석', '로고 생성', 'API Only'],
  },
  {
    date: '2026.03.18 ~ 03.19',
    title: '인사이트 & 부서 분석 체계',
    desc: '부서별 Saved M/M 관리, AI 사용률 인사이트(센터→팀→서비스 드릴다운), 서비스 사용량 인사이트, 센터 그루핑 로직 수정(10+ 커밋의 디버깅), 소유자 변경 기능, DailyUsageStat 레거시 완전 제거.',
    tags: ['인사이트', '부서 분석', '센터 그루핑', '레거시 제거'],
  },
  {
    date: '2026.03.23',
    title: '대규모 안정화 & 기능 완성',
    desc: '하루 60+ 커밋의 마라톤. 주말/휴일 토글, 모든 모델 타입 헬스체크(ASR/IMAGE/ComfyUI), 응답 지연 추이(일별/주별/월별), 서비스 에러 관리 탭, 모델 Fallback 체인, 헬스체크 Blue-Green 중복 방지(Redis 분산 락), 에러율 일별 트렌드, chunk 404 자동 복구(lazyWithRetry). 헬스체크 timeout만 3번 조정(10분→30분→9분30초).',
    tags: ['헬스체크', 'Fallback', '분산 락', '에러 트렌드'],
  },
  {
    date: '2026.03.24 ~ 03.25',
    title: 'GPU 모니터링 & AI 기능 집중',
    desc: 'SSH 기반 GPU 실시간 모니터링, LLM 서빙 메트릭 자동 탐지(vLLM/SGLang/Ollama/TGI), 처리량 3단 분석(이론·피크·현재), GPU 수요 예측, 권한별 온보딩 가이드 투어, 등록 마법사, 공개 대시보드 팀별 차트.',
    tags: ['GPU 모니터링', '가이드 투어', '수요 예측'],
  },
  {
    date: '2026.03.26 ~ 03.27',
    title: 'AI 도우미 챗봇 & 최종 고도화',
    desc: 'AI 도우미 챗봇(SSE 스트리밍, 권한별 동적 프롬프트, 페이지 자동 이동), 382→6 쿼리 최적화 + Batch API, AI 코칭 리포트, 서비스 품질 메트릭 6종(TTFT/TPOT/E2E/KV Cache/Preemption/Queue), FP8 자동 감지. Prisma napi 한계 극복 — node-postgres 직접 연결로 GPU 스냅샷 대량 조회 안정화. GPU 수요 예측 전면 재설계(실측 기반 B300 산출 + IDC/Deloitte/Gartner 산업 트렌드 반영 + 경영 보고서 자동 생성). 플랫폼 스토리 페이지.',
    tags: ['AI 챗봇', '성능 최적화', 'napi 극복', 'GPU 예측 재설계', '플랫폼 스토리'],
  },
  {
    date: '2026.03.26 ~ 03.27',
    title: '권한 체계 강화 & GPU 전력 시간별 전환',
    desc: 'SUPER_ADMIN 대상 권한 변경 버튼 슈퍼관리자에게만 노출. 하드코딩 Super Admin fallback 복원(DB 우선, 없으면 기존 유지). TEAM visibility 조상 매칭 수정. GPU 전력 사용률 수집 체계 일별(date)→시간별(timestamp) 전환 + 기존 데이터 보존 마이그레이션. Swagger 문서 반영.',
    tags: ['권한 체계', 'Super Admin', 'TEAM visibility', '전력 시간별', '마이그레이션'],
  },
  {
    date: '2026.03.27',
    title: 'Prometheus 통합 & DTGPT 연동',
    desc: 'DTGPT K8s 클러스터(5노드 40×H200) Prometheus 자동 수집기 구현 — deploy 즉시 동작. 과거 vLLM 데이터 14일 backfill(KV cache 신구 이름 대응 + preemption). DTGPT replica 1:N 매핑. 미연결 장비(HPC 54×H200) 등록 및 추정 포함. GPU 전력 사용률 시간별 전환. 추정 조건 공지 배너(편집 가능, JIRA 링크).',
    tags: ['Prometheus', 'DTGPT', 'backfill', '미연결 장비', 'HPC'],
  },
  {
    date: '2026.03.27',
    title: 'GPU 벤치마크 기반 용량 시스템 전면 재설계',
    desc: 'compute-bound 이론 최대(0.8%) → 서버별 관측 P95 피크 벤치마크로 전환. 3대 지표 체계 확립: tok/s + KV Cache% + 대기건수. 종합 용량 = max(3차원) — 체감과 일치하는 0-100% 지표. GPU 부족분 3차원 산출(처리량/KV메모리/동시성 각각 B300, 병목 식별). 8개 히트맵(날짜×시간 30일): tok/s, KV%, 대기, Preemption, 처리량%, KV%, 동시처리%, GPU Util%. 피크(14~16시)/비업무(20~06시)/전체 평균 카드. Prisma napi 한계 → node-postgres 직접 연결로 근본 해결. 벤치마크 자동 산출(P95) + 수동 오버라이드 + 매일 갱신 크론.',
    tags: ['벤치마크', '3대 지표', '종합 용량', '히트맵', 'napi 우회', '3차원 부족분'],
  },
  {
    date: '2026.03.29',
    title: 'Dev/QA 서버 & Redis 캐싱 최적화',
    desc: '배포 전 동작검증용 Dev/QA 서버 도입(포트 8095, 프로덕션 완전 독립). deploy.sh dev/dev-stop/dev-status 명령어. DB 스키마 변경 자동 차단(prisma db push 차단 + 감지 경고 → syngha.han 승인 후 migrate). Redis DB 15번 캐시 분리. --no-deps로 프로덕션 인프라 보호. Redis 캐싱 최적화: withCache fail-open 범용 캐시 유틸, incrementUsage 12회→1회 파이프라인(RTT 92% 절감), 관리자/사용자/공개 통계 엔드포인트 12개에 read-through 캐시 적용(60~300초 TTL), my-usage 3쿼리 병렬화.',
    tags: ['Dev 서버', 'Redis 캐싱', 'Pipeline', 'fail-open', '스키마 보호'],
  },
  {
    date: '2026.03.29',
    title: '전체 엔드포인트 캐싱 + Precompute 워밍 + 실시간 갱신 UI',
    desc: '미캐싱 22개 stats 엔드포인트에 withCache read-through 캐시 적용(총 28개). 60초 주기 캐시 워밍 서비스 도입 — 대시보드 batch 핵심 엔드포인트(by-service/by-dept/error-rate/health-status 등)를 백그라운드에서 사전 연산하여 Redis에 저장. thundering herd 완전 제거: 첫 유저도 캐시 히트, DB 부하가 유저 수와 무관하게 일정. 프론트엔드 데이터 갱신 시각 표시 + 수동 새로고침 버튼.',
    tags: ['withCache 전체 적용', 'Precompute 워밍', 'thundering herd 해결', '갱신 시각 UI'],
  },
  {
    date: '2026.03.29',
    title: '300명 동시접속 대응 — 쓰기 버퍼링 + 커넥션 풀 + TTL 단축',
    desc: 'DGX H200 기준 3000 DAU / 300 동시접속 최적화. usage_logs/request_logs 쓰기 버퍼링(1초 간격 bulk INSERT, 개별 INSERT 대비 DB 부하 90%↓). 커넥션 풀 확장(pgPool 10→50, Prisma connection_limit 동기화). 캐시 TTL 전면 단축(120→60, 300→90, 실시간성 2배 향상). Precompute 주기 15초/워밍 주기 30초로 단축. 워밍 대상 3→7개 확대(by-dept 계열 4개 추가). Graceful shutdown 시 잔여 버퍼 flush 보장.',
    tags: ['쓰기 버퍼링', 'bulk INSERT', '커넥션 풀', 'TTL 단축', 'DGX 최적화'],
  },
  {
    date: '2026.03.29',
    title: 'OIDC 인증 체계 구축 — 사용자별 사용량 자동 추적',
    desc: 'Open WebUI, Google ADK, LangChain 등 외부 서비스에서 사용자별 사용량을 자동 추적하기 위한 OIDC(OpenID Connect) 인증 체계 전면 구축. Auth Server(HTTPS :9050) — OIDC Provider(authorize/token/userinfo) + Mock SSO(개발용). 삼성 SSO 직통 연동(form_post, RS256 인증서 검증, genai.samsungds.net 중간자 제거). Gateway body.user 지원 — OpenAI 표준 user 필드로 사용자 식별(x-user-id 헤더 대체). Python SDK(agent_platform_auth.py) — setup_auth() 한 줄로 OpenAI/LangChain/ADK 전부 자동 user 주입(OpenAI SDK monkey-patch + LiteLLM 콜백 이중 커버). Dashboard OIDC 로그인 모드 추가(기존 SSO 호환 유지). Open WebUI Playwright E2E 검증 완료. Google ADK 1.28 + 2.0 Alpha 호환 검증. 보안 리뷰 8건 수정(SSRF 차단, 클라이언트 시크릿 프론트엔드 제거, open redirect 방지 등). docs-site 가이드 5페이지 + Agent용 프롬프트 + 예제 zip. deploy.sh SSL 자동 생성 + OIDC_ISSUER 자동 감지.',
    tags: ['OIDC', 'Auth Server', 'body.user', 'Open WebUI', 'ADK', 'LangChain', 'SSO 직통', 'Python SDK', '보안 리뷰'],
  },
];

// ── 기능 카테고리 ──
const featureGroups = [
  {
    title: '서비스 관리',
    icon: Server,
    color: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    features: [
      'LLM 프록시 (Chat · Embedding · Rerank · Image · ASR)',
      '가중치 기반 라운드로빈 로드밸런싱 & SubModel Failover',
      'API Only 서비스 — 외부 사용 기록 수집 (프록시 미경유)',
      '토큰 기반 Rate Limiting (서비스 공통 / 사용자별)',
      '서비스 마켓플레이스 & 배포 범위 관리 (전체·본부·팀)',
      '공개 대시보드 & 관리자 권한 신청 워크플로우',
    ],
  },
  {
    title: '모니터링 & 분석',
    icon: BarChart3,
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
    features: [
      'SSH 기반 GPU 실시간 모니터링 & 처리량 3단 분석 (이론·피크·현재)',
      '통합 대시보드 9개 탭 (사용량·서비스·DAU/MAU·M/M·부서·본부·분석·레이턴시·GPU)',
      'Redis read-through 캐시 28개 + 15~30초 Precompute 워밍 + 쓰기 버퍼링 bulk INSERT',
      '모델 레이턴시 & 헬스체크 (10분 자동 프로빙) + FP8 정밀도 자동 감지',
      '에러 추적 & Failover 시도 상세 로그 + 에러율 트렌드 차트',
      '모델 평점(Rating) 시스템 & 만족도 차트',
      '서비스 품질 메트릭 6종 (TTFT · TPOT · E2E · KV Cache · Preemption · Queue)',
    ],
  },
  {
    title: 'AI 기능',
    icon: Brain,
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-100',
    features: [
      'M/M 절감 AI 자동 추정',
      '에러 패턴 AI 자동 분석/분류',
      'GPU 수요 예측 (LLM 기반)',
      '서비스 로고 AI 자동 생성',
      'AI 도우미 챗봇 (SSE 스트리밍)',
      'GPU 서버 AI 코칭 리포트',
    ],
  },
  {
    title: '보안 & 거버넌스',
    icon: Shield,
    color: 'from-amber-500 to-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    features: [
      '3단계 권한 체계 (SUPER_ADMIN → ADMIN → USER)',
      '5단계 모델 가시성 (PUBLIC · BUSINESS_UNIT · TEAM · ADMIN · SUPER_ADMIN)',
      '감사 로그 & 요청 로그 — 전체 관리자 액션 추적',
      'Knox 임직원 인증 연동 & 조직도 동기화 (해외 R&D 센터 포함)',
      '휴일 관리 & 영업일 기반 통계 필터링',
      'Internal API Swagger + 외부 연동 API 문서 자동 생성',
    ],
  },
  {
    title: '인프라 & DevOps',
    icon: Server,
    color: 'from-cyan-500 to-cyan-600',
    bg: 'bg-cyan-50',
    border: 'border-cyan-100',
    features: [
      'Blue-Green 무중단 배포 (deploy.sh, 다운타임 0)',
      'Dev/QA 서버 (포트 8095, DB 공유 + Redis DB 15 캐시 분리)',
      'DB 스키마 변경 자동 차단 (Dev) + migrate 승인 프로세스',
      'Docker Compose 멀티 서비스 (PostgreSQL · Redis · Nginx · API · Dashboard)',
      'DEPLOY.md 배포 가이드 문서',
    ],
  },
];

// ── 아키텍처 레이어 ──
const archLayers = [
  { label: 'Nginx', sub: 'Reverse Proxy · :8090', icon: Globe, color: 'bg-slate-700' },
  { label: 'React Dashboard', sub: 'Vite + Tailwind CSS', icon: MonitorSpeaker, color: 'bg-blue-600' },
  { label: 'Express API', sub: 'Prisma ORM · SSE', icon: Server, color: 'bg-emerald-600' },
  { label: 'PostgreSQL + Redis', sub: '영속 저장소 · 캐시 · Pipeline', icon: Database, color: 'bg-violet-600' },
];

// ── 기술 스택 ──
const techStack = [
  'React 18', 'TypeScript', 'Vite', 'Tailwind CSS',
  'Express.js', 'Prisma', 'PostgreSQL 15', 'Redis 7',
  'Docker Compose', 'Nginx', 'SSE Streaming', 'SSH2',
];

// ── 팀 ──
const team = [
  { name: '한승하', initials: 'SH', role: 'Developer', desc: '기획 · 설계 · 풀스택 개발', color: 'from-blue-500 to-indigo-600' },
  { name: '이병주', initials: 'BJ', role: 'Developer', desc: '기획 · 설계 · 개발', color: 'from-emerald-500 to-teal-600' },
  { name: '김영섭', initials: 'YS', role: 'Developer', desc: '기획 · 설계 · 개발', color: 'from-violet-500 to-purple-600' },
];

export default function PlatformStory() {
  return (
    <div className="max-w-5xl mx-auto space-y-16 pb-20">

      {/* ════ Hero ════ */}
      <section className="relative pt-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            640+ commits · 54,000+ lines of code
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-3">
            Agent Registry & Dashboard
          </h1>
          <p className="text-lg text-gray-500 font-medium">
            사내 AI 서비스의 통합 관제탑
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { value: '27', label: '페이지', icon: Layers, color: 'text-blue-600 bg-blue-50' },
            { value: '50+', label: 'API 엔드포인트', icon: Network, color: 'text-emerald-600 bg-emerald-50' },
            { value: '6', label: 'AI 기능', icon: Brain, color: 'text-violet-600 bg-violet-50' },
            { value: '3단계', label: '권한 체계', icon: Shield, color: 'text-amber-600 bg-amber-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-5 text-center shadow-sm">
              <div className={`w-10 h-10 rounded-lg ${stat.color} flex items-center justify-center mx-auto mb-3`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Feature Highlights ════ */}
      <section>
        <SectionHeader icon={Zap} title="Feature Highlights" subtitle="플랫폼 핵심 기능" />
        <div className="grid md:grid-cols-2 gap-5">
          {featureGroups.map((group) => (
            <div key={group.title} className={`${group.bg} ${group.border} border rounded-xl p-6`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${group.color} flex items-center justify-center`}>
                  <group.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-gray-800 text-sm">{group.title}</h3>
              </div>
              <ul className="space-y-2">
                {group.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-gray-600">
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Architecture ════ */}
      <section>
        <SectionHeader icon={Container} title="Architecture" subtitle="시스템 아키텍처" />
        <div className="bg-white rounded-xl border border-gray-100 p-8 shadow-sm">
          {/* Layers */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <Users className="w-4 h-4" /> 사용자 요청
            </div>
            {archLayers.map((layer, i) => (
              <div key={layer.label} className="w-full max-w-md">
                <div className={`${layer.color} rounded-lg px-5 py-3.5 text-white flex items-center gap-3`}>
                  <layer.icon className="w-5 h-5 opacity-80" />
                  <div>
                    <div className="font-semibold text-sm">{layer.label}</div>
                    <div className="text-xs opacity-70">{layer.sub}</div>
                  </div>
                </div>
                {i < archLayers.length - 1 && (
                  <div className="flex justify-center py-1">
                    <div className="w-px h-4 bg-gray-300" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Monorepo */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Monorepo 구조</div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { name: 'packages/dashboard', desc: 'React SPA', icon: MonitorSpeaker },
                { name: 'packages/api', desc: 'Express REST API', icon: Server },
                { name: 'docs-site', desc: 'Documentation', icon: BookOpen },
              ].map((pkg) => (
                <div key={pkg.name} className="flex items-center gap-2.5 px-3 py-2.5 bg-gray-50 rounded-lg">
                  <pkg.icon className="w-4 h-4 text-gray-400" />
                  <div>
                    <div className="text-xs font-mono font-medium text-gray-700">{pkg.name}</div>
                    <div className="text-[10px] text-gray-400">{pkg.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deploy */}
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
            <Container className="w-3.5 h-3.5" />
            Docker Compose 기반 Blue-Green 배포 · git pull && ./deploy.sh
          </div>
        </div>
      </section>

      {/* ════ Development Timeline ════ */}
      <section>
        <SectionHeader icon={GitBranch} title="Development Timeline" subtitle="개발 여정 · 640+ commits" />
        <div className="relative">
          {/* 수직 라인 */}
          <div className="absolute left-[18px] top-2 bottom-2 w-px bg-gradient-to-b from-blue-200 via-violet-200 to-emerald-200" />

          <div className="space-y-6">
            {timeline.map((item, i) => (
              <div key={i} className="relative flex gap-5">
                {/* 도트 */}
                <div className="relative z-10 mt-1.5">
                  <div className="w-[9px] h-[9px] rounded-full bg-white border-[2.5px] border-blue-500 shadow-sm" />
                </div>

                {/* 콘텐츠 */}
                <div className="flex-1 pb-2">
                  <div className="text-xs font-mono text-blue-600 font-medium mb-1">{item.date}</div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-1">{item.title}</h4>
                  <p className="text-[13px] text-gray-500 leading-relaxed mb-2">{item.desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════ Team ════ */}
      <section>
        <SectionHeader icon={Users} title="Team" subtitle="개발팀" />
        <div className="grid md:grid-cols-3 gap-5">
          {team.map((member) => (
            <div key={member.name} className="bg-white rounded-xl border border-gray-100 p-6 text-center shadow-sm">
              <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${member.color} flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/10`}>
                <span className="text-white font-bold text-lg">{member.initials}</span>
              </div>
              <h4 className="font-semibold text-gray-800 text-sm">{member.name}</h4>
              <p className="text-xs text-blue-600 font-medium mt-0.5">{member.role}</p>
              <p className="text-xs text-gray-400 mt-1">{member.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ════ Tech Stack ════ */}
      <section>
        <SectionHeader icon={Terminal} title="Tech Stack" subtitle="기술 스택" />
        <div className="flex flex-wrap gap-2 justify-center">
          {techStack.map((tech) => (
            <span key={tech} className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-600 shadow-sm">
              {tech}
            </span>
          ))}
        </div>
      </section>

      {/* ════ Commit History (접이식, 작게) ════ */}
      <CommitHistory />

      {/* ════ Footer Quote ════ */}
      <section className="text-center pt-8 border-t border-gray-100">
        <p className="text-lg text-gray-400 italic font-light">
          "모든 팀이 AI의 힘을 쉽게 활용할 수 있도록"
        </p>
        <p className="text-xs text-gray-300 mt-2 font-medium">
          — Agent Registry Team
        </p>
      </section>
    </div>
  );
}

// ── Commit History (접이식) ──
interface Commit { hash: string; date: string; author: string; subject: string; }

const authorColors: Record<string, string> = {
  'syngha.han': 'text-blue-600',
  'byeongjulee91-dev': 'text-emerald-600',
  '한승하': 'text-blue-600',
  'Claude': 'text-violet-500',
};

function CommitHistory() {
  const [open, setOpen] = useState(false);
  const commits = commitsData as Commit[];
  const total = commits.length;

  // 날짜별 그루핑
  const grouped = commits.reduceRight((acc, c) => {
    const d = c.date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(c);
    return acc;
  }, {} as Record<string, Commit[]>);
  const dates = Object.keys(grouped);

  return (
    <section className="pt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[11px] text-gray-300 hover:text-gray-400 transition-colors mx-auto"
      >
        <GitBranch className="w-3 h-3" />
        <span>전체 커밋 히스토리{total > 0 ? ` (${total})` : ''}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 max-h-[500px] overflow-y-auto border border-gray-100 rounded-lg bg-gray-50/50">
          <div className="divide-y divide-gray-100">
            {dates.map(date => (
              <div key={date}>
                <div className="sticky top-0 bg-gray-50 px-4 py-1.5 border-b border-gray-100">
                  <span className="text-[10px] font-mono font-medium text-gray-400">{date}</span>
                  <span className="text-[10px] text-gray-300 ml-2">{grouped[date].length}건</span>
                </div>
                {grouped[date].map(c => (
                  <div key={c.hash} className="px-4 py-1.5 flex items-start gap-2 hover:bg-white/60 transition-colors">
                    <code className="text-[10px] font-mono text-gray-300 mt-px flex-shrink-0">{c.hash}</code>
                    <span className={`text-[10px] font-medium flex-shrink-0 w-24 truncate ${authorColors[c.author] || 'text-gray-400'}`}>
                      {c.author}
                    </span>
                    <span className="text-[10px] text-gray-500 leading-relaxed">{c.subject}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Section Header ──
function SectionHeader({ icon: Icon, title, subtitle }: { icon: typeof Zap; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
        <Icon className="w-4 h-4 text-gray-500" />
      </div>
      <div>
        <h2 className="text-sm font-bold text-gray-800 tracking-wide">{title}</h2>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}
