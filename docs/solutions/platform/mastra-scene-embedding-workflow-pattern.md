---
title: "Mastra scene embedding workflow: source artifacts in Manager, scene vectors through Admin ingest"
last_updated: 2026-05-26
date: 2026-05-26
date_learned: 2026-05-26
problem_type: architecture_pattern
component: service_object
severity: high
module: apps/mastra
related_components:
  - apps/admin
  - apps/manager
  - packages/admin-graphql
tags:
  - mastra
  - scene-embedding
  - admin-ingest
  - pgvector
  - manager
  - provenance
  - retries
  - search
related_features:
  - feat-133
  - feat-132
related:
  - "docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md"
  - "docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md"
  - "docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md"
applies_when:
  - "Moving generated scene vectors out of Manager or Admin provider calls"
  - "Adding a Mastra workflow that writes vectors into Admin-owned pgvector tables"
  - "Reviewing scene embedding idempotency, provenance, or retry behavior"
---

# Mastra Scene Embedding Workflow Pattern

## Context

Scene embeddings used to be generated directly by Admin from
`{assetId}/scene-analysis.json`, while older Manager paths could still embed
scene descriptions and post to legacy vector indexers. feat-133 moves only
scene embedding generation into Mastra.

The ownership line is now:

- Manager produces scene source artifacts only: `{assetId}/scene-analysis.json`.
- Mastra owns scene embedding generation, provider calls, provider response
  validation, retry policy, and Studio-visible workflow diagnostics.
- Admin owns target resolution, scene-specific ingest, pgvector storage,
  indexes, public GraphQL/search contracts, and retrieval.

Do not use this pattern to move live query embeddings or live search
orchestration into Mastra. Query-time retrieval remains Admin-owned.

## Guidance

Keep scene ingest scene-specific. Do not add a generic embedding blob endpoint.
Admin should expose an internal route shaped around scene source data, target
ids, model metadata, generation mode, Mastra run id, and compact provenance.

The flow is:

1. Admin backfill or GraphQL trigger enumerates `(video, edition, locale)`
   targets and loads the Manager scene-analysis artifact once per edition group.
2. Admin launches Mastra with Admin target ids and the scene source data.
3. Mastra validates the source shape, requires contiguous `sceneIndex` values
   from `0`, generates vectors, validates provider count/index/dimension shape,
   and submits the final payload to Admin ingest.
4. Admin resolves `videoId` and `videoEditionId`, rejects a mismatched supplied
   `coreId`, verifies the source hash, enforces 1536 dimensions, and writes to
   `video_scene` plus `video_scene_locale`.
5. Existing Admin search retrievers continue to read
   `video_scene_locale.embedding`.

The provenance contract should stay compact and queryable:

- `sourceArtifactKey`
- `sourceArtifactVersion`
- `sourceContentHash`
- `sourceProvider`
- `sourceGeneratedAt`
- `generationMode`
- `mastraRunId`
- `generatedAt`

Mastra step outputs must remain scrubbed. Step summaries can include counts,
indexes, dimensions, token counts, model name, source content hash, and run id;
they must not expose vectors or raw scene text. Typed workflow failures should
throw inside committed steps so Mastra Studio shows failed runs instead of green
runs with hidden `{ ok: false }` payloads.

## Why This Matters

This keeps each service aligned with its job:

- Manager remains an upstream source-artifact producer, not a vector service.
- Mastra gains durable observability for provider calls and retries.
- Admin remains the authority for storage, target safety, and search contracts.
- Existing public search behavior stays stable because the read path still uses
  the Admin pgvector tables.

Idempotency belongs at Admin ingest. Default `idempotent` mode should no-op only
when row count, vector health, source content hash, model, and dimensions match.
`repair` can rewrite unhealthy rows only when provenance still matches.
`force` and `model-upgrade` are explicit rewrite modes.

## Implementation Checklist

- Mastra workflow:
  - `apps/mastra/src/mastra/workflows/scene-embedding.ts`
  - `apps/mastra/src/services/embedding-provider.ts`
  - `apps/mastra/src/services/admin-scene-ingest-client.ts`
- Admin ingest and storage:
  - `apps/admin/src/app/api/internal/mastra/scene-embeddings/route.ts`
  - `apps/admin/src/auth/mastra-ingest-bearer.ts`
  - `apps/admin/src/services/scene-embedding-ingest.service.ts`
  - `apps/admin/src/services/scene-embedding.service.ts`
  - `apps/admin/prisma/migrations/0019_scene_embedding_mastra_provenance/migration.sql`
- Admin launch surfaces:
  - `apps/admin/src/services/mastra-scene-embedding-client.ts`
  - `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`
  - `apps/admin/src/graphql/mutations/scene-embedding.ts`
  - `apps/admin/src/scripts/run-embeds.ts`
- Manager cleanup:
  - `apps/manager/src/services/sceneEmbeddingSync.ts`
  - `apps/manager/src/app/api/backfill/{start,status,cancel}/route.ts`
  - `apps/manager/src/features/jobs/scene-embedding-sync-card.tsx`

## Review Traps

- Do not let Manager retain a runnable scene-vector backfill path after the
  Mastra workflow lands. Retired routes should fail closed.
- Do not accept missing source artifact provenance. Admin ingest should require
  artifact key, artifact version, and source provider.
- Do not trust caller-supplied `coreId`; compare it with the resolved Admin
  video row before writing.
- Do not retry nonretryable failures such as provider auth, provider dimension
  drift, invalid input, or Admin 4xx rejects. Retry only typed retryable
  provider/Admin failures.
- Do not create CMS/Strapi compatibility fields in the Mastra scene contract.
  Use Admin/Core/Mux identifiers and Admin-owned source artifacts.

## Validation

The feat-133 validation set proved the contract at both boundaries:

- Mastra-shaped scene output is accepted by Admin ingest.
- Admin writes provenance and vectors into `video_scene_locale`.
- Existing hybrid search retrievers still read the same table.
- Manager scene sync reports only source-artifact readiness.
- Retired Manager backfill routes no longer import legacy embedding services.

Run the focused checks from the roadmap after touching this path:

```bash
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- scene-embedding.service.test.ts sceneEmbeddingBackfill.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts
pnpm --filter @forge/manager test -- sceneEmbeddingSync.test.ts
```
