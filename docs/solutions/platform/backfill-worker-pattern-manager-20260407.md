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
  - postgresql-18
  - strapi-v5-snake-case
  - jsonb-cast
  - pg-array-literal
  - structured-output
  - chunked-indexing
  - openrouter
  - embedding-retry
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

### Strapi v5 snake-cases DB column names

The Strapi schema field `bcp47` becomes `bcp_47` in the database. All raw SQL must use the snake-cased form. The Strapi admin shows camelCase, but the DB is snake_case. Always verify column names against `\d tablename` in production before writing raw SQL.

### PostgreSQL 18: jsonb::text[] cast is not supported

The `?::jsonb::text[]` pattern documented in the pgvector best-practices doc does not work on PostgreSQL 18 (Railway's current version). Use PostgreSQL array literal format instead:

```typescript
// WRONG on PG 18 — jsonb::text[] cast unsupported
JSON.stringify(themes) → ?::jsonb::text[]

// CORRECT — PG array literal with ?::text[]
toPgArray(themes) → ?::text[]

function toPgArray(arr: string[]): string {
  if (arr.length === 0) return "{}"
  return "{" + arr.map(v =>
    '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
  ).join(",") + "}"
}
```

### duration lives on video_variants, not mux_videos

In the Strapi data model, `mux_videos.duration` is always 0. The actual duration is on the `video_variants` table. Filter by `vv.duration > 0`, not `mv.duration > 0`.

### Embed once per Video, filter by locale at query time

For dubbed content (translations of the same script), the industry standard is to embed once per content item and filter by locale at query time — not to embed separately per language. The thematic signal (forgiveness, hope, redemption) is the same across dubs. Locale-aware recommendations come from the query:

```sql
WHERE se.video_id != $current_video  -- dedup across language variants
  AND l.bcp47 = $user_locale         -- only videos in user's language
```

Per-language embeddings are appropriate for cross-lingual _search_ (feat-010), not _recommendations_.

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
<<<<<<< Updated upstream

### 6. Always verify raw SQL column names against prod DB

Strapi v5 snake-cases field names (`bcp47` → `bcp_47`). Run `\d tablename` in the target DB before writing raw SQL. Do not trust the Strapi schema file — it shows camelCase.

### 7. Test raw SQL against production before merging

A dry-run deployment is not enough — run the actual SQL query against the production database to catch column name mismatches, cast incompatibilities, and data distribution issues (e.g., `mux_videos.duration` being 0 for all rows).

### 8. Do not use jsonb::text[] on PostgreSQL 18+

Use PG array literal format (`{val1,val2}`) with `?::text[]` binding instead. The `jsonb::text[]` cast is not supported on PG 18.

### 9. Retry external API calls inside batch loops, not just at the SDK level

The OpenAI SDK has `maxRetries: 3` for HTTP-level errors (429, 500), but OpenRouter can also return 200 with a malformed body (missing `.data`). Wrap the call in try/catch inside a retry loop to handle both failure modes. Without this, ~8% of batch items fail on transient errors.

### 10. Protect expensive computed results with retry on the final write

When a pipeline spends tokens on LLM calls (scene analysis + embedding), the final persistence step (CMS POST) must have its own retry. Losing a 500-token embedding because of a transient 502 on the indexer is wasteful. Retry the write, not the whole pipeline.

### 11. Validate inputs before sending to external APIs

OpenRouter's embedding API returns `{ error }` (HTTP 200, no `.data`) for empty strings. The OpenAI SDK treats this as a successful response with a malformed body. Root cause: the LLM sometimes returns empty signals for a scene, producing an empty description string. Fix: filter empty descriptions before embedding — they have no semantic value for recommendations anyway. Always validate API inputs at the boundary, not just API outputs.

### 12. Use structured outputs for LLM extraction, not freeform JSON

OpenRouter/OpenAI `response_format: { type: "json_schema" }` guarantees valid JSON matching a specific schema. Eliminates `parseLLMJson` fallback paths entirely. Also enables the LLM to signal input quality issues (`inputQuality: "bad_frames"`) so the pipeline can retry with different data.

### 13. Constrain LLM outputs to enums where categories are known

Demographics, tone, and other categorical fields should use `enum` in the structured output schema rather than freeform strings. This prevents casing inconsistencies (`Adult` vs `adult`) and invented categories. Normalize to lowercase after extraction for anything not enum-constrained (themes).

### 14. Separate categorical dimensions into distinct columns

Demographics (age/life stage) and spiritual context (faith journey) are orthogonal dimensions. Store them in separate `TEXT[]` columns rather than mixing into one field. This enables independent filtering (e.g., "youth" AND "seeker") and cleaner faceted queries. Each column gets its own enum in the structured output schema.

### 15. Chunk large POST payloads with skip-delete for subsequent chunks

Feature films with 60+ scenes produce embedding payloads that exceed Strapi's body limit (413 Payload Too Large). Each 1536-dim embedding is ~12KB as JSON. Fix: POST in chunks of 20 scenes. First chunk does delete-then-insert (clears old data), subsequent chunks use `skipDelete: true` (append only). The CMS indexer accepts an optional `skipDelete` parameter.

### 16. Use Zod transform + pipe for case-insensitive enum validation

```typescript
z.string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(VALID_VALUES))
```

This lowercases the LLM output before validating against the enum. Prevents a single casing mismatch (`"Adult"` vs `"adult"`) from triggering a full Zod parse failure that discards ALL extracted signals.

## Final Results (feat-042)

| Metric                     | Value                                          |
| -------------------------- | ---------------------------------------------- | --- | --- | --- | --- | ---------- |
| Videos indexed             | 467/468 (1 video has no transcript)            |
| Scenes                     | 1,965                                          |
| Themes coverage            | 100%                                           |
| Demographics coverage      | 87%                                            |
| Spiritual context coverage | 97%                                            |
| Total cost                 | $0.74                                          |
| Processing time            | ~3.5 hours                                     |
| PRs                        | #664, #668, #670, #672, #674, #675, #677, #680 |
|                            |                                                |     |     |     |     | Stash base |

=======

### 9. Retry external API calls inside batch loops, not just at the SDK level

The OpenAI SDK has `maxRetries: 3` for HTTP-level errors (429, 500), but OpenRouter can also return 200 with a malformed body (missing `.data`). Wrap the call in try/catch inside a retry loop to handle both failure modes. Without this, ~8% of batch items fail on transient errors.

### 10. Protect expensive computed results with retry on the final write

When a pipeline spends tokens on LLM calls (scene analysis + embedding), the final persistence step (CMS POST) must have its own retry. Losing a 500-token embedding because of a transient 502 on the indexer is wasteful. Retry the write, not the whole pipeline.

> > > > > > > Stashed changes
