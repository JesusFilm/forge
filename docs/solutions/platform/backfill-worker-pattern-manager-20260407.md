---
title: "Backfill Worker Pattern — Next.js Manager with CMS Queue"
problem_type: best_practice
component: manager
root_cause: missing_tooling
resolution_type: tooling_addition
severity: medium
date: "2026-04-07"
features:
  - "feat-042"
tags:
  - backfill
  - batch-processing
  - next-js
  - after-callback
  - cost-tracking
  - railway
  - scene-embeddings
module: manager
key_files:
  - "apps/manager/src/services/backfill.ts"
  - "apps/manager/src/services/sceneEmbedder.ts"
  - "apps/manager/src/services/cmsClient.ts"
  - "apps/manager/src/services/backfillQueue.ts"
  - "apps/manager/src/app/api/backfill/start/route.ts"
  - "apps/cms/src/api/backfill-queue/services/backfill-queue.ts"
related:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
  - "docs/solutions/platform/multimodal-scene-analysis-pipeline.md"
---

## Problem

A one-time batch job needs to process ~955 videos through an AI pipeline (scene analysis + embedding + pgvector indexing). The job must be resumable, cost-tracked, and run without blocking the manager's normal pipeline. The manager is a Next.js app on Railway with `restartPolicyMaxRetries: 3`.

## What Didn't Work

### 1. Separate Railway service / CLI script

A standalone `npx tsx` script would need to resolve Next.js path aliases (`@/*`) outside the Next.js build, requiring separate tsconfig and build setup. The manager already has all the pipeline services wired up — duplicating that context into a CLI script adds unnecessary complexity for a one-time job.

### 2. Running check only in the async handler (TOCTOU)

First implementation checked `status.running` in the route handler, then dispatched `after(() => startBackfill())`. Two concurrent POST requests could both see `running=false` and both return 202, but only one backfill actually runs — the second throws inside `after()` and is silently caught.

### 3. Silent JSON parse failure

First implementation wrapped `request.json()` in a catch-all that swallowed malformed JSON (not just empty bodies), silently using default config. A request with `Content-Type: application/json` and body `{broken` would succeed with defaults instead of returning 400.

## Solution

### Architecture: API route + after() background execution

Three manager API routes (`/api/backfill/start`, `/status`, `/cancel`) control the backfill. The start route uses Next.js `after()` to run the batch in background — same pattern as the existing scene-analysis route. No separate service needed.

### Claim-then-start pattern (TOCTOU fix)

```typescript
// claimBackfill() synchronously sets running=true BEFORE after() dispatches.
// This prevents two concurrent requests from both seeing running=false.
export function claimBackfill(config?: Partial<BackfillConfig>): boolean {
  if (status.running) return false
  status = { running: true, config: { ...DEFAULT_CONFIG, ...config }, ... }
  return true
}

// startBackfill() is parameterless — reads config from status.config.
// Avoids config divergence between claim and start.
export async function startBackfill(): Promise<void> {
  if (!status.running) throw new Error("claimBackfill must be called first")
  const config = status.config
  // ... batch loop
}

// Route: claim synchronously, then dispatch async
const claimed = claimBackfill(config)
if (!claimed) return NextResponse.json({ error: "Already running" }, { status: 409 })
after(async () => { await startBackfill() })
```

### Progress tracking via output table

No separate progress table. The `scene_embeddings` table IS the progress indicator — if a video has rows there, it's done. On restart, `fetchProcessedVideoIds()` queries `SELECT DISTINCT video_id FROM scene_embeddings` and the batch skips those videos.

### CMS backfill-queue endpoint (raw SQL)

The queue query joins `videos → video_subtitles → languages` + `video_variants → mux_videos` with a critical constraint: **variant language must match subtitle language** (`video_variants_language_lnk.language_id = l.id`). Without this, `DISTINCT ON (v.id)` could return a mux_asset_id from a different language variant than the selected subtitle, producing incoherent scene analysis (English transcript + Spanish video stills).

### Content-type check before JSON parse

```typescript
const contentType = request.headers.get("content-type") ?? ""
if (contentType.includes("application/json")) {
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
}
// No content-type → use defaults (empty body is fine)
```

### Shared CMS client

Extracted `cmsClient.ts` with `cmsGet<T>()` and `cmsPost<T>()` — shared auth header, timeout, and error handling (response body truncated to 500 chars to prevent log leakage of internal Strapi errors).

## Why This Works

1. **after() runs in the same process** — no separate service to deploy, same dependency context, no path alias issues.
2. **Claim-then-start** is synchronous within the Node.js event loop — no race window between check and state mutation.
3. **Output-as-progress** means zero additional state to maintain. The idempotent delete-then-insert indexer makes re-processing safe.
4. **Railway restarts** lose in-memory status but NOT persisted work. The next `/start` call re-queries the CMS, filters done videos, and continues.

## Prevention

### 1. Always claim locks synchronously before after()

Any API route that dispatches background work via `after()` should claim its guard (mutex, running flag) synchronously in the request handler, not inside the callback.

### 2. Constrain SQL cross-joins in DISTINCT ON queries

When using `DISTINCT ON` with multi-table joins, ensure all joined dimensions are constrained to the same entity. An unconstrained cross-join produces a cartesian product that `DISTINCT ON` arbitrarily picks from.

### 3. Check content-type before parsing request bodies

Don't wrap `request.json()` in a catch-all. Check `content-type` first — empty bodies without JSON content-type are "use defaults", malformed JSON with JSON content-type is a 400.

### 4. Cap and truncate error logs in long-running batch jobs

Module-level error arrays must be bounded (shift at cap) and error messages truncated (500 chars). This prevents memory growth on systemic failures and limits information leakage through status endpoints.

### 5. Separate claim from execution in background workers

When a route both validates and dispatches, split into `claim()` (synchronous, returns success/failure) and `execute()` (async, parameterless, reads from claimed state). This makes the contract explicit and prevents config divergence.
