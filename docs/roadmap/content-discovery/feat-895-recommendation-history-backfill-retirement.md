---
id: "feat-895"
title: "Reconcile and retire PostgreSQL history with privacy-safe replay"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-891", "feat-892", "feat-893", "feat-894"]
blocks: ["feat-897", "feat-896"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own bounded backfill/reconciliation/cutover tooling, reliable privacy erasure propagation, read fences, retention and rollback. Backfill still-unexpired history with original IDs/times/expiry in checkpointed bounded pages. Privacy reset/delete/destination erasure wins over in-flight inserts and corrections; qualify logical suppression and physical expiry separately. The owner's tolerance for failed analytics does not authorize failed privacy controls. Reconcile delivered/backfilled identities, digests and as-of output; distinguish explicit live export loss from backfill defects. Retire old payload/index allocation only after dependencies and rollback are safe. Preserve truthful failure/retention evidence. No direct local deployment, unbounded purge or production fault injection.

## Context

- Parent: [feat-897](feat-897-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Canonical history reads use actual response-time expiry even when a caller
supplies an older clock. Watch aggregates floor their expiry cutoff at actual
query-start time while preserving the requested historical acceptance cutoff.
HTTP boundary tests cover stale caller clocks, expiry during an in-flight read,
and stricter caller cutoffs. This is a prerequisite for future certified marker
retirement; it does not itself authorize removal of erasure markers.

The Watch compact retention portion now uses bounded scheduled phases for
expired receipts, issued items and empty issued windows. It preserves the
five-second attempt deadline, 750 ms phase admission, exact committed ledger
counts, continuation and overdue health for compact backlog. An isolated local
PostgreSQL fixture proves pagination, live/expired boundaries, failed child
rollback and budget yield. Backfill qualification, privacy erasure propagation,
reader cutover, rollback and production physical retirement remain unimplemented; no
production lifecycle claim follows from this local proof.

The disabled ClickHouse client now offers `sweepClosedExpired` as a bounded
primitive for at most 100 explicitly closed `(family, logicalId)` values. It
requires each ID's source-side maximum original expiry and checks it against
the **maximum original expiry across every stored revision and physical
variant**, returning still-live IDs as pending. An ID with no stored row is
also fenced once its source expiry passes, before an unknown in-flight INSERT
can arrive. It installs a terminal read
fence before running `ALTER TABLE ... DELETE` with `mutations_sync=2`, then
verifies no active history rows remain. This avoids per-row TTL resurrection:
an older long-lived revision remains available to historical `asOf` reads
until its own expiry, even if the latest revision expired earlier. The marker
also suppresses a server INSERT that completes after cleanup; a repeated
sweep removes that late row once its original expiry passes. A late correction
with a future expiry stays physically pending but remains unreadable behind
the marker. A timeout or uncertain mutation response is **not** a confirmed
physical-cleanup receipt; the marker stays and the job must reconcile.
Preflight and verification reads cap physical scans at one million rows,
256 MiB, two threads, 101 result rows and eight server seconds inside the
client's existing operation deadline. The mutation itself may still run after
HTTP abort and can rewrite large unpartitioned parts even for one ID; no
universal mutation deadline or production cost bound is claimed.

On pinned ClickHouse 25.8.15.35, ten generic real-database tests exercise
canonical revisions/conflicts, historical cutoff, expiry, privacy erasure,
whole-ID cleanup, late expired INSERT replay, a late future-expiry correction,
and an initially absent row. After synchronous mutation the owned fixture had zero active
`system.parts` rows for its history table. A separate owned
`event_expiry_physical_test` database with `old_parts_lifetime=1` showed
`system.mutations.is_done=1`, `parts_to_do=0`, and no remaining
`system.parts` entry after the old part cleanup. These observations establish
the local active-part rewrite and eventual local part removal, not immediate
removal of inactive parts under the production setting, provider backup purge,
or filesystem-space savings. ClickHouse documents that lightweight `DELETE`
only masks rows until a later merge, whereas `ALTER TABLE ... DELETE` rewrites
affected parts; TTL deletion also waits for merges. See the
[ALTER DELETE](https://clickhouse.com/docs/reference/statements/alter/delete),
[lightweight DELETE](https://clickhouse.com/docs/reference/statements/delete),
and [TTL](https://clickhouse.com/docs/concepts/features/operations/delete/ttl)
references.

This primitive is **not wired to a scheduled job or enabled**. Its caller must
certify a closed producer/backfill lineage and a maximum original expiry over
every possible revision, including unknown in-flight INSERTs. The certificate
must identify a stable source incarnation; an expired receipt for a reusable
caller ID does not establish permanent closure. Source certificate generation
and durable job progress remain unimplemented.

The current primitive retains its terminal marker. A future retirement protocol
can release that marker once the certified maximum possible expiry is past:
actual-wall-time filtering then keeps even a late INSERT logically expired.
The generic and Watch readers now apply that time floor. Before the certified
expiry, the marker must remain. This logical condition does not require claiming
that an aborted HTTP INSERT stopped, and does not prove physical completion.
Late expired rows still need recurring physical reconciliation. A zero-row check
proves the observed state at that check; claiming no later physical arrival
requires separate server-query completion evidence. Provider backup retention
and inactive-part removal are also distinct.

There is no arbitrary fixed marker TTL, scheduled remote sweep or automatic
certificate in this slice. The finite control-metadata lifecycle and production
retention wiring remain open feat-895/896 gates. No producer
or PostgreSQL schema was changed, no production DDL was applied, and the
feature remains default-off. The current exported safe fields omit
profile/session/browser digests and content-action destination artifact IDs;
profile disable/reset affects private influence and linkage, not contextual
analytics, so this slice adds no new consent gate or privacy journal.
