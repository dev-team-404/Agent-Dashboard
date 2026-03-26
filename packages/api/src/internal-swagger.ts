/**
 * Internal Organization API — OpenAPI 3.0 Spec + Swagger UI
 *
 * /internal/api-docs    → JSON spec
 * /internal/api-docs/ui → Swagger UI
 */

const orgNodeSchema = {
  type: 'object',
  properties: {
    departmentCode: { type: 'string', example: 'DEPT001' },
    departmentName: { type: 'string', example: '시스템LSI사업부' },
    enDepartmentName: { type: 'string', nullable: true, example: 'System LSI Business' },
    parentDepartmentCode: { type: 'string', nullable: true, example: 'ROOT001' },
    userCount: { type: 'integer', example: 42 },
  },
};

const treeNodeSchema = {
  type: 'object',
  properties: {
    ...orgNodeSchema.properties,
    children: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } },
  },
};

export const internalSwaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Internal Organization API',
    version: '1.0.0',
    description: `사내 서비스 간 조직도 데이터 조회를 위한 Internal API입니다.

**인증**: 불필요 (사내 네트워크 신뢰 기반)

**Base URL**: \`http://a2g.samsungds.net:8090/api/internal/org\`

**사용 서비스**: nexus-web (조직도 기반 권한관리)`,
  },
  servers: [
    { url: '/internal/org', description: 'Internal API (direct)' },
    { url: '/api/internal/org', description: 'Internal API (via nginx proxy)' },
  ],
  tags: [
    { name: 'Organization Tree', description: '조직도 트리 조회' },
    { name: 'User', description: '사용자 부서 정보 조회' },
    { name: 'Department', description: '부서 검색/목록' },
  ],
  paths: {
    '/tree': {
      get: {
        tags: ['Organization Tree'],
        summary: '전체 조직도 트리',
        description: '전체 조직 구조를 계층형 JSON으로 반환합니다. 루트 노드부터 최하위 부서까지 포함됩니다.',
        responses: {
          '200': {
            description: '조직도 트리',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tree: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } },
                    totalNodes: { type: 'integer', example: 156 },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal Server Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/tree/{deptCode}': {
      get: {
        tags: ['Organization Tree'],
        summary: '부서 서브트리',
        description: '특정 부서를 루트로 한 하위 조직 트리를 반환합니다.',
        parameters: [
          { name: 'deptCode', in: 'path', required: true, schema: { type: 'string' }, description: 'Knox 부서 코드', example: 'DEPT001' },
        ],
        responses: {
          '200': { description: '서브트리', content: { 'application/json': { schema: { $ref: '#/components/schemas/TreeNode' } } } },
          '404': { description: '부서를 찾을 수 없음', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '500': { description: 'Internal Server Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/user/{loginId}': {
      get: {
        tags: ['User'],
        summary: '사용자 부서 정보 + 계층',
        description: `사용자의 부서 정보와 조직 계층 체인(루트→리프)을 반환합니다.

**계층 순서**: 최상위 조직 → 사업부 → 센터 → 팀 (루트에서 리프 방향)`,
        parameters: [
          { name: 'loginId', in: 'path', required: true, schema: { type: 'string' }, description: 'Knox 사용자 ID', example: 'syngha.han' },
        ],
        responses: {
          '200': {
            description: '사용자 부서 정보',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: {
                      type: 'object',
                      properties: {
                        loginId: { type: 'string', example: 'syngha.han' },
                        name: { type: 'string', example: '한승하' },
                        deptName: { type: 'string', nullable: true, example: 'SW Innovation Team' },
                        deptCode: { type: 'string', nullable: true, example: 'DEPT001' },
                      },
                    },
                    hierarchy: {
                      type: 'array',
                      description: '조직 계층 (루트 → 리프 순서)',
                      items: {
                        type: 'object',
                        properties: {
                          code: { type: 'string', example: 'ROOT001' },
                          name: { type: 'string', example: 'System LSI Business' },
                          enName: { type: 'string', example: 'System LSI Business' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: '사용자를 찾을 수 없음', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '500': { description: 'Internal Server Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/search': {
      get: {
        tags: ['Department'],
        summary: '부서 검색',
        description: '한글 또는 영문 부서명으로 부서를 검색합니다. 최소 2글자 이상 입력해야 합니다. 최대 50건 반환.',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 }, description: '검색 키워드 (한글/영문)', example: 'S/W혁신' },
        ],
        responses: {
          '200': {
            description: '검색 결과',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: { type: 'array', items: { $ref: '#/components/schemas/OrgNode' } },
                    count: { type: 'integer', example: 3 },
                  },
                },
              },
            },
          },
          '400': { description: '검색어가 2글자 미만', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '500': { description: 'Internal Server Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/departments': {
      get: {
        tags: ['Department'],
        summary: '전체 부서 목록 (플랫)',
        description: '모든 부서를 플랫 리스트로 반환합니다. 드롭다운 셀렉터 등에 사용합니다.',
        responses: {
          '200': {
            description: '부서 목록',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    departments: { type: 'array', items: { $ref: '#/components/schemas/OrgNode' } },
                    count: { type: 'integer', example: 156 },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal Server Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      OrgNode: orgNodeSchema,
      TreeNode: treeNodeSchema,
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Failed to get org tree' },
        },
      },
    },
  },
};

/**
 * Internal API Swagger UI HTML 생성
 * 기존 Public API Swagger UI와 동일한 swagger-ui-dist 에셋 재사용
 */
export function getInternalSwaggerUiHtml(): string {
  const specJson = JSON.stringify(internalSwaggerSpec);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Internal Org API - Documentation</title>
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
      layout: 'StandaloneLayout',
      defaultModelsExpandDepth: 1,
      docExpansion: 'list',
    });
  </script>
</body>
</html>`;
}
