---
title: "Vector embedding storage scope and PR sequencing"
module: CMS and Manager
date: 2026-04-11
problem_type: best_practice
component: database
symptoms:
  - "The transcript chunk table was named `video_embeddings`, which sounded broader than its actual row shape"
  - "The same PR risked becoming a catch-all redesign for transcript, metadata, scene, and future video profile vectors"
  - "Manager UI copy said generic embeddings even though the CMS sync path only wrote transcript chunks"
  - "Future scene and video profile embedding work needed sequencing without destabilizing the transcript sync PR"
root_cause: inadequate_documentation
resolution_type: documentation_update
severity: medium
tags:
  - embeddings
  - pgvector
  - cms
  - manager
  - transcript-embeddings
  - scene-embeddings
  - video-profile-embeddings
  - pr-sequencing
---

# Vector embedding storage scope and PR sequencing

Update (2026-04-10): the dedicated follow-up rename landed, so the transcript chunk table now uses `transcript_embeddings`. The sequencing guidance below remains as the decision record for why that rename was split from the earlier transcript sync work.

## Problem

The enrichment transcript sync PR made generated transcript chunks durable in the CMS pgvector index, but it surfaced a naming and scope problem: the physical CMS table is called `video_embeddings`, while the data being synced is specifically transcript chunks.

That mismatch became more risky once we considered existing `scene_embeddings`, artifact-only `metadataEmbedding`, and future video profile vectors for recommendations, semantic playlists, and viewer journeys. The tempting fix was to rewrite the current PR into a broader embedding architecture. That would have expanded a nearly-complete transcript sync PR into a multi-vector storage redesign.

## Root Cause

The system has multiple embedding grains that answer different retrieval questions:

- transcript chunk embeddings answer "where in the spoken transcript does this query match?"
- scene embeddings answer "which visually and thematically analyzed scenes are similar?"
- metadata or video profile embeddings answer "what is this video broadly about?"

The original table name `video_embeddings` hid that distinction because it sounded like the canonical home for all video-related vectors. The row shape, however, is transcript-specific:

```sql
video_id
chunk_index
chunk_text
embedding
model
```

This is not a good home for scene descriptions, asset-level metadata vectors, or future video profile vectors.

## Decision

Keep the current PR transcript-only and do not rewrite it from scratch.

For the current PR:

- keep the physical table name `video_embeddings`
- make UI and docs say "transcript embeddings" clearly
- sync only `EmbeddingsResult.chunks[]`
- leave `metadataEmbedding` artifact-only
- do not add scene embedding indexing to the same diff

Then follow up with smaller PRs:

1. Rename `video_embeddings` to `transcript_embeddings` in a dedicated database/copy cleanup PR.
2. Integrate scene embedding indexing into the enrichment scene-analysis path.
3. Design a CMS home for future video profile or metadata-derived embeddings only after the retrieval strategy is clear.

## Storage Pattern

Prefer separate pgvector tables by retrieval grain, not one generic table just because all rows contain vectors.

Recommended shape:

```text
transcript_embeddings
  one row per transcript chunk
  optimized for transcript semantic search and snippets

scene_embeddings
  one row per analyzed scene
  optimized for scene-level recommendations and thematic grouping

video_profile_embeddings
  one or a few rows per video
  optimized for next-best-video, journeys, and playlist generation
```

Avoid flattening semantically different vectors into transcript rows:

```typescript
// Avoid: metadata is not a transcript chunk.
await cmsPost("/embedding/index", {
  videoDocumentId,
  chunks: [
    ...transcriptChunks,
    {
      text: metadataEmbedding.text,
      embedding: metadataEmbedding.embedding,
    },
  ],
})
```

Keep each vector source honest about what it represents:

```typescript
// Current PR: transcript chunks only.
await cmsPost("/embedding/index", {
  videoDocumentId,
  mode: "if_missing",
  chunks: transcriptChunks.map((chunk) => ({
    text: chunk.text,
    embedding: chunk.embedding,
  })),
  model: generated.model,
})
```

## Identifier Boundary

Use stable document IDs at external API boundaries, but keep numeric Strapi IDs as internal foreign keys where they serve joins.

