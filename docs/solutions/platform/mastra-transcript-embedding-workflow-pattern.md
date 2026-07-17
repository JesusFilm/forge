---
title: "Mastra transcript embedding workflow: source in Manager, vectors in Admin"
last_updated: 2026-05-25
problem_type: architecture_pattern
component: service_object
severity: high
module: apps/mastra
tags:
  - mastra
  - transcript-embedding
  - pgvector
  - admin-ingest
  - manager
  - provenance
  - search
related_features:
  - feat-132
related:
  - "docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md"
  - "docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md"
date_learned: 2026-05-25
---

# Mastra Transcript Embedding Workflow Pattern

## Context

Transcript embeddings used to be produced by Manager as
`{assetId}/embeddings.json` and then imported by Admin. That worked for the
first admin table migration, but it left chunk planning, provider calls, vector
storage, provenance, and search behavior spread across services.

feat-132 moved only transcript embedding generation into Mastra. The ownership
line is now:

- Manager produces transcript source data only: text plus timed segments.
- Mastra plans transcript chunks and calls the embedding provider.
- Admin owns vector storage, pgvector indexes, ingest validation, and search
  retrieval.

Do not use this pattern as precedent for moving live query embeddings or live
search orchestration into Mastra. Query-time retrieval remains Admin-owned.

## Guidance

Keep the flow contract-shaped instead of artifact-shaped:

1. Admin backfills enumerate `(video, edition, language)` targets and read
   Manager's transcript source artifact once per `(video, edition)` group.
2. Admin launches Mastra with Admin identifiers when it has them.
3. Manager-originated enrichment launches Mastra with external identifiers such
   as `assetId`, `muxAssetId`, optional Admin-provided `adminVideoId`, and
   language.
4. Mastra returns vectors only to Admin's internal transcript ingest endpoint.
5. Admin resolves the target, rejects ambiguity before writing, guards vector
   dimensions, stores provenance, and writes through the existing transcript
   vector tables.

The target resolution split is important:

```ts
target: {
  admin: {
    videoId,
    videoEditionId,
    coreId,
  },
}
```

Use that shape for Admin-originated backfills. Use this shape for
Manager-originated enrichment where `coreId` may not exist:

```ts
target: {
  external: {
    assetId,
    muxAssetId,
    adminVideoId,
  },
}
```

Admin must treat the external target as a lookup request, not an instruction to
write. If the identifiers resolve to zero or multiple Admin videos, the ingest
must return a rejected result before vector rows are touched. When `assetId` is
present, validate that the source artifact key belongs to that asset prefix.
When the run was triggered by Admin through Manager, pass `adminVideoId` through
as the Admin `video.id` constraint.

CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS document-id
compatibility in this Mastra embedding path. In particular, do not introduce
`videoDocumentId` into new transcript embedding contracts; use Admin/Core/Mux
identifiers instead.

## Why This Matters

This split gives Mastra the AI workflow responsibility without weakening Admin's
storage and retrieval guarantees:

- Admin's existing `video_transcript` and `video_transcript_chunk` tables remain
  the only transcript vector store.
- Existing mixed semantic video search continues to read transcript evidence
  from `video_transcript_chunk.embedding`.
- Provenance fields on `VideoTranscript` make Mastra runs auditable:
  `sourceArtifactKey`, `sourceContentHash`, `sourceProvider`,
  `sourceGeneratedAt`, `generationMode`, `mastraRunId`, and `chunkingVersion`.
- Ingest modes make rewrites explicit. Default idempotent mode should no-op only
  when provenance and chunk health match. `repair`, `force`, and
  `model-upgrade` must have distinct behavior.

The deletion gate for the old Manager transcript embedding producer is a contract
test, not just unit coverage. Prove that a Mastra-shaped payload is accepted by
Admin ingest, written into the existing transcript vector tables, and retrieved
by the existing Admin search path.

For local end-to-end proof, use Admin core sync to populate real catalogue data
before launching the workflow. A useful smoke target is an English video with a
Core VTT, Mux asset, and Admin video id. The feat-132 local proof used
`2_UltimateCoach`:

1. Run Admin core sync for catalogue, subtitle, dub, and download phases against
   the local Docker-backed Admin DB.
2. Build transcript source data from the core-synced VTT. Treat this as
   Manager-shaped source data: transcript text plus timed segments.
3. Launch Mastra with an external target that includes `assetId`, `muxAssetId`,
   and `adminVideoId`.
