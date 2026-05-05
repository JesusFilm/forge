---
id: "feat-116"
title: "Embed Backfill — Stage 2 — S3 Artifact Memoization + Batched OpenRouter Calls"
owner: "nisal"
priority: "P0"
status: "not-started"
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
