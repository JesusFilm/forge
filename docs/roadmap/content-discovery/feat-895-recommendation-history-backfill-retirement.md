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

The Watch compact retention portion now uses bounded scheduled phases for
expired receipts, issued items and empty issued windows. It preserves the
five-second attempt deadline, 750 ms phase admission, exact committed ledger
counts, continuation and overdue health for compact backlog. An isolated local
PostgreSQL fixture proves pagination, live/expired boundaries, failed child
rollback and budget yield. Backfill qualification, privacy erasure propagation,
reader cutover, rollback and physical retirement remain unimplemented; no
production lifecycle claim follows from this local proof.
