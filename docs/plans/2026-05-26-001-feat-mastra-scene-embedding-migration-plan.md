---
title: Mastra Scene Embedding Migration
type: feat
status: active
date: 2026-05-26
origin: docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md
---

# Mastra Scene Embedding Migration

## Summary

Move scene embedding generation out of Admin and Manager into a Mastra-owned
workflow. Admin keeps scene vector storage, target resolution, pgvector indexes,
GraphQL trigger authority, and search retrieval. Manager keeps producing
`scene-analysis.json` source artifacts only.

## Requirements

- Mastra owns scene vector provider calls, retries, failure diagnostics, and
  Studio-visible workflow runs.
- Admin exposes a scene-specific internal ingest endpoint for Mastra payloads;
  no generic vector blob endpoint.
- Admin stores compact scene provenance: source artifact key/version, source
  text/hash/snippet, locale, model/provider/dimensions, generation mode,
  Mastra run id, and generated timestamp.
- Admin scene backfill and GraphQL trigger paths launch Mastra with source scene
  data instead of calling the embedding provider directly.
- Manager no longer generates or posts final scene vectors; it preserves
  scene-analysis source artifact production.
- Existing Admin search and retrieval continue to read
  `video_scene_locale.embedding` without public response-shape changes.
- Live query embeddings, live search orchestration, experience embeddings,
  production search traces, and eval retrieval stay out of scope.
- Do not add CMS/Strapi identifiers to new contracts. Mastra/Admin contracts use
  Admin/Core/Mux identifiers and scene source artifacts.

## Context & Patterns

- `apps/admin/src/services/scene-embedding.service.ts` already owns the bulk
  `video_scene` + `video_scene_locale` writer, but currently calls the provider.
- `apps/admin/src/services/transcript-embedding-ingest.service.ts` is the model
  for authenticated, type-specific ingest, idempotent/repair/force/model-upgrade
  modes, target resolution, provenance, and advisory locking.
- `apps/mastra/src/mastra/workflows/transcript-embedding.ts` is the model for a
  committed three-step workflow that keeps vectors out of step output and throws
  typed workflow failures so Studio marks failed runs as failed.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` is the model for
  Admin loading a Manager source artifact once per `(video, edition)` group and
  launching Mastra once per language/locale target.
- `docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md`
  documents the ownership boundary and review traps to mirror for scenes.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md` and
  `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`
  remain authoritative for the scene table write shape and vector casts.

## Implementation Units

### U1. Scene Provenance Schema and Storage Writer

Files:

- Modify `apps/admin/prisma/schema.prisma`
- Add `apps/admin/prisma/migrations/0019_scene_embedding_mastra_provenance/migration.sql`
- Modify `apps/admin/src/services/scene-embedding.service.ts`
- Modify `apps/admin/src/services/scene-embedding.service.test.ts`

Approach:

- Add nullable provenance columns and useful indexes on `video_scene_locale`,
  matching transcript's parent-grain provenance where possible but at scene
  locale grain: `sourceArtifactKey`, `sourceContentHash`, `sourceProvider`,
  `sourceGeneratedAt`, `generationMode`, `mastraRunId`, and
  `sourceArtifactVersion`.
- Refactor `indexEditionScenes` so it can write Mastra-supplied scene payloads
  through the existing bulk SQL path without generating embeddings itself.
- Keep vector, source text, and raw Prisma detail out of public GraphQL and
  normal workflow reports.

Test scenarios:

- Reject wrong vector dimensions before any write.
- Persist provenance and source text/snippet to `video_scene_locale`.
- Preserve existing bulk SQL shape: `INSERT INTO video_scene_locale`,
  per-row `u.embedding_text::vector(1536)`, and `ON CONFLICT`.
- Existing direct `indexEditionScenes` tests are updated to inject vectors or
  moved behind the new Mastra-oriented writer.

### U2. Admin Scene Mastra Ingest Contract

Files:

- Add `apps/admin/src/services/scene-embedding-ingest.service.ts`
- Add `apps/admin/src/services/scene-embedding-ingest.service.test.ts`
- Add `apps/admin/src/services/scene-embedding-ingest.contract.test.ts`
- Add `apps/admin/src/app/api/internal/mastra/scene-embeddings/route.ts`
- Add `apps/admin/src/app/api/internal/mastra/scene-embeddings/route.test.ts`
- Modify `apps/admin/src/auth/mastra-ingest-bearer.ts`
- Modify `apps/admin/src/auth/mastra-ingest-bearer.test.ts`
- Modify `apps/admin/src/config/env.ts`

Approach:

- Add `MASTRA_SCENE_INGEST_API_KEYS`, separate from workflow launch keys and
  transcript ingest keys.
- Validate exactly one Admin target shape with `videoId`, `videoEditionId`, and
  optional `coreId`; scene ingest for this ticket does not accept CMS document
  IDs or generic external blob targeting.
- Validate locale, scene indexes, timecodes, non-empty source text, model,
  dimensions, generation mode, Mastra run id, source artifact metadata, and
  provider response shape.
- Implement idempotent, repair, force, and model-upgrade behavior against
  existing `video_scene_locale` rows.

Test scenarios:

- Valid Mastra-shaped scene payload writes `video_scene_locale`.
- Invalid bearer, malformed JSON, dimension drift, duplicate/noncontiguous
  scenes, and source hash mismatch are rejected with safe envelopes.
- Idempotent rerun returns `unchanged` for healthy matching rows and rejects
  differing existing rows.
- `repair`, `force`, and `model-upgrade` intentionally rewrite only under the
  requested mode.

### U3. Mastra Scene Embedding Workflow and Route

Files:

