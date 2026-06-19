---
id: "feat-197"
title: "Watch search query and outcome logging"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-06-22"
duration: 5
depends_on:
  - "feat-136"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "observability"
  - "privacy"
  - "analytics"
---

## Problem

Algolia gives the team visibility into what people search for and where search
fails. The replacement search system needs similar observability so real user
queries, no-result cases, and clicked outcomes can feed future quality work and
eval datasets.

Roadmap window: next week, June 22-26, 2026.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-136-admin-search-trace-storage-retention.md`
   - Admin-owned search trace storage and privacy/retention constraints.
2. `docs/roadmap/content-discovery/feat-137-search-query-quality-abuse-labeling.md`
   - trace labeling and low-signal filtering.
3. `docs/roadmap/content-discovery/feat-193-watch-search-readiness-eval-suite.md`
   - current eval set that future logged data should improve.
4. `apps/admin/src/services/search-trace.service.ts`
   - search trace write path.
5. `apps/admin/src/services/search-trace-privacy.ts`
   - privacy handling for trace data.
6. `apps/admin/src/services/search-trace-retention.service.ts`
   - retention behavior.
7. `apps/admin/src/services/hybrid-search.service.ts`
   - search execution and trace metadata.

## What To Build

1. Confirm the current trace model captures the fields needed for Watch search
   outcome analysis.
2. Log query text, detected query language, active site language, search mode,
   result count, and no-result searches.
3. Log clicked result where available.
4. Keep the implementation privacy-safe and avoid unnecessary user-identifying
   data.
5. Provide a review path for common searches and failures, either via an
   existing report/export surface or a small operator query/report.
6. Make logged data usable as input for future eval query sets.

## Acceptance Criteria

- Log query text, detected query language, active site language, search mode,
  result count, and no-result searches.
- Log clicked result where available.
- Handle data in a privacy-safe way without unnecessary user-identifying
  information.
- Provide a way for the team to review common searches and failures.
- Logged data can feed future search eval query sets.

## Verification

- Trace writes do not block or break live search responses.
- No-result and clicked-result cases are visible in the review/export path.
- Raw query retention remains within the existing privacy limits.
