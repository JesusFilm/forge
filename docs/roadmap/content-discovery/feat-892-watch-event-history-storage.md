---
id: "feat-892"
title: "Move anonymous Watch history behind compact admission state"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-889", "feat-890", "feat-891"]
blocks: ["feat-897", "feat-894", "feat-895"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own `watch-surface-exposure.service.ts`, anonymous history adapter, compact Watch admission schema/migration and tests. Separate historical payloads from served bindings and replay/conflict authority. Preserve exact V2 bindings, original 14-day or legacy expiry, batch limits and accepted/replay/repeat/conflict responses. Commit operational admission first, then dispatch history without awaiting network delivery; no forwarding store. Export failures are measured and may lose history under the owner's policy. Preserve canonical first-event ranking and duplicate-count semantics for delivered events, with explicit incomplete coverage. Keep legacy binding authority until recorded expiry where original manifests cannot be reconstructed. Prepare bounded unexpired backfill and prove allocation reduction without weakening admission. Do not retire original rows before feat-895 qualification.

## Context

- Parent: [feat-897](feat-897-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Compact admission, typed Watch envelopes, bounded backfill paging and an
isolated PostgreSQL admission fixture are implemented behind default-off gates.
Qualification uses `WATCH_COMPACT_ADMISSION_MODE=shadow` to retain the legacy
report source while exercising compact receipts; `compact` stops new full-row
writes after the reader and rollback path are qualified. The legacy V2 binding
remains authoritative through its recorded expiry. The production gate remains
off; mixed batches that contain a pre-cutover V2 binding use one locked legacy
transaction until those bindings expire. Physical retirement, reader cutover,
exact historical replay timing and measured allocation belong to subsequent
tickets.
Optional history encoding runs after admission commits and only when the
dispatcher is enabled; preparation failures are counted separately from
viewer-action success.
Bounded scheduled retention now drains compact receipts (100), issued items
(100), and only empty expired windows (25) through separate admitted phases.
The run ledger counts committed rows, reports remaining expired compact state,
and yields without advancing the success watermark. Isolated PostgreSQL tests
cover multiple pages, live rows, a failed child transaction, and a pre-work
budget yield. The shared recommendation test schema includes the compact Watch
tables because ordinary recommendation retention now sweeps them; the existing
profile candidate/projection PostgreSQL CI entry point passes all 20 tests.

A local synthetic comparison used 2,000 six-item windows and 38,000 Watch
events: the original exposure table occupied 24,461,312 bytes and the compact
receipt/item/window tables occupied 19,824,640 bytes after `VACUUM ANALYZE`,
18.96% less. This fixture has no production skew, duplicates, concurrent traffic
or prior bloat. It proves neither production savings nor filesystem reclamation;
remaining admission/replay state still has a substantial storage cost.
Production allocation and ordinary-cycle evidence remain pending.

Watch history now keys each immutable revision by the server-owned rank ID:
legacy receipts use the exposure row ID, compact receipts retain their rank ID,
and backfill reuses the same ID. The caller event ID remains in the payload and
public receipt. A later accepted incarnation can reuse that caller ID after the
earlier receipt expires without inheriting its higher revision or erasure
marker. The codec unit suite (4 tests), isolated PostgreSQL admission suite
(7 tests), and isolated ClickHouse canonical/report suite (11 tests) cover
corrections, mixed legacy/compact export, backfill, expiry, and an erased old
incarnation. This identity change needs no remote data migration because the
history transport is still disabled. Privacy marker retirement still requires
the source-closure and maximum-expiry certificate in feat-895; receipt expiry
alone is insufficient.