4. Verify Mastra Studio shows the three workflow tiles green.
5. Query `video_transcript` and `video_transcript_chunk` for the same
   `mastraRunId`, `sourceContentHash`, and 1536-dimensional chunk embeddings.
6. Query Admin search with text from the transcript and confirm the existing
   `semantic-video` retriever returns the synced video.

This proof is better than a synthetic "hello world" run because it exercises the
actual Admin catalogue rows, Mux identifiers, VTT-derived timed segments,
pgvector storage, and public search retrieval path together.

## Implementation Checklist

- Mastra workflow:
  - `apps/mastra/src/mastra/workflows/transcript-embedding.ts`
  - `apps/mastra/src/services/embedding-provider.ts`
  - `apps/mastra/src/services/admin-transcript-ingest-client.ts`
- Admin ingest and storage:
  - `apps/admin/src/app/api/internal/mastra/transcript-embeddings/route.ts`
  - `apps/admin/src/auth/mastra-ingest-bearer.ts`
  - `apps/admin/src/services/transcript-embedding-ingest.service.ts`
  - `apps/admin/src/services/transcript-embedding.service.ts`
  - `apps/admin/prisma/migrations/0018_transcript_embedding_mastra_provenance/migration.sql`
- Admin backfill:
  - `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`
  - `apps/admin/src/services/mastra-transcript-embedding-client.ts`
  - `apps/admin/src/services/manager-artifacts.service.ts`
- Manager launch surface:
  - `apps/manager/src/services/mastra-transcript-embeddings.ts`
  - `apps/manager/src/workflows/transcriptOnlyPipeline.ts`
  - `apps/manager/src/workflows/videoEnrichment.ts`
  - `apps/manager/src/services/embeddings.ts`

## Review Traps

- Do not let `force` mode collapse into an idempotent no-op when provenance and
  chunks already match.
- Do not collapse typed Mastra workflow failures into generic
  `admin_ingest_failed` results in the committed route path.
- Do not cast unknown Admin or Mastra enum strings into typed statuses. Parse
  them through allowlists and return `parse_error` or `admin_ingest_failed`.
- Do not create provenance columns without matching Prisma indexes when the
  service will query them.
- Do not ignore `assetId`, `muxAssetId`, or Admin-provided IDs in
  external-target ingest. Require `muxAssetId` for Manager-originated runs,
  use `adminVideoId` as the Admin-row constraint when present, and use `assetId`
  as an artifact-prefix drift guard.
- Do not add CMS compatibility fields such as `videoDocumentId` to the new
  Mastra transcript embedding contract.

## Validation

Run the focused proof set after changing this surface:

```bash
pnpm --filter @forge/admin db:generate
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin-graphql typecheck
pnpm --filter @forge/admin lint
pnpm --filter @forge/manager lint
pnpm --filter @forge/mastra lint
pnpm --filter @forge/admin-graphql lint
pnpm --filter @forge/mastra test
pnpm --filter @forge/admin test -- mastra-ingest-bearer.test.ts transcript-embedding-ingest.service.test.ts transcript-embedding-ingest.contract.test.ts route.test.ts transcript-embedding.service.test.ts transcriptEmbeddingBackfill.test.ts mastra-transcript-embedding-client.test.ts manager-artifacts.service.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts graphql/mutations/transcript-embedding.test.ts schema.test.ts schema.security.test.ts
pnpm --filter @forge/manager test -- transcriptOnlyPipeline.test.ts videoEnrichment.test.ts mastra-transcript-embeddings.test.ts embeddings.test.ts sceneEmbeddingSync.test.ts
pnpm --filter @forge/admin-graphql test
git diff --check
```

`@forge/admin-graphql` currently has no test files, so "No test files found,
exiting with code 0" is an acceptable result for that package.

For a local real-data smoke run after core sync, also verify:

```bash
pnpm --filter @forge/admin core-sync:run -- --full --scope=countries,keywords,video-origins,videos,video-images,video-editions,video-subtitles,video-dubs,video-dub-downloads
curl 'http://localhost:3003/api/search?q=ultimate%20coach%20game%20plan&locale=en&type=video&limit=5'
```

## Related

- `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`
  documents the pre-Mastra vector-reuse migration. Treat it as historical for
  transcript generation, but its bulk pgvector writer and search-index notes are
  still relevant.
- `docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md`
  documents why Admin keeps the public `semantic-video` retriever label while
  backing it with enriched transcript chunks.
