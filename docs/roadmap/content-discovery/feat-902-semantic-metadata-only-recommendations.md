---
id: "feat-902"
title: "Retire behavioral recommendation learning and viewer profiles"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-29"
duration: 7
depends_on: []
blocks: []
tags: [recommendations, admin, web, database, infrastructure]
---

## Problem

The owner has retired co-watch, behavioral background learners and viewer interest
profiles. Recommendations should use content semantics and metadata only. This
supersedes historical instructions to preserve profile/co-watch serving and the
unmerged ClickHouse export design where it exists only to feed those learners.

## Entry Points — Read These First

1. `docs/plans/2026-10-29-001-refactor-semantic-metadata-recommendations-plan.md`.
2. `apps/admin/src/services/recommendations/delivery.factory.ts` and
   `user-delivery.service.ts`: seeded and source-free recommendation dependencies.
3. `apps/admin/src/services/recommendations/profile.service.ts` and
   `viewer-identity.service.ts`: Web and native profile creation.
4. `apps/admin/src/instrumentation.ts`, `src/workflows/recommendationProfileProjection.ts`,
   `src/workflows/recommendationProfileReconciliation.ts` and
   `src/workflows/recommendationCowatchRefresh.ts`: worker dispatch and replay.
5. `apps/admin/prisma/schema.prisma`: profile, projection, co-watch and FK ownership.

## Grep These

`authorizeProfile|retrieveProfile|dispatchRecommendationProfile|CowatchRefresh|profileTokenDigest|recommendation_profile|recommendation_cowatch|RecommendationPersonalizationControl`

## What To Build

Remove behavioral candidate sources, profile creation and learner dispatch across
Web/native callers. Keep semantic retrieval, video metadata summaries, precomputed
recommendations and their A/B measurements. Remove personalization UI and clear
retired credentials. Shut down persisted learners safely before deleting their
rows. U4 requires zero rows in the 19 retired behavioral direct-delete tables,
explicit detachment of three retained historical references, and verification
that request, playback, native viewer, eligibility and precomputed A/B evidence
remains. Release B retains the emptied tables and their schema. Physical
table/index removal needs a separately scoped normal-release follow-up after
the row drain. Record exact release revisions, row counts, reusable PostgreSQL
pages, relation allocation and physical filesystem space separately.

## Constraints

- Video content summaries (`RecommendationPrecomputedContentProfile`) are metadata,
  not viewer profiles. Keep them and content embedding/build workflows.
- Keep playback, Grow course progress, push installation identity and A/B evidence.
- Do not drop tables in a predeploy migration while the old revision can use them.
- Do not continue the ClickHouse migration solely to supply retired learners.
- Normal reviewed green PR-to-main deployments only; preserve the dirty checkout.

## Verification

Old profile credentials cannot change serving or create a new profile. Native
bootstrap returns personalization false. Profile and co-watch jobs cannot restart
on boot, replay, feedback, manual routes or CLI. Semantic/precomputed tests retain
language eligibility and experiment accounting. Real PostgreSQL tests prove the
retirement cleanup preserves kept data. Production receipts prove retired rows
are absent and distinguish reusable space from physical file reclamation. A
historical queued business ledger does not by itself mean a learner is running:
adjudicate its joined actual workflow runtime without rewriting history.
