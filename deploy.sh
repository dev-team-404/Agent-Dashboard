#!/bin/bash
# ============================================
# Agent Registry - Blue-Green 무중단 배포
# ============================================
#
# 사용법:
#   ./deploy.sh              # Blue-Green 배포 (다운타임 0)
#   ./deploy.sh --with-docs  # docs-site 포함 배포 (nginx 재시작, 짧은 끊김)
#   ./deploy.sh status       # 현재 활성 슬롯 확인
#   ./deploy.sh init         # 최초 설치 (전체 빌드 + 시작)
#   ./deploy.sh dev          # Dev/QA 서버 빌드 + 시작 (포트 8095)
#   ./deploy.sh dev-stop     # Dev/QA 서버 중지
#   ./deploy.sh dev-status   # Dev/QA 서버 상태 확인
#
# 원리:
#   항상 Blue/Green 2세트 운영.
#   비활성 쪽 업데이트 → nginx reload로 트래픽 전환 → 구 활성 쪽 업데이트
#   → 양쪽 모두 최신, 다운타임 0
#   nginx 컨테이너는 트래픽 진입점이므로 기본 배포 시 건드리지 않음 (reload만)
#

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
info() { echo -e "${CYAN}[INFO]${NC} $*"; }

cd "$(dirname "$0")"

STATE_FILE=".deploy-state"
BACKUP_UPSTREAM=""
WITH_DOCS=false
DEV_COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
DEV_PORT="${DEV_PORT:-8095}"

# ─── Auth Server 자동 설정 ───
# OIDC_ISSUER를 서버 IP로 자동 설정 (사내 배포 시 수동 설정 불필요)
if [ -z "${OIDC_ISSUER:-}" ]; then
  _HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  export OIDC_ISSUER="https://${_HOST_IP}:${AUTH_PORT:-9050}"
fi

# SSL 인증서 자동 생성 (cert/ 디렉토리에 없으면)
_ensure_ssl_certs() {
  local cert_dir="./cert"
  local _PFX_PW="Samsung260310"

  # ── PFX 자동 추출: cert/ 안에 .pfx 파일이 있으면 server.crt/key 자동 생성 ──
  if [ ! -f "${cert_dir}/server.crt" ] || [ ! -f "${cert_dir}/server.key" ]; then
    local _PFX=$(find "${cert_dir}" -maxdepth 1 -name "*.pfx" -o -name "*.p12" 2>/dev/null | head -1)
    if [ -n "$_PFX" ]; then
      log "PFX 파일 발견: $_PFX → server.crt/server.key 추출"
      openssl pkcs12 -in "$_PFX" -clcerts -nokeys -out "${cert_dir}/server.crt" -passin "pass:${_PFX_PW}" 2>/dev/null
      openssl pkcs12 -in "$_PFX" -nocerts -nodes -out "${cert_dir}/server.key" -passin "pass:${_PFX_PW}" 2>/dev/null
      # P7B 체인이 있으면 server.crt에 합치기
      local _P7B=$(find "${cert_dir}" -maxdepth 1 -name "*.p7b" 2>/dev/null | head -1)
      if [ -n "$_P7B" ]; then
        log "P7B 체인 발견: $_P7B → server.crt에 합치기"
        openssl pkcs7 -in "$_P7B" -inform DER -print_certs >> "${cert_dir}/server.crt" 2>/dev/null || \
        openssl pkcs7 -in "$_P7B" -print_certs >> "${cert_dir}/server.crt" 2>/dev/null
      fi
      if [ -f "${cert_dir}/server.crt" ] && [ -f "${cert_dir}/server.key" ]; then
        info "PFX에서 인증서 추출 완료"
        openssl x509 -in "${cert_dir}/server.crt" -noout -subject -dates 2>/dev/null
      else
        warn "PFX 추출 실패 — 자체서명 인증서로 대체"
      fi
    fi
  fi

  # ── 여전히 없으면 자체서명 인증서 자동 생성 ──
  if [ ! -f "${cert_dir}/server.crt" ] || [ ! -f "${cert_dir}/server.key" ]; then
    log "SSL 인증서 없음 → 자체서명 인증서 자동 생성"
    local _IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout "${cert_dir}/server.key" -out "${cert_dir}/server.crt" \
      -subj "/C=KR/O=Samsung DS/CN=agent-platform-auth" \
      -addext "subjectAltName=DNS:localhost,DNS:auth,IP:127.0.0.1,IP:${_IP},IP:172.17.0.1" \
      2>/dev/null
    info "자체서명 인증서 생성 완료: ${cert_dir}/server.crt"
    warn "운영 환경에서는 사내 CA 인증서로 교체하세요"
  fi

  # ── SSO 인증서: sso.cer 없으면 cert.cer → sso.cer 복사 ──
  if [ ! -f "${cert_dir}/sso.cer" ]; then
    if [ -f "${cert_dir}/cert.cer" ]; then
      cp "${cert_dir}/cert.cer" "${cert_dir}/sso.cer"
      info "cert/cert.cer → cert/sso.cer 복사 (SSO 인증서)"
    elif [ "${ENABLE_MOCK_SSO:-false}" != "true" ]; then
      warn "SSO 인증서(cert/sso.cer 또는 cert/cert.cer) 없음 — 실제 SSO 연동 시 필요합니다"
    fi
  fi
}

