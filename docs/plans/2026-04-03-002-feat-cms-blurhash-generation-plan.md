---
title: "feat: Auto-generate blurhash for video_image records"
type: feat
status: completed
date: 2026-04-03
origin: docs/brainstorms/2026-04-03-cms-blurhash-generation-requirements.md
---

# feat: Auto-generate blurhash for video_image records

## Overview

Add automatic blurhash generation to the CMS so that `video_image` records receive a blurhash whenever their URL changes. Includes a backfill endpoint for existing records missing blurhash data.

## Problem Frame

Blurhash values are currently only populated via core API sync. Images added or updated directly in the CMS (via manager or admin) never get a blurhash, meaning consumers (web, mobile) can't show placeholder previews for those images. (see origin: docs/brainstorms/2026-04-03-cms-blurhash-generation-requirements.md)

## Requirements Trace

- R1. Auto-generate blurhash on `video_image` create/update when URL is present and blurhash is null
- R2. Do not overwrite existing blurhash values
- R3. Provide a backfill mechanism for existing records where blurhash is null, processing in batches
- R4. Design the generation logic as a reusable utility for future content types

## Scope Boundaries

- Only `video_image` content type. Other content types are future work.
- No GraphQL schema changes (blurhash field already exists).
- No admin panel UI changes.
- Core sync uses raw SQL (`bulkUpsertByCoreId`) which bypasses Strapi lifecycle hooks. The lifecycle hook only fires for Document Service writes (admin panel, GraphQL mutations).
- Core sync must stop writing the `blurhash` field so it doesn't overwrite CMS-generated values with null.

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/video-image/content-types/video-image/schema.json` — target content type, `blurhash` string field already exists
- `apps/cms/src/api/core-sync/services/sync-videos.ts` (lines 543-558) — where core sync writes `blurhash: img.blurhash ?? null`
- `apps/cms/src/api/core-sync/services/bulk-upsert.ts` — raw SQL upsert, bypasses lifecycle hooks
- `apps/cms/src/bootstrap/seed-easter.ts` — reference for fire-and-forget endpoint pattern
- `apps/cms/src/scripts/data-import.ts` — reference for standalone script pattern
- `apps/cms/src/api/data-snapshot/` — reference for custom REST endpoint with secret-auth middleware

### Institutional Learnings

- **Fire-and-forget endpoint pattern** (`docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md`): Batch operations should use an on-demand HTTP endpoint returning 202, not bootstrap or standalone CLI. Includes concurrency guard and status polling. Reuse `api::data-snapshot.secret-auth` middleware for auth.
- **Strapi v5 won't backfill existing rows** (`docs/solutions/database-issues/strapi-boolean-defaults-not-backfilled-on-existing-rows.md`): New/changed fields need explicit backfill.
- **EnrichmentJob pattern** (`docs/solutions/cms/strapi-enrichment-job-content-type.md`): For durable job state tracking across deploys if needed.

### External References

- Strapi v5 lifecycle hooks: `beforeCreate`/`beforeUpdate` receive `event` object with `event.params.data` for reading/modifying fields. Hooks can be async. File goes at `src/api/<name>/content-types/<name>/lifecycles.ts`.
- Blurhash generation: `blurhash` + `sharp` is the standard Node.js approach. Resize to ~32px first for performance (~2-5ms encode). Total per image ~50-150ms including network fetch.

## Key Technical Decisions

- **`blurhash` + `sharp` libraries**: Standard, battle-tested combo. `sharp` decodes images to raw RGBA pixels, `blurhash` encodes to the compact base83 string. No meaningful alternatives since the field already stores blurhash format.
- **Synchronous in lifecycle hook**: ~50-150ms per image is acceptable latency for a single document save. Avoids the complexity of async queuing for a single-image operation.
- **Fire-and-forget HTTP endpoint for backfill** (not CLI script): Follows the established pattern from the Easter seed solution. Returns 202 immediately, processes async with concurrency guard and status polling. Better suited to Railway (no SSH access, process memory resets on deploy). Reuses `secret-auth` middleware.
- **4x3 component count**: Standard blurhash encoding, ~28 character string. Good balance for landscape-oriented video thumbnails.
- **Resize to 32px before encoding**: Critical performance optimization — blurhash only captures low-frequency color data, so full-resolution images waste CPU. Makes encoding near-instant.
- **Append `/public` to URL**: The `url` field stores bare Cloudflare Image Delivery URLs without a variant. Must append `/public` (or a smaller variant) to get a fetchable image.
- **Remove blurhash from core sync**: Core sync currently writes `blurhash: img.blurhash ?? null` which would overwrite CMS-generated values. Since blurhash will now be generated locally, remove the field from the sync payload. Records with `source === "manager"` are already skipped by sync (line 112), but core-sourced records would have their backfilled blurhash wiped on next sync.
- **Post-sync blurhash pass**: After core sync completes, automatically generate blurhash for any newly created `video_image` records that have a URL but no blurhash. This covers new images brought in by core sync without requiring manual backfill re-runs.

## Open Questions

### Resolved During Planning

- **Which library?** `blurhash` + `sharp` — standard approach, wide ecosystem support, matches existing field format.
- **Sync vs async in lifecycle hook?** Synchronous — latency is acceptable for single saves (~50-150ms).
- **Batch concurrency for backfill?** 5-10 concurrent fetches to avoid Cloudflare rate limiting while keeping throughput reasonable.
- **CLI script vs HTTP endpoint for backfill?** HTTP endpoint following fire-and-forget pattern — matches institutional learnings and Railway constraints.

### Deferred to Implementation

- **Cloudflare flexible variants**: If enabled, fetching `/<id>/w=32,h=32,fit=inside` instead of `/<id>/public` would save bandwidth during backfill. Worth trying but falls back to `/public` + local resize if not available.
- **Error handling for invalid URLs**: Some `video_image` records may have broken or SVG URLs that can't produce a blurhash. Implementation should log and skip these gracefully.

## Implementation Units

- [ ] **Unit 0: Remove blurhash from core sync payload**

  **Goal:** Prevent core sync from overwriting CMS-generated blurhash values.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/api/core-sync/services/sync-videos.ts`

  **Approach:**
  - Remove the `blurhash: img.blurhash ?? null` line (line 556) from the image record data in `sync-videos.ts`
  - This means core sync will no longer write to the blurhash column. Existing values are preserved, and CMS-generated values won't be overwritten on next sync.
  - The `bulkUpsertByCoreId` UPDATE path only writes columns present in `rec.data`, so omitting the field means it won't be touched.

  **Patterns to follow:**
  - Other optional fields in the sync that are managed locally would follow the same pattern

  **Test scenarios:**
  - Core sync runs without errors after removing the field
  - Existing blurhash values on video_image records are not modified by sync
  - New video_image records created by sync have null blurhash (to be filled by backfill)

  **Verification:**
  - Run core sync and confirm blurhash column is untouched on existing records

