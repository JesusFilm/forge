---
id: "feat-905"
title: "Remove drained behavioral recommendation schema and code"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-10-29"
duration: 7
depends_on:
  - "feat-902"
blocks: []
tags: [recommendations, admin, database, infrastructure]
---

## Problem

Release B deliberately keeps the 19 retired behavioral tables and their indexes
while a bounded operator drains rows. Empty rows can leave relation allocation
in place. Removing that physical schema and the remaining compatibility code
requires a separate reviewed release after the row drain and retained-reference
checks. A zero-row result does not by itself prove filesystem recovery.

## October 30 verified completion

Runtime [#2963](https://github.com/JesusFilm/forge/pull/2963) and schema
[#2965](https://github.com/JesusFilm/forge/pull/2965) merged after independent
exact-head review and green checks. Actual HTTP and worker roles run
`161fd1e36d64453ac549bccc69b362a68cecf304`; migration 0165 and the exact
19-table removal are verified. The three historical references remain null,
retained guards/attachments match, and 31,080 retirement receipt rows remain.
Database allocation fell from 41,312,048,831 to 39,187,658,431 bytes;
PGDATA free space rose from 7,205,188 to 9,280,128 KiB (85% to 81% used).
These are separate observed measures, not an exact causal allocation equation.

The [release report](../../reports/2026-10-30-retired-behavioral-schema-removal.md)
records actual replicas, checksum/catalog, retained serving and ordinary
21-family/two-extra evidence, independent acceptance and its limits. No new
daily cycle is credited; feat-554/756/609 remain open. Fresh fact retry and
HTTP 403 signals stay in feat-792, and unlocalized React rendering errors are
feat-907. This completion establishes physical cleanup and sampled retained
database compatibility, not global delivery reliability.

## Entry Points — Read These First

1. `docs/roadmap/content-discovery/feat-902-semantic-metadata-only-recommendations.md`
   and `docs/plans/2026-10-29-002-behavioral-recommendation-retirement-cleanup-plan.md`:
   release and exact row-drain boundaries.
2. `apps/admin/prisma/schema.prisma` and
   `apps/admin/prisma/migrations/0165_remove_retired_behavioral_schema/migration.sql`:
   retained models, exact empty-schema admission, restrictive drops and guards.
3. `apps/admin/src/services/recommendations/retired-behavioral-schema.db.test.ts`:
   populated retained fixtures, all 19 nonempty refusal cases, workflow/lock
   admission and retained integrity contracts. The completed drain operator
   is removed; `RecommendationBehavioralRetirementBatch` retains its receipts.
4. `apps/admin/src/services/recommendations/retention.service.ts`:
   ordinary expiry and the 21 retained health families after schema removal.

## Grep These

`RecommendationProfile|RecommendationCowatch|recommendation_profile_|recommendation_cowatch_|behavioral-retirement|RecommendationPrecomputedContentProfile`

## What To Build

Feat-902 must independently verify CLI completion followed by a fresh exact
zero read in all 19 direct-delete tables after the last profile deletion, plus
detachment of the three retained historical references. Then inventory every remaining Admin, Web,
native, Prisma, SQL, migration-owned index and operational reference. Remove
only retired models, tables, indexes, triggers and code through
a forward-only migration and normal reviewed PR-to-main release. Preserve
retained request, playback, native viewer/push, eligibility and current
precomputed A/B data. Keep historical migrations and receipts interpretable.
Decide explicitly whether the bounded row-drain ledger and its evidence must be
retained before removing any operator code. Record relation allocation and
PGDATA/WAL before and after; report PostgreSQL reusable pages and filesystem
space separately. If a measured capacity need remains, propose a safe,
reviewed reclamation method on its own evidence rather than assuming `DROP`
recovers an exact amount.

## Constraints

- Do not start this work before the scoped row-drain and preserved-reference
  evidence is independently accepted. A nonzero fresh post-completion read
  requires another bounded source-bound drain and repeated exact zero check
  under feat-902 before this ticket may start; no fixed wait or activity gate
  is added.
- Do not treat the legacy experiment, shadow, composition, study, promotion or
  owner-release families as part of the 19-table delete set without a separate
  explicit disposition.
- Do not drop `recommendation_viewer`, content summaries, current
  `recommendation_precomputed_*` evidence, Watch exposures, playback or push
  identity.
- Do not use broad `CASCADE`, unreviewed online DDL, direct production deploys
  or a manual ordinary-retention run to force physical space recovery.

## Verification

- Exact zero-row and detached-reference receipts precede the migration.
- Native populated-schema migration tests preserve retained rows, FK behavior,
  playback and ordinary expiry; Admin typecheck, lint, format and required CI pass.
- Actual HTTP and worker revisions, migration checksum and catalog confirm the
  reviewed release. Read-only relation, PGDATA and WAL measurements establish
  what physical capacity changed, without equating deleted rows to bytes freed.