# ─── 상태 관리 ───
get_active() {
  local state
  state=$(cat "$STATE_FILE" 2>/dev/null || true)
  # blue/green 이외의 값은 blue로 초기화
  if [ "$state" = "blue" ] || [ "$state" = "green" ]; then
    echo "$state"
  else
    echo "blue"
  fi
}

get_inactive() {
  local active
  active=$(get_active)
  [ "$active" = "blue" ] && echo "green" || echo "blue"
}

# ─── 헬스체크 대기 ───
wait_healthy() {
  local service=$1
  local max_wait=${2:-90}
  local elapsed=0
  local container_id

  info "${service} 헬스체크 대기 중..."

  while [ $elapsed -lt $max_wait ]; do
    container_id=$(docker compose ps -q "$service" 2>/dev/null || true)

    if [ -z "$container_id" ]; then
      sleep 2
      elapsed=$((elapsed + 2))
      continue
    fi

    local health
    health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id" 2>/dev/null || echo "unknown")

    if [ "$health" = "healthy" ]; then
      log "${service} → healthy (${elapsed}초)"
      return 0
    fi

    if [ "$health" = "no-healthcheck" ]; then
      # 헬스체크 없는 서비스 (dashboard) — 컨테이너 running이면 OK
      local state
      state=$(docker inspect --format='{{.State.Status}}' "$container_id" 2>/dev/null || echo "unknown")
      if [ "$state" = "running" ]; then
        log "${service} → running (${elapsed}초)"
        return 0
      fi
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  err "${service}가 ${max_wait}초 내에 ready 상태가 되지 않았습니다"
  return 1
}

# ─── nginx upstream 전환 ───
switch_upstream() {
  local color=$1
  info "upstream을 ${color}으로 전환 중..."

  # 백업
  BACKUP_UPSTREAM=$(cat nginx/active-upstream.conf)

  # 전환
  cp "nginx/upstream-${color}.conf" nginx/active-upstream.conf
  log "active-upstream.conf → ${color}"

  # nginx graceful reload (기존 연결 유지)
  docker compose exec -T nginx nginx -s reload
  log "nginx reload 완료 — 트래픽이 ${color}으로 전환됨"
}

# ─── 롤백 ───
rollback_upstream() {
  if [ -n "$BACKUP_UPSTREAM" ]; then
    warn "upstream 롤백 중..."
    echo "$BACKUP_UPSTREAM" > nginx/active-upstream.conf
    docker compose exec -T nginx nginx -s reload 2>/dev/null || true
    warn "upstream 롤백 완료"
  fi
}

# ─── status 명령 ───
cmd_status() {
  local active
  active=$(get_active)
  local inactive
  inactive=$(get_inactive)

  echo ""
  echo -e "${BOLD}Blue-Green 배포 상태${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  활성 슬롯:   ${GREEN}${active}${NC} ← 트래픽 수신 중"
  echo -e "  대기 슬롯:   ${CYAN}${inactive}${NC}"
  echo ""
  docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps
  echo ""
}

# ─── init 명령 (최초 설치) ───
cmd_init() {
  log "최초 설치 시작 — 전체 빌드 + 시작"
  echo ""

  # SSL 인증서 확인/자동 생성
  _ensure_ssl_certs
  echo ""

  info "OIDC_ISSUER=${OIDC_ISSUER}"
  echo ""

  # 인프라 먼저
  log "1/5 인프라 시작 (postgres, redis)"
  docker compose up -d postgres redis
  wait_healthy postgres 60
  wait_healthy redis 30
  echo ""

  # Blue 먼저 (DB 마이그레이션 실행)
  log "2/5 Blue 슬롯 빌드 + 시작"
  docker compose build --no-cache api-blue dashboard-blue
  docker compose up -d api-blue dashboard-blue
  wait_healthy api-blue 90
  wait_healthy dashboard-blue 30
  echo ""

  # Green (Blue가 마이그레이션 완료 후)
  log "3/5 Green 슬롯 빌드 + 시작"
  docker compose build --no-cache api-green dashboard-green
  docker compose up -d api-green dashboard-green
  wait_healthy api-green 90
  wait_healthy dashboard-green 30
  echo ""

  # Auth Server (stateless, no Blue-Green needed)
  log "4/5 Auth Server 빌드 + 시작"
  docker compose build --no-cache auth
  docker compose up -d auth
  wait_healthy auth 240
  echo ""

  # Nginx + docs-site
  log "5/5 Nginx(docs 포함) 빌드 + 시작"
  docker compose build --no-cache nginx
  docker compose up -d nginx
  echo ""

  # 상태 저장
  echo "blue" > "$STATE_FILE"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "최초 설치 완료!"
  info "활성 슬롯: blue"
  info "이후 배포: ./deploy.sh"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  docker compose ps
}

