#!/bin/bash
# ============================================
# Agent Dashboard - Blue-Green 무중단 배포
# ============================================
#
# 사용법:
#   ./deploy.sh          # Blue-Green 배포 (다운타임 0)
#   ./deploy.sh status   # 현재 활성 슬롯 확인
#   ./deploy.sh init     # 최초 설치 (전체 빌드 + 시작)
#
# 원리:
#   항상 Blue/Green 2세트 운영.
#   비활성 쪽 업데이트 → nginx reload로 트래픽 전환 → 구 활성 쪽 업데이트
#   → 양쪽 모두 최신, 다운타임 0
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

  # 인프라 먼저
  log "1/4 인프라 시작 (postgres, redis)"
  docker compose up -d postgres redis
  wait_healthy postgres 60
  wait_healthy redis 30
  echo ""

  # Blue 먼저 (DB 마이그레이션 실행)
  log "2/4 Blue 슬롯 빌드 + 시작"
  docker compose build api-blue dashboard-blue
  docker compose up -d api-blue dashboard-blue
  wait_healthy api-blue 90
  wait_healthy dashboard-blue 30
  echo ""

  # Green (Blue가 마이그레이션 완료 후)
  log "3/4 Green 슬롯 빌드 + 시작"
  docker compose build api-green dashboard-green
  docker compose up -d api-green dashboard-green
  wait_healthy api-green 90
  wait_healthy dashboard-green 30
  echo ""

  # Nginx
  log "4/4 Nginx 빌드 + 시작"
  docker compose build nginx
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

  echo ""
  echo -e "${BOLD}Blue-Green 무중단 배포${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  현재 활성: ${GREEN}${ACTIVE}${NC}"
  echo -e "  배포 대상: ${CYAN}${INACTIVE}${NC} (먼저 업데이트)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  local START_TIME
  START_TIME=$(date +%s)

  # ──────────────────────────────────────────
  # Step 1: 비활성 슬롯 빌드 (기존 서비스 계속 운영)
  # ──────────────────────────────────────────
  log "Step 1/5: ${INACTIVE} 슬롯 이미지 빌드 (서비스 중단 없음)"
  docker compose build "api-${INACTIVE}" "dashboard-${INACTIVE}"
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
  docker compose build "api-${ACTIVE}" "dashboard-${ACTIVE}"
  docker compose up -d "api-${ACTIVE}" "dashboard-${ACTIVE}"

  if ! wait_healthy "api-${ACTIVE}" 90; then
    warn "api-${ACTIVE} 헬스체크 실패 — 서비스에는 영향 없음 (${INACTIVE} 활성 중)"
  fi
  wait_healthy "dashboard-${ACTIVE}" 30 || true
  echo ""

  # ──────────────────────────────────────────
  # Step 5: 상태 저장 + 결과
  # ──────────────────────────────────────────
  echo "$INACTIVE" > "$STATE_FILE"

  local END_TIME
  END_TIME=$(date +%s)
  local ELAPSED=$((END_TIME - START_TIME))

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "배포 완료!"
  info "활성 슬롯: ${INACTIVE}"
  info "총 소요: ${ELAPSED}초"
  info "서비스 중단: 0초"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  docker compose ps
}

# ─── 메인 ───
case "${1:-deploy}" in
  status)
    cmd_status
    ;;
  init)
    cmd_init
    ;;
  deploy|"")
    cmd_deploy
    ;;
  *)
    echo "사용법: $0 [deploy|status|init]"
    echo ""
    echo "  deploy   Blue-Green 무중단 배포 (기본값)"
    echo "  status   현재 활성 슬롯 확인"
    echo "  init     최초 설치 (전체 빌드 + 순차 시작)"
    exit 1
    ;;
esac
