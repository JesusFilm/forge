---
id: "feat-889"
title: "Commit accepted events to a bounded durable outbox"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 3
depends_on: []
blocks: ["feat-888", "feat-890", "feat-891", "feat-892", "feat-893"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own `apps/admin/src/services/recommendations/event-history/envelope.ts`, `outbox.ts`, colocated tests, additive Prisma model/migration, and no other runtime files. Define a versioned stable event envelope with family, logical identity/revision, occurred/accepted/expiry times, payload digest and bounded sanitized JSON. Preserve original expiry and reject malformed/oversized/conflicting identities. Add a transactional pending store with atomic byte/event caps, lease token/expiry, bounded skip-locked claims, acknowledgement fencing, deferred retry and original-expiry disposition. It must compose with the caller's existing transaction; avoid a dual-write gap. No permanent duplicate ledger, no network I/O inside admission transactions. Tests prove rollback, concurrent duplicate/cap admission, worker crash/release, stale lease acknowledgement, deferred retry and expiry through the store's public operations on isolated PostgreSQL. This ticket introduces the foundation only; it cannot claim all writers are migrated.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