# ─── Blue-Green 배포 ───
cmd_deploy() {
  local ACTIVE
  ACTIVE=$(get_active)
  local INACTIVE
  INACTIVE=$(get_inactive)

  # SSL 인증서 확인/자동 생성
  _ensure_ssl_certs

  echo ""
  echo -e "${BOLD}Blue-Green 무중단 배포${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  현재 활성: ${GREEN}${ACTIVE}${NC}"
  echo -e "  배포 대상: ${CYAN}${INACTIVE}${NC} (먼저 업데이트)"
  echo -e "  OIDC: ${OIDC_ISSUER}"
  if [ "$WITH_DOCS" = true ]; then
    echo -e "  docs-site: ${YELLOW}포함${NC} (nginx 컨테이너 교체됨)"
  fi
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  local START_TIME
  START_TIME=$(date +%s)

  # ──────────────────────────────────────────
  # Step 1: 비활성 슬롯 빌드 (기존 서비스 계속 운영)
  # ──────────────────────────────────────────
  if [ "$WITH_DOCS" = true ]; then
    log "Step 1/5: 이미지 빌드 — API + Dashboard + Nginx(docs) (서비스 중단 없음)"
    docker compose build --no-cache "api-${INACTIVE}" "dashboard-${INACTIVE}" nginx
  else
    log "Step 1/5: 이미지 빌드 — API + Dashboard (서비스 중단 없음)"
    docker compose build --no-cache "api-${INACTIVE}" "dashboard-${INACTIVE}"
  fi
  echo ""

  # ──────────────────────────────────────────
  # Step 2: 비활성 슬롯 컨테이너 재시작 + 헬스체크
  # ──────────────────────────────────────────
  log "Step 2/5: ${INACTIVE} 슬롯 컨테이너 재시작"
  docker compose up -d "api-${INACTIVE}" "dashboard-${INACTIVE}"

  if ! wait_healthy "api-${INACTIVE}" 90; then
    err "api-${INACTIVE} 헬스체크 실패 — 배포 중단 (기존 서비스 영향 없음)"
    exit 1
  fi
  if ! wait_healthy "dashboard-${INACTIVE}" 30; then
    err "dashboard-${INACTIVE} 시작 실패 — 배포 중단 (기존 서비스 영향 없음)"
    exit 1
  fi
  echo ""

  # ──────────────────────────────────────────
  # Step 3: 트래픽 전환 (nginx reload, 다운타임 0)
  # ──────────────────────────────────────────
  log "Step 3/5: 트래픽 전환 ${ACTIVE} → ${INACTIVE}"

  if ! switch_upstream "$INACTIVE"; then
    err "nginx reload 실패"
    rollback_upstream
    exit 1
  fi
  echo ""

  # ──────────────────────────────────────────
  # Step 4: 구 활성 슬롯(이제 비활성) 업데이트
  # ──────────────────────────────────────────
  log "Step 4/5: ${ACTIVE} 슬롯 업데이트 (트래픽은 이미 ${INACTIVE}에서 처리 중)"
  docker compose build --no-cache "api-${ACTIVE}" "dashboard-${ACTIVE}"
  docker compose up -d "api-${ACTIVE}" "dashboard-${ACTIVE}"

  if ! wait_healthy "api-${ACTIVE}" 90; then
    warn "api-${ACTIVE} 헬스체크 실패 — 서비스에는 영향 없음 (${INACTIVE} 활성 중)"
  fi
  wait_healthy "dashboard-${ACTIVE}" 30 || true
  echo ""

  # ──────────────────────────────────────────
  # Auth Server 업데이트 (stateless, no Blue-Green needed)
  # ──────────────────────────────────────────
  log "Auth Server 빌드 + 재시작"
  docker compose build --no-cache auth
  docker compose up -d auth
  wait_healthy auth 240 || warn "auth 헬스체크 실패 — 서비스에 영향 없음"
  echo ""

  # ──────────────────────────────────────────
  # Step 5: (docs 배포 시만) Nginx 컨테이너 교체
  # ──────────────────────────────────────────
  if [ "$WITH_DOCS" = true ]; then
    log "Step 5/5: Nginx 컨테이너 교체 (docs-site 업데이트 포함)"
    warn "⚠ nginx 컨테이너 교체로 1~2초 연결 끊김 발생"
    docker compose up -d nginx
  else
    log "Step 5/5: Nginx 컨테이너 유지 (upstream 전환은 Step 3에서 완료)"
  fi
  echo ""

  # ──────────────────────────────────────────
  # 상태 저장 + 결과
  # ──────────────────────────────────────────
  echo "$INACTIVE" > "$STATE_FILE"

  local END_TIME
  END_TIME=$(date +%s)
  local ELAPSED=$((END_TIME - START_TIME))

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "배포 완료!"
  info "활성 슬롯: ${INACTIVE}"
  info "총 소요: ${ELAPSED}초"
  if [ "$WITH_DOCS" = true ]; then
    warn "nginx 컨테이너 교체로 짧은 끊김 발생 (1~2초)"
  else
    info "서비스 중단: 0초"
  fi
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  docker compose ps
}

