---
title: Mastra Embedding Workflow Hardening
type: feat
status: completed
date: 2026-05-26
origin: docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md
roadmap: docs/roadmap/content-discovery/feat-135-mastra-embedding-workflow-hardening.md
---

# Mastra Embedding Workflow Hardening

## Summary

Harden the completed transcript, scene, and experience embedding migrations by
extracting only the shared primitives proven across all three slices. Mastra
keeps owning background provider calls and workflow observability. Admin keeps
owning vector storage, target resolution, ingest validation, pgvector indexes,
publication gates, public search contracts, and live query embeddings.

## Problem Frame

The three migrations landed intentionally as concrete, type-specific paths. The
remaining risk is duplicated validation and drift-prone product semantics:
provider vector checks, Admin ingest client behavior, generation modes,
idempotent/repair/rewrite statuses, and operator-facing ownership docs now exist
in three similar shapes. This hardening pass should reduce that duplication
without introducing a generic embedding blob endpoint or weakening any
type-specific contract.

## Requirements

- R1. Mastra provider validation consistently enforces response count alignment,
  finite numeric vectors, and expected dimensions for transcript chunks, scene
  descriptions, and experience source text.
- R2. Mastra shares Admin ingest client transport, error classification, retry
  hints, and status parsing rules while preserving separate transcript, scene,
  and experience payload/result schemas.
- R3. Generation modes are consistent across embedding types:
  `idempotent`, `repair`, `force`, and `model-upgrade`.
- R4. Admin ingest services use common language for compact provenance and
  write outcomes while keeping type-specific source, target, and vector
  validation local to each service.
- R5. Manager/Admin leftover migration scaffolding that depends on CMS or old
  generated embedding artifacts is removed or narrowed.
- R6. Package guides and durable solution docs describe the final ownership
  boundary after all three migrations.

## Scope Boundaries

- Do not add a generic Admin embedding ingest endpoint.
- Do not combine transcript, scene, and experience payload schemas.
- Do not move live user search orchestration or live query embedding generation
  into Mastra.
- Do not change public REST or GraphQL response shapes.
- Do not preserve CMS/Strapi compatibility in migrated embedding paths.
- Do not refactor unrelated workflow, search, or UI code for style only.

## Context & Research

- `apps/mastra/src/services/embedding-provider.ts` already centralizes provider
  HTTP calls, but workflow-injected requesters can bypass its response-shape
  checks. Harden at the provider-result boundary so every workflow gets the
  same count, finite-value, and dimension guarantees.
- `apps/mastra/src/services/admin-transcript-ingest-client.ts`,
  `apps/mastra/src/services/admin-scene-ingest-client.ts`, and
  `apps/mastra/src/services/admin-experience-ingest-client.ts` duplicate
  config/auth/network/parse/rejected classification. The type-specific result
  parsers should remain local, but transport and classification can be shared.
- `apps/admin/src/services/transcript-embedding-ingest.service.ts`,
  `apps/admin/src/services/scene-embedding-ingest.service.ts`, and
  `apps/admin/src/services/experience-embedding-ingest.service.ts` already
  share the status vocabulary. Small shared types/helpers can reduce drift
  without moving source hash, target, or row-health decisions out of the
  concrete services.
- `apps/manager/src/services/embeddingSync.ts`,
  `apps/manager/src/app/api/jobs/[id]/embedding-sync/override/route.ts`, and
  related UI/report types still reference CMS transcript vector sync and
  `{assetId}/embeddings.json`. Those are incompatible with the final ownership
  model and should be removed when safe.
- `apps/admin/src/services/manager-artifacts.service.ts` still has a
  `readEmbeddingsArtifact` path for old manager-generated vectors. That path is
  no longer part of production transcript, scene, or experience generation.
- `apps/admin/src/services/embeddings.service.ts` must retain Admin-side live
  query embedding generation for search. Any cleanup here must avoid removing
  `generateExperienceEmbedding`, `apps/admin/src/services/hybrid-search.service.ts`,
  dashboard search diagnostics, or search health probes.

## Key Technical Decisions

- Shared Mastra provider validation should validate a normalized
  `EmbeddingProviderResult`, not only provider HTTP JSON. This makes production
  and test-injected requesters follow the same contract.
- Shared Mastra Admin ingest code should be a generic transport/parser helper
  with a type-specific `parseResult` callback. The public exports remain
  `callAdminTranscriptIngest`, `callAdminSceneIngest`, and
  `callAdminExperienceIngest`.
- Admin shared helpers should be limited to mode/status vocabulary and write
  outcome naming. Type-specific services keep their own Zod schemas, source
  hashes, target resolution, advisory locks, and row-health checks.
- Manager cleanup should delete CMS vector-sync behavior rather than rename it.
  Manager remains source-artifact owner and Mastra launcher, not a vector sync
  or vector override surface.
- Admin's direct embedding provider helper remains only for live search query
  embeddings and diagnostics. Background content embedding generation stays in
  Mastra.

## Implementation Units

### U1. Mastra Shared Provider Validation

**Goal:** Ensure all embedding workflows enforce the same provider-result
contract.

**Files:**

- Modify: `apps/mastra/src/services/embedding-provider.ts`
- Modify: `apps/mastra/src/services/embedding-provider.test.ts`
- Modify: `apps/mastra/src/mastra/workflows/transcript-embedding.ts`
- Modify: `apps/mastra/src/mastra/workflows/scene-embedding.ts`
- Modify: `apps/mastra/src/mastra/workflows/experience-embedding.ts`
- Modify tests as needed under `apps/mastra/src/mastra/workflows/*.test.ts`

