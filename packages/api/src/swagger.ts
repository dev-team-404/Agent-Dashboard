/**
 * Swagger / OpenAPI 3.0 Specification
 *
 * Agent Usage Statistics System - Public API Documentation
 * Agent 사용량 집계 시스템 공개 API 문서
 *
 * All dates are in KST (Asia/Seoul), YYYY-MM-DD format
 * 모든 날짜는 KST (Asia/Seoul) 기준, YYYY-MM-DD 형식
 */

// ─── Reusable Schema Components ────────────────────────────

const dateParam = (name: string, descEn: string, descKr: string, example: string) => ({
  name,
  in: 'query' as const,
  required: true,
  description: `${descEn} / ${descKr} (YYYY-MM-DD, KST)`,
  schema: { type: 'string' as const, format: 'date' as const, example },
});

const serviceNameParam = (required: boolean) => ({
  name: 'serviceName',
  in: 'query' as const,
  required,
  description: 'Service name (code). Retrieve from /stats/services (서비스 코드. /stats/services 의 name 필드 사용)',
  schema: { type: 'string' as const, example: 'nexus-coder' },
});

const apiKeyParam = {
  name: 'apiKey',
  in: 'query' as const,
  required: false,
  description: 'API key for authentication. Set by Super Admin in dashboard. Not required if no key is configured. / 슈퍼관리자가 대시보드에서 설정한 API 비밀번호. 미설정 시 불필요.',
  schema: { type: 'string' as const, example: 'your-api-key' },
};

const yearParam = {
  name: 'year',
  in: 'query' as const,
  required: false,
  description: 'Year (YYYY). Defaults to current year if omitted / 연도. 미입력 시 올해',
  schema: { type: 'integer' as const, example: 2026 },
};

const monthParam = {
  name: 'month',
  in: 'query' as const,
  required: false,
  description: 'Month (1-12). Defaults to current month if omitted / 월. 미입력 시 이번달',
  schema: { type: 'integer' as const, minimum: 1, maximum: 12, example: 3 },
};

const errorResponse = (desc: string, example?: string) => ({
  description: desc,
  content: {
    'application/json': {
      schema: {
        type: 'object' as const,
        properties: { error: { type: 'string' as const } },
      },
      ...(example ? { example: { error: example } } : {}),
    },
  },
});

