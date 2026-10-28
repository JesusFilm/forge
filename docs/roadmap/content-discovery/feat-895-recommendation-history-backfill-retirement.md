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

Own bounded operator backfill/reconciliation/cutover tooling, durable privacy erasure/correction propagation, read fences, retention integration and rollback runbook. Backfill all still-unexpired in-scope history with original IDs/times/expiry; page/checkpoint without large transactions and cap production work. Privacy reset/delete/destination erasure wins over delayed inserts and corrections. Qualify selective queued-payload erasure and physical expiry; no resurrection and no silent lost events. Reconcile canonical counts/digests/as-of reports before reader cutover, and remove old history payload/index allocation only after dependencies and rollback horizon are safe. Keep honest failure ledgers and retention-health types. No direct local deploy, unbounded purge or production fault injection.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
