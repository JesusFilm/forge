---
id: "feat-892"
title: "Move anonymous Watch history behind compact admission state"
owner: "nisal"
priority: "P1"
status: "not-started"
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

Implementation pending.
