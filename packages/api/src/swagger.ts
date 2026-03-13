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

const serviceIdParam = (required: boolean) => ({
  name: 'serviceId',
  in: 'query' as const,
  required,
  description: 'Service UUID. Retrieve from /stats/services (서비스 UUID. /stats/services 에서 조회 가능)',
  schema: { type: 'string' as const, format: 'uuid' as const, example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
});

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
    title: 'Agent Stats - Public API',
    version: '2.1.0',
    description:
      'Public API for querying AI Agent usage data. **No authentication required.**\n' +
      'AI Agent 사용량 데이터를 조회할 수 있는 공개 API입니다. **인증 없이** 사용 가능합니다.\n\n' +
      '## Common Notes (공통 사항)\n' +
      '- All date parameters use **KST (Asia/Seoul)** in `YYYY-MM-DD` format\n' +
      '  날짜 파라미터는 모두 **KST (Asia/Seoul)** 기준 `YYYY-MM-DD` 형식\n' +
      '- Maximum query period: **365 days** / 최대 조회 기간: **365일**\n' +
      '- Tokens = inputTokens + outputTokens / 토큰 = 입력 토큰 + 출력 토큰\n' +
      '- API call count = requestCount / API 호출 수 = requestCount\n\n' +
      '## Usage Flow (사용 흐름)\n' +
      '1. Query service ID list via `/stats/services` / `/stats/services` 로 서비스 ID 목록 조회\n' +
      '2. Use the desired `serviceId` to query team/user usage / 원하는 `serviceId`를 이용하여 팀별/사용자별 사용량 조회\n',
  },
  servers: [{ url: '/api/public', description: 'Public API' }],
  paths: {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Service List (서비스 목록)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/services': {
      get: {
        summary: 'Deployed Service List (배포된 서비스 목록)',
        description:
          'Returns ID, name, display name, type, status, and metadata of **deployed** services only (status=DEPLOYED).\n' +
          '**배포 완료(status=DEPLOYED)** 상태인 서비스의 ID, 이름, 표시명, 타입, 메타데이터를 반환합니다.\n' +
          'Services in DEVELOPMENT status are excluded.\n' +
          '개발 중(DEVELOPMENT) 상태의 서비스는 제외됩니다.\n\n' +
          'Use this endpoint to retrieve the UUID needed for the `serviceId` parameter of other APIs.\n' +
          '다른 API의 `serviceId` 파라미터에 사용할 UUID를 여기서 조회하세요.',
        tags: ['Services (서비스)'],
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
                          serviceId: { type: 'string', format: 'uuid', description: 'Service UUID (서비스 UUID)' },
                          name: { type: 'string', description: 'Service system name in English (서비스 시스템명, 영문)' },
                          displayName: { type: 'string', description: 'Service display name (서비스 표시명)' },
                          description: { type: 'string', nullable: true, description: 'Service description (서비스 설명)' },
                          type: { type: 'string', enum: ['STANDARD', 'BACKGROUND'], description: 'Service type (서비스 타입)' },
                          status: { type: 'string', enum: ['DEVELOPMENT', 'DEPLOYED'], description: 'Service status (서비스 상태)' },
                          enabled: { type: 'boolean', description: 'Active status (활성 상태)' },
                          targetMM: { type: 'number', nullable: true, description: 'Target MM (Men/Month) (목표 MM)' },
                          serviceCategory: { type: 'array', items: { type: 'string' }, description: 'Service categories, multiple allowed (서비스 카테고리, 복수 선택 가능)' },
                          standardMD: { type: 'number', nullable: true, description: 'Standard M/D for BACKGROUND services (표준 M/D, BACKGROUND 서비스용)' },
                          jiraTicket: { type: 'string', nullable: true, description: 'Jira ticket URL (Jira 티켓 URL)' },
                          serviceUrl: { type: 'string', nullable: true, description: 'Service URL (서비스 URL)' },
                          docsUrl: { type: 'string', nullable: true, description: 'API documentation URL (API 문서 URL)' },
                          registeredBy: { type: 'string', nullable: true, description: 'Registered by user ID (등록자 ID)' },
                          registeredByDept: { type: 'string', nullable: true, description: 'Registered by department (등록자 부서)' },
                          createdAt: { type: 'string', format: 'date-time', description: 'Created at (생성일시)' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'nexus-coder', displayName: 'Nexus Coder', description: 'AI 코드 리뷰 서비스', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 3.0, serviceCategory: ['코드개발/분석/검증 지원'], standardMD: null, jiraTicket: null, serviceUrl: 'https://nexus.example.com', docsUrl: 'https://docs.example.com/nexus', registeredBy: 'syngha.han', registeredByDept: 'S/W혁신팀(S.LSI)', createdAt: '2025-06-01T09:00:00.000Z' },
                    { serviceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', name: 'hanseol', displayName: 'Hanseol', description: '한글 문서 자동 생성', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 1.5, serviceCategory: ['문서 및 요구사항 지능형 처리', '코드개발/분석/검증 지원'], standardMD: null, jiraTicket: 'https://jira.example.com/browse/HS-100', serviceUrl: null, docsUrl: null, registeredBy: 'young87.kim', registeredByDept: 'AI플랫폼팀(DS)', createdAt: '2025-07-15T10:30:00.000Z' },
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
          dateParam('startDate', 'Start date', '조회 시작일', '2025-01-01'),
          dateParam('endDate', 'End date', '조회 종료일', '2025-01-31'),
          serviceIdParam(true),
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
          '400': errorResponse('Invalid request (잘못된 요청)', 'serviceId is required. serviceId는 필수 파라미터입니다.'),
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
          'Results are sorted by `deptname` in ascending order. Each row represents one `deptname + serviceId` combination.\n' +
          '결과는 `deptname` 기준 오름차순 정렬되며, 각 행은 하나의 `deptname + serviceId` 조합입니다.\n\n' +
          'To view a specific service only, use `/stats/team-usage`.\n' +
          '특정 서비스만 보려면 `/stats/team-usage`를 사용하세요.',
        tags: ['Team Usage (팀별 사용량)'],
        parameters: [
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
                          serviceId: { type: 'string', nullable: true, format: 'uuid', description: 'Service UUID (서비스 UUID)' },
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
                    { deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', serviceName: 'nexus-coder', serviceDisplayName: 'Nexus Coder', totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, requestCount: 3200, uniqueUsers: 15 },
                    { deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', serviceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', serviceName: 'hanseol', serviceDisplayName: 'Hanseol', totalInputTokens: 500000, totalOutputTokens: 200000, totalTokens: 700000, requestCount: 1500, uniqueUsers: 8 },
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
          dateParam('startDate', 'Start date', '조회 시작일', '2025-01-01'),
          dateParam('endDate', 'End date', '조회 종료일', '2025-01-31'),
          serviceIdParam(true),
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
                          userId: { type: 'string', format: 'uuid', description: 'User UUID (사용자 UUID)' },
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
                    { rank: 1, userId: 'uuid-1', loginId: 'syngha.han', username: '한승하', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, userId: 'uuid-2', loginId: 'young87.kim', username: '김영수', deptname: 'AI플랫폼팀(DS)', businessUnit: 'DS', totalInputTokens: 720000, totalOutputTokens: 350000, totalTokens: 1070000, requestCount: 1320 },
                    { rank: 3, userId: 'uuid-3', loginId: 'jieun.park', username: '박지은', deptname: 'DevOps팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 600000, totalOutputTokens: 280000, totalTokens: 880000, requestCount: 950 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Invalid request (잘못된 요청)', 'serviceId is required. serviceId는 필수 파라미터입니다.'),
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
          '- `serviceId`: Service UUID (required) / 서비스 UUID (필수)\n' +
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
          dateParam('startDate', 'Start date', '조회 시작일', '2025-01-01'),
          dateParam('endDate', 'End date', '조회 종료일', '2025-01-31'),
          serviceIdParam(true),
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
                          userId: { type: 'string', format: 'uuid', description: 'User UUID (사용자 UUID)' },
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
                    { rank: 1, userId: 'uuid-1', loginId: 'syngha.han', username: '한승하', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, userId: 'uuid-2', loginId: 'minjae.lee', username: '이민재', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 620000, totalOutputTokens: 310000, totalTokens: 930000, requestCount: 1120 },
                    { rank: 3, userId: 'uuid-3', loginId: 'suji.choi', username: '최수지', deptname: 'S/W혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 480000, totalOutputTokens: 220000, totalTokens: 700000, requestCount: 890 },
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
          '> 응답에 추정에 사용된 기준값이 `estimationBaseline`으로 포함됩니다.',
        tags: ['DAU / MAU'],
        parameters: [
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
                          serviceId: { type: 'string', format: 'uuid', description: 'Service UUID (서비스 UUID)' },
                          name: { type: 'string', description: 'Service system name (서비스 시스템명)' },
                          displayName: { type: 'string', description: 'Service display name (서비스 표시명)' },
                          description: { type: 'string', nullable: true, description: 'Service description (서비스 설명)' },
                          type: { type: 'string', enum: ['STANDARD', 'BACKGROUND'], description: 'Service type (서비스 타입)' },
                          status: { type: 'string', enum: ['DEPLOYED'], description: 'Always DEPLOYED (항상 DEPLOYED)' },
                          enabled: { type: 'boolean', description: 'Active status (활성 상태)' },
                          targetMM: { type: 'number', nullable: true, description: 'Target MM (Men/Month) (목표 MM)' },
                          serviceCategory: { type: 'array', items: { type: 'string' }, description: 'Service categories (서비스 카테고리)' },
                          standardMD: { type: 'number', nullable: true, description: 'Standard M/D for BACKGROUND (표준 M/D)' },
                          jiraTicket: { type: 'string', nullable: true, description: 'Jira ticket URL' },
                          serviceUrl: { type: 'string', nullable: true, description: 'Service URL (서비스 URL)' },
                          docsUrl: { type: 'string', nullable: true, description: 'API docs URL (API 문서 URL)' },
                          registeredBy: { type: 'string', nullable: true, description: 'Registered by (등록자 ID)' },
                          registeredByDept: { type: 'string', nullable: true, description: 'Registered by dept (등록자 부서)' },
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
                    { serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'nexus-coder', displayName: 'Nexus Coder', description: 'AI 코드 리뷰 서비스', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 3.0, serviceCategory: ['코드개발/분석/검증 지원'], standardMD: null, jiraTicket: null, serviceUrl: 'https://nexus.example.com', docsUrl: null, registeredBy: 'syngha.han', registeredByDept: 'S/W혁신팀(S.LSI)', createdAt: '2025-06-01T09:00:00.000Z', totalCallCount: 3200, totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, dau: 45, mau: 128, isEstimated: false },
                    { serviceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', name: 'auto-review', displayName: 'Auto Review Bot', description: '자동 코드 리뷰 봇', type: 'BACKGROUND', status: 'DEPLOYED', enabled: true, targetMM: 1.0, serviceCategory: ['코드개발/분석/검증 지원'], standardMD: 0.5, jiraTicket: 'https://jira.example.com/browse/AR-1', serviceUrl: null, docsUrl: null, registeredBy: 'young87.kim', registeredByDept: 'AI플랫폼팀(DS)', createdAt: '2025-07-15T10:30:00.000Z', totalCallCount: 5060, totalInputTokens: 800000, totalOutputTokens: 400000, totalTokens: 1200000, dau: 15, mau: 33, isEstimated: true, estimationDetail: { avgDailyApiCalls: 230, totalMonthlyApiCalls: 5060, avgCallsPerPersonPerDay: 15.3, avgCallsPerPersonPerMonth: 152.4 } },
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
  },
};

/**
 * Swagger UI HTML (CDN-based)
 */
export function getSwaggerUiHtml(): string {
  const specJson = JSON.stringify(swaggerSpec);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Stats - API Documentation</title>
  <link rel="icon" type="image/png" href="/logo.png" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
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
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
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
