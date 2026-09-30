---
id: "feat-575"
title: "Retire unprotected legacy recommendation trace detail early"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-09-30"
duration: 3
depends_on: []
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
---

## Problem

Implement U4 of the storage-efficiency plan. User authorized early retirement, superseding the prior expiry-only route for unprotected stage details. Preserve all protected observations and ordinary privacy expiry. This ticket does not close retention verification or physical reclamation.

## Entry Points — Read These First

1. `docs/plans/2026-09-30-001-recommendation-storage-efficiency-plan.md` — authorized scope, units and release gates.
2. `apps/admin/prisma/schema.prisma` — request, item, fact, exposure, profile and trace models.
3. `apps/admin/src/services/recommendations/` — writers, readers and retention.
4. `docs/operations/legacy-recommendation-trace-conversion.md` — original private hold mechanism and parity proof.
5. `docs/operations/legacy-recommendation-stage-reclamation.md` — inactive exact-empty reclamation asset.

## Grep These

- `RecommendationServedItem|WatchSurfaceExposure|RecommendationProfileInterest`
- `trace_format_version|trace_payload|usesCompactCandidateTrace`
- `recommendation_render_event_key|toast_tuple_target`

## What To Build

Implement U4 of the storage-efficiency plan. User authorized early retirement, superseding the prior expiry-only route for unprotected stage details. Preserve all protected observations and ordinary privacy expiry. This ticket does not close retention verification or physical reclamation.

## Constraints

Only new task-owned agents may be used. Preserve ranking, learning, attribution,
29-day event/trace evidence except explicitly authorized unprotected legacy detail,
and configured profile expiry/erasure. No direct deployment, unreviewed retained
rewrite, CASCADE, or VACUUM FULL. No production writes by child agents.

## Verification

Native PostgreSQL exact-value/reader/expiry tests and physical table/index/TOAST/WAL
benchmarks; relevant unit/type/lint/migration/format checks; independent review;
normal PR-to-main deployment and actual fleet health and filesystem measurements.
Keep status in progress until the full intended production result is verified.

## September 30 Rollout Evidence

See `docs/reports/2026-09-30-recommendation-storage-rollout.md` for reviewed PRs,
actual deployment state, the finite retirement pilot and open activation gates.
This ticket remains in progress. Local byte reductions and row deletion are not
credited as production filesystem savings.

This ticket was renumbered from feat-572 to feat-575 after concurrent roadmap
work reused feat-572. Historical pilot receipts retain the original number. The
pilot preserved all 64 original quality holdouts and 8,621 observations, retired
1,062 unprotected observations and losslessly converted one protected observation.
Later finite cohorts require fresh review; the pilot does not authorize a loop.

## Finite campaign preparation

`docs/operations/finite-legacy-recommendation-retirement-campaign.md` defines
a bounded, explicit roster with a private digest, current hold file, fresh
fleet/capacity receipt per ten-run transaction, aggregate ledger replay, and
fail-stop behavior. A v2 manifest converts incomplete, zero-composed or other
uncertain unprotected runs losslessly when exact typed row parity succeeds;
it never retires that detail. Unrepresentable rows stay intact and block
whole-table reclaim. Expired roots are outside the campaign and follow
ordinary bounded retention. This is local preparation only: no larger
production cohort or physical reclamation has been executed, so status stays
in progress. Feat-555's separately reviewed exact-empty migration requires
fresh retention health, expired-root cleanup, fleet/rollback and headroom
proof. Feat-554's first two loaded normal retention cycles remain open
monitoring/closure work after any earlier physical reclaim.

## Batch-wave throughput preparation

The fixed-master two-phase operator in
`docs/operations/finite-legacy-recommendation-retirement-campaign.md`
needs a separately reviewed batch-aware Admin CLI before broad admission.
`apps/admin/src/scripts/retire-legacy-recommendation-detail-wave.ts` reuses
the published v2 service functions with one Prisma process for all freezes
and one for all executions in a wave; each ten-run transaction and its source,
protection, expiry, lock, row and byte guards remain unchanged. The operator
must prove the whole wave's typed baseline, privately archive every manifest
and fsync an exact-set acknowledgement before execution. Any uncertain
transport result stops until read-only ledger and live parity reconcile it.

Native PostgreSQL proof covers protected conversion, unprotected retirement,
incomplete lossless preservation, root/item/expiry parity and exact ledgers.
A same-fixture, two-batch local process measurement compares old and new CLI
freeze cost; it is not a production throughput estimate. This ticket stays
in progress until the full finite roster and exact empty-table route are
verified. Expired members remain under ordinary retention without refill.

## Bounded persistent-session preparation

`docs/plans/2026-09-30-003-legacy-detail-persistent-session.md` defines a
separately reviewed 1,000-run speed pilot. The new Admin session CLI keeps one
bidirectional process for ten fixed 100-run waves while the unchanged v2
service performs only ten-run transactions. Each freeze requires a private
archived manifest ACK; each execute requires a fresh operator permit and an
exclusive durable attempt marker. The server checks current target, source,
WAL, locks, typed baseline, durable ledger and original quality parity. A real
30-minute manual hold-review lease and canonical registry digest are required;
the client must stop on any changed file or uncertain response. This local
preparation is not broad cohort approval and does not change ordinary expiry.
The disposable-database receipt is in
`docs/validation/recommendation-storage-20260930/legacy-persistent-session.md`.
The first deployed start-only handshake exposed intermittent nonprotocol JSON
on stdout before `ready`; no cleanup command was sent. A CLI-local channel
isolation fix and actual-subprocess regression are under review. The ticket
remains in progress until a normal deployed handshake, a fresh finite
admission, and the intended retirement and physical verification complete.

## Expiry-aware finite-session continuation preparation

The later-session contract in
`docs/plans/2026-09-30-003-legacy-detail-persistent-session.md` keeps the
original pinned 64-run, 8,621-observation inventory while allowing ordinary
retention to purge expired roots. The Admin session accepts only a fresh fixed
cohort of at most 1,000 runs in bounded partial waves and batches. It checks
present original rows for exact parity and recognizes a missing original only
after both recorded expiries and exact parent absence in one read-only
snapshot. The root-supplied finite stop time cannot exceed the manual
30-minute lease. This is local code preparation; later cohort admission,
client compatibility, deployment, and production cleanup require separate
review. The ticket remains in progress.
