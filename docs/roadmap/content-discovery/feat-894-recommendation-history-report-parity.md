---
id: "feat-894"
title: "Preserve live A/B and operator reporting across history stores"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-892", "feat-893"]
blocks: ["feat-888", "feat-895"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own precomputed CTR/engagement/history evidence adapters, visit admission/archive integration and operator trace/exposure readers. Preserve the active editorial/current experiment, sticky assignments, eligibility/qualification/delivery result, request links, selected/claimed/engaged attribution, late cutoff, immutable revisions and archived cluster/totals fences. Fixed-as-of per-visit parity must hold across stores, including duplicate and corrected events. Report explicit lag; never finalize an incomplete report. Preserve 14-day anonymous coverage disclosure, detail-read authorization/auditing and error visibility. Update capacity table inventories to distinguish serving state, outbox and ClickHouse history.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implementation pending.
