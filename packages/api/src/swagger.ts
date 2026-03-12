/**
 * Swagger / OpenAPI 3.0 Specification
 *
 * Agent 사용량 집계 시스템 공개 API 문서
 * 모든 날짜는 KST (Asia/Seoul) 기준, YYYY-MM-DD 형식
 */

// ─── Reusable Schema Components ────────────────────────────

const dateParam = (name: string, desc: string, example: string) => ({
  name,
  in: 'query' as const,
  required: true,
  description: `${desc} (YYYY-MM-DD, KST 기준)`,
  schema: { type: 'string' as const, format: 'date' as const, example },
});

const serviceIdParam = (required: boolean) => ({
  name: 'serviceId',
  in: 'query' as const,
  required,
  description: '서비스 UUID. /stats/services 에서 조회 가능',
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
    version: '2.0.0',
    description:
      'AI Agent 사용량 데이터를 조회할 수 있는 공개 API입니다. **인증 없이** 사용 가능합니다.\n\n' +
      '## 공통 사항\n' +
      '- 날짜 파라미터는 모두 **KST (Asia/Seoul)** 기준 `YYYY-MM-DD` 형식\n' +
      '- 최대 조회 기간: **365일**\n' +
      '- 토큰 = 입력 토큰(inputTokens) + 출력 토큰(outputTokens)\n' +
      '- API 호출 수 = requestCount\n\n' +
      '## 사용 흐름\n' +
      '1. `/stats/services` 로 서비스 ID 목록 조회\n' +
      '2. 원하는 serviceId를 이용하여 팀별/사용자별 사용량 조회\n',
  },
  servers: [{ url: '/api/public', description: 'Public API' }],
  paths: {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 서비스 목록
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/services': {
      get: {
        summary: '전체 서비스 ID 목록',
        description:
          '등록된 모든 서비스의 ID, 이름, 표시명, 타입, 활성 상태, 메타데이터를 반환합니다.\n\n' +
          '다른 API의 `serviceId` 파라미터에 사용할 UUID를 여기서 조회하세요.',
        tags: ['서비스'],
        responses: {
          '200': {
            description: '서비스 목록',
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
                          serviceId: { type: 'string', format: 'uuid', description: '서비스 UUID' },
                          name: { type: 'string', description: '서비스 시스템명 (영문)' },
                          displayName: { type: 'string', description: '서비스 표시명' },
                          description: { type: 'string', nullable: true, description: '서비스 설명' },
                          type: { type: 'string', enum: ['STANDARD', 'BACKGROUND'], description: '서비스 타입' },
                          status: { type: 'string', enum: ['DEVELOPMENT', 'DEPLOYED'], description: '서비스 상태' },
                          enabled: { type: 'boolean', description: '활성 상태' },
                          targetMM: { type: 'number', nullable: true, description: '목표 MM (Men/Month)' },
                          serviceCategory: { type: 'array', items: { type: 'string' }, description: '서비스 카테고리 (복수)' },
                          standardMD: { type: 'number', nullable: true, description: '표준 M/D (BACKGROUND 서비스)' },
                          jiraTicket: { type: 'string', nullable: true, description: 'Jira 티켓 URL' },
                          serviceUrl: { type: 'string', nullable: true, description: '서비스 URL' },
                          docsUrl: { type: 'string', nullable: true, description: 'API 문서 URL' },
                          registeredBy: { type: 'string', nullable: true, description: '등록자 ID' },
                          registeredByDept: { type: 'string', nullable: true, description: '등록자 부서' },
                          createdAt: { type: 'string', format: 'date-time', description: '생성일시' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'nexus-coder', displayName: 'Nexus Coder', description: 'AI 코드 리뷰 서비스', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 3.0, serviceCategory: ['코드개발/분석/검증 지원'], standardMD: null, jiraTicket: null, serviceUrl: 'https://nexus.example.com', docsUrl: 'https://docs.example.com/nexus', registeredBy: 'syngha.han', registeredByDept: 'SW혁신팀(S.LSI)', createdAt: '2025-06-01T09:00:00.000Z' },
                    { serviceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', name: 'hanseol', displayName: 'Hanseol', description: '한글 문서 자동 생성', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 1.5, serviceCategory: ['문서 및 요구사항 지능형 처리', '코드개발/분석/검증 지원'], standardMD: null, jiraTicket: 'https://jira.example.com/browse/HS-100', serviceUrl: null, docsUrl: null, registeredBy: 'young87.kim', registeredByDept: 'AI플랫폼팀(DS)', createdAt: '2025-07-15T10:30:00.000Z' },
                  ],
                },
              },
            },
          },
          '500': errorResponse('서버 내부 오류'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 특정 서비스 팀별 사용량
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/team-usage': {
      get: {
        summary: '특정 서비스의 팀별 사용량',
        description:
          '지정된 서비스의 기간 내 **팀(부서)별** 토큰 사용량과 API 호출 수를 반환합니다.\n\n' +
          '- `deptname`: 부서명 (예: `SW혁신팀(S.LSI)`)\n' +
          '- `businessUnit`: 괄호 안 사업부 자동 추출 (예: `S.LSI`)\n' +
          '- 토큰: 입력/출력/합계 모두 제공\n' +
          '- `uniqueUsers`: 해당 팀에서 해당 서비스를 사용한 고유 사용자 수',
        tags: ['팀별 사용량'],
        parameters: [
          dateParam('startDate', '조회 시작일', '2025-01-01'),
          dateParam('endDate', '조회 종료일', '2025-01-31'),
          serviceIdParam(true),
        ],
        responses: {
          '200': {
            description: '팀별 사용량 목록',
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
                          deptname: { type: 'string', description: '부서명 (팀명(사업부) 형식)' },
                          businessUnit: { type: 'string', description: '사업부 (괄호 안 추출)' },
                          totalInputTokens: { type: 'integer', description: '총 입력 토큰' },
                          totalOutputTokens: { type: 'integer', description: '총 출력 토큰' },
                          totalTokens: { type: 'integer', description: '총 토큰 (입력 + 출력)' },
                          requestCount: { type: 'integer', description: 'API 호출 수' },
                          uniqueUsers: { type: 'integer', description: '고유 사용자 수' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { deptname: 'SW혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, requestCount: 3200, uniqueUsers: 15 },
                    { deptname: 'AI플랫폼팀(DS)', businessUnit: 'DS', totalInputTokens: 800000, totalOutputTokens: 400000, totalTokens: 1200000, requestCount: 2100, uniqueUsers: 8 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('잘못된 요청', 'serviceId는 필수 파라미터입니다.'),
          '500': errorResponse('서버 내부 오류'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. 전체 서비스 팀별 사용량
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/team-usage-all': {
      get: {
        summary: '전체 서비스 팀별 사용량',
        description:
          '**모든 서비스**에 대해 팀(부서) × 서비스 별 토큰 사용량과 API 호출 수를 반환합니다.\n\n' +
          '결과는 `deptname` 기준 오름차순 정렬되며, 각 행은 하나의 `deptname + serviceId` 조합입니다.\n\n' +
          '특정 서비스만 보려면 `/stats/team-usage`를 사용하세요.',
        tags: ['팀별 사용량'],
        parameters: [
          dateParam('startDate', '조회 시작일', '2025-01-01'),
          dateParam('endDate', '조회 종료일', '2025-01-31'),
        ],
        responses: {
          '200': {
            description: '팀 × 서비스 사용량 목록',
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
                          deptname: { type: 'string', description: '부서명' },
                          businessUnit: { type: 'string', description: '사업부' },
                          serviceId: { type: 'string', nullable: true, format: 'uuid', description: '서비스 UUID' },
                          serviceName: { type: 'string', description: '서비스 시스템명' },
                          serviceDisplayName: { type: 'string', description: '서비스 표시명' },
                          totalInputTokens: { type: 'integer', description: '총 입력 토큰' },
                          totalOutputTokens: { type: 'integer', description: '총 출력 토큰' },
                          totalTokens: { type: 'integer', description: '총 토큰 (입력 + 출력)' },
                          requestCount: { type: 'integer', description: 'API 호출 수' },
                          uniqueUsers: { type: 'integer', description: '고유 사용자 수' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { deptname: 'SW혁신팀(S.LSI)', businessUnit: 'S.LSI', serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', serviceName: 'nexus-coder', serviceDisplayName: 'Nexus Coder', totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, requestCount: 3200, uniqueUsers: 15 },
                    { deptname: 'SW혁신팀(S.LSI)', businessUnit: 'S.LSI', serviceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', serviceName: 'hanseol', serviceDisplayName: 'Hanseol', totalInputTokens: 500000, totalOutputTokens: 200000, totalTokens: 700000, requestCount: 1500, uniqueUsers: 8 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('잘못된 요청', 'startDate와 endDate는 필수 파라미터입니다. (형식: YYYY-MM-DD)'),
          '500': errorResponse('서버 내부 오류'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Top K 사용자
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/top-users': {
      get: {
        summary: '서비스별 Top K 사용자',
        description:
          '지정된 서비스에서 **토큰 사용량 기준 상위 K명**의 사용자 정보와 사용량을 반환합니다.\n\n' +
          '## 파라미터 설명\n' +
          '- `topK`: 반환할 최대 사용자 수 (기본값: 10, 최소: 1, 최대: 100)\n' +
          '- 전체 사용자가 topK보다 적으면 **존재하는 만큼만** 반환\n\n' +
          '## 응답 필드\n' +
          '- `topK`: 요청한 K값\n' +
          '- `totalUsers`: 해당 서비스의 전체 사용자 수\n' +
          '- `returnedCount`: 실제 반환된 사용자 수 (≤ topK)\n' +
          '- `data[]`: 사용자 정보 배열 (rank 순)\n\n' +
          '## 정렬 기준\n' +
          '`totalTokens` (입력 + 출력 합계) 내림차순',
        tags: ['사용자별 사용량'],
        parameters: [
          dateParam('startDate', '조회 시작일', '2025-01-01'),
          dateParam('endDate', '조회 종료일', '2025-01-31'),
          serviceIdParam(true),
          {
            name: 'topK',
            in: 'query',
            required: false,
            description: '반환할 최대 사용자 수 (기본값: 10, 최소: 1, 최대: 100). 전체 사용자가 이보다 적으면 존재하는 만큼만 반환',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10, example: 5 },
          },
        ],
        responses: {
          '200': {
            description: 'Top K 사용자 목록',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    topK: { type: 'integer', description: '요청한 K값', example: 5 },
                    totalUsers: { type: 'integer', description: '해당 서비스의 전체 사용자 수', example: 42 },
                    returnedCount: { type: 'integer', description: '실제 반환된 사용자 수 (totalUsers < topK이면 totalUsers와 동일)', example: 5 },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          rank: { type: 'integer', description: '순위 (1부터 시작)', example: 1 },
                          userId: { type: 'string', format: 'uuid', description: '사용자 UUID' },
                          loginId: { type: 'string', description: '사용자 로그인 ID (사번)', example: 'syngha.han' },
                          username: { type: 'string', description: '사용자 이름', example: '한승하' },
                          deptname: { type: 'string', description: '부서명', example: 'SW혁신팀(S.LSI)' },
                          businessUnit: { type: 'string', description: '사업부', example: 'S.LSI' },
                          totalInputTokens: { type: 'integer', description: '총 입력 토큰', example: 850000 },
                          totalOutputTokens: { type: 'integer', description: '총 출력 토큰', example: 420000 },
                          totalTokens: { type: 'integer', description: '총 토큰 (입력 + 출력)', example: 1270000 },
                          requestCount: { type: 'integer', description: 'API 호출 수', example: 1580 },
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
                    { rank: 1, userId: 'uuid-1', loginId: 'syngha.han', username: '한승하', deptname: 'SW혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, userId: 'uuid-2', loginId: 'young87.kim', username: '김영수', deptname: 'AI플랫폼팀(DS)', businessUnit: 'DS', totalInputTokens: 720000, totalOutputTokens: 350000, totalTokens: 1070000, requestCount: 1320 },
                    { rank: 3, userId: 'uuid-3', loginId: 'jieun.park', username: '박지은', deptname: 'DevOps팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 600000, totalOutputTokens: 280000, totalTokens: 880000, requestCount: 950 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('잘못된 요청', 'serviceId는 필수 파라미터입니다.'),
          '500': errorResponse('서버 내부 오류'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. 부서별 Top K 사용자
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/top-users-by-dept': {
      get: {
        summary: '서비스 + 부서별 Top K 사용자',
        description:
          '지정된 서비스 + 부서에서 **토큰 사용량 기준 상위 K명**의 사용자 정보와 사용량을 반환합니다.\n\n' +
          '## 파라미터 설명\n' +
          '- `serviceId`: 서비스 UUID (필수)\n' +
          '- `deptname`: 부서명, **팀명(사업부)** 형식 (필수). 예: `SW혁신팀(S.LSI)`\n' +
          '- `topK`: 반환할 최대 사용자 수 (기본값: 10, 최소: 1, 최대: 100)\n' +
          '- 해당 부서의 전체 사용자가 topK보다 적으면 **존재하는 만큼만** 반환\n\n' +
          '## 응답 필드\n' +
          '- `topK`: 요청한 K값\n' +
          '- `deptname`: 필터링에 사용된 부서명\n' +
          '- `totalUsersInDept`: 해당 부서의 전체 사용자 수\n' +
          '- `returnedCount`: 실제 반환된 사용자 수 (≤ topK)\n\n' +
          '## 부서명 확인 방법\n' +
          '`/stats/team-usage` API의 응답에서 `deptname` 필드를 참고하세요.\n\n' +
          '## 정렬 기준\n' +
          '`totalTokens` (입력 + 출력 합계) 내림차순',
        tags: ['사용자별 사용량'],
        parameters: [
          dateParam('startDate', '조회 시작일', '2025-01-01'),
          dateParam('endDate', '조회 종료일', '2025-01-31'),
          serviceIdParam(true),
          {
            name: 'deptname',
            in: 'query',
            required: true,
            description: '부서명 (팀명(사업부) 형식). /stats/team-usage 응답의 deptname 값을 사용하세요.',
            schema: { type: 'string', example: 'SW혁신팀(S.LSI)' },
          },
          {
            name: 'topK',
            in: 'query',
            required: false,
            description: '반환할 최대 사용자 수 (기본값: 10, 최소: 1, 최대: 100). 전체 사용자가 이보다 적으면 존재하는 만큼만 반환',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10, example: 3 },
          },
        ],
        responses: {
          '200': {
            description: '부서 내 Top K 사용자 목록',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    topK: { type: 'integer', description: '요청한 K값', example: 3 },
                    deptname: { type: 'string', description: '조회한 부서명', example: 'SW혁신팀(S.LSI)' },
                    totalUsersInDept: { type: 'integer', description: '해당 부서의 전체 사용자 수', example: 12 },
                    returnedCount: { type: 'integer', description: '실제 반환된 사용자 수', example: 3 },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          rank: { type: 'integer', description: '순위 (1부터 시작)', example: 1 },
                          userId: { type: 'string', format: 'uuid', description: '사용자 UUID' },
                          loginId: { type: 'string', description: '사용자 로그인 ID (사번)', example: 'syngha.han' },
                          username: { type: 'string', description: '사용자 이름', example: '한승하' },
                          deptname: { type: 'string', description: '부서명', example: 'SW혁신팀(S.LSI)' },
                          businessUnit: { type: 'string', description: '사업부', example: 'S.LSI' },
                          totalInputTokens: { type: 'integer', description: '총 입력 토큰', example: 850000 },
                          totalOutputTokens: { type: 'integer', description: '총 출력 토큰', example: 420000 },
                          totalTokens: { type: 'integer', description: '총 토큰 (입력 + 출력)', example: 1270000 },
                          requestCount: { type: 'integer', description: 'API 호출 수', example: 1580 },
                        },
                      },
                    },
                  },
                },
                example: {
                  topK: 3,
                  deptname: 'SW혁신팀(S.LSI)',
                  totalUsersInDept: 12,
                  returnedCount: 3,
                  data: [
                    { rank: 1, userId: 'uuid-1', loginId: 'syngha.han', username: '한승하', deptname: 'SW혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, userId: 'uuid-2', loginId: 'minjae.lee', username: '이민재', deptname: 'SW혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 620000, totalOutputTokens: 310000, totalTokens: 930000, requestCount: 1120 },
                    { rank: 3, userId: 'uuid-3', loginId: 'suji.choi', username: '최수지', deptname: 'SW혁신팀(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 480000, totalOutputTokens: 220000, totalTokens: 700000, requestCount: 890 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('잘못된 요청', 'deptname은 필수 파라미터입니다. (형식: 팀명(사업부), 예: SW혁신팀(S.LSI))'),
          '500': errorResponse('서버 내부 오류'),
        },
      },
    },
  },
};

/**
 * Swagger UI HTML (CDN 기반)
 */
export function getSwaggerUiHtml(): string {
  const specJson = JSON.stringify(swaggerSpec);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Stats - API 문서</title>
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
