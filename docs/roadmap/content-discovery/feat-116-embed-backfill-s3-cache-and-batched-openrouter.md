---
id: "feat-116"
title: "Embed Backfill — Stage 2 — S3 Artifact Memoization + Batched OpenRouter Calls"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-06"
duration: 2
depends_on:
  - "feat-115"
blocks:
  - "feat-117"
tags:
  - "admin"
  - "ai-pipeline"
  - "performance"
  - "s3"
  - "openrouter"
---

## Resolution

**Shipped:** 2026-05-05 via [PR #885](https://github.com/JesusFilm/forge/pull/885) (`perf(admin): per-(video, edition) S3 cache + batched OpenRouter (feat-116)`). Stage 2 of the four-stage embed-backfill performance plan ([`docs/plans/2026-05-04-002-refactor-admin-embed-backfill-performance-plan.md`](../../plans/2026-05-04-002-refactor-admin-embed-backfill-performance-plan.md)).

**What landed.** Internal reshape of R1 (`apps/admin/src/workflows/sceneEmbeddingBackfill.ts`) and R2 (`apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`). GraphQL trigger mutations + CLI output stay byte-identical to Stage 1 (modulo `outcomes[]` ordering, already documented as non-deterministic per `Promise.allSettled`). Two compounding wins on top of Stage 1's bounded parallelism:

1. **Per-(video, edition) S3 artifact memoization.** Workflow groups flat `(video, edition, locale)` targets by `(video, edition)`, fetches the manager-artifacts S3 JSON ONCE per group via a new `processGroup` worker, and threads the loaded artifact into each per-locale indexer call via a new first-class `loadedArtifact?` parameter (renamed from the previously test-only `artifactOverride?`). S3 reads collapse from N×L to N. Group-level load failures cascade to per-locale outcomes preserving the `artifact_missing → skipped` / other → `failed` classification. `pLimit` boundary moves up one level — cap is now over groups, not flat targets. Per-locale work runs sequentially within a group so the loaded artifact stays scoped to one stack frame.

2. **Batched OpenRouter (R1 only).** New `generateExperienceEmbeddings(inputs: readonly string[])` issues ONE provider call per `(video, locale)` target instead of one per scene. Input-position-stable contract: `embeddings[i]` corresponds to `inputs[i]`. Typed `EmbeddingsBatchError` with 7-code literal union for caller branching. Singular `generateExperienceEmbedding(text)` delegates with `[normalizedText]` and preserves the back-compat error message for hybrid-search / experience-embedding / search-health callers. R2 stays vector-reuse — never calls the provider.

**CI fix shipped in same PR.** The useworkflow build plugin (`workflow-node-module-error`) initially rejected the original "non-step `processGroup`" design — `s3.ts`'s Node-only imports are forbidden anywhere reachable from workflow scope via plain functions. Fix: `processGroup` itself is a `"use step"`, and artifact-load step wrappers live in a separate `apps/admin/src/workflows/_steps/load-manager-artifact.ts` module so the workflow files don't directly import the readers. Trade-off: per-group artifact + outcomes get journaled (~280 KB × ~6,000 groups ≈ ~1.7 GB extra journal storage per full backfill).

**Smoke evidence.** Local 24 targets / 4 (video, edition) groups: R1 succeeded 24/24 in 14.7s with 4 S3 reads + 24 batched OpenRouter calls (vs Stage 1's 24 + ~84). DB: 60+24 locale rows have non-NULL embeddings. R2 cascade verified — identical `durationMs` per group across all cascaded outcomes.

**Compounded patterns.** Two new solutions docs:

- [`docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md`](../../solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md) — workflow-grouping + `loadedArtifact` parameter widening + group-level cascade + `"use step"` boundary requirement.
- [`docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md`](../../solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md) — batched provider call + typed-error literal-union + position-stable consumer threading.

Bidirectional cross-refs added to the bounded-parallelism (`20260505`), parallel-workflow-error-robustness (`20260420`), and both R1/R2 platform docs.

**Stage 3 unblocked.** `feat-117` (bulk SQL writes) is the natural next block. Note: `feat-119` (NoSuchKey classification gap) became more noisy under Stage 2's group cascade and should land before `feat-118` Stage 4 ships.

**Residual risks documented in PR description** for follow-up: timeout sizing for batched calls, no retry layer for transient OpenRouter failures, `feat-119` classification gap, `scenesSkipped` always-zero shim cleanup.

## Problem

Two compounding inefficiencies in R1 (and R1's S3-side equivalent in R2):

1. **`scene-analysis.json` is re-fetched per locale.** For a video with 30 locales, the same artifact lands from S3 thirty times. Manager's `embeddings.json` has the same shape for R2.
2. **R1 makes one OpenRouter call per scene description.** `text-embedding-3-small` accepts up to **2,048 inputs per call**. At ~10-50 scenes per video × ~30 locales the current full backfill makes ~500k API calls. Batching all scenes for one `(video, locale)` into a single call cuts this to ~30k.

Expected speedup: **5-10× R1 wall-time reduction**, **20-50× fewer OpenRouter API calls** (also lower per-call token-overhead cost), **~85% S3 read reduction**.

## Entry Points — Read These First

1. `apps/admin/src/services/scene-embedding.service.ts` — `indexEditionScenes(target)` reads the artifact and embeds per scene; this is where both fixes land.
2. `apps/admin/src/services/transcript-embedding.service.ts` — R2 reads `embeddings.json` per language; same memoization pattern applies (no embedding batch — R2 reuses vectors).
3. `apps/admin/src/services/embeddings.service.ts` — the OpenRouter provider; needs a new `embedBatch(strings: string[]): Promise<{ embeddings: number[][] }>` method.
4. `apps/admin/src/storage/s3.ts` — the S3 read side; consider per-call caching at the storage layer (LRU keyed by S3 key) OR caller-level memoization in the workflow.
5. `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — enumerator; reshape outer-loop to `(video, edition)` so artifact-fetch happens once per outer iteration.

## Grep These

```
grep -rn "scene-analysis.json\|embeddings.json" apps/admin/src/
grep -rn "embed(" apps/admin/src/services/embeddings.service.ts
grep -rn "for (const target of\|targets.map(" apps/admin/src/workflows/
```

## What To Build

### S3 cache (applies to both R1 and R2)

Pick the simpler of two shapes:

- **Per-workflow memoization (recommended):** in the workflow body, before `Promise.allSettled(targets.map(...))`, group targets by `(video, edition)` and pre-fetch the artifact once per group. Pass the already-loaded JSON down as a constructor arg to `indexEditionScenes` / `indexEditionTranscript`.
- OR **Storage-layer LRU:** wrap `apps/admin/src/storage/s3.ts::getObject` with an LRU keyed by `(bucket, key)`. Bound size (~50 entries; each ~100KB JSON = ~5MB max). Either way, `MANAGER_ARTIFACTS_S3` reads must collapse 1 per `(video, edition)` instead of 1 per `(video, edition, locale)`.

### Batched OpenRouter (R1 only)

In `apps/admin/src/services/embeddings.service.ts`:

```ts
export async function generateExperienceEmbeddings(
  inputs: string[],
): Promise<{ embeddings: number[][] }> {
  // Single OpenRouter / OpenAI call with `input: inputs[]`.
  // Validate dimensions === 1536 on every returned vector.
  // Fail fast on length mismatch (response.length !== inputs.length).
}
```

In `scene-embedding.service.ts`:

```ts
// Before:
for (const scene of scenes) {
  const { embedding } = await provider.embed(scene.description)
  await tx.videoSceneLocale.upsert({ ..., embedding })
}

// After:
const { embeddings } = await provider.generateExperienceEmbeddings(
  scenes.map((s) => s.description),
)
// embeddings[i] is the vector for scenes[i]; pass through to the per-scene upsert.
```

Preserve the existing per-call retry / model-stamp drift handling.

## Constraints

- **Vector ordering must be position-stable.** OpenRouter / OpenAI return embeddings in input order; assert this in tests with deterministic input strings and assert specific embedding vector indices.
- **Dimension validation stays:** `embedding.length === 1536` per row; reject the whole batch and surface as `failed` per-target if any vector is wrong-dimensioned.
- **Don't change the per-target outcome shape.** Today: `{ action: "indexed", embeddingsWritten: N, … }`. After batching, `embeddingsWritten` is still the count of rows written; the value just comes from one batched call instead of N single calls.
- **R2 does not get the OpenRouter batch.** R2 reuses vectors from `embeddings.json` — no provider call. Only the S3 cache applies to R2.
- **Embeddings provider rate limits:** OpenRouter's `text-embedding-3-small` allows large batches but has per-minute rate limits. The batched call still counts as one request. With `feat-115`'s p-limit at concurrency=10 we now make 10 batched calls in flight simultaneously instead of N×10 single calls — net reduction in rate-limit pressure.

## Verification

- `pnpm --filter @forge/admin typecheck` ✓
- `pnpm --filter @forge/admin lint` ✓
- New tests:
  - S3 cache: a single `indexEditionScenes` invocation against a 5-locale `(video, edition)` group results in exactly **one** `s3.getObject` call (mocked).
  - Batched embed: `generateExperienceEmbeddings(["a","b","c"])` issues one provider call with `input: ["a","b","c"]` and returns 3 vectors in the same order. A length mismatch in the response surfaces as a typed error.
  - End-to-end: `indexEditionScenes` for a 10-scene-per-locale fixture issues **one** OpenRouter call per locale (not 10).
- Local benchmark vs the feat-115 baseline: `pnpm run-embeds --pipeline=scene --locale=en` against the same fixture set completes 5-10× faster.
- `apps/admin/CLAUDE.md` R1 + R2 subsections updated to document the per-`(video, edition)` cache and the batched provider call.
