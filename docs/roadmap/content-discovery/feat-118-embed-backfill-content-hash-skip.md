---
id: "feat-118"
title: "Embed Backfill — Stage 4 — Content-Hash Skip for R1 + R2 Re-Runs"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-05-12"
duration: 3
depends_on:
  - "feat-117"
  - "feat-119"
blocks: []
tags:
  - "admin"
  - "ai-pipeline"
  - "performance"
  - "re-embed"
  - "migration"
---

## Problem

R1 (scene) and R2 (transcript) re-runs always recompute every embedding. R1 in particular pays full OpenRouter cost on every re-run regardless of whether the scene description text changed. R3 (Experience content dump) already proved the better pattern: a `cms_content_hash` SHA-256 column gates rerun-skip and downstream re-dispatch. Porting that pattern to R1/R2 makes re-embed runs **near-instant** for unchanged content — the killer feature for periodic re-embeds, model upgrades, and partial-corpus re-runs.

Expected effect: re-embed runs that touch the same descriptions / chunks finish in seconds rather than hours, costing $0 in OpenRouter charges.

## Entry Points — Read These First

1. `apps/admin/src/services/experience-content-dump.service.ts` — R3's `cms_content_hash` logic. The pattern to port.
2. `apps/admin/CLAUDE.md` "Experience content dump (R3)" subsection — describes how the hash gates skip and re-dispatch.
3. `apps/admin/src/services/scene-embedding.service.ts` and `transcript-embedding.service.ts` — where the new hash check lands.
4. `apps/admin/prisma/schema.prisma` — needs new nullable `content_hash` columns on `VideoSceneLocale` and `VideoTranscriptChunk`.
5. `apps/admin/prisma/migrations/` — new migration adding the columns + a partial index for fast lookup. Must be additive (forward-only).

## Grep These

```
grep -rn "cms_content_hash\|contentHash" apps/admin/src/services/
grep -rn "VideoSceneLocale\|VideoTranscriptChunk" apps/admin/prisma/schema.prisma
grep -rn "OPENROUTER_API_KEY\|generateExperienceEmbedding" apps/admin/src/
```

## What To Build

### Schema migration

```sql
-- migration: add content_hash columns + indexes
ALTER TABLE video_scene_locale
  ADD COLUMN content_hash TEXT;
CREATE INDEX video_scene_locale_content_hash_idx
  ON video_scene_locale (content_hash) WHERE content_hash IS NOT NULL;

ALTER TABLE video_transcript_chunk
  ADD COLUMN content_hash TEXT;
CREATE INDEX video_transcript_chunk_content_hash_idx
  ON video_transcript_chunk (content_hash) WHERE content_hash IS NOT NULL;
```

Update `schema.prisma` to add `contentHash String? @map("content_hash")` on both models. NEVER expose via GraphQL (`schema.test.ts` `embed|vector|similarit|content_*hash`-pattern guard).

### Hash computation

```ts
import { createHash } from "node:crypto"

const MODEL_NAME = "text-embedding-3-small"
const HASH_VERSION = "v1"

export function computeSceneContentHash(description: string): string {
  return createHash("sha256")
    .update(`${HASH_VERSION}|${MODEL_NAME}|${description}`)
    .digest("hex")
}
```

Versioned envelope: `HASH_VERSION` lets a future hashing-algorithm change invalidate prior hashes without ambiguity. Model name is included so a model upgrade naturally invalidates skips.

### Skip check (R1 example)

```ts
// In indexEditionScenes, before calling the embedding provider:
const expectedHashes = scenes.map((s) => computeSceneContentHash(s.description))
const existing = await tx.videoSceneLocale.findMany({
  where: {
    videoSceneId: { in: scenes.map((s) => s.videoSceneId) },
    locale,
  },
  select: { videoSceneId: true, contentHash: true },
})
const existingHashByScene = new Map(
  existing.map((e) => [e.videoSceneId, e.contentHash]),
)

const scenesToEmbed = scenes.filter(
  (s, i) => existingHashByScene.get(s.videoSceneId) !== expectedHashes[i],
)
const scenesToSkip = scenes.length - scenesToEmbed.length

if (scenesToEmbed.length === 0) {
  return {
    action: "skipped_unchanged",
    embeddingsWritten: 0,
    scenesSkipped: scenes.length,
  }
}

// Else: batch-embed scenesToEmbed only, then bulk-upsert (per feat-117 shape) writing
// content_hash alongside description + embedding.
```

R2 mirrors the same shape against `(transcript_id, chunk_index)` keyed by chunk text content.

### Outcome shape

Extend the per-target outcome union with a `skipped_unchanged` action:

```ts
{ action: "skipped_unchanged", embeddingsWritten: 0, scenesSkipped: N }
{ action: "indexed", embeddingsWritten: K, scenesSkipped: M }  // partial-skip case
```

Top-level workflow stats already track `succeeded` / `skipped` / `failed`; the `skipped_unchanged` action increments `succeeded` (the work was successful, just no-op).

## Constraints

- **Forward-only migration.** No DROP / RENAME. The columns are nullable with no default; existing rows simply have `content_hash IS NULL` and are treated as "needs re-embed on next run" until the first re-embed populates the hash.
- **Hash MUST include model name + a version marker.** A model upgrade or hash-algorithm change naturally invalidates the entire cache without operator intervention.
- **content_hash is NEVER exposed via GraphQL.** Add it to the existing `embed|vector|similarit`-pattern guard in `apps/admin/src/graphql/schema.test.ts` (extend to also reject `content_hash`).
- **Partial-skip path matters.** A typical re-run will see most scenes hash-match (skip) and a handful hash-miss (re-embed). The batched OpenRouter call (feat-116) must accept `scenesToEmbed.length` inputs, not the full set.
- **Soft-delete safety unchanged.** This ticket does not touch the soft-delete path (R1/R2 do not soft-delete today; both are re-derive-from-source pipelines).
- **R2 hash content is the chunk text.** R2 today reuses vectors verbatim from manager's `embeddings.json`; the savings here are DB-write churn (not OpenRouter). Worth doing even at lower magnitude because R2 does fire bulk writes.

## Verification

- `pnpm --filter @forge/admin typecheck` ✓
- `pnpm --filter @forge/admin lint` ✓
- Migration applies cleanly: `pnpm prisma migrate deploy` against a fresh DB AND against the populated `forge_admin` local DB (no destructive changes).
- New tests:
  - `computeSceneContentHash` is deterministic, version-prefixed, model-name-dependent.
  - Re-embed of an unchanged target returns `{ action: "skipped_unchanged", scenesSkipped: N }` and makes ZERO OpenRouter calls (provider mock asserts not called).
  - Re-embed of a partially-changed target re-embeds only the changed scenes (provider mock receives only the changed inputs in the batch).
  - GraphQL leak guard extended: `content_hash` field never appears in the schema.
- End-to-end local re-run benchmark: `pnpm run-embeds --pipeline=both --locale=en` immediately after a green run completes in seconds with `OpenRouter requests: 0`.
- Solutions doc: capture this as a new entry under `docs/solutions/best-practices/` describing the content-hash skip pattern (reference R3 as the precedent and link the previous embed-backfill performance tickets).
- `apps/admin/CLAUDE.md` R1 + R2 subsections gain a "Re-runs are incremental — only re-embed when content_hash changes" bullet.