For example, manager enrichment jobs naturally know `videoDocumentId`, while `scene_embeddings` and transcript embeddings join through numeric `videos.id`:

```text
Manager request:
  videoDocumentId

CMS boundary:
  videoDocumentId -> published videos.id

pgvector table:
  video_id REFERENCES videos(id) ON DELETE CASCADE
```

Do not rewrite `scene_embeddings` to only use `videoDocumentId` unless the recommendation query model is intentionally redesigned. Existing recommendation joins use numeric IDs for `videos`, variants, images, child/parent exclusions, and locale filtering.

## PR Sequencing

### PR 1: Transcript sync only

Scope:

- generated enrichment transcript chunks sync to CMS pgvector
- missing-only auto-indexing
- explicit override path
- transcript-specific UI copy
- no scene or metadata storage changes

Why: This makes transcript semantic search usable without forcing all vector architecture decisions into the same review.

### PR 2: Rename transcript table

Scope:

- rename `video_embeddings` to `transcript_embeddings`
- update bootstrap SQL/indexer queries/tests/docs
- add a safe rename path for environments that already created `video_embeddings`

Why: The physical table name should eventually match the domain concept, but it is cleaner as a focused database/copy cleanup PR.

### PR 3: Scene embeddings from enrichment

Scope:

- keep standalone subtitle-backed scene backfill
- extract shared manager scene embedding sync logic from `sceneEmbedder.ts`
- let enrichment call that service after `scene-analysis` succeeds
- allow CMS `/scene-embedding/index` to resolve `videoDocumentId` at the API boundary
- keep `scene_embeddings.video_id` numeric internally

Why: New enrichment jobs already guarantee transcripts, so they should be able to produce scene embeddings without requiring a pre-existing CMS subtitle URL.

### PR 4: Video profile retrieval design

Scope:

- decide whether `metadataEmbedding` is queried directly or folded into a richer video profile vector
- design `video_profile_embeddings` or equivalent only after the query/ranking use cases are clear

Why: For next-best-video, semantic playlists, and viewer journeys, a video-level profile vector is likely more useful than a raw metadata-only vector table.

## What Didn't Work

### Rewriting the current PR into a general embedding architecture

This would mix a working transcript sync with table renames, scene enrichment integration, metadata storage, and future recommendation strategy. Review risk rises sharply, and it becomes harder to know whether a regression came from sync mechanics or architecture churn.

### Treating `video_embeddings` as a generic table

The existing row shape is transcript-specific because it stores `chunk_index` and `chunk_text`. Adding metadata or scene rows would require nullable columns, type discriminators, and divergent query logic. That would make both search and recommendations harder to reason about.

### Using `videoDocumentId` as the only scene embedding key

`videoDocumentId` is useful for manager-to-CMS API requests, but the recommendation SQL is relational and numeric-ID based. Keeping numeric `video_id` internally preserves foreign keys, cascade behavior, and efficient joins.

## Prevention

- Name vector stores by retrieval grain: transcript, scene, video profile.
- Keep artifact evolution additive, but do not assume every artifact vector needs immediate CMS storage.
- When a table name is too broad, separate copy/domain cleanup from functional sync work unless the rename is required for correctness.
- Accept stable IDs like `videoDocumentId` at API boundaries, then resolve to CMS-owned row IDs inside CMS.
- Do not put metadata, scene, or profile vectors into transcript chunk tables just to make them "synced."
- Update UI copy to match the exact vector type being synced, especially when physical table names lag behind domain naming.

## Related References

- [pgvector Setup and Embedding Indexing in Strapi v5](pgvector-embedding-indexing-strapi-v5.md)
- [Manager embeddings: transcript-aware chunking with additive metadata artifact contract](../integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md)
- [Multimodal scene analysis pipeline](../platform/multimodal-scene-analysis-pipeline.md)
- [Plan: Sync enrichment transcript embeddings into CMS vector index](../../plans/2026-04-09-feat-sync-enrichment-embeddings-into-cms-vector-index-plan.md)
- [Plan: Integrate scene embeddings into enrichment pipeline](../../plans/2026-04-11-feat-integrate-scene-embeddings-into-enrichment-plan.md)
