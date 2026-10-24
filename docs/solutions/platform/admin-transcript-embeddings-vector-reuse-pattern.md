---
title: "Admin transcript-embeddings indexer: reuse manager's precomputed vectors from S3, never regenerate"
last_updated: 2026-05-21
problem_type: best_practice
component: service_object
root_cause: cross_service_vector_trust_boundary
resolution_type: pattern
severity: medium
module: apps/admin
tags:
  - pgvector
  - prisma
  - embeddings
  - useworkflow
  - transcript-embedding
  - vector-reuse
  - migration
related_features:
  - feat-009
  - feat-041
  - feat-042
related:
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md"
  - "docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md"
  - "docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md"
  - "docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md"
  - "docs/solutions/best-practices/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md"
date_learned: 2026-04-22
---

## Search usage update (feat-131)

Transcript chunk vectors are now live search evidence in admin, but they still
do not form a separate RRF list. Since feat-192, `searchVideoSemantic` reads
the accepted enriched transcript chunk vector contract from
`video_transcript_chunk.embedding`, then emits one candidate per video to the
existing `semantic-video` RRF list. Scene embeddings remain historical storage
until the legacy cleanup pass deletes the unused pipeline.

The performance rule from this doc remains load-bearing: transcript semantic
search filters on `video_transcript_chunk.language`, not only
`video_transcript.language`, so the planner can use the same-table partial HNSW
indexes.

## Stage 3 (feat-117) update

The per-chunk `videoTranscriptChunk.upsert(...)` + per-row `$executeRaw …
UPDATE … embedding` write loop has been collapsed into ONE bulk
`INSERT INTO video_transcript_chunk … SELECT * FROM unnest(12 parallel
arrays) ON CONFLICT (transcript_id, chunk_index) DO UPDATE` per
`(video, edition, language)` target. Per-row Way A vector cast at the
SELECT seam (`u.embedding_text::vector(1536)`, NOT `::vector(1536)[]`
on the parameter — the array-input parser is less-trodden code), with
length-equality preflight asserting all 12 parallel arrays match
`artifact.chunks.length` BEFORE `$executeRaw` (PG18 silently NULL-pads
unequal-length unnest args). Round-trip count drops from `O(chunks)` to
`O(1)` per target. The parent `videoTranscript.upsert(...)` stays as a
Prisma call. The full bulk-write recipe + invariant tests + bind-count
regression guard live in
`docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`.
Mirrors the bullet that landed in `apps/admin/CLAUDE.md`.

## Problem

Admin and cms both need chunk-level transcript embeddings. The two
databases have incompatible schemas (cms: integer SERIAL ids +
denormalized `transcript_embeddings` table; admin: `cuid()` + parent-
chunk split), so the row-level copy that a normal migration would use
is not available. At the same time, regenerating embeddings from
admin's own provider is wasteful here in a way R1's scene-embeddings
case wasn't: **manager already embedded these chunks during enrichment
and stored the vectors in the artifact.** Re-running the provider
against the same text wastes spend for effectively identical output.

## Solution

Trust the artifact. Don't re-embed.

`apps/manager/src/services/embeddings.ts::EmbeddingsResult` carries a
vector alongside each chunk:

```ts
type EmbeddingChunk = {
  chunkId: string
  text: string
  embedding: number[] // <-- this is the thing R2 copies
  metadata: { tokenCount: number; startTime?: number; endTime?: number }
}
```

Admin reads the artifact, validates the shape + dimensions, and writes
each chunk's vector into `VideoTranscriptChunk.embedding` via
`prisma.$executeRaw\`UPDATE ... SET embedding = ${toPgVector(vec)}::vector\``
inside a `$transaction`. No provider call. Same model, same output,
no drift.

This is the R1 pattern minus the provider round-trip. R1
(`docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`)
had to regenerate because `scene-analysis.json` only stores text —
manager's scene pipeline doesn't embed descriptions, cms does. R2's
`embeddings.json` _does_ embed, so admin doesn't have to.

### Three decisions worth preserving

1. **Dimensions are a hard guard; model is a log-only warning.** The
   indexer rejects any artifact whose top-level `dimensions !== 1536`
   or whose chunk-level `embedding.length !== 1536` as
   `TranscriptIndexError("dimension_mismatch")` — an operational bug
   the operator must see in the report. Model-stamp mismatches
   (`openai/text-embedding-3-small` vs `text-embedding-3-small` vs a
   future upgrade) are logged as `transcript_model_mismatch` but DO
   NOT reject. The whole point of vector reuse is to trust manager's
   stamp; hard-reject on model would defeat it. A future model-upgrade
   workflow can re-embed selectively when the team decides to move.

2. **Denormalize `language` onto the chunk row for partial HNSW.**
   `VideoTranscript.language` is keyed on `(videoEditionId, language)`;
   chunks could have filtered through the parent. But pgvector bypasses
   a global HNSW index when a `WHERE language = ?` predicate filters a
   column on a **joined** table — the planner plans a seq scan instead.
   (See
   `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`.)
   Partial HNSW indexes want the filter column on the same table as
   the vector, so `VideoTranscriptChunk` carries a denormalized
   `language` that the indexer keeps in sync with the parent at write
   time. No DB CHECK — Postgres can't express cross-row invariants
   cleanly.

3. **Parent-chunk, not parent-per-chunk-locale.** R1 split into
   `VideoScene` + `VideoSceneLocale` because scene descriptions are
   translated per-locale. Transcripts aren't translated — they're
   transcribed once in a source language, and each chunk is that
   language's content. The R2 parent carries artifact metadata that
   applies to all chunks (model, chunking strategy, generatedAt); the
   chunk carries per-chunk text + vector. Same parent-child depth as
   R1, different semantics inside.

