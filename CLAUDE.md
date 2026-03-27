# Agent Registry & Dashboard — Claude Code Instructions

## Platform Story Page (플랫폼 스토리) — 공로 인정용 핵심 페이지
- 경로: `packages/dashboard/src/pages/PlatformStory.tsx`
- 사이드바: 리소스 → 플랫폼 스토리 (`/platform-story`)
- **이 페이지는 개발팀 전체의 공로를 기록하는 곳이므로 각별히 신경 쓸 것**
- **새로운 기능을 추가하거나 큰 변경 사항이 있을 때, 반드시 PlatformStory.tsx도 함께 업데이트할 것**
  - timeline 배열에 새 마일스톤 추가 (날짜, 제목, 상세 설명, 태그)
  - featureGroups에 새 기능 반영
  - Hero 섹션의 커밋 수, 코드 라인 수 등 통계 업데이트
  - 팀 멤버 변경 시 team 배열 업데이트
- **기능 추가 시 타임라인/기능 목록에 반영되지 않은 커밋이 있는지 git log로 확인하고, 빠진 것은 추가할 것**
- 페이지 하단에 **전체 커밋 히스토리** 접이식 섹션이 있음 (GET /git-log API — 시간순 전체 커밋)
  - 커밋별 작성자(author)가 색상으로 구분되며, 공로 분배 논의 시 근거 자료로 활용
  - 이 섹션은 의도적으로 눈에 띄지 않게 디자인됨 (필요할 때만 펼쳐서 확인)

## Commit Convention
- 한국어 설명 + 카테고리 prefix (fix:, feat:, refactor:, perf:, docs:)
- 커밋 후 반드시 push까지 수행

## Port Convention
- 8090: Nginx proxy
- 8091: PostgreSQL
- 8092: Redis
