#!/bin/bash
# ============================================
# Agent Dashboard - Zero-Downtime Deploy Script
# ============================================
#
# 사용법:
#   ./deploy.sh              # 전체 배포 (api + dashboard + nginx)
#   ./deploy.sh api          # API만 배포
#   ./deploy.sh dashboard    # Dashboard만 배포
#   ./deploy.sh nginx        # Nginx + docs-site만 배포
#   ./deploy.sh api dashboard # 복수 서비스 지정 가능
#
# 원리:
#   1단계: 이미지 빌드 (기존 컨테이너는 서비스 계속 중)
#   2단계: 컨테이너 순차 재시작 + 헬스체크 대기
#          → 빌드 시간 동안 다운타임 0, 재시작은 수 초
#

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }
info() { echo -e "${CYAN}[INFO]${NC} $*"; }

# 프로젝트 루트로 이동
cd "$(dirname "$0")"

# 대상 서비스 결정
if [ $# -eq 0 ]; then
  TARGETS=(api dashboard nginx)
else
  TARGETS=("$@")
fi

# 유효성 검사
VALID_TARGETS="api dashboard nginx"
for t in "${TARGETS[@]}"; do
  if ! echo "$VALID_TARGETS" | grep -qw "$t"; then
    err "알 수 없는 서비스: $t (사용 가능: api, dashboard, nginx)"
    exit 1
  fi
done

log "배포 대상: ${TARGETS[*]}"
echo ""

# ──────────────────────────────────
# 1단계: 이미지 빌드 (다운타임 없음)
# ──────────────────────────────────
log "1단계: 이미지 빌드 시작 (기존 서비스는 계속 운영 중)"
START_BUILD=$(date +%s)

docker compose build "${TARGETS[@]}"

END_BUILD=$(date +%s)
log "빌드 완료 ($(( END_BUILD - START_BUILD ))초 소요)"
echo ""

# ──────────────────────────────────
# 2단계: 순차 재시작 + 헬스체크 대기
# ──────────────────────────────────

wait_healthy() {
  local service=$1
  local max_wait=${2:-60}
  local elapsed=0

  info "$service 헬스체크 대기 중..."
  while [ $elapsed -lt $max_wait ]; do
    local health
    health=$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q "$service" 2>/dev/null)" 2>/dev/null || echo "unknown")

    if [ "$health" = "healthy" ]; then
      log "$service → healthy (${elapsed}초)"
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  warn "$service 가 ${max_wait}초 내에 healthy 상태가 되지 않았습니다 (현재: $health)"
  warn "서비스는 시작되었지만 헬스체크를 확인해주세요"
  return 0
}

log "2단계: 순차 재시작 시작"
START_RESTART=$(date +%s)

# 재시작 순서: api → dashboard → nginx (의존성 순서)
ORDER=(api dashboard nginx)

for service in "${ORDER[@]}"; do
  # 대상 목록에 있는 서비스만 재시작
  if printf '%s\n' "${TARGETS[@]}" | grep -qx "$service"; then
    echo ""
    log "재시작: $service"
    docker compose up -d --no-deps "$service"
    wait_healthy "$service" 60
  fi
done

END_RESTART=$(date +%s)
echo ""

# ──────────────────────────────────
# 결과 요약
# ──────────────────────────────────
TOTAL=$(( END_RESTART - START_BUILD ))
RESTART_TIME=$(( END_RESTART - START_RESTART ))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "배포 완료!"
info "총 소요: ${TOTAL}초 (빌드: $(( END_BUILD - START_BUILD ))초 + 재시작: ${RESTART_TIME}초)"
info "다운타임: 약 ${RESTART_TIME}초 (컨테이너 재시작 시간만)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 최종 상태 확인
docker compose ps
