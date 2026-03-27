# Agent Registry & Dashboard — Claude Code Instructions

## Platform Story Page (플랫폼 스토리)
- 경로: `packages/dashboard/src/pages/PlatformStory.tsx`
- 사이드바: 리소스 → 플랫폼 스토리 (`/platform-story`)
- **중요: 새로운 기능을 추가하거나 큰 변경 사항이 있을 때, 반드시 PlatformStory.tsx도 함께 업데이트할 것**
  - timeline 배열에 새 마일스톤 추가
  - featureGroups에 새 기능 반영
  - 커밋 수, 코드 라인 수 등 통계 업데이트
  - 팀 멤버 변경 시 team 배열 업데이트
- 이 페이지는 개발팀의 공로와 플랫폼 발전 과정을 기록하는 곳이므로, 기능 추가 시 빠뜨리지 말 것

## Commit Convention
- 한국어 설명 + 카테고리 prefix (fix:, feat:, refactor:, perf:, docs:)
- 커밋 후 반드시 push까지 수행

## Port Convention
- 8090: Nginx proxy
- 8091: PostgreSQL
- 8092: Redis
