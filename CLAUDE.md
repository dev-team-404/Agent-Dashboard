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
- 페이지 하단에 **전체 커밋 히스토리** 접이식 섹션이 있음 (정적 JSON: `commits-data.json`)
  - 커밋별 작성자(author)가 색상으로 구분되며, 공로 분배 논의 시 근거 자료로 활용
  - 이 섹션은 의도적으로 눈에 띄지 않게 디자인됨 (필요할 때만 펼쳐서 확인)
  - **커밋 추가 시 commits-data.json도 갱신할 것** — 아래 명령어로 재생성:
    ```bash
    git log --format='{hash:"%h",date:"%ad",author:"%an",subject:"%s"}' --date=format:"%Y-%m-%d" --reverse | python3 -c "
    import sys, json
    commits = []
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        parts = line[1:-1]
        fields = {}
        for pair in ['hash','date','author','subject']:
            idx = parts.find(pair + ':\"')
            if idx == -1: continue
            start = idx + len(pair) + 2
            end = parts.find('\",', start) if pair != 'subject' else len(parts) - 1
            if end == -1: end = len(parts) - 1
            fields[pair] = parts[start:end]
        commits.append(fields)
    print(json.dumps(commits, ensure_ascii=False))
    " > packages/dashboard/src/pages/commits-data.json
    ```

## Commit Convention
- 한국어 설명 + 카테고리 prefix (fix:, feat:, refactor:, perf:, docs:)
- 커밋 후 반드시 push까지 수행

## Deployment
- **프로덕션은 사내망에서 운영 중** — 이 로컬 서버에서 `deploy.sh` 돌리는 게 아님
- 사내망 배포: `git pull && ./deploy.sh` (사내망 서버에서 직접 실행)
- 여기서는 코드 수정 → commit → push까지만 수행

## Port Convention
- 8090: Nginx proxy
- 8091: PostgreSQL
- 8092: Redis
