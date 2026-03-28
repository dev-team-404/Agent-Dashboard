#!/bin/sh
set -e

# ============================================
# Dev/QA 서버 전용 엔트리포인트
# prisma db push 차단 — 스키마 변경 감지 시 경고
# ============================================

YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  [DEV] Dev/QA 서버 시작${NC}"
echo -e "${CYAN}  DB 스키마 자동 변경 차단 모드${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── 스키마 변경 감지 ───
echo -e "${CYAN}[DEV]${NC} DB 스키마 변경 여부 확인 중..."

# prisma migrate diff: 현재 DB vs 로컬 schema.prisma 비교
DIFF_OUTPUT=$(npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code 2>&1) && DIFF_EXIT=0 || DIFF_EXIT=$?

if [ "$DIFF_EXIT" -eq 0 ]; then
  # exit code 0 = 차이 없음
  echo -e "${GREEN}[DEV] ✓ DB 스키마 동기화 상태 — 정상${NC}"
elif [ "$DIFF_EXIT" -eq 2 ]; then
  # exit code 2 = 차이 있음
  echo ""
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}  ⚠  DB 스키마 변경 감지! (Dev 서버에서 차단됨)${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${YELLOW}  변경 내용:${NC}"
  echo "$DIFF_OUTPUT" | head -30
  echo ""
  echo -e "${YELLOW}  조치 방법:${NC}"
  echo -e "  1. ${BOLD}syngha.han${NC} 확인/승인 받기"
  echo -e "  2. 프로덕션 서버에서 실행: ${BOLD}./deploy.sh migrate${NC}"
  echo -e "  3. Dev 서버 재시작: ${BOLD}./deploy.sh dev${NC}"
  echo ""
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${YELLOW}[DEV] 스키마 변경 없이 서버를 시작합니다 (일부 기능이 동작하지 않을 수 있음)${NC}"
else
  # 기타 에러 (prisma migrate diff 미지원 등)
  echo -e "${YELLOW}[DEV] 스키마 비교 실패 (무시하고 계속 진행)${NC}"
fi

echo ""

# ─── 마이그레이션 스크립트 실행 (데이터 보정, idempotent) ───
echo -e "${CYAN}[DEV]${NC} 데이터 보정 스크립트 실행..."
node scripts/pre-migrate-gpu-power.mjs || true
node dist/backfill-service-fields.js || true
node dist/fix-alias-names.js || true
node dist/seed-holidays.js || true
node scripts/migrate-scope-to-codes.mjs || true

# ─── 서버 시작 ───
echo ""
echo -e "${GREEN}[DEV]${NC} API 서버 시작..."
exec node dist/index.js