**Test Scenarios:**

- Provider result with fewer vectors than inputs fails with retryable
  `invalid_response`.
- Provider result with non-finite vector values fails before Admin ingest.
- Provider result with inconsistent or unexpected dimensions fails as
  `dimension_mismatch`.
- Workflow-injected requesters cannot bypass these checks.

### U2. Mastra Shared Admin Ingest Client

**Goal:** Share Admin ingest transport and error classification while keeping
type-specific payload/result parsers.

**Files:**

- Create: `apps/mastra/src/services/admin-embedding-ingest-client.ts`
- Create: `apps/mastra/src/services/admin-embedding-ingest-client.test.ts`
- Modify: `apps/mastra/src/services/admin-transcript-ingest-client.ts`
- Modify: `apps/mastra/src/services/admin-scene-ingest-client.ts`
- Modify: `apps/mastra/src/services/admin-experience-ingest-client.ts`
- Modify type-specific ingest client tests as needed

**Test Scenarios:**

- Missing URL or bearer returns `config_missing`.
- 401 returns nonretryable `auth_failed`.
- 409 with a parsed rejected result returns nonretryable `rejected`.
- Admin 4xx JSON error preserves `adminReason`.
- 5xx/429/network failures remain retryable.
- Unknown success statuses still parse-fail instead of being cast.

### U3. Admin Mode/Outcome Common Language

**Goal:** Align mode/status naming across Admin ingest services without moving
concrete validation out of those services.

**Files:**

- Create: `apps/admin/src/services/embedding-ingest-shared.ts`
- Create: `apps/admin/src/services/embedding-ingest-shared.test.ts`
- Modify: `apps/admin/src/services/transcript-embedding-ingest.service.ts`
- Modify: `apps/admin/src/services/scene-embedding-ingest.service.ts`
- Modify: `apps/admin/src/services/experience-embedding-ingest.service.ts`
- Modify focused ingest service tests as needed

**Test Scenarios:**

- `statusForEmbeddingWrite` returns `created`, `repaired`,
  `model_upgraded`, or `forced` consistently.
- `repair` rejects provenance drift and leaves healthy matching vectors
  unchanged where the concrete service already requires that behavior.
- Existing transcript/scene/experience ingest tests continue proving
  type-specific target, source, and vector validation.

### U4. Remove Retired CMS / Generated-Artifact Sync Scaffolding

**Goal:** Remove old Manager/Admin vector-sync paths that depended on CMS or
manager-generated `embeddings.json`, while preserving Manager source artifacts
and Mastra launchers.

**Files:**

- Delete or narrow: `apps/manager/src/services/embeddingSync.ts`
- Delete: `apps/manager/src/app/api/jobs/[id]/embedding-sync/override/route.ts`
- Delete or update tests for the removed route/service
- Modify: `apps/manager/src/types/job.ts`
- Modify: `apps/manager/src/lib/embedding-sync-report.ts`
- Modify: `apps/manager/src/features/jobs/embedding-sync-card.tsx`
- Modify: `apps/manager/src/features/jobs/live-job-steps-table.tsx`
- Modify: `apps/manager/src/features/jobs/review-player/review-player-card.tsx`
- Modify: `apps/admin/src/services/manager-artifacts.service.ts`
- Modify: `apps/admin/src/services/manager-artifacts.service.test.ts`
- Narrow: `apps/admin/src/services/embeddings.service.ts`
- Modify: `apps/admin/src/services/embeddings.service.test.ts`

**Test Scenarios:**

- Manager tests no longer reference CMS transcript embedding override or
  manager-generated `embeddings.json` sync.
- Scene source readiness reporting remains available.
- Admin manager artifact tests cover transcript-source and scene-analysis reads,
  not old embeddings-artifact vector imports.
- Admin search query embedding tests still pass, proving live query embedding
  generation remains Admin-owned.

### U5. Docs and Durable Ownership Notes

**Goal:** Update guidance so future work follows the final ownership model.

**Files:**

- Modify: `apps/mastra/AGENTS.md`
- Modify: `apps/mastra/CLAUDE.md`
- Modify: `apps/admin/AGENTS.md`
- Modify: `apps/admin/CLAUDE.md`
- Modify: `apps/manager/AGENTS.md`
- Modify: `apps/manager/CLAUDE.md`
- Create or update: `docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md`
- Modify the three existing Mastra embedding workflow solution notes if they
  need cross-links to the final shared pattern.

**Test Scenarios:**

- Docs state Mastra owns background embedding generation, provider validation,
  retries, diagnostics, and Studio observability.
- Docs state Admin owns vector storage, publication gates, indexes, target
  resolution, public search contracts, search retrieval, and live query
  embeddings.
- Docs state Manager owns source artifacts where applicable and no CMS vector
  sync remains.

## Verification

Run the roadmap checks and touched-scope checks:

```bash
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra lint
pnpm --filter @forge/admin test -- transcript-embedding.service.test.ts scene-embedding.service.test.ts experienceEmbeddingBackfill.test.ts hybrid-search-retrievers.test.ts search-eval/fingerprint.test.ts
pnpm --filter @forge/admin test -- transcript-embedding-ingest.service.test.ts scene-embedding-ingest.service.test.ts experience-embedding-ingest.service.test.ts manager-artifacts.service.test.ts embeddings.service.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
pnpm --filter @forge/manager test
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
git diff --check
```

No Prisma schema change is expected. If implementation discovers one is needed,
run Admin db generation before validation.
