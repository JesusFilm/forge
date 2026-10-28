---
id: "feat-895"
title: "Reconcile and retire PostgreSQL history with privacy-safe replay"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-891", "feat-892", "feat-893", "feat-894"]
blocks: ["feat-888", "feat-896"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own bounded backfill/reconciliation/cutover tooling, reliable privacy erasure propagation, read fences, retention and rollback. Backfill still-unexpired history with original IDs/times/expiry in checkpointed bounded pages. Privacy reset/delete/destination erasure wins over in-flight inserts and corrections; qualify logical suppression and physical expiry separately. The owner's tolerance for failed analytics does not authorize failed privacy controls. Reconcile delivered/backfilled identities, digests and as-of output; distinguish explicit live export loss from backfill defects. Retire old payload/index allocation only after dependencies and rollback are safe. Preserve truthful failure/retention evidence. No direct local deployment, unbounded purge or production fault injection.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
