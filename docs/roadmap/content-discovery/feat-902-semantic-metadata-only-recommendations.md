---
id: "feat-902"
title: "Retire behavioral recommendation learning and viewer profiles"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-29"
duration: 7
depends_on: []
blocks:
  - "feat-905"
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
remains. Release B retains the tables and their schema during the bounded row
drain; [feat-905](feat-905-retired-behavioral-schema-removal.md) owns later
physical table/index/code removal. Record exact release revisions, row counts,
relation allocation and physical filesystem space separately. Reusable pages
were not isolated or numerically measured in the accepted U4 evidence;
[feat-905](feat-905-retired-behavioral-schema-removal.md) owns the physical
measurement/removal follow-up.

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
retirement cleanup preserves kept data. Production acceptance needs CLI
completion followed by a fresh exact all-19-table zero read after the last
profile deletion, plus detached-reference and retained-lane checks. If the read
is nonzero, run another bounded source-bound drain and repeat it. This is a
bounded observed database state under the deployed source, not an eternal-zero
promise or an extra wait/activity/clean-day gate. U4 records allocation and
filesystem capacity, but reusable pages remain unmeasured and physical
reclamation is not claimed. A historical queued business ledger does not
by itself mean a learner is running:
adjudicate its joined actual workflow runtime without rewriting history.

## October 29 independently accepted production closeout

The D CLI returned `complete` at 07:18:45 UTC. The same operation's CLI and
durable ledger reconciled **3,088,917 direct deletes**, **18,055 explicit
detached-reference updates** and **31,080 batches**. A post-completion read
found zero rows in each of the 19 direct-delete tables and zero remaining
shadow, decision and experiment-assignment profile references. The
[retirement report](../../reports/2026-10-29-behavioral-recommendation-retirement.md)
holds the exact receipts, source-bound role/retained-data checks, natural
serving sample, dated capacity and historic failures. This ticket is complete
for the independently accepted bounded cutover and U4 row drain. See the
accompanying documentation PR and root [#2541](https://github.com/JesusFilm/forge/pull/2541)
for exact-head review, CI, merge and normal-deployment receipts. DELETE does not
establish physical filesystem recovery or numerically measured reusable pages.
Ordinary retention feat-554/feat-756 remains a separate obligation; manual retirement
earns no daily-cycle credit. Feat-905 owns later schema removal.
