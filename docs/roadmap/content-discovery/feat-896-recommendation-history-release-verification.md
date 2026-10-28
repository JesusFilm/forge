---
id: "feat-896"
title: "Verify recommendation history release and storage savings"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-895"]
blocks: ["feat-888"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own priced dedicated service/queue configuration, deployment coordination, capacity and release evidence. Measure current arrival rates/payload distributions, outbox allocation/WAL/maintenance reserves, queue backlog and recovery throughput; verify 24-hour outage sizing and five-minute normal-operation learning freshness. Obtain the actual regional configuration/cost before purchase. Review exact final integration head, pass all required checks independently, merge through normal PR-to-main and verify actual Admin HTTP/worker revisions. Observe normal event delivery, A/B continuity, retention/privacy and physical/storage effects; separate database allocation/reuse, filesystem free space and total cost. Preserve existing daily retention monitor. Close feat-888 only once all scope and actual deployment evidence pass; missing access or priced infrastructure remains an explicit unresolved dependency.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
