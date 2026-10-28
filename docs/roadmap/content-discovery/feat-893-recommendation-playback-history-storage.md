---
id: "feat-893"
title: "Move recommendation playback history without losing serving authority"
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

Own recommendation delivery/evidence/episode/playback/outcome/content-action event writers and history reader integration for recent context, user history, profile and co-watch. Split compact request/item/handoff/replay/finality/current-eligibility authority from retained history; retain only a bounded temporary open-episode fact buffer. Preserve sequence, revision, correction, immediate exclusions, privacy generations and exact expiry. Finalization must have complete facts through a committed sequence watermark; partial ClickHouse data cannot finalize an episode. Typed bounded readers preserve existing source-neutral and attributed outcomes, latest revision and source-as-of semantics. Replace raw-source FKs only with explicit equivalent lineage/revalidation. Include usefulness-extractor compatibility and operator dependencies. This ticket remains incomplete while any accepted raw family persists permanently in PostgreSQL.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