// ─── Swagger Spec ──────────────────────────────────────────

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Agent Registry - Public API',
    version: '2.1.0',
    description:
      'Public API for querying AI Agent usage data.\n' +
      'AI Agent 사용량 데이터를 조회할 수 있는 공개 API입니다.\n\n' +
      '## Authentication (인증)\n' +
      '- **GET** requests require `?apiKey=` query parameter (if API key is configured by Super Admin)\n' +
      '  GET 요청은 `?apiKey=` 쿼리 파라미터 필수 (슈퍼관리자가 비밀번호 설정 시)\n' +
      '- **POST** requests (usage submission) do not require API key\n' +
      '  POST 요청 (사용량 기록)은 비밀번호 불필요\n\n' +
      '## Common Notes (공통 사항)\n' +
      '- All date parameters use **KST (Asia/Seoul)** in `YYYY-MM-DD` format\n' +
      '  날짜 파라미터는 모두 **KST (Asia/Seoul)** 기준 `YYYY-MM-DD` 형식\n' +
      '- Maximum query period: **365 days** / 최대 조회 기간: **365일**\n' +
      '- Tokens = inputTokens + outputTokens / 토큰 = 입력 토큰 + 출력 토큰\n' +
      '- API call count = requestCount / API 호출 수 = requestCount\n\n' +
      '## Usage Flow (사용 흐름)\n' +
      '1. Query service ID list via `/stats/services` / `/stats/services` 로 서비스 ID 목록 조회\n' +
      '2. Use the desired `serviceName` to query team/user usage / 원하는 `serviceName`(서비스 코드)를 이용하여 팀별/사용자별 사용량 조회\n',
  },
  servers: [
    { url: '/api/public', description: 'Public Stats API (/api/public/stats/...)' },
    { url: '/api', description: 'External Usage API (/api/external-usage/...)' },
  ],
  paths: {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Service List (서비스 목록)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/services': {
      get: {
        summary: 'Deployed Service List (배포된 서비스 목록)',
        description:
          'Returns name, display name, type, status, and metadata of **deployed** services only (status=DEPLOYED).\n' +
          '**배포 완료(status=DEPLOYED)** 상태인 서비스의 이름, 표시명, 타입, 메타데이터를 반환합니다.\n' +
          'Services in DEVELOPMENT status are excluded.\n' +
          '개발 중(DEVELOPMENT) 상태의 서비스는 제외됩니다.\n\n' +
          'Use the `name` field as the `serviceName` parameter for other APIs.\n' +
          '다른 API의 `serviceName` 파라미터에 사용할 서비스 코드(`name`)를 여기서 조회하세요.',
        tags: ['Services (서비스)'],
        parameters: [apiKeyParam],
        responses: {
          '200': {
            description: 'Service list (서비스 목록)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', description: 'Service system name in English (서비스 시스템명, 영문)' },
                          displayName: { type: 'string', description: 'Service display name (서비스 표시명)' },
                          description: { type: 'string', nullable: true, description: 'Service description (서비스 설명)' },
                          type: { type: 'string', enum: ['STANDARD', 'BACKGROUND'], description: 'Service type (서비스 타입)' },
                          status: { type: 'string', enum: ['DEVELOPMENT', 'DEPLOYED'], description: 'Service status (서비스 상태)' },
                          enabled: { type: 'boolean', description: 'Active status (활성 상태)' },
                          targetMM: { type: 'number', nullable: true, description: 'Target MM (Men/Month). null if not set (목표 MM. 미설정 시 null)' },
                          savedMM: { type: 'number', nullable: true, description: 'Saved MM (Men/Month). Current savings achieved. null if not set (절감 실적 MM. 미설정 시 null)' },
                          serviceCategory: { type: 'array', items: { type: 'string' }, description: 'Service categories, multiple allowed (서비스 카테고리, 복수 선택 가능)' },
                          jiraTicket: { type: 'string', nullable: true, description: 'Jira ticket URL (Jira 티켓 URL)' },
                          serviceUrl: { type: 'string', nullable: true, description: 'Service URL (서비스 URL)' },
                          docsUrl: { type: 'string', nullable: true, description: 'API documentation URL (API 문서 URL)' },
                          registeredBy: { type: 'string', nullable: true, description: 'Registered by user ID (등록자 ID)' },
                          registeredByDept: { type: 'string', nullable: true, description: 'Registered by department (등록자 부서 한글)' },
                          team: { type: 'string', nullable: true, description: 'English team name (영문 팀이름)' },
                          center2Name: { type: 'string', nullable: true, description: '1st parent department English name (1차 상위부서 영문)' },
                          center1Name: { type: 'string', nullable: true, description: '2nd parent department English name (2차 상위부서 영문)' },
                          createdAt: { type: 'string', format: 'date-time', description: 'Created at (생성일시)' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { name: 'nexus-coder', displayName: 'Nexus Coder', description: 'AI 코드 리뷰 서비스', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 3.0, savedMM: 1.2, serviceCategory: ['코드개발/분석/검증 지원'], jiraTicket: null, serviceUrl: 'https://nexus.example.com', docsUrl: 'https://docs.example.com/nexus', registeredBy: 'syngha.han', registeredByDept: 'S/W혁신팀(S.LSI)', team: 'S/W Innovation Team', center2Name: 'Platform Technology Center', center1Name: 'none', createdAt: '2025-06-01T09:00:00.000Z' },
                    { name: 'hanseol', displayName: 'Hanseol', description: '한글 문서 자동 생성', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: null, savedMM: null, serviceCategory: ['문서 및 요구사항 지능형 처리', '코드개발/분석/검증 지원'], jiraTicket: 'https://jira.example.com/browse/HS-100', serviceUrl: null, docsUrl: null, registeredBy: 'young87.kim', registeredByDept: 'AI플랫폼팀(DS)', team: 'AI Platform Team', center2Name: 'AI Development Center', center1Name: 'none', createdAt: '2025-07-15T10:30:00.000Z' },
                  ],
                },
              },
            },
          },
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Team Usage for a Specific Service (특정 서비스 팀별 사용량)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/team-usage': {
      get: {
        summary: 'Team Usage for a Specific Service (특정 서비스의 팀별 사용량)',
        description:
          'Returns token usage and API call count **per team (department)** for the specified service within the given date range.\n' +
          '지정된 서비스의 기간 내 **팀(부서)별** 토큰 사용량과 API 호출 수를 반환합니다.\n\n' +
          '- `deptname`: Department name, e.g. `S/W혁신팀(S.LSI)` / 부서명\n' +
          '- `businessUnit`: Auto-extracted from parentheses, e.g. `S.LSI` / 괄호 안 사업부 자동 추출\n' +
          '- Tokens: input, output, and total are all provided / 토큰: 입력/출력/합계 모두 제공\n' +
          '- `uniqueUsers`: Unique user count who used this service in the team / 해당 팀에서 해당 서비스를 사용한 고유 사용자 수',
        tags: ['Team Usage (팀별 사용량)'],
        parameters: [
          apiKeyParam,
          dateParam('startDate', 'Start date', '조회 시작일', '2025-01-01'),
          dateParam('endDate', 'End date', '조회 종료일', '2025-01-31'),
          serviceNameParam(true),
        ],
        responses: {
          '200': {
            description: 'Team usage list (팀별 사용량 목록)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          deptname: { type: 'string', description: 'Department name in TeamName(BusinessUnit) format (부서명, 팀명(사업부) 형식)' },
                          businessUnit: { type: 'string', description: 'Business unit extracted from parentheses (사업부, 괄호 안 추출)' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens (총 입력 토큰)' },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens (총 출력 토큰)' },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output) (총 토큰 = 입력 + 출력)' },
                          requestCount: { type: 'integer', description: 'API call count (API 호출 수)' },
                          uniqueUsers: { type: 'integer', description: 'Unique user count (고유 사용자 수)' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, requestCount: 3200, uniqueUsers: 15 },
                    { deptname: 'AI플랫폼팀(DS)', businessUnit: 'DS', totalInputTokens: 800000, totalOutputTokens: 400000, totalTokens: 1200000, requestCount: 2100, uniqueUsers: 8 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid request (잘못된 요청)', 'serviceName is required (e.g., nexus-coder). serviceName은 필수 파라미터입니다.'),
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. Team Usage for All Services (전체 서비스 팀별 사용량)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/team-usage-all': {
      get: {
        summary: 'Team Usage for All Services (전체 서비스 팀별 사용량)',
        description:
          'Returns token usage and API call count per team × service combination for **all services**.\n' +
          '**모든 서비스**에 대해 팀(부서) × 서비스 별 토큰 사용량과 API 호출 수를 반환합니다.\n\n' +
          'Results are sorted by `deptname` in ascending order. Each row represents one `deptname + serviceName` combination.\n' +
          '결과는 `deptname` 기준 오름차순 정렬되며, 각 행은 하나의 `deptname + serviceName` 조합입니다.\n\n' +
          'To view a specific service only, use `/stats/team-usage`.\n' +
          '특정 서비스만 보려면 `/stats/team-usage`를 사용하세요.',
        tags: ['Team Usage (팀별 사용량)'],
        parameters: [
          apiKeyParam,
          dateParam('startDate', 'Start date', '조회 시작일', '2025-01-01'),
          dateParam('endDate', 'End date', '조회 종료일', '2025-01-31'),
        ],
        responses: {
          '200': {
            description: 'Team × Service usage list (팀 × 서비스 사용량 목록)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          deptname: { type: 'string', description: 'Department name (부서명)' },
                          businessUnit: { type: 'string', description: 'Business unit (사업부)' },
                          serviceName: { type: 'string', description: 'Service system name (서비스 시스템명)' },
                          serviceDisplayName: { type: 'string', description: 'Service display name (서비스 표시명)' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens (총 입력 토큰)' },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens (총 출력 토큰)' },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output) (총 토큰 = 입력 + 출력)' },
                          requestCount: { type: 'integer', description: 'API call count (API 호출 수)' },
                          uniqueUsers: { type: 'integer', description: 'Unique user count (고유 사용자 수)' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', serviceName: 'nexus-coder', serviceDisplayName: 'Nexus Coder', totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, requestCount: 3200, uniqueUsers: 15 },
                    { deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', serviceName: 'hanseol', serviceDisplayName: 'Hanseol', totalInputTokens: 500000, totalOutputTokens: 200000, totalTokens: 700000, requestCount: 1500, uniqueUsers: 8 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid request (잘못된 요청)', 'startDate and endDate are required (format: YYYY-MM-DD). startDate와 endDate는 필수 파라미터입니다. (형식: YYYY-MM-DD)'),
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Top K Users (Top K 사용자)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/top-users': {
      get: {
        summary: 'Top K Users by Service (서비스별 Top K 사용자)',
        description:
          'Returns the **top K users by token usage** and their usage data for the specified service.\n' +
          '지정된 서비스에서 **토큰 사용량 기준 상위 K명**의 사용자 정보와 사용량을 반환합니다.\n\n' +
          '## Parameters (파라미터 설명)\n' +
          '- `topK`: Maximum number of users to return (default: 10, min: 1, max: 100)\n' +
          '  반환할 최대 사용자 수 (기본값: 10, 최소: 1, 최대: 100)\n' +
          '- If total users < topK, returns only as many as exist\n' +
          '  전체 사용자가 topK보다 적으면 존재하는 만큼만 반환\n\n' +
          '## Response Fields (응답 필드)\n' +
          '- `topK`: Requested K value / 요청한 K값\n' +
          '- `totalUsers`: Total users for this service / 해당 서비스의 전체 사용자 수\n' +
          '- `returnedCount`: Actual returned user count (≤ topK) / 실제 반환된 사용자 수\n' +
          '- `data[]`: User info array, sorted by rank / 사용자 정보 배열 (rank 순)\n\n' +
          '## Sort Order (정렬 기준)\n' +
          '`totalTokens` (input + output combined) descending / `totalTokens` (입력 + 출력 합계) 내림차순',
        tags: ['User Usage (사용자별 사용량)'],
        parameters: [
          apiKeyParam,
          dateParam('startDate', 'Start date', '조회 시작일', '2025-01-01'),
          dateParam('endDate', 'End date', '조회 종료일', '2025-01-31'),
          serviceNameParam(true),
          {
            name: 'topK',
            in: 'query',
            required: false,
            description: 'Max users to return (default: 10, min: 1, max: 100). Returns fewer if total users < topK. / 반환할 최대 사용자 수 (기본값: 10). 전체 사용자가 이보다 적으면 존재하는 만큼만 반환',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10, example: 5 },
          },
        ],
        responses: {
          '200': {
            description: 'Top K user list (Top K 사용자 목록)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    topK: { type: 'integer', description: 'Requested K value (요청한 K값)', example: 5 },
                    totalUsers: { type: 'integer', description: 'Total users for this service (해당 서비스의 전체 사용자 수)', example: 42 },
                    returnedCount: { type: 'integer', description: 'Actual returned count. Equals totalUsers if totalUsers < topK (실제 반환된 사용자 수)', example: 5 },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          rank: { type: 'integer', description: 'Rank, starting from 1 (순위, 1부터 시작)', example: 1 },

                          loginId: { type: 'string', description: 'User login ID (employee number) (사용자 로그인 ID, 사번)', example: 'syngha.han' },
                          username: { type: 'string', description: 'User display name (사용자 이름)', example: '한승하' },
                          deptname: { type: 'string', description: 'Department name (부서명)', example: 'S/W혁신팀(S.LSI)' },
                          businessUnit: { type: 'string', description: 'Business unit (사업부)', example: 'S.LSI' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens (총 입력 토큰)', example: 850000 },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens (총 출력 토큰)', example: 420000 },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output) (총 토큰 = 입력 + 출력)', example: 1270000 },
                          requestCount: { type: 'integer', description: 'API call count (API 호출 수)', example: 1580 },
                        },
                      },
                    },
                  },
                },
                example: {
                  topK: 5,
                  totalUsers: 42,
                  returnedCount: 5,
                  data: [
                    { rank: 1, loginId: 'syngha.han', username: '한승하', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, loginId: 'young87.kim', username: '김영수', deptname: 'AI플랫폼팀(DS)', businessUnit: 'DS', totalInputTokens: 720000, totalOutputTokens: 350000, totalTokens: 1070000, requestCount: 1320 },
                    { rank: 3, loginId: 'jieun.park', username: '박지은', deptname: 'DevOps팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 600000, totalOutputTokens: 280000, totalTokens: 880000, requestCount: 950 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid request (잘못된 요청)', 'serviceName is required (e.g., nexus-coder). serviceName은 필수 파라미터입니다.'),
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. Top K Users by Department (부서별 Top K 사용자)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/top-users-by-dept': {
      get: {
        summary: 'Top K Users by Service + Department (서비스 + 부서별 Top K 사용자)',
        description:
          'Returns the **top K users by token usage** for the specified service + department combination.\n' +
          '지정된 서비스 + 부서에서 **토큰 사용량 기준 상위 K명**의 사용자 정보와 사용량을 반환합니다.\n\n' +
          '## Parameters (파라미터 설명)\n' +
          '- `serviceName`: Service name/code (required) / 서비스 코드 (필수)\n' +
          '- `deptname`: Department name in **TeamName(BusinessUnit)** format (required). Example: `S/W혁신팀(S.LSI)`\n' +
          '  부서명, **팀명(사업부)** 형식 (필수). 예: `S/W혁신팀(S.LSI)`\n' +
          '- `topK`: Maximum number of users to return (default: 10, min: 1, max: 100)\n' +
          '  반환할 최대 사용자 수 (기본값: 10, 최소: 1, 최대: 100)\n' +
          '- If total users in the dept < topK, returns only as many as exist\n' +
          '  해당 부서의 전체 사용자가 topK보다 적으면 존재하는 만큼만 반환\n\n' +
          '## Response Fields (응답 필드)\n' +
          '- `topK`: Requested K value / 요청한 K값\n' +
          '- `deptname`: Department name used for filtering / 필터링에 사용된 부서명\n' +
          '- `totalUsersInDept`: Total users in the department / 해당 부서의 전체 사용자 수\n' +
          '- `returnedCount`: Actual returned user count (≤ topK) / 실제 반환된 사용자 수\n\n' +
          '## How to find department names (부서명 확인 방법)\n' +
          'Refer to the `deptname` field in the `/stats/team-usage` API response.\n' +
          '`/stats/team-usage` API의 응답에서 `deptname` 필드를 참고하세요.\n\n' +
          '## Sort Order (정렬 기준)\n' +
          '`totalTokens` (input + output combined) descending / `totalTokens` (입력 + 출력 합계) 내림차순',
        tags: ['User Usage (사용자별 사용량)'],
        parameters: [
          apiKeyParam,
          dateParam('startDate', 'Start date', '조회 시작일', '2025-01-01'),
          dateParam('endDate', 'End date', '조회 종료일', '2025-01-31'),
          serviceNameParam(true),
          {
            name: 'deptname',
            in: 'query',
            required: true,
            description: 'Department name in TeamName(BusinessUnit) format. Use deptname from /stats/team-usage response. / 부서명 (팀명(사업부) 형식). /stats/team-usage 응답의 deptname 값을 사용하세요.',
            schema: { type: 'string', example: 'S/W혁신팀(S.LSI)' },
          },
          {
            name: 'topK',
            in: 'query',
            required: false,
            description: 'Max users to return (default: 10, min: 1, max: 100). Returns fewer if total users < topK. / 반환할 최대 사용자 수 (기본값: 10). 전체 사용자가 이보다 적으면 존재하는 만큼만 반환',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10, example: 3 },
          },
        ],
        responses: {
          '200': {
            description: 'Top K users in the department (부서 내 Top K 사용자 목록)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    topK: { type: 'integer', description: 'Requested K value (요청한 K값)', example: 3 },
                    deptname: { type: 'string', description: 'Queried department name (조회한 부서명)', example: 'S/W혁신팀(S.LSI)' },
                    totalUsersInDept: { type: 'integer', description: 'Total users in the department (해당 부서의 전체 사용자 수)', example: 12 },
                    returnedCount: { type: 'integer', description: 'Actual returned user count (실제 반환된 사용자 수)', example: 3 },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          rank: { type: 'integer', description: 'Rank, starting from 1 (순위, 1부터 시작)', example: 1 },

                          loginId: { type: 'string', description: 'User login ID (employee number) (사용자 로그인 ID, 사번)', example: 'syngha.han' },
                          username: { type: 'string', description: 'User display name (사용자 이름)', example: '한승하' },
                          deptname: { type: 'string', description: 'Department name (부서명)', example: 'S/W혁신팀(S.LSI)' },
                          businessUnit: { type: 'string', description: 'Business unit (사업부)', example: 'S.LSI' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens (총 입력 토큰)', example: 850000 },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens (총 출력 토큰)', example: 420000 },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output) (총 토큰 = 입력 + 출력)', example: 1270000 },
                          requestCount: { type: 'integer', description: 'API call count (API 호출 수)', example: 1580 },
                        },
                      },
                    },
                  },
                },
                example: {
                  topK: 3,
                  deptname: 'S/W혁신팀(S.LSI)',
                  totalUsersInDept: 12,
                  returnedCount: 3,
                  data: [
                    { rank: 1, loginId: 'syngha.han', username: '한승하', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, loginId: 'minjae.lee', username: '이민재', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 620000, totalOutputTokens: 310000, totalTokens: 930000, requestCount: 1120 },
                    { rank: 3, loginId: 'suji.choi', username: '최수지', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 480000, totalOutputTokens: 220000, totalTokens: 700000, requestCount: 890 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid request (잘못된 요청)', 'deptname is required (format: TeamName(BusinessUnit), e.g. S/W혁신팀(S.LSI)). deptname은 필수 파라미터입니다.'),
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 6. DAU / MAU per Service (서비스별 DAU / MAU)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/dau-mau': {
      get: {
        summary: 'DAU / MAU per Service by Year-Month (서비스별 DAU / MAU, 년/월 기준)',
        description:
          'Returns DAU (Daily Active Users) and MAU (Monthly Active Users) for **deployed services** (status=DEPLOYED) for the specified year/month.\n' +
          '지정된 연도/월에 대해 **배포 완료(status=DEPLOYED)** 서비스의 DAU(일간 활성 사용자)와 MAU(월간 활성 사용자)를 반환합니다.\n' +
          'Includes full service metadata (category, targetMM, URLs, etc.). Services in DEVELOPMENT status are excluded.\n' +
          '서비스 메타데이터(카테고리, 목표MM, URL 등)가 포함됩니다. 개발 중(DEVELOPMENT) 상태의 서비스는 제외됩니다.\n\n' +
          '## Calculation Method by Service Type (서비스 타입별 산출 방식)\n\n' +
          '| Type 타입 | DAU | MAU |\n' +
          '|-----------|-----|-----|\n' +
          '| **STANDARD** | Directly counted unique users on business days / 영업일 기준 고유 사용자 직접 집계 | Directly counted unique users in the month / 월간 고유 사용자 직접 집계 |\n' +
          '| **BACKGROUND** | Estimated DAU (see formula below) / 추정 DAU (아래 산식 참조) | Estimated MAU (see formula below) / 추정 MAU (아래 산식 참조) |\n\n' +
          '## Estimation Formula for BACKGROUND Services (BACKGROUND 서비스 추정 산식)\n\n' +
          'BACKGROUND services do not send user identification headers (`x-user-id`), so DAU/MAU cannot be measured directly. ' +
          'Instead, we derive "average API calls per person" from STANDARD services and use it to estimate.\n\n' +
          'BACKGROUND 서비스는 사용자 식별 헤더(`x-user-id`)를 전송하지 않으므로 DAU/MAU를 직접 측정할 수 없습니다. ' +
          'STANDARD 서비스 데이터에서 "1인당 평균 API 호출 수"를 산출하여 역으로 추정합니다.\n\n' +
          '### Estimated DAU (추정 DAU)\n' +
          '1. `Avg API calls per person per day` = Avg daily API calls of all STANDARD services (business days, **same month**) / Avg daily DAU of all STANDARD services (**same month**)\n' +
          '   `1인당 하루 평균 API 호출 수` = STANDARD 전체 **해당 월** 영업일 하루 평균 API 호출 수 ÷ STANDARD 전체 **해당 월** 영업일 하루 평균 DAU\n' +
          '2. `Estimated DAU` = Avg daily API calls of the BACKGROUND service (business days) / Avg API calls per person per day\n' +
          '   `추정 DAU` = 해당 BACKGROUND 서비스의 영업일 하루 평균 API 호출 수 ÷ 1인당 하루 평균 API 호출 수\n\n' +
          '### Estimated MAU (추정 MAU)\n' +
          '1. `Avg API calls per person per month` = Total API calls of all STANDARD services **in the same month** / MAU of all STANDARD services **in the same month**\n' +
          '   `1인당 월 평균 API 호출 수` = STANDARD 전체 **해당 월** 총 API 호출 수 ÷ STANDARD 전체 **해당 월** MAU\n' +
          '2. `Estimated MAU` = Total API calls of the BACKGROUND service in the month / Avg API calls per person per month\n' +
          '   `추정 MAU` = 해당 BACKGROUND 서비스의 해당 월 총 API 호출 수 ÷ 1인당 월 평균 API 호출 수\n\n' +
          '## Baseline Period (기준 기간)\n\n' +
          '- **Past months (지난 달)**: Baseline uses that month\'s complete data → **fixed value** (조회 시점에 관계없이 동일)\n' +
          '- **Current month (이번 달)**: Baseline uses accumulated data so far → **real-time** (매일 점점 정확해짐)\n\n' +
          '> All dates/times are in **KST (Asia/Seoul)**.\n' +
          '> 모든 날짜/시간은 **KST (한국 표준시)** 기준입니다.\n\n' +
          '> BACKGROUND services include `isEstimated: true` and `estimationDetail` in the response.\n' +
          '> BACKGROUND 서비스의 응답에는 `isEstimated: true`와 `estimationDetail`이 포함됩니다.\n\n' +
          '> Response includes `estimationBaseline` with the baseline values used for estimation.\n' +
          '> 응답에 추정에 사용된 기준값이 `estimationBaseline`으로 포함됩니다.\n\n' +
          '## API Only Services (API Only 서비스)\n\n' +
          'API Only services use `POST /external-usage/by-user` to submit per-user usage data. ' +
          'Records are stored in usage_logs (same table as proxy services), so DAU/MAU is calculated identically to proxy services.\n' +
          'API Only 서비스는 `POST /external-usage/by-user`를 통해 사용자별 사용 데이터를 전송합니다. ' +
          'usage_logs(프록시 서비스와 동일한 테이블)에 기록되므로 DAU/MAU가 프록시 서비스와 동일하게 산출됩니다.',
        tags: ['DAU / MAU'],
        parameters: [
          apiKeyParam,
          {
            name: 'year',
            in: 'query',
            required: true,
            description: 'Year to query, 2000-2100 (조회 연도, 2000~2100)',
            schema: { type: 'integer', minimum: 2000, maximum: 2100, example: 2026 },
          },
          {
            name: 'month',
            in: 'query',
            required: true,
            description: 'Month to query, 1-12 (조회 월, 1~12)',
            schema: { type: 'integer', minimum: 1, maximum: 12, example: 3 },
          },
        ],
        responses: {
          '200': {
            description: 'DAU/MAU list per service (서비스별 DAU/MAU 목록)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    year: { type: 'integer', description: 'Queried year (조회 연도)', example: 2026 },
                    month: { type: 'integer', description: 'Queried month (조회 월)', example: 3 },
                    isCurrentMonth: { type: 'boolean', description: 'Whether this is the current month (이번 달 여부). true=real-time, false=fixed (true=실시간, false=확정)' },
                    estimationBaseline: {
                      type: 'object',
                      description: 'STANDARD baseline values used for BACKGROUND estimation (BACKGROUND 추정에 사용된 STANDARD 기준값)',
                      properties: {
                        callsPerPersonPerDay: { type: 'number', description: 'Avg calls per person per day (1인당 하루 평균 호출 수)' },
                        callsPerPersonPerMonth: { type: 'number', description: 'Avg calls per person per month (1인당 월 평균 호출 수)' },
                        standardAvgDailyDAU: { type: 'integer', description: 'STANDARD avg daily DAU (STANDARD 영업일 평균 DAU)' },
                        standardMAU: { type: 'integer', description: 'STANDARD MAU for the month (STANDARD 월간 MAU)' },
                        standardTotalCalls: { type: 'integer', description: 'STANDARD total calls for the month (STANDARD 월 총 호출 수)' },
                        isFixed: { type: 'boolean', description: 'Whether baseline is fixed (past month) or real-time (current month) (확정 여부)' },
                      },
                    },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', description: 'Service system name (서비스 시스템명)' },
                          displayName: { type: 'string', description: 'Service display name (서비스 표시명)' },
                          description: { type: 'string', nullable: true, description: 'Service description (서비스 설명)' },
                          type: { type: 'string', enum: ['STANDARD', 'BACKGROUND'], description: 'Service type (서비스 타입)' },
                          status: { type: 'string', enum: ['DEPLOYED'], description: 'Always DEPLOYED (항상 DEPLOYED)' },
                          enabled: { type: 'boolean', description: 'Active status (활성 상태)' },
                          targetMM: { type: 'number', nullable: true, description: 'Target MM (Men/Month). null if not set (목표 MM. 미설정 시 null)' },
                          savedMM: { type: 'number', nullable: true, description: 'Saved MM (Men/Month). null if not set (절감 실적 MM. 미설정 시 null)' },
                          serviceCategory: { type: 'array', items: { type: 'string' }, description: 'Service categories (서비스 카테고리)' },
                          jiraTicket: { type: 'string', nullable: true, description: 'Jira ticket URL' },
                          serviceUrl: { type: 'string', nullable: true, description: 'Service URL (서비스 URL)' },
                          docsUrl: { type: 'string', nullable: true, description: 'API docs URL (API 문서 URL)' },
                          registeredBy: { type: 'string', nullable: true, description: 'Registered by (등록자 ID)' },
                          registeredByDept: { type: 'string', nullable: true, description: 'Registered by dept (등록자 부서 한글)' },
                          team: { type: 'string', nullable: true, description: 'English team name (영문 팀이름)' },
                          center2Name: { type: 'string', nullable: true, description: '1st parent dept English (1차 상위부서 영문)' },
                          center1Name: { type: 'string', nullable: true, description: '2nd parent dept English (2차 상위부서 영문)' },
                          createdAt: { type: 'string', format: 'date-time', description: 'Created at (생성일시)' },
                          totalCallCount: { type: 'integer', description: 'Total API call count in the month (해당 월 총 API 호출 수)' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens in the month (해당 월 총 입력 토큰)' },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens in the month (해당 월 총 출력 토큰)' },
                          totalTokens: { type: 'integer', description: 'Total tokens (input+output) in the month (해당 월 총 토큰 = 입력 + 출력)' },
                          dau: { type: 'integer', description: 'Business-day avg DAU. STANDARD=actual, BACKGROUND=estimated (영업일 평균 DAU. STANDARD=실측, BACKGROUND=추정)' },
                          mau: { type: 'integer', description: 'MAU. STANDARD=actual, BACKGROUND=estimated (MAU. STANDARD=실측, BACKGROUND=추정)' },
                          isEstimated: { type: 'boolean', description: 'Whether the value is estimated. true for BACKGROUND (추정값 여부. BACKGROUND=true)' },
                          estimationDetail: {
                            type: 'object',
                            nullable: true,
                            description: 'Only for BACKGROUND services. Estimation basis (BACKGROUND 서비스만 포함. 추정 산출 근거)',
                            properties: {
                              avgDailyApiCalls: { type: 'integer', description: 'Avg daily API calls of this service on business days (해당 서비스 영업일 하루 평균 API 호출 수)' },
                              totalMonthlyApiCalls: { type: 'integer', description: 'Total API calls of this service in the month (해당 서비스 해당 월 총 API 호출 수)' },
                              avgCallsPerPersonPerDay: { type: 'number', description: 'STANDARD baseline: avg calls per person per day (STANDARD 기준 1인당 하루 평균 호출 수)' },
                              avgCallsPerPersonPerMonth: { type: 'number', description: 'STANDARD baseline: avg calls per person per month (STANDARD 기준 1인당 월 평균 호출 수)' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                example: {
                  year: 2026,
                  month: 3,
                  data: [
                    { name: 'nexus-coder', displayName: 'Nexus Coder', description: 'AI 코드 리뷰 서비스', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 3.0, savedMM: 1.2, serviceCategory: ['코드개발/분석/검증 지원'], jiraTicket: null, serviceUrl: 'https://nexus.example.com', docsUrl: null, registeredBy: 'syngha.han', registeredByDept: 'S/W혁신팀(S.LSI)', team: 'S/W Innovation Team', center2Name: 'Platform Technology Center', center1Name: 'none', createdAt: '2025-06-01T09:00:00.000Z', totalCallCount: 3200, totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, dau: 45, mau: 128, isEstimated: false },
                    { name: 'auto-review', displayName: 'Auto Review Bot', description: '자동 코드 리뷰 봇', type: 'BACKGROUND', status: 'DEPLOYED', enabled: true, targetMM: null, savedMM: null, serviceCategory: ['코드개발/분석/검증 지원'], jiraTicket: 'https://jira.example.com/browse/AR-1', serviceUrl: null, docsUrl: null, registeredBy: 'young87.kim', registeredByDept: 'AI플랫폼팀(DS)', team: 'AI Platform Team', center2Name: 'AI Development Center', center1Name: 'none', createdAt: '2025-07-15T10:30:00.000Z', totalCallCount: 5060, totalInputTokens: 800000, totalOutputTokens: 400000, totalTokens: 1200000, dau: 15, mau: 33, isEstimated: true, estimationDetail: { avgDailyApiCalls: 230, totalMonthlyApiCalls: 5060, avgCallsPerPersonPerDay: 15.3, avgCallsPerPersonPerMonth: 152.4 } },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid request (잘못된 요청)', 'year(2000~2100) and month(1~12) are required (e.g., year=2026&month=3). year(2000~2100)와 month(1~12)는 필수 파라미터입니다.'),
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 7. External Usage - POST by-user (API Only 서비스 사용자별 사용 기록 전송)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 8. Insight — AI Usage Rate & Service Usage (센터별/서비스별 인사이트)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/insight_ai_usage_rate': {
      get: {
        summary: 'AI Usage Rate by Center (센터별 AI 활용율)',
        description: `센터별 AI 활용율 대시보드 데이터.\n\n## 센터 그룹핑 규칙\n- center1 또는 center2에 SOC/LSI/Sensor Business Team → 해당 Business Team 하위로 그룹\n- center1 또는 center2가 SSCR, 또는 팀명에 / 포함 (단 S/W, H/W 등 약어 제외) → "Overseas R&D Center"\n- center1 또는 center2에 System LSI Business → "Direct"\n- 그 외 → 집계 제외\n\nSaved M/M 기준 내림차순 정렬.\nS.LSI 사업부 소속 부서만 집계됩니다.`,
        tags: ['Insight'],
        parameters: [apiKeyParam, yearParam, monthParam],
        responses: {
          '200': {
            description: 'Center-level usage rate data',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    month: { type: 'string' as const, description: 'Data period (YYYY-MM)', example: '2026-02' },
                    centers: {
                      type: 'array' as const,
                      items: {
                        type: 'object' as const,
                        properties: {
                          name: { type: 'string' as const, description: 'Center name (English)' },
                          totalMau: { type: 'integer' as const, description: 'Total MAU across all teams in this center (last month)' },
                          mauChangePercent: { type: 'number' as const, description: '% change vs previous month' },
                          totalSavedMM: { type: 'number' as const, description: 'Total Saved M/M across all teams' },
                          teamCount: { type: 'integer' as const, description: 'Number of teams in this center' },
                        },
                      },
                    },
                  },
                },
                example: {
                  month: '2026-02',
                  centers: [
                    { name: 'SOC Business Team', totalMau: 320, mauChangePercent: 8.3, totalSavedMM: 15.2, teamCount: 5 },
                    { name: 'LSI Business Team', totalMau: 210, mauChangePercent: -2.1, totalSavedMM: 10.8, teamCount: 4 },
                    { name: 'Overseas R&D Center', totalMau: 95, mauChangePercent: 15.0, totalSavedMM: 3.5, teamCount: 8 },
                    { name: 'Direct', totalMau: 45, mauChangePercent: 0, totalSavedMM: 1.2, teamCount: 3 },
                  ],
                },
              },
            },
          },
          '500': errorResponse('Internal server error'),
        },
      },
    },
    '/stats/insight_ai_usage_rate/{centerName}': {
      get: {
        summary: 'AI Usage Rate - Center Detail (센터 상세)',
        description: `특정 센터의 상세 데이터.\n\n## Returns\n- teamMauChart: 팀별 MAU 비교\n- monthlyTrend: 6개월 MAU 추이\n- teamTokenChart: 팀별 토큰 사용량\n- monthlyTokenTrend: 6개월 토큰 추이\n\n## Overseas R&D Center\nOverseas R&D Center 상세 조회 시, 개별 팀이 아닌 서브그룹으로 집계됩니다:\n- 팀명에 / 포함 (S/W 등 약어 제외) → 마지막 / 뒤 연구소명 (예: Wi-Fi Firmware/SCSC → SCSC)\n- center1 또는 center2가 SSCR → "SSCR"`,
        tags: ['Insight'],
        parameters: [
          apiKeyParam, yearParam, monthParam,
          { name: 'centerName', in: 'path' as const, required: true, description: 'Center name (URL-encoded)', schema: { type: 'string' as const, example: 'SOC Business Team' } },
        ],
        responses: {
          '200': {
            description: 'Center detail data',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    centerName: { type: 'string' as const },
                    period: { type: 'string' as const },
                    data: {
                      type: 'array' as const,
                      description: '팀별 MAU + 토큰 사용량 (합산)',
                      items: {
                        type: 'object' as const,
                        properties: {
                          teamName: { type: 'string' as const },
                          mau: { type: 'integer' as const },
                          tokens: { type: 'integer' as const },
                        },
                      },
                    },
                    monthlyTrend: {
                      type: 'array' as const,
                      description: '월별 MAU + 토큰 추이 (6개월)',
                      items: {
                        type: 'object' as const,
                        properties: {
                          month: { type: 'string' as const },
                          mau: { type: 'integer' as const },
                          tokens: { type: 'integer' as const },
                        },
                      },
                    },
                    teamServices: {
                      type: 'array' as const,
                      description: '팀×서비스 상세 (서비스별 Saved M/M, MAU, LLM Calls)',
                      items: {
                        type: 'object' as const,
                        properties: {
                          team: { type: 'string' as const },
                          serviceDisplayName: { type: 'string' as const },
                          serviceType: { type: 'string' as const, enum: ['STANDARD', 'BACKGROUND'] },
                          savedMM: { type: 'number' as const, nullable: true },
                          mau: { type: 'integer' as const },
                          llmCallCount: { type: 'integer' as const },
                        },
                      },
                    },
                  },
                },
                example: {
                  centerName: 'SOC Business Team',
                  period: '2026-03',
                  data: [
                    { teamName: 'SOC IP Development Team(S.LSI)', mau: 180, tokens: 2518671596 },
                    { teamName: 'AP S/W Development Team(S.LSI)', mau: 147, tokens: 2850520335 },
                    { teamName: 'CP S/W Development Team(S.LSI)', mau: 113, tokens: 1852541211 },
                    { teamName: 'SOC Platform Development Team(S.LSI)', mau: 83, tokens: 758817865 },
                    { teamName: 'Connectivity Development Team', mau: 58, tokens: 1276602303 },
                  ],
                  monthlyTrend: [
                    { month: '2025-09', mau: 1, tokens: 147011 },
                    { month: '2025-10', mau: 0, tokens: 0 },
                    { month: '2025-11', mau: 1, tokens: 49261358 },
                    { month: '2025-12', mau: 5, tokens: 5853666 },
                    { month: '2026-01', mau: 3, tokens: 6512 },
                    { month: '2026-02', mau: 284, tokens: 5361651229 },
                  ],
                  teamServices: [
                    { team: 'SOC IP Development Team(S.LSI)', serviceDisplayName: 'Roo Code', serviceType: 'STANDARD', savedMM: 3.5, mau: 120, llmCallCount: 45000 },
                    { team: 'AP S/W Development Team(S.LSI)', serviceDisplayName: 'Claude Code', serviceType: 'STANDARD', savedMM: 1.2, mau: 60, llmCallCount: 18000 },
                  ],
                },
              },
            },
          },
          '404': errorResponse('Center not found'),
          '500': errorResponse('Internal server error'),
        },
      },
    },
    '/stats/insight_service_usage': {
      get: {
        summary: 'Service Usage by LLM Calls (서비스별 LLM 호출 순위)',
        description: `모든 배포된 서비스를 LLM 호출 수 기준으로 정렬.\n카드: LLM Call Count, Token Usage (input/output/total), MAU.\n\nAll deployed services sorted by LLM call count (descending).\nReturns per-service: call count, token usage breakdown, MAU.\n\nS.LSI 사업부 소속 사용자 기준 집계.`,
        tags: ['Insight'],
        parameters: [apiKeyParam, yearParam, monthParam],
        responses: {
          '200': {
            description: 'Service usage data sorted by LLM calls',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    month: { type: 'string' as const, example: '2026-02' },
                    services: {
                      type: 'array' as const,
                      items: {
                        type: 'object' as const,
                        properties: {
                          displayName: { type: 'string' as const, description: 'Service display name' },
                          llmCallCount: { type: 'integer' as const },
                          tokenUsage: {
                            type: 'object' as const,
                            properties: {
                              input: { type: 'integer' as const },
                              output: { type: 'integer' as const },
                              total: { type: 'integer' as const },
                            },
                          },
                          mau: { type: 'integer' as const },
                        },
                      },
                    },
                  },
                },
                example: {
                  month: '2026-02',
                  services: [
                    { displayName: 'Nexus Coder', llmCallCount: 5200, tokenUsage: { input: 2500000, output: 1500000, total: 4000000 }, mau: 45 },
                  ],
                },
              },
            },
          },
          '500': errorResponse('Internal server error'),
        },
      },
    },
    '/stats/insight_service_usage/{serviceName}': {
      get: {
        summary: 'Service Usage - Team Token Breakdown (팀별 토큰 사용량)',
        description: `특정 서비스의 팀별 토큰 사용량 (지난달).\n팀명 영어, 토큰 단위: M (millions).\n\nPer-team token usage for a specific service.\nTeam names in English. Token values in millions.`,
        tags: ['Insight'],
        parameters: [
          apiKeyParam, yearParam, monthParam,
          { name: 'serviceName', in: 'path' as const, required: true, description: 'Service display name (URL-encoded)', schema: { type: 'string' as const, example: 'Nexus Coder (CLI)' } },
        ],
        responses: {
          '200': {
            description: 'Team-level token usage',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    displayName: { type: 'string' as const, description: 'Service display name' },
                    period: { type: 'string' as const },
                    teamTokens: {
                      type: 'array' as const,
                      items: {
                        type: 'object' as const,
                        properties: {
                          team: { type: 'string' as const, description: 'English team name' },
                          teamKr: { type: 'string' as const, description: 'Korean department name' },
                          tokensM: { type: 'number' as const, description: 'Total tokens in millions' },
                          mau: { type: 'integer' as const, description: 'Monthly active users' },
                          llmCallCount: { type: 'integer' as const, description: 'LLM call count' },
                        },
                      },
                    },
                  },
                },
                example: {
                  displayName: 'Nexus Coder',
                  period: '2026-03',
                  teamDetails: [
                    { team: 'SW Innovation Team', teamKr: 'S/W혁신팀(S.LSI)', tokensM: 1.52, mau: 8, llmCallCount: 2542 },
                    { team: 'Platform Team', teamKr: '플랫폼팀(S.LSI)', tokensM: 0.83, mau: 3, llmCallCount: 450 },
                  ],
                },
              },
            },
          },
          '404': errorResponse('Service not found'),
          '500': errorResponse('Internal server error'),
        },
      },
    },
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 10. DTGPT Server — Daily Service Usage (일별 서비스 사용량)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/dtgpt/service-usage': {
      get: {
        summary: 'DTGPT Server — Daily Service Usage (일별 서비스별 토큰 사용량)',
        description:
          'Returns **daily token usage** per service for the given month.\n' +
          '해당 월의 **일별** 서비스별 토큰 사용량을 반환합니다.\n\n' +
          '## Scope\n' +
          '- G1+G2 개별 서비스별 집계, G3−G2에 해당하는 나머지는 "기타"로 합산\n' +
          '- Each day lists service displayName → { inputTokens, outputTokens, totalTokens }\n',
        tags: ['DTGPT Server Usage (DTGPT 서버 사용량)'],
        parameters: [
          apiKeyParam,
          { name: 'year', in: 'query' as const, required: true, description: 'Year (2000-2100)', schema: { type: 'integer' as const, example: 2026 } },
          { name: 'month', in: 'query' as const, required: true, description: 'Month (1-12)', schema: { type: 'integer' as const, minimum: 1, maximum: 12, example: 3 } },
        ],
        responses: {
          '200': {
            description: 'Daily service usage / 일별 서비스별 사용량',
            content: {
              'application/json': {
                example: {
                  year: 2026, month: 3,
                  server: 'http://cloud.dtgpt.samsunds.net/llm/v1',
                  fixedServices: ['roocode', 'dify', 'openwebui', 'claudecode'],
                  data: [
                    { date: '2026-03-01', services: { 'Roo Code': { inputTokens: 200000, outputTokens: 150000, totalTokens: 350000 }, 'Claude Code': { inputTokens: 80000, outputTokens: 40000, totalTokens: 120000 }, '기타': { inputTokens: 30000, outputTokens: 12000, totalTokens: 42000 } } },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid year/month', 'year(2000~2100)와 month(1~12)는 필수입니다.'),
          '500': errorResponse('Internal server error'),
        },
      },
    },
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 10. DTGPT Server — Daily Total Token Usage (해당월 일별 총 토큰 사용량)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/dtgpt/token-usage': {
      get: {
        summary: 'DTGPT Server — Daily Total Token Usage (해당월 일별 총 토큰 사용량)',
        description:
          'Returns **daily total input/output/total tokens** for the given month.\n' +
          '해당 월의 **일별** 총 input/output/total 토큰 사용량을 반환합니다.\n\n' +
          '## Scope (집계 범위)\n' +
          '- **Services**: roocode, dify, openwebui, claudecode, api (G1+G3)\n' +
          '- **Models**: `cloud.dtgpt.samsunds.net` endpoint models only\n',
        tags: ['DTGPT Server Usage (DTGPT 서버 사용량)'],
        parameters: [
          apiKeyParam,
          { name: 'year', in: 'query' as const, required: true, description: 'Year (2000-2100)', schema: { type: 'integer' as const, example: 2026 } },
          { name: 'month', in: 'query' as const, required: true, description: 'Month (1-12)', schema: { type: 'integer' as const, minimum: 1, maximum: 12, example: 3 } },
        ],
        responses: {
          '200': {
            description: 'Daily total token usage / 일별 총 토큰 사용량',
            content: {
              'application/json': {
                example: {
                  year: 2026, month: 3,
                  server: 'http://cloud.dtgpt.samsunds.net/llm/v1',
                  fixedServices: ['roocode', 'dify', 'openwebui', 'claudecode'],
                  data: [
                    { date: '2026-03-01', inputTokens: 500000, outputTokens: 350000, totalTokens: 850000 },
                    { date: '2026-03-02', inputTokens: 620000, outputTokens: 410000, totalTokens: 1030000 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid year/month', 'year(2000~2100)와 month(1~12)는 필수입니다.'),
          '500': errorResponse('Internal server error / 서버 내부 오류'),
        },
      },
    },
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 9. External Usage - POST by-user (API Only 서비스 사용자별 사용 기록 전송)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // GPU Power Usage (DT GPU 전력 사용률)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/gpu-power': {
      servers: [{ url: '/api', description: 'GPU Power API (No Auth)' }],
      post: {
        summary: 'Register/Update GPU Power Usage (GPU 전력 사용률 등록/업데이트)',
        description:
          'Upsert hourly average GPU power usage ratio. Minutes and seconds are truncated to the hour (e.g. 14:35:20 → 14:00:00). If the same hour exists, the value is overwritten.\n' +
          '시간별 GPU 평균 전력 사용률을 등록합니다. 분/초는 시간 단위로 정규화됩니다 (예: 14:35:20 → 14:00:00). 동일 시각이 존재하면 값이 덮어씌워집니다.\n\n' +
          '**Authentication**: None (인증 불필요)',
        tags: ['GPU Power Usage (DT GPU 전력 사용률)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['timestamp', 'power_avg_usage_ratio'],
                properties: {
                  timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 datetime (truncated to hour) / 시각 (시간 단위로 정규화)', example: '2026-03-27T14:00:00Z' },
                  power_avg_usage_ratio: { type: 'number', minimum: 0, maximum: 100, description: 'Average GPU power usage ratio (%) / GPU 평균 전력 사용률 (%)', example: 72.35 },
                },
              },
              examples: {
                'normal': {
                  summary: 'Normal usage / 일반 사용률',
                  value: { timestamp: '2026-03-27T14:00:00Z', power_avg_usage_ratio: 72.35 },
                },
                'high': {
                  summary: 'High usage / 높은 사용률',
                  value: { timestamp: '2026-03-27T09:00:00Z', power_avg_usage_ratio: 95.12 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Saved successfully / 저장 성공',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'GPU power usage saved' },
                    data: {
                      type: 'object',
                      properties: {
                        timestamp: { type: 'string', format: 'date-time', example: '2026-03-27T14:00:00.000Z' },
                        power_avg_usage_ratio: { type: 'number', example: 72.35 },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': errorResponse('Invalid request (잘못된 요청)', 'timestamp must be a valid ISO 8601 datetime'),
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
      get: {
        summary: 'Get Recent 7 Days GPU Power Usage (최근 7일 GPU 전력 사용률 조회)',
        description:
          'Returns hourly GPU power usage data for the last 7 days (up to 168 records), sorted by timestamp ascending.\n' +
          '최근 7일간의 시간별 GPU 전력 사용률 데이터를 시각 오름차순으로 반환합니다 (최대 168건).\n\n' +
          '**Authentication**: None (인증 불필요)',
        tags: ['GPU Power Usage (DT GPU 전력 사용률)'],
        responses: {
          '200': {
            description: 'Success / 성공',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string', format: 'date-time', example: '2026-03-27T14:00:00.000Z' },
                          power_avg_usage_ratio: { type: 'number', example: 72.35 },
                        },
                      },
                    },
                  },
                },
                examples: {
                  'sample': {
                    summary: 'Sample response / 예시 응답',
                    value: {
                      data: [
                        { timestamp: '2026-03-27T09:00:00.000Z', power_avg_usage_ratio: 65.20 },
                        { timestamp: '2026-03-27T10:00:00.000Z', power_avg_usage_ratio: 71.50 },
                        { timestamp: '2026-03-27T11:00:00.000Z', power_avg_usage_ratio: 72.35 },
                      ],
                    },
                  },
                },
              },
            },
          },
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },

    '/external-usage/by-user': {
      servers: [{ url: '/api', description: 'External Usage API' }],
      post: {
        summary: 'Submit Usage by User (사용자별 사용 기록 전송) — Recommended / 권장',
        description:
          'Submit daily usage records. Supports both user-level (STANDARD) and service-level (BACKGROUND) tracking.\n' +
          '일별 사용 기록을 전송합니다. 사용자 단위(STANDARD)와 서비스 단위(BACKGROUND) 모두 지원합니다.\n\n' +
          'Records are stored in the **same table (usage_logs)** as proxy services, ' +
          'enabling cross-service unique user deduplication, Top K Users ranking, and all other dashboard statistics.\n' +
          '프록시 서비스와 **동일한 테이블(usage_logs)** 에 기록되어 ' +
          '통합 대시보드 사용자 중복제거, Top K Users 등 모든 통계에 자연스럽게 반영됩니다.\n\n' +
          '## Service Type Rules (서비스 타입별 필수 필드)\n' +
          '| Field | STANDARD | BACKGROUND |\n' +
          '|-------|----------|------------|\n' +
          '| `userId` | **필수** | 선택 |\n' +
          '| `deptName` | 선택 (Knox 자동) | userId 없으면 **필수** |\n\n' +
          '## Key Features (주요 특징)\n' +
          '- **User-level granularity**: Per-user (Knox ID) tracking / 사용자(Knox ID) 단위 추적\n' +
          '- **Service-level**: BACKGROUND services can submit without userId / BACKGROUND 서비스는 userId 없이 전송 가능\n' +
          '- **Cross-service dedup**: Unique user deduplication across services / 서비스 간 사용자 중복제거 가능\n' +
          '- **Auto dept info**: Department info auto-resolved from Knox API (when userId provided) / userId 제공 시 Knox API에서 부서 정보 자동 조회\n\n' +
          '## Processing Flow (처리 흐름)\n' +
          '1. `userId` (Knox ID) → Look up User in DB / DB User 조회 (userId 있는 항목만)\n' +
          '2. Unregistered/unverified → Batch Knox Employee API lookup → Auto-register User / 미등록/미인증 → Knox Employee API 일괄 조회 → User 자동 등록\n' +
          '3. `modelName` → Match via ServiceModel alias → Fallback to Model.name / ServiceModel alias 매칭 → Model.name fallback\n' +
          '4. UsageLog upsert `(date, userId, modelId, serviceId)` — same key = overwrite / 동일 키 = 덮어쓰기\n' +
          '5. UserService upsert (user-service relationship tracking / user-service 관계 추적, userId 있는 항목만)\n\n' +
          '## Partial Success (부분 성공)\n' +
          'If some users fail Knox verification or some models are unregistered, ' +
          'only those records are skipped — the rest are processed normally. ' +
          'Check `warnings` in the response for details.\n' +
          '일부 사용자의 Knox 인증 실패나 모델 미등록 시 해당 레코드만 스킵되고 나머지는 정상 처리됩니다. ' +
          '응답의 `warnings`에서 상세 사유를 확인하세요.\n\n' +
          '## Prerequisites (사전 조건)\n' +
          '- Service must be registered with `apiOnly: true` and deployed / 서비스가 `apiOnly: true`로 등록 + 배포 상태\n' +
          '- Models must be registered as **ServiceModel alias** for the service / 서비스에 **ServiceModel alias**로 모델 등록 필요\n' +
          '- Users must be active Samsung employees (재직/휴직) / 사용자는 재직 또는 휴직 상태의 삼성 임직원',
        tags: ['External Usage (API Only 사용 기록)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['serviceId', 'data'],
                properties: {
                  serviceId: {
                    type: 'string',
                    description: 'Service name (not UUID) / 서비스 이름 (UUID 아님)',
                    example: 'my-api-service',
                  },
                  data: {
                    type: 'array',
                    description: 'Array of per-user daily usage records (max 5000) / 사용자별 일별 사용 기록 배열 (최대 5000건)',
                    items: {
                      type: 'object',
                      required: ['date', 'modelName', 'requestCount', 'totalInputTokens', 'totalOutputTokens'],
                      properties: {
                        date: {
                          type: 'string', format: 'date',
                          description: 'Usage date (YYYY-MM-DD). Must be a valid calendar date. / 사용 날짜 (유효한 날짜여야 함)',
                          example: '2026-03-15',
                        },
                        userId: {
                          type: 'string',
                          description: '**STANDARD: 필수** / BACKGROUND: 선택. Knox login ID. Unregistered users are auto-registered via Knox Employee API. / Knox 로그인 ID (사번 아이디). 미등록 사용자는 Knox API로 자동 등록',
                          example: 'hong.gildong',
                        },
                        deptName: {
                          type: 'string',
                          description: 'STANDARD: 선택 / **BACKGROUND: userId 없으면 필수**. Department name / 부서명. 예: "S/W혁신팀(S.LSI)"',
                          example: 'S/W혁신팀(S.LSI)',
                        },
                        modelName: {
                          type: 'string',
                          description: 'ServiceModel alias name (priority) or global Model.name (fallback) / ServiceModel alias (우선) 또는 전역 Model.name (fallback)',
                          example: 'gpt-4o',
                        },
                        requestCount: {
                          type: 'integer',
                          description: 'Total LLM API request count for this user/model/date / 해당 날짜/사용자/모델의 총 LLM API 요청 수',
                          example: 50,
                        },
                        totalInputTokens: {
                          type: 'integer',
                          description: 'Total input tokens consumed / 총 입력 토큰',
                          example: 100000,
                        },
                        totalOutputTokens: {
                          type: 'integer',
                          description: 'Total output tokens consumed / 총 출력 토큰',
                          example: 50000,
                        },
                      },
                    },
                  },
                },
              },
              examples: {
                'multi-user': {
                  summary: 'Multiple users, multiple dates (여러 사용자, 여러 날짜)',
                  value: {
                    serviceId: 'my-api-service',
                    data: [
                      { date: '2026-03-15', userId: 'hong.gildong', modelName: 'gpt-4o', requestCount: 50, totalInputTokens: 100000, totalOutputTokens: 50000 },
                      { date: '2026-03-15', userId: 'kim.chulsu', modelName: 'gpt-4o', requestCount: 30, totalInputTokens: 60000, totalOutputTokens: 30000 },
                      { date: '2026-03-16', userId: 'hong.gildong', modelName: 'claude-sonnet', requestCount: 20, totalInputTokens: 40000, totalOutputTokens: 20000 },
                    ],
                  },
                },
                'single-user': {
                  summary: 'Single user correction / 단일 사용자 정정',
                  value: {
                    serviceId: 'my-api-service',
                    data: [
                      { date: '2026-03-15', userId: 'hong.gildong', modelName: 'gpt-4o', requestCount: 55, totalInputTokens: 110000, totalOutputTokens: 55000 },
                    ],
                  },
                },
                'background-service': {
                  summary: 'BACKGROUND service (no userId, deptName required) / 백그라운드 서비스 (userId 없이 deptName 필수)',
                  value: {
                    serviceId: 'my-background-service',
                    data: [
                      { date: '2026-03-15', deptName: 'S/W혁신팀(S.LSI)', modelName: 'gpt-4o', requestCount: 100, totalInputTokens: 200000, totalOutputTokens: 100000 },
                      { date: '2026-03-16', deptName: 'S/W혁신팀(S.LSI)', modelName: 'claude-sonnet', requestCount: 50, totalInputTokens: 80000, totalOutputTokens: 40000 },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Usage records saved. May include partial success with warnings. / 사용 기록 저장 완료. 부분 성공 시 warnings 포함 가능.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', description: 'Always true if request was processed / 요청이 처리되면 항상 true' },
                    service: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', description: 'Service name / 서비스 이름' },
                        type: { type: 'string', enum: ['STANDARD', 'BACKGROUND'], description: 'Service type / 서비스 타입' },
                        apiOnly: { type: 'boolean', description: 'Always true / 항상 true' },
                      },
                    },
                    result: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer', description: 'Total records submitted / 제출된 총 레코드 수' },
                        upserted: { type: 'integer', description: 'Records successfully saved / 저장 성공 수' },
                        skipped: { type: 'integer', description: 'Records skipped (user or model resolution failed) / 스킵 수 (사용자 또는 모델 매칭 실패)' },
                        errors: { type: 'integer', description: 'Records failed during DB write / DB 저장 실패 수' },
                      },
                    },
                    users: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer', description: 'Unique user IDs submitted / 제출된 고유 사용자 수' },
                        resolved: { type: 'integer', description: 'Users successfully resolved (DB or Knox) / 매칭 성공 사용자 수' },
                        failed: { type: 'integer', description: 'Users not found in Knox / Knox에서 찾을 수 없는 사용자 수' },
                      },
                    },
                    models: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer', description: 'Unique model names submitted / 제출된 고유 모델명 수' },
                        resolved: { type: 'integer', description: 'Models matched (alias or name) / 매칭 성공 모델 수' },
                        failed: { type: 'integer', description: 'Unregistered model names / 미등록 모델명 수' },
                      },
                    },
                    warnings: {
                      type: 'array', items: { type: 'string' },
                      description: 'Failure details for skipped users/models / 스킵된 사용자/모델의 실패 사유',
                    },
                    errorDetails: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          index: { type: 'integer', description: 'Index in the data array / data 배열 내 인덱스' },
                          error: { type: 'string', description: 'Error message / 에러 메시지' },
                        },
                      },
                      description: 'DB write error details / DB 저장 에러 상세',
                    },
                  },
                },
                examples: {
                  'full-success': {
                    summary: 'All records saved / 전체 성공',
                    value: {
                      success: true,
                      service: { name: 'my-api-service', type: 'STANDARD', apiOnly: true },
                      result: { total: 3, upserted: 3, skipped: 0, errors: 0 },
                      users: { total: 2, resolved: 2, failed: 0 },
                      models: { total: 2, resolved: 2, failed: 0 },
                    },
                  },
                  'partial-success': {
                    summary: 'Partial success with failed user / 부분 성공 (사용자 1명 실패)',
                    value: {
                      success: true,
                      service: { name: 'my-api-service', type: 'STANDARD', apiOnly: true },
                      result: { total: 5, upserted: 3, skipped: 2, errors: 0 },
                      users: { total: 3, resolved: 2, failed: 1 },
                      models: { total: 1, resolved: 1, failed: 0 },
                      warnings: [
                        'User "retired.user": Knox에서 임직원 정보를 확인할 수 없습니다 (재직/휴직 상태만 허용)',
                      ],
                    },
                  },
                },
              },
            },
          },
          '400': errorResponse(
            'Invalid request body (잘못된 요청 본문)',
            'Validation failed. Check details for field-level errors. / 유효성 검사 실패. details에서 필드별 에러를 확인하세요.',
          ),
          '403': errorResponse(
            'Service is not API Only or disabled (API Only 서비스가 아니거나 비활성화)',
            'Service "my-service" is not an API Only service. apiOnly 서비스로 등록되어야 합니다.',
          ),
          '404': errorResponse(
            'Service not found (서비스를 찾을 수 없음)',
            'Service "my-service" not found. 등록되지 않은 서비스입니다.',
          ),
          '500': errorResponse('Internal server error (서버 내부 오류)'),
        },
      },
    },

  },
};

/**
 * Swagger UI HTML (로컬 에셋 서빙 — 사내망 CDN 차단 대응)
 */
export function getSwaggerUiHtml(): string {
  const specJson = JSON.stringify(swaggerSpec);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Registry - API Documentation</title>
  <link rel="icon" type="image/png" href="/logo.png?v=20260316" />
  <link rel="stylesheet" href="/api/swagger-ui/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 30px 0; }
    .swagger-ui .info .title { font-size: 2em; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/swagger-ui/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      spec: ${specJson},
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;
}
