---
id: "feat-893"
title: "Move recommendation playback history without losing serving authority"
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

Own recommendation delivery/evidence/episode/playback/outcome/content-action writers and history integration for recent context, user history, profile and co-watch. Separate compact request/item/handoff/replay/finality/eligibility authority from retained payloads; keep bounded temporary operational facts for open episodes. After operational commit, dispatch history without awaiting the send, queueing or retrying. Preserve sequence, revision, immediate exclusions, privacy and original expiry. Complete operational facts through the committed episode sequence still drive finalization; missing ClickHouse exports cannot silently finalize partial episodes. Bounded history readers preserve source-neutral/attributed outcomes and expose incomplete coverage. Replace raw-source FKs with explicit lineage/revalidation. Include usefulness/operator compatibility. This ticket remains incomplete while an accepted raw family remains permanently duplicated in PostgreSQL.

## Context

- Parent: [feat-897](feat-897-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