### Pitfalls worth repeating

- **Invariants ported from R1 must be re-validated against R2's data
  provenance.** R1's `assertNoDuplicateSceneIndexes` iterates
  `scene.sceneIndex` — a value from the upstream artifact that can
  genuinely duplicate. R2's naive port became
  `assertNoDuplicateChunkIndexes` iterating the loop counter `i` —
  which can never duplicate by construction. The check was a dead
  no-op that still carried its original error code, and three
  reviewers each flagged a different symptom of the same bug. See
  `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  for the full pattern. Any future R3–R9 port must re-derive the
  invariant, not just copy the check.
- **Prisma `$executeRaw` + `::vector` cast must run inside
  `$transaction`** when the chunk upsert and vector write depend on
  each other. Same rule as R1.
- **Zod top-level `.passthrough()`, chunk-level `.strict()`.** The top
  level tolerates future manager-side additions (`metadataEmbedding`,
  `artifactKeys`, new metadata fields) without a coordinated admin
  release. The chunk level is strict because an unknown chunk field
  would silently corrupt what the indexer reads.
- **Never echo the Zod error message in the thrown error.** The
  artifact contains chunk text (user-controlled content). Log the Zod
  detail server-side only; throw a stable generic message. Same rule
  as R1's `core-id-mapping.service.ts::loadCoreIdMapping` per
  `docs/solutions/best-practices/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md`.
- **Dispatch test mandatory.** The `triggerTranscriptEmbeddingBackfill`
  resolver must call `start(runTranscriptEmbeddingBackfill, [input])`
  from `workflow/api`. `"use workflow"` is inert under vitest;
  body-only tests will not catch a missing `start()` wrapper. Pattern:
  `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`.
- **Pre-transaction prune covers re-chunking.** If manager re-runs
  enrichment and produces fewer chunks, the pre-transaction
  `deleteMany({ chunkIndex: { notIn: incomingIndexes } })` removes
  orphans before the upsert loop. Bounded to the current transcript;
  other editions' rows are untouched.
- **Language resolution stays inside admin.** The artifact doesn't
  carry a top-level language field. Admin resolves each target's
  BCP-47 via `Video.primaryLanguage.bcp47` (fallback `en`). If manager
  ever adds a language field to the artifact, prefer that — it's the
  authoritative signal (manager sometimes falls back to English
  transcription when the requested source language isn't available —
  see
  `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`).

### Why not R1's regenerate pattern?

| Aspect                      | R1 (scene-embeddings)                 | R2 (transcript-embeddings)    |
| --------------------------- | ------------------------------------- | ----------------------------- |
| Source artifact             | `scene-analysis.json`                 | `embeddings.json`             |
| Vectors in artifact?        | No — text-only                        | Yes — per chunk               |
| Admin does                  | Re-embed descriptions                 | Copy vectors                  |
| OpenRouter cost             | ~$0.005/catalog                       | $0                            |
| Drift risk                  | None (same model + text)              | Model-stamp mismatch possible |
| What breaks on model change | Silent drift until both sides upgrade | Admin warns, operator audits  |

## Verification

- `SELECT COUNT(*) FROM video_transcript_chunk WHERE embedding IS NOT NULL`
  grows to match `totalChunks` from the artifact's metadata row on
  `video_transcript`. Re-running the backfill keeps the count stable.
- `EXPLAIN (ANALYZE) SELECT ... ORDER BY embedding <=> ?::vector
WHERE language = 'en' LIMIT 10` should hit
  `video_transcript_chunk_embedding_hnsw_en`, not a sequential scan.
- Indexer unit tests cover: dimension hard-guard, model log-only,
  chunk-level empty-text rejection, duplicate chunk-index rejection,
  transaction boundary + timeout, prune-on-re-run, vector reuse (no
  provider call made). Live-Postgres smoke is gated on the same
  operational unblocker as R1 prod smoke.
- Workflow body tests cover per-target error isolation (ManagerArtifactError
  `artifact_missing` → skipped; every other error → failed), language-
  filter inclusion semantics, coreId filter, empty inputs.
- Dispatch test asserts the mutation calls `start()` from
  `workflow/api` with the workflow function reference and args tuple.

## Related

- `apps/admin/src/services/transcript-embedding.service.ts` — indexer.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — backfill.
- `apps/admin/src/graphql/mutations/transcript-embedding.ts` — trigger.
- `apps/admin/src/services/manager-artifacts.service.ts` — `readEmbeddingsArtifact`
  and the `EmbeddingsResult` Zod schema.
- `apps/manager/src/services/embeddings.ts` — artifact producer.
- `docs/plans/2026-04-22-002-feat-admin-transcript-embeddings-infra-plan.md`
  — implementation plan.
- `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
  — R2 origin.
- `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md`
  — Stage 2 (feat-116) widens this indexer's input with a first-class
  `loadedArtifact?: EmbeddingsResult` parameter (renamed from the
  test-only `artifactOverride?`). The workflow now fetches the
  embeddings artifact ONCE per `(video, edition)` group and passes
  it to each per-language `indexEditionTranscript(...)` call so the
  service short-circuits the S3 read. NOTE: Stage 2's batched-
  provider sibling pattern does NOT apply to R2 — R2 reuses vectors
  verbatim from the artifact and never calls the provider, which is
  the whole point of the R2 vs R1 divergence documented above.