- [ ] **Unit 1: Shared blurhash generation utility**

  **Goal:** Create a reusable function that takes an image URL and returns a blurhash string.

  **Requirements:** R1, R4

  **Dependencies:** None

  **Files:**
  - Create: `apps/cms/src/utils/generate-blurhash.ts`
  - Test: `apps/cms/src/utils/generate-blurhash.test.ts`

  **Approach:**
  - Add `blurhash` and `sharp` as dependencies to `apps/cms/package.json`
  - Function accepts a URL string, fetches the image, resizes to 32px with sharp, extracts raw RGBA pixels, encodes with `blurhash` at 4x3 components
  - Append `/public` to bare Cloudflare URLs if no variant is present
  - Return the blurhash string or throw on failure (caller decides how to handle)

  **Patterns to follow:**
  - Utility functions in `apps/cms/src/` follow simple export default/named export pattern
  - Use `Core.Strapi` typing at function boundaries per AGENTS.md guidance

  **Test scenarios:**
  - Given a valid image URL, returns a non-empty blurhash string matching expected format (~28 chars, base83)
  - Given an unreachable URL, throws an error
  - Given a URL without a variant suffix, appends `/public` before fetching

  **Verification:**
  - Function can be imported and called standalone
  - Returns valid blurhash strings for known test images

