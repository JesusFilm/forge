---
title: "refactor: Admin embed-backfill (R1 + R2) performance — bounded parallelism, batched embeds, bulk SQL"
type: refactor
status: active
date: 2026-05-04
origin: docs/roadmap/content-discovery/feat-115-embed-backfill-bounded-parallelism.md
related:
  - docs/roadmap/content-discovery/feat-116-embed-backfill-s3-cache-and-batched-openrouter.md
  - docs/roadmap/content-discovery/feat-117-embed-backfill-bulk-sql-writes.md
  - docs/roadmap/content-discovery/feat-118-embed-backfill-content-hash-skip.md
---

# refactor: Admin embed-backfill (R1 + R2) performance — bounded parallelism, batched embeds, bulk SQL

## Overview

R1 (scene) and R2 (transcript) backfill workflows are sequential `for…of` loops over `(video, edition, locale)` triples. At ~1,088 videos × ~30 locales × 10–50 scenes each, a full multi-locale run takes many hours. This plan stages a **three-PR sequence** (with a fourth PR flagged as follow-up) that compounds wall-time wins without changing the GraphQL trigger surface, the local CLI shape, or the embedding-model invariants:

1. **Stage 1 — Bounded parallelism** on the per-target loop (`p-limit` + `Promise.allSettled`).
2. **Stage 2 — S3 artifact memoization + batched OpenRouter calls** (one fetch per `(video, edition)`, one provider call per `(video, locale)`).
3. **Stage 3 — Bulk DB writes** via single `INSERT … unnest(...) ON CONFLICT … DO UPDATE` per write batch.
4. **Stage 4 (follow-up, out of scope here)** — Content-hash skip for re-runs (port R3's `cms_content_hash` pattern).

PR-to-ticket mapping is 1-to-1 with the existing roadmap tickets `feat-115`..`feat-118`.

## Problem Frame

Current shape (both workflows):

```
enumerate (video, edition, locale) targets
for each target:                      ← sequential
  read scene-analysis.json (R1) /     ← re-fetched every locale
       embeddings.json (R2) from S3
  for each scene/chunk:                ← R1 only
    OpenRouter embed(scene.description) ← one call per scene
  prisma.$transaction:
    for each scene/chunk:               ← per-row round-trip
      upsert ... + $executeRaw ::vector
```

Result: workflow wall-time is dominated by (a) OpenRouter call count on R1, (b) S3 reads on both, and (c) per-row Prisma round-trips on both. None of these are CPU-bound — they're all latency × N — so each stage independently buys multiplicative speedup.

The user expects to re-run periodically (model upgrade, partial corpus refresh). The wins here also lower per-run cost, but Stage 4's content-hash skip is what makes "re-run weekly" actually cheap; that lands as a separate PR per ticket `feat-118`.

## Requirements Trace

- **R1.** Reduce wall-time of a full multi-locale R1 + R2 backfill by at least 50× compounded across the three PRs (5–10× from parallelism, 5–10× from batched OpenRouter, 1.5–3× from bulk SQL).
- **R2.** Reduce OpenRouter API call count on R1 by ≥20× (target: ~30k calls instead of ~500k for a full backfill).
- **R3.** Preserve per-target error isolation: `artifact_missing` stays `skipped`, provider/DB errors stay `failed`, neither aborts sibling targets.
- **R4.** Preserve idempotency — re-running any subset produces identical DB state.
- **R5.** Preserve external surface: GraphQL `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill` JSON shape and `pnpm --filter @forge/admin run-embeds` CLI args/output unchanged except for ordering and per-target metrics that are now batched-derived.
- **R6.** Preserve embedding invariants: `text-embedding-3-small`, 1536-d, dimension validation, no `embedding`/`vector` field exposed via GraphQL (`schema.test.ts` guard).
- **R7.** Preserve dispatch-level test coverage (`docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`) — every `start()` site keeps its dispatch test green.
- **R8.** Concurrency must be env-tunable so prod can ramp conservatively (start at 5) while local cranks (20+).
- **R9.** Each ticket flips `status: not-started → in-progress` when its PR opens and `→ complete` (with a `## Resolution` section) when its PR merges; `docs/roadmap/README.md` reflects each flip.

## Scope Boundaries

- **In scope:** R1 (`apps/admin/src/workflows/sceneEmbeddingBackfill.ts` + `services/scene-embedding.service.ts`) and R2 (`apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` + `services/transcript-embedding.service.ts`). The CLI `apps/admin/src/scripts/run-embeds.ts` and the env validator `apps/admin/src/config/env.ts`. The OpenRouter provider in `apps/admin/src/services/embeddings.service.ts` (new batch entrypoint).
- **Out of scope:** R3 (Experience content dump) and R4/R5 (read-side hybrid search / scene recommendations) are untouched. R3's `cms_content_hash` pattern is the precedent for Stage 4 but Stage 4 ships under `feat-118` as a separate PR.
- **Out of scope (future):** `DROP INDEX → bulk INSERT → CREATE INDEX` operator-mode for full re-embed runs (HNSW maintenance is per-row internally; bulk insert helps round-trip cost only). Capture as future enhancement note in the new bulk-insert solutions doc.
- **Non-goal:** Changing the locale-enumeration query, the manager-artifacts S3 key shape, the data-derived locale set, or the dispatch surface.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` (line 132–137): the per-target `for…of` to replace; `stepIndexEditionLocale` already classifies outcomes into `succeeded | skipped | failed` with typed-error branching on `ManagerArtifactError("artifact_missing")`.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`: identical shape; same edits apply.
- `apps/admin/src/services/scene-embedding.service.ts`:
  - Generates embeddings outside the transaction with `Promise.allSettled(scenes.map(...))` already (line 155–161). The change is to replace the **N parallel single-input calls** with **one batched call** containing every scene's text.
  - Per-scene Prisma upsert + `$executeRaw … ::vector` write loop inside `$transaction` (line 211–294). Stage 3 collapses to one `$executeRaw … unnest(...) ON CONFLICT` per locale.
- `apps/admin/src/services/transcript-embedding.service.ts`: per-chunk upsert + `$executeRaw` loop (line 305–346). Stage 3 collapses identically; no provider call to batch (R2 reuses vectors verbatim).
- `apps/admin/src/services/embeddings.service.ts::generateExperienceEmbedding` (line 121–203): single-input shape today (`input: [normalizedText]`). The OpenRouter / OpenAI embeddings endpoint already accepts an `input: string[]` array; the request shape change is trivial. Add a sibling `generateExperienceEmbeddings(inputs: string[])` that returns `{ model, dimensions, embeddings: number[][] }` ordered by input position; refactor the singular helper to delegate to the batched one with `[text]`.
- `apps/admin/src/db/pgvector.ts`:
  - `toPgArray(values: readonly string[])` — quoted PG array literal (`{val1,val2}`); rejects unsafe braces. **Bind site keeps the parameter count at 1 regardless of N** — this is the canonical workaround for the 32,767 prepared-statement param cap.
  - `toPgVector(embedding: readonly number[])` — `[0.1,0.2,...]` text form. Stage 3 wraps each row's vector text inside a `toPgArray` call (the outer text-array of vector strings, cast to `vector(1536)[]` server-side).
- `apps/admin/src/services/core-sync/phases/sync-dubs.ts` — array-bound `$executeRaw` soft-delete is the canonical reference for the bulk-bind pattern (cf. `apps/admin/CLAUDE.md` "Core sync — video-dubs phase"). Stage 3 mirrors its structure.
- `apps/admin/src/config/env.ts` — t3-oss/zod env validator. Two new optional zod-int entries with default-via-`.optional()` (read defaults at the call site, not in zod, so the env file documents only the override).
- `apps/admin/src/scripts/run-embeds.ts` — CLI direct-invokes the workflow function bodies; surface the resolved concurrency in the `run-embeds.start` event for operator visibility.
- `apps/admin/src/storage/s3.ts` — current S3 read side; option B (per-workflow memoization) is preferred over option A (LRU at storage layer) because the cache is bounded by enumeration order and naturally gc'd when the workflow returns.

### Institutional Learnings

- **`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`** — the no-`Promise.all` rule. Stage 1 must use bounded `p-limit` + `Promise.allSettled`. Outcome ordering may differ from sequential; tests asserting strict ordering are bugs to fix.
- **`docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`** — every workflow `start()` call site has a dispatch-level test. Stages 1–3 do not add new `start()` sites, so this rule constrains us not to remove existing dispatch tests, not to add new ones.
- **`docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`** — every new `$executeRaw` template needs SQL-shape assertions in tests, not row-mapping checks. Stage 3 tests assert the SQL contains `INSERT INTO`, `unnest(`, `ON CONFLICT`, `DO UPDATE`, and the right type cast (`vector(1536)[]` for R1, `text[]` for R2 chunk text).
- **`docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`** — bulk inserts MUST bind arrays as single PG-array literals via `toPgArray`, not as N separate parameters. The `sync-dubs` phase regressed once at 209k rows; the test there is a regression guard. Stage 3's tests need an equivalent bind-count assertion.
- **`docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md`** — any enum-typed column in raw SQL must use the lowercase `@map`'d DB literal, not the uppercase TS variant name. Neither `video_scene_locale` nor `video_transcript_chunk` writes touch enum columns today; if Stage 3 introduces one (e.g., `source` filter), use the DB literal form.
- **`docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`** — locale set stays data-derived. No regression risk in this plan; flagged here so future readers know not to "optimise" by hardcoding a locale list.
- **`docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md`** + **`postgres-generated-column-drift-add-column-if-not-exists-20260429.md`** — `video_scene_locale` and `video_transcript_chunk` do **not** carry generated tsvector columns today (those live on `video_locale`). Stage 3 doesn't need an exclusion list; flag this as a constraint so a future schema change with generated columns trips the test, not prod.

### External References

External research **skipped**. The OpenRouter / OpenAI embeddings batch shape (`input: string[]`, returns `data[]` in input order) is documented in OpenAI's API reference and already in use by sibling pipelines in this repo. The pgvector `vector(N)[]` array-cast pattern is established in `apps/admin/src/services/core-sync/phases/sync-dubs.ts` and the bind-variable solutions doc. `p-limit` is already a transitive dep (`pnpm-lock.yaml` shows `p-limit@7.3.0` resolved); no new external best-practice survey is needed.

## Key Technical Decisions

- **Per-workflow memoization over storage-layer LRU (Stage 2).** Reshape the enumerator to `(video, edition) → locales[]`, fetch artifact once per outer iteration, pass the loaded artifact down via a new optional `artifactOverride` arg (already exists for tests; widening its non-test use is cheap). Bounds memory to one artifact at a time, releases naturally when the inner loop closes. Avoids cache-eviction tuning and cross-request bleed risk that an LRU at the storage layer would introduce.
- **Batch OpenRouter at the service layer, not the workflow.** Add `generateExperienceEmbeddings(inputs: string[])` to `embeddings.service.ts`; refactor `generateExperienceEmbedding(text)` to delegate. The scene service calls the batched form with `scenes.map(s => s.description)`. This isolates the provider's batch contract (input order = output order, same model/dimension validation per row, rate-limit accounting per request) inside one module and gives `embeddings.service.test.ts` exactly one place to assert input-order stability.
- **One bulk-write per `(video, edition, locale)` write batch (Stage 3), not per-target.** The transaction boundary stays per-target so a single locale's write failure doesn't poison a sibling. Inside the transaction we collapse N upserts into:
  1. `videoScene` / `videoTranscript` parent upserts unchanged (1–N parents per target; N is small — typically 1).
  2. Pre-prune `deleteMany` unchanged.
  3. **One** `$executeRaw … INSERT … SELECT * FROM unnest(...) ON CONFLICT … DO UPDATE …` for the locale's child rows (`video_scene_locale` or `video_transcript_chunk`).
  4. **No separate `$executeRaw … UPDATE … SET embedding = …`** — the bulk INSERT writes `embedding` directly via `unnest($vec_strings::text[])::vector(1536)[]`, eliminating the per-row vector update round-trip that exists today.
- **Concurrency env var defaults are read at the call site, not in zod.** `env.ts` declares `SCENE_EMBEDDING_CONCURRENCY` and `TRANSCRIPT_EMBEDDING_CONCURRENCY` as `z.coerce.number().int().positive().optional()`. The workflow resolves the runtime value via `env.SCENE_EMBEDDING_CONCURRENCY ?? 10`. Keeps the env validator surfaces honest and avoids "magic default" drift between docs and code.
- **Ordering contract.** Outcome array is no longer sorted by `(coreId, locale)` — it follows `Promise.allSettled` resolution order. The existing report aggregator (`stepReport`) is already order-agnostic; no change. If any downstream test or operator script depends on order, fix it as part of Stage 1 (the workflow-robustness solutions doc explicitly calls this a test bug).
- **R2 batch-size assertion is N=1.** R2 has no provider call; Stage 2 only adds the S3 cache for R2. Stage 2's batched-OpenRouter changes are R1-only.
- **Stage 4 deferred deliberately.** The cost of porting R3's `cms_content_hash` pattern is real (schema migration + GraphQL leak guard extension + partial-skip path through the new bulk-insert SQL). Doing it inside Stage 3 would couple two distinct concerns. Stage 4 lands cleanly atop a green Stage 3 because the `scenesToEmbed` subset becomes the input to the same batched provider call and the same bulk-insert SQL.

## Open Questions

### Resolved During Planning

- **Q: Cache S3 artifacts at the storage layer or in the workflow?** A: In the workflow (per-`(video, edition)` group). See Decisions §1.
- **Q: Where does the OpenRouter batch live — workflow or service?** A: Service. Workflow stays a target dispatcher; service owns provider semantics. See Decisions §2.
- **Q: One bulk-write per target or one per workflow?** A: Per target (locale). Preserves error isolation and keeps transaction size bounded. See Decisions §3.
- **Q: What concurrency default?** A: 10. Tunable via env. Stage 1's verification step should sanity-check that the OpenRouter rate limit headroom holds at 10 batched calls in flight.

### Resolved Mid-Plan

- **JSONB column binding shape for Stage 3 (R1's `themes` / `bibleVerses` / `demographics` / `spiritualContext`).** **Locked: Way A** — bind each scene's JSON value as a `JSON.stringify`'d string inside a regular `toPgArray(text[])` literal, cast `::jsonb` at the SELECT seam (per-row), e.g. `themes_text::jsonb` in the `SELECT ... FROM unnest(...) AS u(...)` clause. Reuses the proven `text[]` bind discipline; sidesteps the PG18 `jsonb`-cast warning in root `CLAUDE.md`. Stage 3 fixture tests must include at least one JSON value containing an embedded double-quote to prove the round-trip escape survives. If Way A trips an escaping issue against PG18 the test surfaces during Stage 3, fall back to Way C (separate `unnest(...) WITH ORDINALITY` per column joined by position). Way B (`::jsonb[]` directly on the array seam) is rejected.

### Deferred to Implementation

- **Exact `unnest(...)` arg list for R2.** R2 has more nullable columns (`startSeconds`, `endSeconds`, `chunkId`) and a `tokenCount` int. Determine at implementation time whether the cleanest shape is `unnest(text[], text[], int[], double precision[], double precision[], text[], int[], vector(1536)[])` with `coalesce(..., NULL)` or a JSONB-shaped staging row. Both bind a constant parameter count; pick the one whose SQL invariant test reads cleanest.
- **Whether to widen `IndexEditionScenesInput.artifactOverride` from "test-only" to a first-class `loadedArtifact` parameter.** Today it's marked "test-only" in the comment. The cleanest Stage-2 shape is a renamed, non-test param (`loadedArtifact?`) with the test-only path collapsed into the same field. Decide at implementation time whether the rename earns its weight.
- **Pre-allocate the bound `synced_at` array vs `ARRAY(SELECT NOW() FROM generate_series(1, N))`.** Both work; pick whichever the SQL invariant test reads cleanest.
- **Whether to add a benchmark assertion as a CI gate or development-only affordance.** Hard timing in CI is brittle; default to "development affordance only" but capture wall-time numbers in the PR description for each stage so reviewers see the actual delta.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

### Stage progression — workflow loop body shape

```
Stage 0 (today):
  for (target of targets) {
    artifact = await s3.getObject(target.cmsVideoId)        // re-fetched per locale
    embeddings = await Promise.allSettled(                  // N single-input calls
      scenes.map(s => provider.embed(s.description)))
    await prisma.$transaction(async tx => {
      for (scene of scenes) {
        await tx.videoSceneLocale.upsert(...)               // per-row round-trip
        await tx.$executeRaw`UPDATE ... embedding = ...`    // per-row round-trip
      }
    })
  }

Stage 1:
  const limit = pLimit(env.SCENE_EMBEDDING_CONCURRENCY ?? 10)
  await Promise.allSettled(
    targets.map(t => limit(() => indexEditionScenes(t))))   // bounded parallel

Stage 2 (within indexEditionScenes, called via outer (video, edition) group):
  artifact = await s3.getObject(group.cmsVideoId)           // ONCE per (video, edition)
  for (locale of group.locales) {
    embeddings = await provider.embedBatch(                 // ONE call per (video, locale)
      scenes.map(s => s.description))
    /* same DB write loop */
  }

Stage 3:
  /* same enumerate + cache + batch */
  await prisma.$transaction(async tx => {
    /* parent upserts unchanged */
    await tx.$executeRaw`
      INSERT INTO video_scene_locale (...)
      SELECT * FROM unnest(${toPgArray(...)}::text[], ...,
                           ${toPgArray(vecStrings)}::vector(1536)[])
      ON CONFLICT (video_scene_id, locale) DO UPDATE SET ...
    `                                                       // ONE round-trip
  })
```

## Implementation Units

- [ ] **Unit 1 — Stage 1: Bounded parallelism on the per-target loop (PR #1, ticket `feat-115`)**

**Goal:** Replace sequential `for…of` over targets with `pLimit(N)` + `Promise.allSettled` in both R1 and R2 workflows. Surface concurrency via env vars.

**Requirements:** R1 (parallelism component), R3, R4, R5, R7, R8, R9.

**Dependencies:** None. (Tickets `feat-115`..`feat-118` ship from `origin/main`; this branch must merge `main` before opening the first PR so the ticket frontmatter is editable on-branch.)

**Files:**

- Modify: `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`
- Modify: `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`
- Modify: `apps/admin/src/config/env.ts`
- Modify: `apps/admin/src/scripts/run-embeds.ts` (surface resolved concurrency in the `run-embeds.start` event)
- Modify: `apps/admin/CLAUDE.md` (R1 + R2 subsections — concurrency env var names + the "uses `allSettled`" rule)
- Modify: `docs/roadmap/content-discovery/feat-115-...md` (status flip + Resolution section on merge)
- Modify: `docs/roadmap/README.md`
- Test: `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts`
- Test: `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts`
- Test: `apps/admin/src/config/env.test.ts` (new entries pass through correctly when set/unset)

**Approach:**

- Add `SCENE_EMBEDDING_CONCURRENCY` and `TRANSCRIPT_EMBEDDING_CONCURRENCY` to `env.ts` as `z.coerce.number().int().positive().optional()` with the corresponding `process.env` mappings using the existing `emptyToUndefined` helper.
- In each workflow body: replace the sequential `for (const target of targets)` block with `Promise.allSettled(targets.map((t) => limit(() => stepIndexEditionLocale(t))))`. Map each settled result into the existing `BackfillOutcome` shape; preserve the existing `logOutcome` defensive wrap so a log throw on one target never escapes.
- Promote `stepIndexEditionLocale` from `for…of`-internal to a free function reference inside `targets.map`. The existing `"use step"` directive needs no change.
- Confirm `p-limit` is reachable as a direct dependency (it's transitive in `pnpm-lock.yaml` today). If not directly listed in `apps/admin/package.json`, add it.
- `run-embeds.ts` `run-embeds.start` event gains `sceneConcurrency` / `transcriptConcurrency` keys for operator visibility.

**Patterns to follow:**

- The `"no Promise.all" / use Promise.allSettled` rule from `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`.
- Existing `Promise.allSettled` use inside `scene-embedding.service.ts` line 155–189 (for embedding generation) — Stage 1 mirrors its result-mapping pattern at the workflow level.

**Test scenarios:**

- Two sibling targets where one rejects with an arbitrary `Error` and the other resolves: outcome array has both, with one `failed` and one `succeeded`. (Regression guard against re-introducing `Promise.all`.)
- Three targets at concurrency=2, each with an artificial ≥10 ms delay: assert the third target's start time is `>=` the first target's end time within a generous timing epsilon (the bounded-parallelism behavioral guarantee).
- `artifact_missing` from one target while siblings succeed: outcome shape unchanged from sequential — `skipped` with `reason: "artifact_missing"`.
- Existing dispatch tests for `triggerSceneEmbeddingBackfill` and `triggerTranscriptEmbeddingBackfill` stay green (no GraphQL surface change).
- `env.test.ts`: missing var → `env.SCENE_EMBEDDING_CONCURRENCY` is `undefined`; `"5"` → `5`; `"-1"` → validator rejects.
- `run-embeds.start` JSON contains the resolved concurrency.

**Verification:**

- `pnpm --filter @forge/admin typecheck && lint && vitest run src/workflows/sceneEmbeddingBackfill src/workflows/transcriptEmbeddingBackfill src/config/env` all green.
- Local benchmark: `pnpm run-embeds --pipeline=both --locale=en` against the same fixture set as Stage 0 baseline completes meaningfully faster; capture the wall-time delta in the PR description (development affordance, not a CI gate).
- Flip `feat-115` to `in-progress` when PR opens; flip to `complete` with a Resolution section + PR # when it merges; update `docs/roadmap/README.md`. (`feat-116` will auto-unblock per the viewer's blocked-by-deps rule.)

---

- [ ] **Unit 2 — Stage 2: S3 artifact memoization + batched OpenRouter (PR #2, ticket `feat-116`)**

**Goal:** Cut S3 reads to one per `(video, edition)` and OpenRouter calls to one per `(video, locale)` for R1. R2 gets the S3 cache only.

**Requirements:** R1 (artifact-cache + batched-embed components), R2, R3, R4, R5, R6, R9.

**Dependencies:** Unit 1 (Stage 1 must be merged).

**Files:**

- Modify: `apps/admin/src/services/embeddings.service.ts` (add `generateExperienceEmbeddings(inputs: string[])`; refactor singular helper to delegate)
- Modify: `apps/admin/src/services/scene-embedding.service.ts` (consume the batched provider call; widen the artifact-override path so the workflow can pass a pre-loaded artifact)
- Modify: `apps/admin/src/services/transcript-embedding.service.ts` (widen the artifact-override path; no provider change)
- Modify: `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` (reshape enumerator into `(video, edition)` groups → fetch artifact once → fan out to per-locale targets within the group)
- Modify: `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` (same reshape, no provider call)
- Modify: `apps/admin/CLAUDE.md` (R1 + R2 subsections — document the per-`(video, edition)` cache + the batched provider call)
- Modify: `docs/roadmap/content-discovery/feat-116-...md` (status flips + Resolution section)
- Modify: `docs/roadmap/README.md`
- Test: `apps/admin/src/services/embeddings.service.test.ts`
- Test: `apps/admin/src/services/scene-embedding.service.test.ts`
- Test: `apps/admin/src/services/transcript-embedding.service.test.ts`
- Test: `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts`
- Test: `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts`

**Approach:**

- New `generateExperienceEmbeddings(inputs: string[]): Promise<{ model, dimensions, embeddings: number[][] }>`. The OpenAI / OpenRouter request body becomes `{ model, input: inputs, encoding_format: "float" }`. Response zod schema gains a min-length tied to `inputs.length` (length-mismatch rejected as a typed error, fail-fast for the whole target). Each returned vector is dimension-validated. The singular `generateExperienceEmbedding(text)` becomes `generateExperienceEmbeddings([text]).then(r => ({ ...r, embedding: r.embeddings[0]! }))`.
- `scene-embedding.service.ts` replaces the existing `Promise.allSettled(scenes.map(s => provider.embed(s.description)))` block with one batched call. Keep the empty-description pre-validation. Per-scene `scenesSkipped` counter goes to zero on the happy path (the whole batch fails-fast on length mismatch / dimension error); preserve the field for backward compatibility but document its semantics shift in CLAUDE.md.
- Workflow enumerator reshape: convert the flat `BackfillTarget[]` into `Map<(videoId, editionId), { coreId, cmsVideoId, locales: string[] }>`. The outer iteration loads the artifact once. The inner iteration fans out per locale; each call passes `loadedArtifact` to the service so the service does not re-read S3.
- The `pLimit` boundary moves up one level: parallelism is now over **groups**, not individual targets. Concurrency env vars retain their names but their semantics shift slightly (concurrent groups, not concurrent targets). Document the shift in `apps/admin/CLAUDE.md`. Per-locale work inside a group runs sequentially within the group's context; the artifact is in scope for all locales in the group.
- Alternative: keep `pLimit` at the target level but precompute the artifact per group once. Reject — the artifact would need to live in a per-workflow `Map<groupKey, Promise<artifact>>` which is functionally equivalent to per-group iteration but harder to reason about.

**Patterns to follow:**

- `apps/cms/src/api/scene-embedding/services/indexer.ts` and `apps/manager`'s embedding pipelines both use the OpenAI batch API; cross-reference for header / body shape parity.
- The `Promise.allSettled` + `for-loop result mapping` pattern in `scene-embedding.service.ts` line 155–189 is the model for handling a length-mismatch in the batched response.

**Test scenarios:**

- `generateExperienceEmbeddings(["a", "b", "c"])` issues exactly one fetch with `body.input` deeply equal to `["a", "b", "c"]`; returns three vectors in input order. Mock provider asserts.
- Length mismatch (provider returns 2 vectors for a 3-input request): typed error; `indexEditionScenes` surfaces this as a `failed` outcome, not a partial write.
- Dimension mismatch on any one vector: same handling.
- `indexEditionScenes` with a 5-locale group passes `loadedArtifact` through and issues exactly one `s3.getObject` call across the whole group (mock asserts).
- `indexEditionScenes` for a 10-scene-per-locale fixture issues exactly one OpenRouter call per locale (not 10).
- R2: `indexEditionTranscript` for a 5-language group issues exactly one `s3.getObject` call across the whole group; provider mock is never invoked (R2 reuses vectors).
- Vector ordering: feed three deterministic strings, mock the provider to return three deterministic vectors, assert the upsert call writes them positionally to the right scene index.

**Verification:**

- `pnpm --filter @forge/admin typecheck && lint && vitest run` all green.
- Local benchmark vs Stage 1 baseline: `pnpm run-embeds --pipeline=scene --locale=en` against the same fixture set completes 5–10× faster; OpenRouter request count drops by ≥20× (capture in the PR description).
- Flip `feat-116` to `in-progress`/`complete`; update README.

---

- [ ] **Unit 3 — Stage 3: Bulk DB writes via `INSERT … unnest(...) ON CONFLICT` (PR #3, ticket `feat-117`)**

**Goal:** Collapse per-row `videoSceneLocale.upsert()` + per-row `$executeRaw … UPDATE … embedding` into a single `$executeRaw … INSERT … SELECT * FROM unnest(...) ON CONFLICT … DO UPDATE` per `(video, edition, locale)` write batch. Same shape for R2's chunk writes.

**Requirements:** R1 (write-throughput component), R3, R4, R5, R6, R9.

**Dependencies:** Unit 2.

**Files:**

- Modify: `apps/admin/src/services/scene-embedding.service.ts`
- Modify: `apps/admin/src/services/transcript-embedding.service.ts`
- Modify: `apps/admin/src/db/pgvector.ts` (only if a new helper for `vector[]`-array binding is genuinely needed; default position is to use `toPgArray(vecStrings)` directly with a `::vector(1536)[]` cast in SQL)
- Modify: `apps/admin/CLAUDE.md` (R1 + R2 subsections)
- Modify: `docs/roadmap/content-discovery/feat-117-...md`
- Modify: `docs/roadmap/README.md`
- Create: `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260504.md` (or similar date — the new pattern doc)
- Test: `apps/admin/src/services/scene-embedding.service.test.ts`
- Test: `apps/admin/src/services/transcript-embedding.service.test.ts`

**Approach:**

- Inside the per-target `prisma.$transaction`:
  - Parent upserts (`videoScene` / `videoTranscript`) stay unchanged (1–N parents per target — typically 1 for R2; for R1 it's one `videoScene` per scene which today is also a per-row upsert).
  - **R1 parent upsert collapse (optional, do this if it stays surgical):** parent-row upserts for `videoScene` can also collapse to a bulk `INSERT … unnest(...) ON CONFLICT` since they touch one row per scene. If it complicates the SQL, defer to a follow-up — the user-visible win is on the locale rows.
  - Pre-prune `deleteMany` unchanged.
  - One `$executeRaw` for the locale's child rows, binding parallel arrays via `toPgArray` and casting server-side. Sketch (R1):

  ```ts
  await tx.$executeRaw`
    INSERT INTO video_scene_locale (
      video_scene_id, locale, source_text, description, themes, bible_verses,
      demographics, spiritual_context, model, dimensions, embedding, updated_at
    )
    SELECT * FROM unnest(
      ${toPgArray(sceneIds)}::text[],
      ${toPgArray(localesArr)}::text[],
      ${toPgArray(sourceTexts)}::text[],
      ${toPgArray(descriptions)}::text[],
      /* themes / bibleVerses / demographics / spiritualContext are JSONB —
         decide at impl time between unnest of jsonb[] vs a per-row CTE. */
      ...,
      ${toPgArray(models)}::text[],
      ${dims}::int,                                /* scalar broadcast */
      ${toPgArray(vecStrings)}::vector(1536)[],
      NOW()
    )
    ON CONFLICT (video_scene_id, locale)
    DO UPDATE SET
      source_text = EXCLUDED.source_text,
      description = EXCLUDED.description,
      themes = EXCLUDED.themes,
      bible_verses = EXCLUDED.bible_verses,
      demographics = EXCLUDED.demographics,
      spiritual_context = EXCLUDED.spiritual_context,
      model = EXCLUDED.model,
      dimensions = EXCLUDED.dimensions,
      embedding = EXCLUDED.embedding,
      updated_at = NOW()
  `
  ```

  - The JSONB columns (`themes`, `bibleVerses`, `demographics`, `spiritualContext`) need a chosen binding shape. PG18 rejects `?::jsonb::text[]`; use either a per-row `unnest(text[])` of stringified JSON cast to `::jsonb[]` server-side, or a CTE that joins parallel arrays and applies casts. Pick whichever the SQL invariant test reads cleanest.
  - R2 mirrors the same shape against `video_transcript_chunk`. Columns differ (`startSeconds` / `endSeconds` are nullable doubles; `tokenCount` is int; `chunkId` is text). All bind via `toPgArray`-style single-parameter literals.

- **No enum columns are written** in either table today, so the enum-mapping seam doc is preserved by exclusion. If a future field is added, that doc applies.
- **`updated_at` and `synced_at`:** today's per-row `UPDATE … SET … updated_at = NOW()` is replaced by `NOW()` directly inside the bulk INSERT and `EXCLUDED`-mirroring on conflict. No per-row `synced_at` column on these tables.
- The new solutions doc captures: the bulk-insert + bind-as-array pattern, the `vector(1536)[]` cast, the cross-references to the bind-var-cap and enum-seam docs, and the explicit "HNSW maintenance is per-row internally; bulk insert helps round-trip cost only — operator-mode `DROP INDEX → bulk INSERT → CREATE INDEX` is a future enhancement."

**Patterns to follow:**

- `apps/admin/src/services/core-sync/phases/sync-dubs.ts` array-bound `$executeRaw` soft-delete (see `apps/admin/CLAUDE.md` "Core sync — video-dubs phase").
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md` for test shape.
- `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md` for the bind-as-array discipline.

**Test scenarios:**

- **SQL-shape invariants** (R1 test): captured raw SQL contains `INSERT INTO video_scene_locale`, `unnest(`, `::text[]`, `::vector(1536)[]`, `ON CONFLICT (video_scene_id, locale)`, `DO UPDATE SET`, `EXCLUDED.embedding`. Same for R2 against `video_transcript_chunk` with `::vector(1536)[]` and `::text[]` for the chunk-text array.
- **Bind-count regression guard:** `mock.calls[0].args.length` (the bound-parameter count, not the array length) is constant — independent of `scenes.length` / `chunks.length`. Prevents accidental re-introduction of per-row binding.
- **Mixed insert + update fixture:** half new scenes, half pre-existing rows; assert post-call DB state has all rows correct (the existing rows updated, the new rows inserted).
- **Idempotency:** running twice with identical input produces identical row state; running with one scene's description changed updates only that row's `description` + `embedding`.
- **R2 dimension mismatch on one chunk:** typed error short-circuits the whole target before the SQL runs (existing pre-validation path; just confirm Stage 3 doesn't bypass it).
- **No partial writes on SQL error:** if the bulk INSERT throws (e.g., unique violation on a parent row that was deleted between pre-prune and INSERT), the surrounding `$transaction` rolls back; no orphan vectors.
- **Vector serialization round-trip:** a multi-row insert of three deterministic vectors round-trips via a real / testcontainer Postgres; assert `SELECT embedding::text` matches `toPgVector(input)` for each row in input order.
- **R2 sanitized-error preservation:** the existing `isPrismaRuntimeError` + `sanitizePrismaErrorMessage` path still wraps `$executeRaw` failures so the bound vector literal does not leak into `outcome.reason`. This is not new code — Stage 3 simply must not bypass the wrap.

**Verification:**

- `pnpm --filter @forge/admin typecheck && lint && vitest run` all green.
- Local benchmark vs Stage 2 baseline: `pnpm run-embeds --pipeline=both --locale=en` finishes 1.5–3× faster.
- After PR merges, run a full local backfill against `forge_admin` (1,088 videos) and capture wall-time + OpenRouter call count in the PR description so the staged speedups are evidenced.
- Flip `feat-117` to `in-progress`/`complete`; update README. `feat-118` auto-unblocks.
- New solutions doc lands alongside the PR.

---

- [ ] **Unit 4 — Future-considerations stub for content-hash skip (PR #4, ticket `feat-118`)** _(Out of scope for this plan; flag only)_

This unit is the natural follow-up that ports R3's `cms_content_hash` pattern to R1/R2. **Do not implement as part of the three-PR sequence.** The full ticket body in `docs/roadmap/content-discovery/feat-118-...md` is the authoritative scope. Sketch:

- New schema migration: nullable `content_hash` columns on `VideoSceneLocale` + `VideoTranscriptChunk` with partial indexes.
- `computeSceneContentHash(text)` and `computeChunkContentHash(text)` helpers carrying a versioned envelope (`HASH_VERSION`) and the model name so a model upgrade naturally invalidates skips.
- Pre-batch hash check inside `indexEditionScenes` / `indexEditionTranscript`: existing-row hash matches → skip; partial mismatch → embed only the changed subset (the batched provider call from Stage 2 accepts `scenesToEmbed.length` inputs naturally; the bulk-insert SQL from Stage 3 writes `content_hash` alongside `embedding`).
- New per-target outcome variant `{ action: "skipped_unchanged", scenesSkipped: N }`; counts as `succeeded` in top-level stats.
- Extend the GraphQL leak guard in `apps/admin/src/graphql/schema.test.ts` to additionally reject `content_hash`.

When PR #4 ships, flip `feat-118` to `complete` with a `## Resolution` section.

## System-Wide Impact

- **Interaction graph:**
  - GraphQL `triggerSceneEmbeddingBackfill` and `triggerTranscriptEmbeddingBackfill` mutations: external surface unchanged.
  - `pnpm run-embeds` CLI: external surface unchanged; new `sceneConcurrency` / `transcriptConcurrency` keys added to the start-event JSON.
  - `embeddings.service::generateExperienceEmbedding(text)` is consumed by R3 (`experience-embedding.service`) and R4 hybrid-search query embedding. After Stage 2 it delegates to the batched form internally; the singular signature is preserved so R3/R4 are not forced to migrate.
  - `manager` REST proxies (`POST /api/admin-embeds/scene` / `/transcript`) forward to admin's GraphQL trigger mutations — no change.
- **Error propagation:**
  - Per-target isolation preserved at every stage (`Promise.allSettled` at the workflow boundary, `prisma.$transaction` per-target, R2's `isPrismaRuntimeError` wrap unchanged).
  - Stage 2 batched-provider length/dimension mismatch fails the entire target (not partial), matching the existing dimension-validation contract.
  - Stage 3 bulk-INSERT failure rolls back the per-target transaction; sibling targets unaffected.
- **State lifecycle risks:**
  - Pre-prune `deleteMany` ordering vs bulk INSERT inside the same transaction — confirmed safe (same transaction, same lock scope as today). Document this in the new solutions doc.
  - Outcome ordering in `report.outcomes` is now non-deterministic; the existing aggregator is order-agnostic. Any downstream consumer that walks `outcomes` in order is reading an undocumented contract — fix at use site.
- **API surface parity:**
  - GraphQL JSON shape: byte-identical except for `outcomes` ordering. `schema.test.ts` "no embed/vector/similarit field leak" guard remains green; no new fields added.
  - REST: not directly involved; manager's proxies are pass-through.
- **Integration coverage:**
  - The new bulk-INSERT SQL benefits from at least one testcontainer / live-DB integration test (mixed insert + update fixture) — unit-level shape assertions don't exercise pgvector's actual cast behavior.
  - The S3 cache reshape benefits from at least one workflow-level test that asserts `s3.getObject` call count across a multi-locale group.

## Risks & Dependencies

- **Risk: Outcome-ordering regressions in callers.** Mitigation: search for `outcomes[0]` / array-index access patterns in tests and admin code; convert to find-by-key. Already a documented test bug per the workflow-robustness solutions doc.
- **Risk: OpenRouter rate-limit pressure with concurrency=10 batched calls in flight.** A batched call counts as one request; net pressure is lower than today's per-scene fan-out. Mitigation: start prod at concurrency=5 via env override; ramp after observation.
- **Risk: pgvector `vector(1536)[]` cast with `unnest(toPgArray(vecStrings))` — first time this codebase casts a text-array of vector literals server-side.** Mitigation: integration test against a real / testcontainer Postgres that inserts ≥3 rows and round-trips `embedding::text` byte-equal to `toPgVector(input)`.
- **Risk: Pre-prune `deleteMany` removes a row that the bulk INSERT then re-inserts in the same transaction.** Postgres handles this within a single transaction without serializability issues; document the ordering contract in the new solutions doc and verify with a fixture test.
- **Risk: JSONB column binding shape (`themes`, `bibleVerses`, `demographics`, `spiritualContext`) may not accept the obvious `unnest(...)` form on PG18.** Mitigation: pick the binding shape during Stage 3 implementation against the local PG18 instance; the test shape is the SQL invariant assertion, not a value test, so the choice doesn't ripple to the workflow.
- **Risk: Branch is currently behind `main` — tickets `feat-115`..`feat-118` exist on `origin/main` but not on this branch.** Mitigation: merge `main` (or rebase) before opening the first PR so the ticket frontmatter is editable on-branch and the auto-blocked status flips work as documented in each ticket.
- **Dependency: `p-limit` direct dependency** — currently transitive (lockfile shows multiple versions). Stage 1 should make the dependency explicit in `apps/admin/package.json` if not already.
- **Dependency: Stage ordering matters.** Stage 3's bulk SQL benefits from Stage 2's batched embedding only because the embeddings are already a `number[][]` in input order; if Stage 3 were attempted before Stage 2 the per-row vector update would still need to round-trip per scene. Land the stages in order.

## Documentation / Operational Notes

- **`apps/admin/CLAUDE.md` updates per stage:**
  - Stage 1: R1 + R2 sections gain "Workflow uses `p-limit(env.SCENE_EMBEDDING_CONCURRENCY ?? 10)` + `Promise.allSettled` — no `Promise.all`."
  - Stage 2: R1 section gains "Artifact is fetched once per `(video, edition)` group; OpenRouter is called once per `(video, locale)` with all scenes batched." R2 section gains the artifact-cache note only.
  - Stage 3: R1 + R2 sections gain "Per-target write batch is one `$executeRaw INSERT … unnest(...) ON CONFLICT DO UPDATE` instead of per-row upserts; bind via `toPgArray`."
- **New solutions doc (Stage 3):** `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260504.md` — capture the bulk-insert pgvector pattern, cross-reference the bind-var cap and enum-seam docs, and flag the `DROP INDEX → bulk INSERT → CREATE INDEX` operator-mode as a future enhancement (not implemented here).
- **Roadmap status flips per stage:** flip ticket `status: not-started → in-progress` when the PR opens; flip to `complete` with a `## Resolution` section (PR #, what shipped, deviations) when it merges. Update `docs/roadmap/README.md` to reflect each flip. The viewer auto-marks the next ticket unblocked.
- **PR description discipline:** each PR should include a wall-time / call-count delta vs the previous stage's baseline so reviewers see the actual win, not just the code change.
- **Operational rollout:** prod gets `SCENE_EMBEDDING_CONCURRENCY=5` initially (Doppler `forge-admin`), local devs can crank to 20+. After Stage 2 lands, the OpenRouter call rate is ~20× lower at the same concurrency, so the prod ramp can move to 10 with no headroom concern.
- **Re-embed scenario reminder:** Stages 1–3 do not skip unchanged content. A re-run still re-embeds (R1) and re-writes (R2) every row — just much faster and cheaper. The "near-instant re-run" scenario lands with Stage 4 (`feat-118`).

## Sources & References

- **Origin tickets:**
  - `docs/roadmap/content-discovery/feat-115-embed-backfill-bounded-parallelism.md` (PR 1)
  - `docs/roadmap/content-discovery/feat-116-embed-backfill-s3-cache-and-batched-openrouter.md` (PR 2)
  - `docs/roadmap/content-discovery/feat-117-embed-backfill-bulk-sql-writes.md` (PR 3)
  - `docs/roadmap/content-discovery/feat-118-embed-backfill-content-hash-skip.md` (follow-up)
- **Code references:**
  - `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`
  - `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`
  - `apps/admin/src/services/scene-embedding.service.ts`
  - `apps/admin/src/services/transcript-embedding.service.ts`
  - `apps/admin/src/services/embeddings.service.ts`
  - `apps/admin/src/services/core-sync/phases/sync-dubs.ts` (array-bound `$executeRaw` reference)
  - `apps/admin/src/db/pgvector.ts` (`toPgArray` / `toPgVector`)
  - `apps/admin/src/scripts/run-embeds.ts`
  - `apps/admin/src/config/env.ts`
  - `apps/admin/CLAUDE.md` (R1 + R2 + Running embeds locally subsections)
- **Solutions docs:**
  - `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
  - `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
  - `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
  - `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`
  - `docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md`
  - `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`
- **Precedent for resolution-section format:** `docs/roadmap/content-discovery/feat-097-investigate-prod-query-embedding.md`.
