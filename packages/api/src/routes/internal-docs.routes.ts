/**
 * Internal API Documentation
 * Serves HTML docs for /internal/org/* endpoints
 */

import { Router } from 'express';

export const internalDocsRoutes = Router();

internalDocsRoutes.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Internal Org API - Agent Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; background: #0f172a; color: #e2e8f0; }
  h1 { color: #818cf8; margin-bottom: 8px; }
  .subtitle { color: #64748b; margin-bottom: 32px; }
  h2 { color: #6366f1; border-bottom: 1px solid #1e293b; padding-bottom: 8px; margin: 32px 0 16px; }
  .endpoint { background: #1e293b; padding: 20px; border-radius: 12px; margin: 16px 0; border-left: 4px solid #6366f1; }
  .method { display: inline-block; background: #22c55e20; color: #22c55e; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.85em; }
  .path { color: #f59e0b; font-family: 'SF Mono', Consolas, monospace; font-size: 1.05em; margin-left: 8px; }
  .desc { color: #94a3b8; margin-top: 8px; line-height: 1.6; }
  .params { margin-top: 12px; }
  .param { background: #0f172a; padding: 8px 12px; border-radius: 6px; margin: 4px 0; font-size: 0.9em; }
  .param code { color: #818cf8; }
  .param .type { color: #64748b; }
  pre { background: #0f172a; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 0.85em; margin-top: 12px; }
  .note { background: #422006; border: 1px solid #92400e; padding: 12px 16px; border-radius: 8px; color: #fbbf24; margin: 24px 0; font-size: 0.9em; }
</style></head><body>
<h1>Internal Organization API</h1>
<p class="subtitle">Private endpoints for nexus-web. No authentication required (internal network trust).</p>

<div class="note">These endpoints are NOT part of the public Swagger docs. They are designed for internal service-to-service communication only.</div>

<h2>Endpoints</h2>

<div class="endpoint">
  <span class="method">GET</span><span class="path">/internal/org/tree</span>
  <div class="desc">Returns the full organization hierarchy as a nested tree structure.</div>
  <pre>Response: { tree: [{ departmentCode, departmentName, enDepartmentName, children: [...] }], totalNodes: number }</pre>
</div>

<div class="endpoint">
  <span class="method">GET</span><span class="path">/internal/org/tree/:deptCode</span>
  <div class="desc">Returns the subtree rooted at the given department code.</div>
  <div class="params">
    <div class="param"><code>:deptCode</code> <span class="type">string</span> - Knox department code</div>
  </div>
</div>

<div class="endpoint">
  <span class="method">GET</span><span class="path">/internal/org/user/:loginId</span>
  <div class="desc">Returns a user's department info and full hierarchy chain (root to leaf).</div>
  <div class="params">
    <div class="param"><code>:loginId</code> <span class="type">string</span> - Knox login ID (e.g. syngha.han)</div>
  </div>
  <pre>Response: { user: { loginId, name, deptName, deptCode }, hierarchy: [{ code, name, enName }] }</pre>
</div>

<div class="endpoint">
  <span class="method">GET</span><span class="path">/internal/org/search?q=keyword</span>
  <div class="desc">Search departments by Korean or English name. Minimum 2 characters.</div>
  <div class="params">
    <div class="param"><code>q</code> <span class="type">string</span> - Search keyword (min 2 chars)</div>
  </div>
</div>

<div class="endpoint">
  <span class="method">GET</span><span class="path">/internal/org/departments</span>
  <div class="desc">Flat list of all departments (for dropdown/autocomplete selectors).</div>
  <pre>Response: { departments: [{ departmentCode, departmentName, enDepartmentName, parentDepartmentCode, userCount }], count: number }</pre>
</div>

</body></html>`);
});