- [ ] **Unit 2: Lifecycle hook on video_image**

  **Goal:** Auto-generate blurhash on create/update when URL is present and blurhash is null.

  **Requirements:** R1, R2

  **Dependencies:** Unit 1

  **Files:**
  - Create: `apps/cms/src/api/video-image/content-types/video-image/lifecycles.ts`

  **Approach:**
  - This is the first lifecycle hook in the project — follows Strapi v5 convention: `export default { async beforeCreate(event), async beforeUpdate(event) }`
  - In both hooks: check if `event.params.data.url` is truthy and `event.params.data.blurhash` is null/undefined
  - For `beforeUpdate`, also guard against cases where `url` is not in the update payload (partial update)
  - Call the shared utility from Unit 1 to generate blurhash
  - Set `event.params.data.blurhash = generatedHash`
  - Wrap in try/catch — if blurhash generation fails (network error, invalid image), log a warning but allow the save to proceed. Blurhash is a nice-to-have, not a save-blocker.
  - Note: Strapi v5 `beforeCreate` fires more often than expected (publishing, status changes trigger it). The null-check guard on blurhash handles this correctly — if blurhash is already set, the hook is a no-op.

  **Patterns to follow:**
  - Strapi v5 lifecycle hook signature: `event.params.data` for field access
  - ESM `export default { ... }` format matching project convention

  **Test scenarios:**
  - Create with URL and no blurhash → blurhash is generated and set
  - Create with URL and existing blurhash → blurhash is not overwritten
  - Create with no URL → no blurhash generation attempted
  - Update changing URL with null blurhash → blurhash is generated
  - Update not changing URL → no blurhash generation attempted
  - Blurhash generation failure → save proceeds, warning logged

  **Verification:**
  - Creating a `video_image` via Strapi admin with a valid Cloudflare URL populates the blurhash field
  - Updating a record that already has a blurhash does not change it

- [ ] **Unit 3: Backfill endpoint**

  **Goal:** HTTP endpoint to backfill blurhash for all existing `video_image` records where blurhash is null.

  **Requirements:** R3

  **Dependencies:** Unit 1

  **Files:**
  - Create: `apps/cms/src/api/blurhash-backfill/routes/blurhash-backfill.ts`
  - Create: `apps/cms/src/api/blurhash-backfill/controllers/blurhash-backfill.ts`
  - Create: `apps/cms/src/api/blurhash-backfill/services/blurhash-backfill.ts`

  **Approach:**
  - Follow the fire-and-forget endpoint pattern from the Easter seed institutional learning
  - Two endpoints:
    - `POST /blurhash-backfill/trigger` — starts the backfill, returns 202 immediately
    - `GET /blurhash-backfill/status` — returns current progress (total, processed, errors, running)
  - Both protected with `global::api-token-auth` middleware (existing pattern from `core-sync`)
  - Service holds module-level state for concurrency guard (prevent duplicate runs) and progress tracking
  - Query `video_images` where `blurhash IS NULL AND url IS NOT NULL` using raw SQL via `strapi.db.connection`
  - Process in batches of 50 records, 5 concurrent fetches per batch
  - For each record: generate blurhash using Unit 1 utility, update via raw SQL
  - Log progress and errors. Skip records where generation fails (log URL and error).
  - Idempotent: re-running only processes records still missing blurhash

  **Patterns to follow:**
  - Route/controller/service structure matching `apps/cms/src/api/core-sync/`
  - Fire-and-forget pattern from `docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md`
  - Auth middleware pattern from `core-sync` routes
  - Raw SQL access via `strapi.db.connection` (knex) for performance

  **Test scenarios:**
  - Trigger returns 202 and starts async processing
  - Status returns progress with total/processed/errors/running counts
  - Records with existing blurhash are skipped
  - Records with null URL are skipped
  - Failed generations are logged and skipped, don't halt the batch
  - Concurrent trigger attempts are rejected (concurrency guard)
  - Re-running after partial completion picks up where it left off (only processes null blurhash)

  **Verification:**
  - After running against a database with null-blurhash records, all records with valid URLs have blurhash populated
  - Status endpoint shows completion with accurate counts
  - Records previously synced from core retain their original blurhash values

