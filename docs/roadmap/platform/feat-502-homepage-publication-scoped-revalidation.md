---
id: "feat-502"
title: "Validate experience publication before promotion and scoped invalidation"
owner: "vlad"
priority: "P0"
status: "not-started"
start_date: "2026-09-17"
duration: 6
depends_on: []
blocks: []
tags:
  - "admin"
  - "web"
  - "performance"
  - "revalidation"
---

## Problem

Homepage publication emits broad settings invalidation and a manifest refresh;
the Web receiver immediately expires unrelated video caches and Watch layouts.
This may amplify editor overload. New candidates must pass isolated rendering and
resource checks before replacing the working publication or invalidating caches.
Reduce scope without making published content or route admission stale. Ship after
the editor repair as a separate publication-safety workstream.

## Entry Points — Read These First

1. `docs/plans/2026-09-14-001-fix-experience-editor-dub-fanout-plan.md` — PR 2 matrix and rollout.
2. `apps/admin/src/services/experience.service.ts` — publish before/after state.
3. `apps/admin/src/services/revalidate-webhook.ts` — webhook contract.
4. `apps/admin/src/services/watch-route-manifest-refresh.service.ts` — indirect broad invalidation.
5. `apps/web/src/app/api/revalidate/route.ts` and `apps/web/src/lib/watch-cache-tags.ts` — receiver and tags.
6. `docs/roadmap/platform/feat-172-watch-cache-invalidation-hardening.md` — existing correctness requirements.

## Grep These

`emitRevalidateWebhook`, `refreshManifestAfterResponse`, `revalidateAllWatchPages`,
`REVALIDATE_TAG_PROFILE`, `WATCH_CACHE_TAG_GROUPS`, `purgeDynamicCollectionEdgeCache`.

## What To Build

Persist immutable candidate attempts; validate privately with runtime/resource
budgets; bind readiness to exact draft/incumbent/build revisions; atomically promote
only after success; deliver post-commit invalidation through an idempotent outbox;
retain a tested rollback path. Failed checks leave the incumbent and caches intact.
Map dependencies and introduce receiver-first scoped events, avoiding redundant
global settings events and unnecessary manifest rebuilds while preserving freshness.

## Constraints

Old webhook payloads retain compatibility. Scoped tags require matching cache
declarations. Do not weaken immediate affected-content freshness or auth, or change
analytics/recommendations. Follow normal PR-to-main deployments. This ticket is
technically independent of `feat-501`; editor-first is release sequencing.

## Verification

Follow the plan's failed-candidate, concurrent-publish, stale-readiness, transaction,
outbox-retry, preview-isolation, and rollback tests. Run the publish/change matrix
with real Next/Redis cache behavior and
staging traffic. Run focused Web/Admin tests, lint, typecheck, and builds. Store
evidence in `docs/validation/feat-502/`; keep pending until implementation passes.
