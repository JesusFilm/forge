---
id: "feat-890"
title: "Persist canonical event history through durable transport"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-889"]
blocks: ["feat-888", "feat-891", "feat-892", "feat-893"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own new `event-history/clickhouse.ts`, schema SQL and HTTP boundary tests. Implement bounded authenticated ClickHouse HTTP insert/read with strict response validation, deadlines, sanitized typed errors and injectable transport. Inserts must confirm persistence before outbox acknowledgement; canonical reads deduplicate logical identity/revision and enforce original expiry before asynchronous physical TTL. Preserve correction ordering and immutable digest conflict detection. Qualify incomplete responses, duplicate delivery, partial batches and asynchronous flush behavior from current official docs. Define safe privacy/expiry filtering and remote erasure before enabling personal payload delivery. Do not provision accounts or services, change workflows, or use arbitrary caller SQL/URLs. Actual provider credentials/configuration are parent-owned.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
