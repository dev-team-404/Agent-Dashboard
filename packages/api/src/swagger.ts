/**
 * Swagger / OpenAPI 3.0 Specification
 *
 * Agent Usage Statistics System Public API Documentation
 * All dates are in KST (Asia/Seoul) timezone, YYYY-MM-DD format
 */

// ─── Reusable Schema Components ────────────────────────────

const dateParam = (name: string, desc: string, example: string) => ({
  name,
  in: 'query' as const,
  required: true,
  description: `${desc} (YYYY-MM-DD, KST timezone)`,
  schema: { type: 'string' as const, format: 'date' as const, example },
});

const serviceIdParam = (required: boolean) => ({
  name: 'serviceId',
  in: 'query' as const,
  required,
  description: 'Service UUID. Available from /stats/services',
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
      'Public API for querying AI Agent usage data. **No authentication required**.\n\n' +
      '## General Information\n' +
      '- All date parameters use **KST (Asia/Seoul)** timezone in `YYYY-MM-DD` format\n' +
      '- Maximum query period: **365 days**\n' +
      '- Tokens = inputTokens + outputTokens\n' +
      '- API calls = requestCount\n\n' +
      '## Usage Flow\n' +
      '1. Query service ID list from `/stats/services`\n' +
      '2. Use desired serviceId to query team/user usage statistics\n',
  },
  servers: [{ url: '/api/public', description: 'Public API' }],
  paths: {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 서비스 목록
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/services': {
      get: {
        summary: 'List all service IDs',
        description:
          'Returns ID, name, display name, type, active status, and metadata for all registered services.\n\n' +
          'Use this API to get UUIDs for the `serviceId` parameter in other APIs.',
        tags: ['Services'],
        responses: {
          '200': {
            description: 'Service list',
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
                          serviceId: { type: 'string', format: 'uuid', description: 'Service UUID' },
                          name: { type: 'string', description: 'Service system name (English)' },
                          displayName: { type: 'string', description: 'Service display name' },
                          description: { type: 'string', nullable: true, description: 'Service description' },
                          type: { type: 'string', enum: ['STANDARD', 'BACKGROUND'], description: 'Service type' },
                          status: { type: 'string', enum: ['DEVELOPMENT', 'DEPLOYED'], description: 'Service status' },
                          enabled: { type: 'boolean', description: 'Enabled status' },
                          targetMM: { type: 'number', nullable: true, description: 'Target MM (Men/Month)' },
                          serviceCategory: { type: 'array', items: { type: 'string' }, description: 'Service categories (multiple)' },
                          standardMD: { type: 'number', nullable: true, description: 'Standard M/D (for BACKGROUND services)' },
                          jiraTicket: { type: 'string', nullable: true, description: 'Jira ticket URL' },
                          serviceUrl: { type: 'string', nullable: true, description: 'Service URL' },
                          docsUrl: { type: 'string', nullable: true, description: 'API documentation URL' },
                          registeredBy: { type: 'string', nullable: true, description: 'Registrant ID' },
                          registeredByDept: { type: 'string', nullable: true, description: 'Registrant department' },
                          createdAt: { type: 'string', format: 'date-time', description: 'Created at' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'nexus-coder', displayName: 'Nexus Coder', description: 'AI Code Review Service', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 3.0, serviceCategory: ['Code Development/Analysis/Validation'], standardMD: null, jiraTicket: null, serviceUrl: 'https://nexus.example.com', docsUrl: 'https://docs.example.com/nexus', registeredBy: 'syngha.han', registeredByDept: 'SW Innovation Team(S.LSI)', createdAt: '2025-06-01T09:00:00.000Z' },
                    { serviceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', name: 'hanseol', displayName: 'Hanseol', description: 'Korean Document Auto-generation', type: 'STANDARD', status: 'DEPLOYED', enabled: true, targetMM: 1.5, serviceCategory: ['Intelligent Document & Requirements Processing', 'Code Development/Analysis/Validation'], standardMD: null, jiraTicket: 'https://jira.example.com/browse/HS-100', serviceUrl: null, docsUrl: null, registeredBy: 'young87.kim', registeredByDept: 'AI Platform Team(DS)', createdAt: '2025-07-15T10:30:00.000Z' },
                  ],
                },
              },
            },
          },
          '500': errorResponse('Internal server error'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Team Usage by Service
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/team-usage': {
      get: {
        summary: 'Team usage by service',
        description:
          'Returns token usage and API call count **by team (department)** for a specified service within a date range.\n\n' +
          '- `deptname`: Department name (e.g., `SW Innovation Team(S.LSI)`)\n' +
          '- `businessUnit`: Business unit automatically extracted from parentheses (e.g., `S.LSI`)\n' +
          '- Tokens: Input/output/total all provided\n' +
          '- `uniqueUsers`: Number of unique users from the team who used the service',
        tags: ['Team Usage'],
        parameters: [
          dateParam('startDate', 'Start date', '2025-01-01'),
          dateParam('endDate', 'End date', '2025-01-31'),
          serviceIdParam(true),
        ],
        responses: {
          '200': {
            description: 'Team usage list',
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
                          deptname: { type: 'string', description: 'Department name (Team(BusinessUnit) format)' },
                          businessUnit: { type: 'string', description: 'Business unit (extracted from parentheses)' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens' },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens' },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output)' },
                          requestCount: { type: 'integer', description: 'API call count' },
                          uniqueUsers: { type: 'integer', description: 'Unique user count' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { deptname: 'SW Innovation Team(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, requestCount: 3200, uniqueUsers: 15 },
                    { deptname: 'AI Platform Team(DS)', businessUnit: 'DS', totalInputTokens: 800000, totalOutputTokens: 400000, totalTokens: 1200000, requestCount: 2100, uniqueUsers: 8 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Bad request', 'serviceId is a required parameter.'),
          '500': errorResponse('Internal server error'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. All Services Team Usage
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/team-usage-all': {
      get: {
        summary: 'Team usage across all services',
        description:
          'Returns token usage and API call count by team (department) × service for **all services**.\n\n' +
          'Results are sorted in ascending order by `deptname`, with each row representing a `deptname + serviceId` combination.\n\n' +
          'Use `/stats/team-usage` to view a specific service only.',
        tags: ['Team Usage'],
        parameters: [
          dateParam('startDate', 'Start date', '2025-01-01'),
          dateParam('endDate', 'End date', '2025-01-31'),
        ],
        responses: {
          '200': {
            description: 'Team × Service usage list',
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
                          deptname: { type: 'string', description: 'Department name' },
                          businessUnit: { type: 'string', description: 'Business unit' },
                          serviceId: { type: 'string', nullable: true, format: 'uuid', description: 'Service UUID' },
                          serviceName: { type: 'string', description: 'Service system name' },
                          serviceDisplayName: { type: 'string', description: 'Service display name' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens' },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens' },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output)' },
                          requestCount: { type: 'integer', description: 'API call count' },
                          uniqueUsers: { type: 'integer', description: 'Unique user count' },
                        },
                      },
                    },
                  },
                },
                example: {
                  data: [
                    { deptname: 'SW Innovation Team(S.LSI)', businessUnit: 'S.LSI', serviceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', serviceName: 'nexus-coder', serviceDisplayName: 'Nexus Coder', totalInputTokens: 1200000, totalOutputTokens: 600000, totalTokens: 1800000, requestCount: 3200, uniqueUsers: 15 },
                    { deptname: 'SW Innovation Team(S.LSI)', businessUnit: 'S.LSI', serviceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', serviceName: 'hanseol', serviceDisplayName: 'Hanseol', totalInputTokens: 500000, totalOutputTokens: 200000, totalTokens: 700000, requestCount: 1500, uniqueUsers: 8 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Bad request', 'startDate and endDate are required parameters. (format: YYYY-MM-DD)'),
          '500': errorResponse('Internal server error'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Top K Users
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/top-users': {
      get: {
        summary: 'Top K users by service',
        description:
          'Returns user information and usage for **top K users by token usage** in a specified service.\n\n' +
          '## Parameters\n' +
          '- `topK`: Maximum number of users to return (default: 10, min: 1, max: 100)\n' +
          '- If total users is less than topK, returns **only existing users**\n\n' +
          '## Response Fields\n' +
          '- `topK`: Requested K value\n' +
          '- `totalUsers`: Total number of users in the service\n' +
          '- `returnedCount`: Actual number of users returned (≤ topK)\n' +
          '- `data[]`: User information array (ordered by rank)\n\n' +
          '## Sort Criteria\n' +
          '`totalTokens` (input + output total) descending',
        tags: ['User Usage'],
        parameters: [
          dateParam('startDate', 'Start date', '2025-01-01'),
          dateParam('endDate', 'End date', '2025-01-31'),
          serviceIdParam(true),
          {
            name: 'topK',
            in: 'query',
            required: false,
            description: 'Maximum number of users to return (default: 10, min: 1, max: 100). Returns only existing users if total is less than topK',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10, example: 5 },
          },
        ],
        responses: {
          '200': {
            description: 'Top K users list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    topK: { type: 'integer', description: 'Requested K value', example: 5 },
                    totalUsers: { type: 'integer', description: 'Total number of users in the service', example: 42 },
                    returnedCount: { type: 'integer', description: 'Actual number of users returned (equals totalUsers if totalUsers < topK)', example: 5 },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          rank: { type: 'integer', description: 'Rank (starting from 1)', example: 1 },
                          userId: { type: 'string', format: 'uuid', description: 'User UUID' },
                          loginId: { type: 'string', description: 'User login ID (employee number)', example: 'syngha.han' },
                          username: { type: 'string', description: 'User name', example: 'Seungha Han' },
                          deptname: { type: 'string', description: 'Department name', example: 'SW Innovation Team(S.LSI)' },
                          businessUnit: { type: 'string', description: 'Business unit', example: 'S.LSI' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens', example: 850000 },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens', example: 420000 },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output)', example: 1270000 },
                          requestCount: { type: 'integer', description: 'API call count', example: 1580 },
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
                    { rank: 1, userId: 'uuid-1', loginId: 'syngha.han', username: 'Seungha Han', deptname: 'SW Innovation Team(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, userId: 'uuid-2', loginId: 'young87.kim', username: 'Youngsu Kim', deptname: 'AI Platform Team(DS)', businessUnit: 'DS', totalInputTokens: 720000, totalOutputTokens: 350000, totalTokens: 1070000, requestCount: 1320 },
                    { rank: 3, userId: 'uuid-3', loginId: 'jieun.park', username: 'Jieun Park', deptname: 'DevOps Team(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 600000, totalOutputTokens: 280000, totalTokens: 880000, requestCount: 950 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Bad request', 'serviceId is a required parameter.'),
          '500': errorResponse('Internal server error'),
        },
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. Top K Users by Department
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    '/stats/top-users-by-dept': {
      get: {
        summary: 'Top K users by service + department',
        description:
          'Returns user information and usage for **top K users by token usage** in a specified service + department.\n\n' +
          '## Parameters\n' +
          '- `serviceId`: Service UUID (required)\n' +
          '- `deptname`: Department name, **Team(BusinessUnit)** format (required). e.g., `SW Innovation Team(S.LSI)`\n' +
          '- `topK`: Maximum number of users to return (default: 10, min: 1, max: 100)\n' +
          '- If total users in the department is less than topK, returns **only existing users**\n\n' +
          '## Response Fields\n' +
          '- `topK`: Requested K value\n' +
          '- `deptname`: Department name used for filtering\n' +
          '- `totalUsersInDept`: Total number of users in the department\n' +
          '- `returnedCount`: Actual number of users returned (≤ topK)\n\n' +
          '## How to Find Department Names\n' +
          'Refer to the `deptname` field in `/stats/team-usage` API response.\n\n' +
          '## Sort Criteria\n' +
          '`totalTokens` (input + output total) descending',
        tags: ['User Usage'],
        parameters: [
          dateParam('startDate', 'Start date', '2025-01-01'),
          dateParam('endDate', 'End date', '2025-01-31'),
          serviceIdParam(true),
          {
            name: 'deptname',
            in: 'query',
            required: true,
            description: 'Department name (Team(BusinessUnit) format). Use the deptname value from /stats/team-usage response.',
            schema: { type: 'string', example: 'SW Innovation Team(S.LSI)' },
          },
          {
            name: 'topK',
            in: 'query',
            required: false,
            description: 'Maximum number of users to return (default: 10, min: 1, max: 100). Returns only existing users if total is less than topK',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10, example: 3 },
          },
        ],
        responses: {
          '200': {
            description: 'Top K users in department',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    topK: { type: 'integer', description: 'Requested K value', example: 3 },
                    deptname: { type: 'string', description: 'Queried department name', example: 'SW Innovation Team(S.LSI)' },
                    totalUsersInDept: { type: 'integer', description: 'Total number of users in the department', example: 12 },
                    returnedCount: { type: 'integer', description: 'Actual number of users returned', example: 3 },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          rank: { type: 'integer', description: 'Rank (starting from 1)', example: 1 },
                          userId: { type: 'string', format: 'uuid', description: 'User UUID' },
                          loginId: { type: 'string', description: 'User login ID (employee number)', example: 'syngha.han' },
                          username: { type: 'string', description: 'User name', example: 'Seungha Han' },
                          deptname: { type: 'string', description: 'Department name', example: 'SW Innovation Team(S.LSI)' },
                          businessUnit: { type: 'string', description: 'Business unit', example: 'S.LSI' },
                          totalInputTokens: { type: 'integer', description: 'Total input tokens', example: 850000 },
                          totalOutputTokens: { type: 'integer', description: 'Total output tokens', example: 420000 },
                          totalTokens: { type: 'integer', description: 'Total tokens (input + output)', example: 1270000 },
                          requestCount: { type: 'integer', description: 'API call count', example: 1580 },
                        },
                      },
                    },
                  },
                },
                example: {
                  topK: 3,
                  deptname: 'SW Innovation Team(S.LSI)',
                  totalUsersInDept: 12,
                  returnedCount: 3,
                  data: [
                    { rank: 1, userId: 'uuid-1', loginId: 'syngha.han', username: 'Seungha Han', deptname: 'SW Innovation Team(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 850000, totalOutputTokens: 420000, totalTokens: 1270000, requestCount: 1580 },
                    { rank: 2, userId: 'uuid-2', loginId: 'minjae.lee', username: 'Minjae Lee', deptname: 'SW Innovation Team(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 620000, totalOutputTokens: 310000, totalTokens: 930000, requestCount: 1120 },
                    { rank: 3, userId: 'uuid-3', loginId: 'suji.choi', username: 'Suji Choi', deptname: 'SW Innovation Team(S.LSI)', businessUnit: 'S.LSI', totalInputTokens: 480000, totalOutputTokens: 220000, totalTokens: 700000, requestCount: 890 },
                  ],
                },
              },
            },
          },
          '400': errorResponse('Bad request', 'deptname is a required parameter. (format: Team(BusinessUnit), e.g., SW Innovation Team(S.LSI))'),
          '500': errorResponse('Internal server error'),
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
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Stats - API Documentation</title>
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
