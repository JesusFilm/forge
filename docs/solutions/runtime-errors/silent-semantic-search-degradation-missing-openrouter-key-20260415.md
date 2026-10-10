---
title: "Silent production semantic-search degradation — missing OPENROUTER_API_KEY swallowed by graceful-degradation try/catch"
date: 2026-04-15
problem_type: runtime_error
component: database
root_cause: config_error
resolution_type: code_fix
severity: critical
module: apps/cms
tags:
  - cms
  - search
  - ai-pipeline
  - semantic-search
  - openrouter
  - graceful-degradation
  - observability
  - railway
  - production-outage
  - pgvector
  - health-check
  - process-local-counters
files_changed:
  - apps/cms/src/api/search/services/search.ts
  - apps/cms/src/api/search/services/search-health.ts
  - apps/cms/src/api/search/controllers/search.ts
  - apps/cms/src/api/search/routes/search.ts
  - apps/cms/src/graphql/search.ts
related_files:
  - apps/cms/src/lib/openrouter.ts
  - apps/cms/src/api/search/services/fusion.ts
  - apps/cms/src/lib/rate-limit-bucket.ts
  - apps/cms/config/cron-tasks.ts
github_prs:
  - "#778"
  - "#780"
github_issues:
  - "#778"
related_docs:
  - "docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md"
  - "docs/solutions/best-practices/rrf-fusion-heterogeneous-content-types-20260415.md"
  - "docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md"
  - "docs/solutions/platform/new-app-ci-and-deployment-patterns.md"
  - "docs/solutions/platform/optional-railway-s3-local-fallback.md"
last_updated: "2026-04-16"
---

## Problem

Production semantic search on the JesusFilm forge CMS was silently degraded to keyword-only mode because `OPENROUTER_API_KEY` was never set on the Railway `forge-cms` service. The search orchestrator's graceful-degradation `try/catch` around `embedQuery` logged at `warn` level with no counters, no response signal, and no probe endpoint — letting every search query return degraded results for an unknown number of days with zero operational visibility.

## Symptoms

- Search queries returned results with flat `0.500` top scores and `null` scene-level data (`startSeconds: null`, `playbackId: null`). The score `0.500 = (1/61) / (2/61)` is the exact RRF fingerprint for rank-1 keyword + empty semantic across 2 fusion lists.
- Rank distribution followed the degraded pattern precisely: `0.500, 0.492, 0.484` matching `(1/(k+rank)) / (2/(k+1))` for `k=60`.
- Thematic/conceptual queries like `"feeling alone in suffering"` and `"centurion at the cross"` returned zero results — these depend entirely on semantic matching with no keyword signal.
- HTTP status was always 200 (graceful degradation working as designed — API contract preserved).
- `strapi.log.warn(...)` lines were present in Railway logs but not noticed — `warn` level falls below most operators' default alert threshold.

## What Didn't Work

1. **Railway CLI silent failure.** `railway status`, `railway whoami`, and `railway variables` all exited with code 1 and produced no output. No error message, no diagnostic hint. Root cause: the browser-login access token (`tokenExpiresAt` in `~/.config/railway/config.json`) had expired ~19 hours earlier. Railway CLI does not distinguish "expired token" from "no auth" — both produce exit 1 with empty stdout/stderr.

2. **Direct Railway API via account token.** Browser-login tokens expire in ~24h and require interactive re-auth. Solution: create an Account Token at `https://railway.com/account/tokens` and pass as `RAILWAY_API_TOKEN` env var. Account tokens are durable (no expiry) and work with the Railway GraphQL API at `https://backboard.railway.com/graphql/v2` for variable reads/writes. Note: `railway whoami`/`status` CLI commands don't work with API tokens, but direct GraphQL queries and mutations (including `variableUpsert`) do. (auto memory [claude])

## Solution

### Immediate operational fix

Set `OPENROUTER_API_KEY` on `forge-cms` production via Railway GraphQL API:

```graphql
mutation ($input: VariableUpsertInput!) {
  variableUpsert(input: $input)
}
# variables:
# {
#   "input": {
#     "projectId": "<forge-project-id>",
#     "environmentId": "<production-env-id>",
#     "serviceId": "<forge-cms-service-id>",
#     "name": "OPENROUTER_API_KEY",
#     "value": "<key-value-from-forge-manager>"
#   }
# }
```

Railway auto-redeployed the service in ~62 seconds. Post-fix: "feeling alone in suffering" → 20 results (was 0); Easter → scores distributed with populated `startSeconds`/`playbackId` and rich semantic snippets.

### Code hardening (PR #780) — four changes to prevent silent recurrence

**1. Log level `warn` → `error` with structured event tag:**

```typescript
// Before — silent degradation
strapi.log.warn(
  `[search] Query embedding failed, falling back to keyword-only: ${
    error instanceof Error ? error.message : String(error)
  }`,
)

// After — structured error surfacing for log-based alerts
const errorClass =
  error instanceof Error ? error.constructor.name : "UnknownError"
const message = error instanceof Error ? error.message : String(error)
strapi.log.error(
  `[search] event=query_embedding_failure error_class=${errorClass} message=${message}`,
)
```