- Add `apps/mastra/src/mastra/workflows/scene-embedding.ts`
- Add `apps/mastra/src/mastra/workflows/scene-embedding.test.ts`
- Add `apps/mastra/src/services/admin-scene-ingest-client.ts`
- Add `apps/mastra/src/services/admin-scene-ingest-client.test.ts`
- Modify `apps/mastra/src/mastra/index.ts`
- Modify `apps/mastra/src/config/env.ts`
- Modify `apps/mastra/src/config/env.test.ts`
- Modify `apps/mastra/AGENTS.md`
- Modify `apps/mastra/CLAUDE.md`

Approach:

- Mirror the transcript workflow's committed graph:
  `validate-and-plan-scene-embedding` → `embed-scene-descriptions` →
  `ingest-scene-embeddings`.
- Accept Admin target identifiers and scene source data, generate vectors from
  scene descriptions/source text, validate response length/index/dimensions, and
  submit final payloads to Admin ingest.
- Keep step outputs summarized: counts, dimensions, hashes, model/provider,
  locale, and run id only; no raw vectors.
- Throw typed workflow failures inside committed runs so provider or Admin
  failures appear as failed Mastra Studio runs, not successful `{ ok: false }`
  runs.

Test scenarios:

- Valid workflow input produces Admin ingest payload with no vector text in
  route responses or step summaries.
- Provider length/index/dimension errors fail safely.
- Admin 401, 409 rejected, parse errors, 5xx, and config missing map to typed
  workflow failure reasons.
- Workflow id and route registration are stable and protected by service bearer.

### U4. Admin Backfill and GraphQL Trigger Launch Mastra

Files:

- Add `apps/admin/src/services/mastra-scene-embedding-client.ts`
- Add `apps/admin/src/services/mastra-scene-embedding-client.test.ts`
- Modify `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`
- Modify `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts`
- Modify `apps/admin/src/graphql/mutations/scene-embedding.ts`
- Modify `apps/admin/src/graphql/mutations/scene-embedding.test.ts`
- Modify `apps/admin/src/scripts/run-embeds.ts`
- Modify `apps/admin/src/config/env.ts`
- Modify `apps/admin/AGENTS.md`
- Modify `apps/admin/CLAUDE.md`

Approach:

- Add Admin's Mastra scene launcher client, analogous to the transcript client,
  posting to `/forge-scene-embeddings`.
- Keep Admin's existing target enumeration, grouping, missing-artifact report,
  retry selectors, and search table ownership.
- Add optional scene generation `mode` to the GraphQL trigger and local CLI,
  defaulting to idempotent.
- Replace per-locale `indexEditionScenes` provider calls with Mastra launch
  calls using the preloaded scene-analysis artifact.

Test scenarios:

- Backfill launches Mastra once per locale target with Admin target ids and
  source scene data.
- Missing source artifacts still produce `missingArtifacts` with
  `kind: "scene-analysis"`.
- Mastra failure reasons map to failed outcomes without leaking vectors.
- GraphQL dispatch passes mode and filters into the workflow.

### U5. Manager Scene Source-Only Cleanup

Files:

- Modify or remove `apps/manager/src/services/sceneEmbeddingSync.ts`
- Modify `apps/manager/src/services/sceneEmbeddingSync.test.ts`
- Remove retired `apps/manager/src/services/sceneEmbedder.ts`
- Remove retired `apps/manager/src/services/sceneEmbedder.test.ts`
- Retire `apps/manager/src/app/api/backfill/{start,status,cancel}/route.ts`
- Modify `apps/manager/src/workflows/videoEnrichment.ts`
- Modify `apps/manager/src/workflows/videoEnrichment.test.ts`
- Modify `apps/manager/src/types/job.ts`
- Modify `apps/manager/src/lib/scene-embedding-sync-report.ts`
- Modify `apps/manager/AGENTS.md`
- Modify `apps/manager/CLAUDE.md`

Approach:

- Stop Manager from generating scene vectors or POSTing them to CMS/Admin
  indexers.
- Preserve `scene-analysis.json` production and the product-level artifact
  report that tells operators scene source data exists.
- Leave transcript Mastra launching untouched.

Test scenarios:

- Full enrichment writes/analyzes scene source data but does not call
  `requestEmbeddingVectors`, `cmsPost("/scene-embedding/index")`, or any vector
  index endpoint.
- `sceneEmbeddingSync.test.ts` becomes source-artifact-only coverage or is
  replaced by an explicit obsolete-producer guard.

### U6. Contract Proof, Search Read Path, and Documentation

Files:

- Modify `apps/admin/src/services/hybrid-search-retrievers.test.ts`
- Modify `apps/admin/src/services/hybrid-search.service.test.ts`
- Modify `apps/admin/src/services/search-eval/fingerprint.test.ts`
- Modify `apps/admin/src/graphql/schema.test.ts`
- Add `docs/solutions/platform/mastra-scene-embedding-workflow-pattern.md`
- Modify `docs/roadmap/content-discovery/feat-133-mastra-scene-embedding-workflow-migration.md`

Approach:

- Add a contract test that sends a Mastra-shaped scene payload through Admin
  ingest, stores rows in `video_scene_locale`, and proves existing search
  retrievers still read the same table.
- Keep search retrieval implementation unchanged unless tests expose a needed
  provenance-safe adjustment.
- Complete the roadmap ticket only after validation and CE review.

Verification:

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/admin test -- scene-embedding.service.test.ts sceneEmbeddingBackfill.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts`
- `pnpm --filter @forge/manager test -- sceneEmbeddingSync.test.ts`
- Relevant lint/typecheck for touched packages.
- `git diff --check`
