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

Actual service qualification and release verification are pending. Organization
access is awaiting discussion of the architectural rationale. No service
configuration, regional price, purchase, provisioning, production gate change,
data cutover or release verification is established.

Preliminary local dispatch testing used ten batches of 90 envelopes, each with
an 8 KiB synthetic payload. Eight requests were admitted and two dropped at the
configured concurrency limit: 720 events were confirmed and 180 capacity-dropped
without retry. Replacing repeated full-buffer byte counting with cumulative
encoded-row byte counts reduced synchronous dispatch preparation from 72–97 ms
to 27–36 ms in that fixture. The 8 MiB tracked envelope limit is not a bound on
whole-process memory. This fixture does not establish production caller latency,
headroom or an observed production failure rate.

Local Watch allocation and report-capacity receipts remain qualified by
feat-892/894: the compact representation used 18.96% less allocation for one
38,000-event fixture, while a one-million-row ClickHouse report exceeded the
three-second query bound. The real reporting horizon, PostgreSQL retirement,
filesystem reclamation and total operating cost remain unproved.
