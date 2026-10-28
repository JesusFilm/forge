---
id: "feat-891"
title: "Run automatic event delivery and outage recovery"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-889", "feat-890"]
blocks: ["feat-888", "feat-895"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own new event-history worker/runtime/health modules, workflow scheduler integration, validated environment settings and isolated worker tests. Deliver bounded outbox batches directly into ClickHouse and remove only sink-confirmed payloads. Recover expired leases with a one-minute sweep; retry with bounded concurrency/backoff, visible quarantine and recovery. Keep accepted events pending during outages without hot loops or finite retry exhaustion loss. Expose pending count/bytes/oldest age, delivery/failure/watermark and complete-through status with no payload logging. Protect serving headroom. Settings default disabled until the full path is qualified. Enforce 24-hour sizing through measured limits rather than assumed capacity. Preserve existing workflow runner roles and build/recovery checks.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