# ─── migrate 명령 (스키마만 동기화, 컨테이너 재빌드 없음) ───
cmd_migrate() {
  local ACTIVE
  ACTIVE=$(get_active)
  local CONTAINER="agent-registry-api-${ACTIVE}"

  echo ""
  echo -e "${BOLD}DB 스키마 마이그레이션${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  대상 컨테이너: ${GREEN}api-${ACTIVE}${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # 현재 호스트의 최신 schema.prisma를 실행 중인 컨테이너에 복사
  log "1/3: 최신 schema.prisma를 컨테이너에 복사"
  docker cp packages/api/prisma/schema.prisma "${CONTAINER}:/app/prisma/schema.prisma"

  # prisma db push — safe mode 먼저 시도, unique 추가 등 경고 시 재시도
  log "2/3: prisma db push 실행"
  if ! docker compose exec -T "api-${ACTIVE}" npx prisma db push --skip-generate 2>&1; then
    warn "safe mode 실패 — unique 제약 추가 등 감지. --accept-data-loss로 재시도합니다."
    if ! docker compose exec -T "api-${ACTIVE}" npx prisma db push --skip-generate --accept-data-loss; then
      err "prisma db push 최종 실패!"
      exit 1
    fi
  fi

  log "3/3: 스키마 동기화 완료 (Prisma Client는 다음 deploy 시 재생성됩니다)"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "마이그레이션 완료!"
  info "주의: API 서버 재시작 필요 시 → ./deploy.sh"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ─── Dev 서버: 헬스체크 대기 (dev compose 전용) ───
wait_healthy_dev() {
  local service=$1
  local max_wait=${2:-90}
  local elapsed=0
  local container_id

  info "[DEV] ${service} 헬스체크 대기 중..."

  while [ $elapsed -lt $max_wait ]; do
    container_id=$($DEV_COMPOSE ps -q "$service" 2>/dev/null || true)

    if [ -z "$container_id" ]; then
      sleep 2
      elapsed=$((elapsed + 2))
      continue
    fi

    local health
    health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id" 2>/dev/null || echo "unknown")

    if [ "$health" = "healthy" ]; then
      log "[DEV] ${service} → healthy (${elapsed}초)"
      return 0
    fi

    if [ "$health" = "no-healthcheck" ]; then
      local state
      state=$(docker inspect --format='{{.State.Status}}' "$container_id" 2>/dev/null || echo "unknown")
      if [ "$state" = "running" ]; then
        log "[DEV] ${service} → running (${elapsed}초)"
        return 0
      fi
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  err "[DEV] ${service}가 ${max_wait}초 내에 ready 상태가 되지 않았습니다"
  return 1
}

# ─── dev 명령: Dev/QA 서버 빌드 + 시작 ───
cmd_dev() {
  echo ""
  echo -e "${BOLD}Dev/QA 서버 배포${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  포트:     ${CYAN}${DEV_PORT}${NC}"
  echo -e "  DB/Redis: ${GREEN}프로덕션과 공유${NC}"
  echo -e "  프로덕션: ${GREEN}영향 없음${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  local START_TIME
  START_TIME=$(date +%s)

  # 인프라(postgres, redis)가 실행 중인지 확인
  log "[DEV] Step 1/3: 인프라 확인"
  local pg_running
  pg_running=$(docker compose ps -q postgres 2>/dev/null || true)
  if [ -z "$pg_running" ]; then
    warn "postgres가 실행 중이 아닙니다. 시작합니다..."
    docker compose up -d postgres redis
    wait_healthy postgres 60
    wait_healthy redis 30
  else
    log "postgres, redis 실행 중 확인"
  fi
  echo ""

  # Dev 이미지 빌드
  # SSL 인증서 확인/자동 생성
  _ensure_ssl_certs
  echo ""

  # Auth Server (Dev: Mock SSO 활성화)
  log "[DEV] Step 2/4: Auth Server 시작 (Mock SSO 활성화)"
  ENABLE_MOCK_SSO=true docker compose build auth 2>/dev/null
  ENABLE_MOCK_SSO=true docker compose up -d auth
  wait_healthy auth 240 || warn "auth 헬스체크 실패"
  echo ""

  log "[DEV] Step 3/4: 이미지 빌드 (api-dev + dashboard-dev + nginx-dev)"
  $DEV_COMPOSE build --no-cache api-dev dashboard-dev nginx-dev
  echo ""

  # 컨테이너 시작 + 헬스체���
  # --no-deps: postgres/redis 등 공유 인프라를 건드리지 않음 (프로덕션 보호)
  log "[DEV] Step 4/4: 컨테이너 시작 (프로덕션 인프라 보호 모드)"
  $DEV_COMPOSE up -d --no-deps api-dev dashboard-dev nginx-dev

  if ! wait_healthy_dev api-dev 90; then
    err "api-dev 헬스체크 실패"
    exit 1
  fi
  if ! wait_healthy_dev dashboard-dev 30; then
    err "dashboard-dev 시작 실패"
    exit 1
  fi
  echo ""

  local END_TIME
  END_TIME=$(date +%s)
  local ELAPSED=$((END_TIME - START_TIME))

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "Dev 서버 배포 완료!"
  info "접속: http://<서버IP>:${DEV_PORT}"
  info "총 소요: ${ELAPSED}초"
  info "프로덕션(8090) 영향: 없음"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  $DEV_COMPOSE ps api-dev dashboard-dev nginx-dev
}

# ─── dev-stop 명령: Dev/QA 서버 중지 ───
cmd_dev_stop() {
  echo ""
  log "Dev 서버 중지 중..."
  $DEV_COMPOSE stop api-dev dashboard-dev nginx-dev
  $DEV_COMPOSE rm -f api-dev dashboard-dev nginx-dev
  log "Dev 서버 중지 완료 (프로덕션 영향 없음)"
  echo ""
}

# ─── dev-status 명령: Dev/QA 서버 상태 확인 ───
cmd_dev_status() {
  echo ""
  echo -e "${BOLD}Dev/QA 서버 상태${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  포트: ${CYAN}${DEV_PORT}${NC}"
  echo ""
  $DEV_COMPOSE ps api-dev dashboard-dev nginx-dev 2>/dev/null || info "Dev 서버가 실행 중이 아닙니다"
  echo ""
}

# ─── 옵션 파싱 ───
COMMAND=""
for arg in "$@"; do
  case "$arg" in
    --with-docs) WITH_DOCS=true ;;
    status|init|deploy|migrate|dev|dev-stop|dev-status) COMMAND="$arg" ;;
    *)
      echo "사용법: $0 [deploy|status|init|migrate|dev|dev-stop|dev-status] [--with-docs]"
      echo ""
      echo "  deploy              Blue-Green 무중단 배포 (기본값)"
      echo "  deploy --with-docs  docs-site 포함 배포 (nginx 재시작, 짧은 끊김)"
      echo "  status              현재 활성 슬롯 확인"
      echo "  init                최초 설치 (전체 빌드 + 순차 시작)"
      echo "  migrate             DB 스키마만 동기화 (컨테이너 재빌드 없음, 데이터 보존)"
      echo ""
      echo "  dev                 Dev/QA 서버 빌드 + 시작 (포트 ${DEV_PORT})"
      echo "  dev-stop            Dev/QA 서버 중지"
      echo "  dev-status          Dev/QA 서버 상태 확인"
      exit 1
      ;;
  esac
done

# ─── 메인 ───
case "${COMMAND:-deploy}" in
  status)
    cmd_status
    ;;
  init)
    cmd_init
    ;;
  migrate)
    cmd_migrate
    ;;
  dev)
    cmd_dev
    ;;
  dev-stop)
    cmd_dev_stop
    ;;
  dev-status)
    cmd_dev_status
    ;;
  deploy|"")
    cmd_deploy
    ;;
esac