**2. Process-local health counters** (`apps/cms/src/api/search/services/search-health.ts`):

```typescript
let attempts = 0
let failures = 0
let lastErrorMessage: string | null = null
let lastErrorClass: string | null = null
let lastErrorAt: string | null = null

export function recordAttempt(): void {
  attempts += 1
}
export function recordFailure(error: unknown): void {
  failures += 1
  lastErrorMessage = error instanceof Error ? error.message : String(error)
  lastErrorClass =
    error instanceof Error ? error.constructor.name : "UnknownError"
  lastErrorAt = new Date().toISOString()
}
export function getStats(): SearchHealthStats {
  /* returns snapshot */
}
```

Pattern: `recordAttempt()` before try, `recordFailure(error)` in catch. Modeled after the existing `rate-limit-bucket.ts` singleton pattern — module-level state, functional API, test-only reset hook.

**3. `searchMode` response field** on both REST and GraphQL:

```typescript
// In SearchResponse type
export type SearchMode = "hybrid" | "keyword-only"
// Derived from queryEmbedding != null at the return site
searchMode: queryEmbedding != null ? "hybrid" : "keyword-only"
```

Added as `searchMode: String!` in GraphQL (not an enum — forward-compatible if modes are added later). Non-breaking additive field; consumers opt in by querying it.

**4. `GET /api/search/health` probe endpoint:**

Runs `embedQuery("health probe")` with a 5-second `withTimeout` wrapper. Returns HTTP 200 always (separates CMS liveness from OpenRouter reachability). Body: `{ status: "ok" | "degraded", error: string | null, attempts, failures, lastErrorMessage, lastErrorClass, lastErrorAt }`. Dedicated `search-health` rate-limit bucket at 5/min (tighter than the 30/min search bucket — a legitimate monitor polls once per minute).

Design decision: always-200 because a non-200 would cause Railway to mark the CMS unhealthy and pull it from the load balancer, which is wrong when the CMS itself is fine and only the external embedding provider is down.

## Why This Works

The root cause was a missing environment variable — `OPENROUTER_API_KEY` was set on `forge-manager` (for enrichment pipelines) but never propagated to `forge-cms` when the search feature (feat-010) was deployed. The orchestrator's `try/catch` did exactly what it was designed to do: degrade gracefully, return keyword-only results, keep the API contract intact. The bug wasn't in the degradation logic — it was in the _visibility_ of that degradation.

The hardening changes add four independent detection channels:

1. **Error-level logs** survive default Railway log retention and can trigger alerts.
2. **Counters** give process-level state without a metrics sink.
3. **`searchMode` field** lets consumers detect and signal degradation to users.
4. **Health probe** lets external monitors detect the failure before users do.

Any one of these would have caught the production incident within minutes rather than days.

## Prevention

### 1. Never let graceful degradation be silent

When a `try/catch` degrades a core feature, log at `error` (not `warn`) and expose a machine-readable signal in the response. Warn-level says "unusual but expected." Error-level says "the product contract is violated even though the HTTP status is fine."

### 2. Add observability that exercises the real dependency

Unit tests mock `embedQuery` — they prove the code paths work but cannot detect a missing env var in production. The `/api/search/health` probe calls the real OpenRouter API on every poll, catching environmental failures that no amount of code testing will surface.

### 3. Know the RRF score signature for degraded mode

When hybrid search is degraded to keyword-only, the RRF normalization formula produces distinctive scores. With `k=60` and 2 lists (semantic + keyword): rank-1 = `0.500`, rank-2 = `0.492`, rank-3 = `0.484`. With 4 lists (video-semantic, video-keyword, experience-semantic, experience-keyword): a rank-1 hit in 2 of 4 lists = `0.500` (which is structurally identical — distinguish by checking whether `startSeconds`/`playbackId` are populated on video results).

### 4. Document cross-service key coupling

`forge-cms` and `forge-manager` share the same `OPENROUTER_API_KEY` in production. Rotating the key requires updating both Railway services simultaneously. This coupling should be documented in deployment runbooks. (auto memory [claude])

### 5. Railway CLI token hygiene

Railway browser-login tokens expire in ~24h. For durable access from devcontainers or CI, use Account Tokens from `https://railway.com/account/tokens` and pass as `RAILWAY_API_TOKEN`. The CLI's `whoami`/`status` commands don't work with API tokens, but the GraphQL API (`https://backboard.railway.com/graphql/v2`) does — use it for `variables` queries and `variableUpsert` mutations. (auto memory [claude])

## Related Documentation

- [Next.js Server Action + LLM structured output with defense-in-depth validation](../best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md) — the client-side counterpart pattern shipped in PR #809. Reuses the same observability discipline (`console.error` before the typed-error collapse) plus a per-request retry helper covering 5xx / 429 (honoring `Retry-After`) / transport errors with jittered backoff — worth mirroring if any future server-to-server OpenRouter path still runs the bare SDK with no retry shape.
- Shared `OPENROUTER_API_KEY` now spans `@forge/cms`, `@forge/manager`, and `@forge/web` (PR #809 added the third consumer). Any rotation must update all three Railway services in the same deploy window.
