---
status: ready
priority: p1
issue_id: "007"
tags: [manager, admin, cms, writeback, migration]
dependencies: ["006"]
---

# Manager Admin Writeback Cutover

## Problem Statement

The Manager backend migration now routes auth, read models, coverage
snapshots, and job state through Admin-backed contracts, and it hard-disables
`cmsClient` REST calls when `MANAGER_BACKEND_MODE=admin`. The remaining
writeback and backfill helper flows still need Admin-native equivalents before
Strapi can be deleted entirely.

## Findings

- `apps/manager/src/services/embeddingSync.ts` still expresses the transcript
  embedding writeback as a CMS `/embedding/index` operation.
- `apps/manager/src/services/sceneEmbeddingSync.ts` still expresses scene
  embedding writeback as a CMS `/scene-embedding/index` operation.
- `apps/manager/src/services/backfillQueue.ts` still reads legacy CMS
  backfill queue and processed-video-id endpoints.
- `apps/manager/src/app/api/enrich/route.ts` now refuses Admin-mode enrichment
  launch before the legacy CMS materialization lookup can run; Admin needs an
  equivalent media/materialization contract before this control is re-enabled.
- `apps/manager/src/features/jobs/review-player/load-job-review-context.ts`
  avoids Strapi in Admin mode by returning no legacy review source; Admin needs
  a review-source contract before before/after metadata can be fully restored.
- `apps/manager/src/services/cmsClient.ts` now throws before any network call
  in admin backend mode, so these paths no longer silently reach Strapi in the
  new production mode.

## Recommended Action

Relaunch `workflows-work` against this todo after the auth/read/job cutover PR
lands:

1. Add Admin-owned GraphQL mutations or workflow triggers for transcript
   embedding indexing, scene embedding indexing, enrichment materialization,
   review sources, and backfill queue reads.
2. Replace `cmsPost`/`cmsGet` callsites in Manager services with those Admin
   contracts.
3. Preserve existing Manager report shapes (`EmbeddingSyncReport`,
   `SceneEmbeddingSyncReport`, backfill queue rows).
4. Add Red/Green tests proving admin mode never calls CMS and that Admin errors
   map to the existing retryable/non-retryable Manager envelopes.
5. Run user-like smoke for the affected override/sync controls.

## Acceptance Criteria

- [ ] `rg -n "cmsPost\\(|cmsGet\\(" apps/manager/src` returns only tests or
      deleted compatibility code.
- [ ] Embedding sync and scene embedding sync operate through Admin in
      `MANAGER_BACKEND_MODE=admin`.
- [ ] Backfill queue reads operate through Admin or are removed from Manager.
- [ ] Enrichment launch materialization and review-source reads operate through
      Admin or remain explicitly disabled with user-visible messaging.
- [ ] Existing report shapes and UI controls remain stable.
- [ ] Admin and Manager tests, typecheck, lint, and browser smoke pass.
