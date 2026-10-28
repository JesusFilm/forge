---
id: "feat-892"
title: "Move anonymous Watch history behind compact admission state"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-889", "feat-890"]
blocks: ["feat-888", "feat-894", "feat-895"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own `watch-surface-exposure.service.ts`, anonymous history read adapter, compact Watch admission schema/migration and relevant tests. Separate immutable history payloads from served-manifest bindings and event replay/conflict identity. Preserve V2 exact issued binding, original 14-day or legacy expiry, batch limits and accepted/replay/repeat/conflict responses. Commit new accepted events and outbox atomically. Reports need canonical first-event ranking and duplicate-count semantics. Backfill preparation must retain all still-unexpired records. Prove PostgreSQL payload/index reduction without weakening binding/replay checks. Coordinate schema changes after feat-889 merges; do not retire original rows until feat-895 parity/cutover gate.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
