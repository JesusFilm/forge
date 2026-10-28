---
id: "feat-896"
title: "Verify recommendation history release and storage savings"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-895"]
blocks: ["feat-897"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own priced dedicated service configuration, deployment coordination and release evidence. Measure arrival/payload distributions, nonblocking caller latency, in-flight memory bounds, observed success/failure/timeout/drop rates by family/arm and delivered-feedback freshness. The earlier 24-hour buffering requirement is withdrawn. Obtain actual regional configuration/cost before purchase. Independently review the exact final head, pass required checks, merge through normal PR-to-main and verify actual Admin HTTP/worker revisions. Observe A/B continuity, privacy/retention and storage effects, distinguishing allocation/reuse, filesystem headroom and total cost. Preserve the daily retention monitor. Close feat-897 only after all implementation and actual release evidence pass; missing access/configuration remain explicit dependencies.

## Context

- Parent: [feat-897](feat-897-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
