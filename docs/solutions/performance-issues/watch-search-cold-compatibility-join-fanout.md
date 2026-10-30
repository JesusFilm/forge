---
module: "Admin Watch search"
date: "2026-10-23"
problem_type: performance_issue
component: database
severity: high
symptoms:
  - "Cold public Watch searches return HTTP 504 before result retrieval"
  - "Warm repeats work while serving-profile deadline warnings recur"
root_cause: logic_error
resolution_type: code_fix
tags:
  - "watch-search"
  - "postgresql"
  - "compatibility"
  - "query-plan"
  - "deadline"
---

# Check existence per version, not per transcript chunk

## Cause

When the stored transcript projection is absent, candidate serving resolves
live compatibility after its 30-second cache expires. The original query
joined all compatible transcripts to all compatible embedded chunks and then
selected distinct chunking versions. Production had 164,700 transcripts and
280,107 chunks, but only one qualifying version. EXPLAIN ANALYZE showed
164,700 chunk-index probes and a disk-spilling sort to return one row.

The public 1,900 ms preparation cutoff includes this work. Correlated logs
proved serving-profile failures, and a trace showed the database query
continuing after HTTP 504. Successful response latency previously omitted
preparation, concealing cold-path cost.

## Fix And Evidence

`typesense-watch-search-transcript-compatibility.ts` now selects distinct
compatible parent versions, then uses EXISTS to check for a qualifying chunk
per version. A NOT MATERIALIZED CTE preserves predicate reuse while allowing
early exit. All exact provenance checks remain; null versions use IS NOT
DISTINCT FROM so invalid null compatibility is still rejected, not dropped.
Do not replace this with LIMIT 1 on the entire query: that hides mixed versions.

Read-only production comparisons returned identical results:

| Order                 | Original | Version-first |
| --------------------- | -------- | ------------- |
| Original then revised | 1,102 ms | 36 ms         |
| Revised then original | 1,309 ms | 40 ms         |

The revised production plan probes the chunk index once. The real PostgreSQL
regression seeds 5,000 transcripts and 60,000 chunks, calls the actual resolver,
then inspects its executed SQL plan. Before the fix it visits 60,000 chunk
rows; afterward it passes the bounded-work assertion. This avoids flaky
wall-clock gates. Additional cases preserve mixed/empty/null-version refusal,
parent/chunk provenance, and exact nullable transform matching.

These are query measurements, not deployed end-to-end SLO proof. A separate
response accounting fix includes preparation in `latencyMs`. Neither change
increases deadlines, widens pools, weakens qualification, or fabricates a
projection row. Release through normal PR-to-main deployment, then verify
cold and warm public queries and stage-specific failure counts.

## Diagnostic Boundaries

APM's database spans include driver and pool waiting; they are not execution
plan time. A projection lookup taking 638 ms in the failed trace executed in
0.012 ms in a later direct database measurement. Those different-time samples
do not isolate the original wait. Admin and Postgres are both configured in
us-west2. Pool pressure and other timeout stages still need monitoring.

See the [investigation report](../../reports/2026-10-23-watch-search-timeout-investigation.md)
for request correlations and the [existing timing guidance](admin-search-stage-db-timing-instrumentation-20260624.md)
for separating database work from orchestration wait. The deadline monitor
template is in `infra/datadog-monitors/watch-search/`; it is not activated by
merging its JSON file.