- [ ] **Unit 4: Post-sync blurhash generation**

  **Goal:** Automatically generate blurhash for newly synced images after core sync completes.

  **Requirements:** R1, R2

  **Dependencies:** Unit 0, Unit 1

  **Files:**
  - Modify: `apps/cms/src/api/core-sync/services/core-sync.ts`

  **Approach:**
  - After `analyzeModifiedTables` completes (around line 223 in `core-sync.ts`), add a post-sync step that:
    1. Queries `video_images` where `blurhash IS NULL AND url IS NOT NULL` using `strapi.db.connection`
    2. For each record, generates blurhash using the shared utility from Unit 1
    3. Updates the record via raw SQL (same pattern as the sync itself)
  - Process with same concurrency as backfill (5 concurrent fetches)
  - Log progress: `[core-sync] Generating blurhash for N images...`
  - Errors are logged and skipped per-record — a failed blurhash should not fail the sync
  - Only runs if the `videos` phase was included in the sync scope (check `phasesToRun.includes("videos")`)
  - This is fire-and-forget within the sync — the sync result is already computed, this is a post-processing enrichment step

  **Patterns to follow:**
  - `analyzeModifiedTables` call in the same file — a post-sync housekeeping step
  - Raw SQL access via `strapi.db.connection` matching the rest of core-sync

  **Test scenarios:**
  - After sync creates new video_images, blurhash is generated for records with URLs
  - Records that already have blurhash are skipped
  - Records with null URL are skipped
  - Individual generation failures don't halt the post-sync step
  - Post-sync step only runs when `videos` phase is in scope

  **Verification:**
  - Run core sync and confirm newly created video_images have blurhash populated
  - Existing records with blurhash are untouched

## System-Wide Impact

- **Interaction graph:** Lifecycle hook fires on all Document Service writes to `video_image` — admin panel, GraphQL mutations, any service using `strapi.documents()`. Does NOT fire on `bulkUpsertByCoreId` (raw SQL), which is correct.
- **Error propagation:** Blurhash generation failure in lifecycle hook is caught and logged — save proceeds normally. In backfill, failures are logged and skipped per-record.
- **State lifecycle risks:** Backfill uses module-level state for progress tracking — lost on Railway redeploy. Acceptable since the backfill is idempotent and can be re-triggered. If durability is needed later, upgrade to EnrichmentJob pattern.
- **API surface parity:** No GraphQL schema changes. The blurhash field already exists and is already exposed. Consumers automatically benefit.
- **Integration coverage:** Verify that the lifecycle hook does not interfere with core-sync (it won't — core sync uses raw SQL). Verify that publishing a video_image doesn't trigger redundant blurhash generation (the null-check guard handles this).

## Risks & Dependencies

- **`sharp` native dependency**: `sharp` requires native bindings (libvips). Should work on Railway's Linux containers and in the devcontainer, but verify it installs cleanly in both environments.
- **Network dependency in lifecycle hook**: Blurhash generation fetches from Cloudflare during save. If Cloudflare is unreachable, the save still proceeds (error is caught). But if latency spikes, saves will feel slow. Monitor and consider async approach if this becomes an issue.
- **Backfill volume**: Need to check how many `video_image` records have null blurhash. If thousands, the backfill may take minutes. The status endpoint provides visibility.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-03-cms-blurhash-generation-requirements.md](docs/brainstorms/2026-04-03-cms-blurhash-generation-requirements.md)
- Related code: `apps/cms/src/api/video-image/content-types/video-image/schema.json`
- Related code: `apps/cms/src/api/core-sync/services/sync-videos.ts`
- Institutional learning: `docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md`
- Institutional learning: `docs/solutions/cms/strapi-enrichment-job-content-type.md`
- External: [Strapi v5 lifecycle hooks docs](https://docs.strapi.io/dev-docs/backend-customization/models)
- External: [blurhash TypeScript encoder](https://github.com/woltapp/blurhash/blob/master/TypeScript/README.md)
- External: [sharp raw pixel extraction](https://github.com/lovell/sharp/blob/main/docs/src/content/docs/api-output.md)
