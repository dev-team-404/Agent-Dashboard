/**
 * Swagger / OpenAPI 3.0 Specification
 *
 * Agent 사용량 집계 시스템 공개 API 문서
 */

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Agent Stats - Public API',
    version: '1.0.0',
    description:
      'AI Agent 사용량 데이터를 조회할 수 있는 공개 API입니다. 인증 없이 사용 가능합니다.\n\n' +
      '모든 엔드포인트는 `startDate`와 `endDate` (YYYY-MM-DD) 쿼리 파라미터가 필수이며, ' +
      '최대 조회 기간은 365일입니다.',
  },
  servers: [{ url: '/api/public', description: 'Public API' }],
  paths: {
    // ─── /stats/service-usage ──────────────────────────
    '/stats/service-usage': {
      get: {
        summary: '일별 서비스별 사용량 통계',
        description:
          '지정된 기간 내 일별/서비스별 요청 수, 토큰 사용량, 활성 사용자 수를 반환합니다.',
        tags: ['사용량 통계'],
        parameters: [
          {
            name: 'startDate',
            in: 'query',
            required: true,
            description: '조회 시작일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-01' },
          },
          {
            name: 'endDate',
            in: 'query',
            required: true,
            description: '조회 종료일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-31' },
          },
          {
            name: 'serviceId',
            in: 'query',
            required: false,
            description: '특정 서비스 ID로 필터링 (UUID)',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: '일별 서비스 사용량 목록',
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
                          date: {
                            type: 'string',
                            format: 'date',
                            example: '2025-01-15',
                            description: '날짜',
                          },
                          serviceId: {
                            type: 'string',
                            nullable: true,
                            example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                            description: '서비스 ID',
                          },
                          serviceName: {
                            type: 'string',
                            example: 'my-service',
                            description: '서비스명',
                          },
                          requests: {
                            type: 'integer',
                            example: 1250,
                            description: '요청 수',
                          },
                          inputTokens: {
                            type: 'integer',
                            example: 500000,
                            description: '입력 토큰 수',
                          },
                          outputTokens: {
                            type: 'integer',
                            example: 250000,
                            description: '출력 토큰 수',
                          },
                          totalTokens: {
                            type: 'integer',
                            example: 750000,
                            description: '전체 토큰 수',
                          },
                          activeUsers: {
                            type: 'integer',
                            example: 45,
                            description: '활성 사용자 수',
                          },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    {
                      date: '2025-01-15',
                      serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                      serviceName: 'my-service',
                      requests: 1250,
                      inputTokens: 500000,
                      outputTokens: 250000,
                      totalTokens: 750000,
                      activeUsers: 45,
                    },
                  ],
                },
              },
            },
          },
          '400': {
            description: '잘못된 요청 (날짜 형식 오류, 기간 초과 등)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                  },
                },
                example: {
                  error:
                    'startDate와 endDate는 필수 파라미터입니다. (형식: YYYY-MM-DD)',
                },
              },
            },
          },
          '500': {
            description: '서버 내부 오류',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── /stats/team-tokens ────────────────────────────
    '/stats/team-tokens': {
      get: {
        summary: '팀/부서별 토큰 사용량',
        description:
          '지정된 기간 내 팀(부서)별 토큰 사용량을 반환합니다. 사업부(Business Unit) 정보가 자동으로 추출됩니다.',
        tags: ['사용량 통계'],
        parameters: [
          {
            name: 'startDate',
            in: 'query',
            required: true,
            description: '조회 시작일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-01' },
          },
          {
            name: 'endDate',
            in: 'query',
            required: true,
            description: '조회 종료일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-31' },
          },
          {
            name: 'serviceId',
            in: 'query',
            required: false,
            description: '특정 서비스 ID로 필터링 (UUID)',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: '팀별 토큰 사용량 목록',
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
                          deptname: {
                            type: 'string',
                            example: 'SW혁신팀(S.LSI)',
                            description: '부서명',
                          },
                          businessUnit: {
                            type: 'string',
                            example: 'S.LSI',
                            description: '사업부',
                          },
                          totalInputTokens: {
                            type: 'integer',
                            example: 1200000,
                            description: '총 입력 토큰',
                          },
                          totalOutputTokens: {
                            type: 'integer',
                            example: 600000,
                            description: '총 출력 토큰',
                          },
                          totalTokens: {
                            type: 'integer',
                            example: 1800000,
                            description: '총 토큰',
                          },
                          requestCount: {
                            type: 'integer',
                            example: 3200,
                            description: '요청 수',
                          },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    {
                      deptname: 'SW혁신팀(S.LSI)',
                      businessUnit: 'S.LSI',
                      totalInputTokens: 1200000,
                      totalOutputTokens: 600000,
                      totalTokens: 1800000,
                      requestCount: 3200,
                    },
                  ],
                },
              },
            },
          },
          '400': {
            description: '잘못된 요청',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
          '500': {
            description: '서버 내부 오류',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },

    // ─── /stats/team-service-usage ─────────────────────
    '/stats/team-service-usage': {
      get: {
        summary: '팀 x 서비스 크로스탭 사용량',
        description:
          '팀(부서)과 서비스를 교차한 사용량 데이터를 반환합니다. 특정 팀이나 서비스로 필터링 가능합니다.',
        tags: ['사용량 통계'],
        parameters: [
          {
            name: 'startDate',
            in: 'query',
            required: true,
            description: '조회 시작일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-01' },
          },
          {
            name: 'endDate',
            in: 'query',
            required: true,
            description: '조회 종료일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-31' },
          },
          {
            name: 'deptname',
            in: 'query',
            required: false,
            description: '특정 부서명으로 필터링',
            schema: {
              type: 'string',
              example: 'SW혁신팀(S.LSI)',
            },
          },
          {
            name: 'serviceId',
            in: 'query',
            required: false,
            description: '특정 서비스 ID로 필터링 (UUID)',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: '팀-서비스 크로스탭 사용량 목록',
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
                          deptname: {
                            type: 'string',
                            example: 'SW혁신팀(S.LSI)',
                            description: '부서명',
                          },
                          businessUnit: {
                            type: 'string',
                            example: 'S.LSI',
                            description: '사업부',
                          },
                          serviceId: {
                            type: 'string',
                            nullable: true,
                            example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                            description: '서비스 ID',
                          },
                          serviceName: {
                            type: 'string',
                            example: 'my-service',
                            description: '서비스명',
                          },
                          requests: {
                            type: 'integer',
                            example: 850,
                            description: '요청 수',
                          },
                          totalTokens: {
                            type: 'integer',
                            example: 425000,
                            description: '총 토큰',
                          },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    {
                      deptname: 'SW혁신팀(S.LSI)',
                      businessUnit: 'S.LSI',
                      serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                      serviceName: 'my-service',
                      requests: 850,
                      totalTokens: 425000,
                    },
                  ],
                },
              },
            },
          },
          '400': {
            description: '잘못된 요청',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
          '500': {
            description: '서버 내부 오류',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },

    // ─── /stats/service-tokens ─────────────────────────
    '/stats/service-tokens': {
      get: {
        summary: '서비스별 토큰 사용량',
        description:
          '지정된 기간 내 서비스별 토큰 사용량과 고유 사용자 수를 반환합니다.',
        tags: ['사용량 통계'],
        parameters: [
          {
            name: 'startDate',
            in: 'query',
            required: true,
            description: '조회 시작일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-01' },
          },
          {
            name: 'endDate',
            in: 'query',
            required: true,
            description: '조회 종료일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-31' },
          },
        ],
        responses: {
          '200': {
            description: '서비스별 토큰 사용량 목록',
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
                          serviceId: {
                            type: 'string',
                            nullable: true,
                            example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                            description: '서비스 ID',
                          },
                          serviceName: {
                            type: 'string',
                            example: 'my-service',
                            description: '서비스명 (시스템 이름)',
                          },
                          serviceDisplayName: {
                            type: 'string',
                            example: 'My Service',
                            description: '서비스 표시명',
                          },
                          totalInputTokens: {
                            type: 'integer',
                            example: 2500000,
                            description: '총 입력 토큰',
                          },
                          totalOutputTokens: {
                            type: 'integer',
                            example: 1200000,
                            description: '총 출력 토큰',
                          },
                          totalTokens: {
                            type: 'integer',
                            example: 3700000,
                            description: '총 토큰',
                          },
                          requestCount: {
                            type: 'integer',
                            example: 8500,
                            description: '요청 수',
                          },
                          uniqueUsers: {
                            type: 'integer',
                            example: 120,
                            description: '고유 사용자 수',
                          },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    {
                      serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                      serviceName: 'my-service',
                      serviceDisplayName: 'My Service',
                      totalInputTokens: 2500000,
                      totalOutputTokens: 1200000,
                      totalTokens: 3700000,
                      requestCount: 8500,
                      uniqueUsers: 120,
                    },
                  ],
                },
              },
            },
          },
          '400': {
            description: '잘못된 요청',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
          '500': {
            description: '서버 내부 오류',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },

    // ─── /stats/summary ────────────────────────────────
    '/stats/summary': {
      get: {
        summary: '전체 사용량 요약',
        description:
          '지정된 기간의 전체 사용량을 요약하여 반환합니다. 총 요청 수, 토큰, 고유 사용자/서비스 수 등을 포함합니다.',
        tags: ['사용량 통계'],
        parameters: [
          {
            name: 'startDate',
            in: 'query',
            required: true,
            description: '조회 시작일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-01' },
          },
          {
            name: 'endDate',
            in: 'query',
            required: true,
            description: '조회 종료일 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2025-01-31' },
          },
        ],
        responses: {
          '200': {
            description: '기간 사용량 요약',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        totalRequests: {
                          type: 'integer',
                          example: 25000,
                          description: '총 요청 수',
                        },
                        totalTokens: {
                          type: 'integer',
                          example: 12500000,
                          description: '총 토큰 수',
                        },
                        totalInputTokens: {
                          type: 'integer',
                          example: 8000000,
                          description: '총 입력 토큰',
                        },
                        totalOutputTokens: {
                          type: 'integer',
                          example: 4500000,
                          description: '총 출력 토큰',
                        },
                        uniqueUsers: {
                          type: 'integer',
                          example: 200,
                          description: '고유 사용자 수',
                        },
                        uniqueServices: {
                          type: 'integer',
                          example: 5,
                          description: '고유 서비스 수',
                        },
                        periodDays: {
                          type: 'integer',
                          example: 31,
                          description: '조회 기간 (일수)',
                        },
                      },
                    },
                  },
                },
                example: {
                  data: {
                    totalRequests: 25000,
                    totalTokens: 12500000,
                    totalInputTokens: 8000000,
                    totalOutputTokens: 4500000,
                    uniqueUsers: 200,
                    uniqueServices: 5,
                    periodDays: 31,
                  },
                },
              },
            },
          },
          '400': {
            description: '잘못된 요청',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
                example: {
                  error: '조회 기간은 최대 365일까지 가능합니다.',
                },
              },
            },
          },
          '500': {
            description: '서버 내부 오류',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * Swagger UI HTML (CDN 기반)
 */
export function getSwaggerUiHtml(specUrl: string): string {
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
      url: '${specUrl}',
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
