---
title: "Stable Admin search dub hydration ordering"
date: "2026-06-25"
category: "database-issues"
module: "Admin search"
problem_type: "database_issue"
component: "database"
severity: "medium"
symptoms:
  - "Repeated identical Admin search checks sometimes returned different hydrated fallback playbackId values for jesus"
  - "Result IDs, order, and scores stayed stable while fallback dub hydration varied"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "service_object"
  - "testing_framework"
tags:
  - "admin-search"
  - "hybrid-search"
  - "hydration"
  - "video-dub"
  - "postgres-ordering"
  - "result-parity"
  - "deterministic-sql"
---

# Stable Admin Search Dub Hydration Ordering

## Problem

Repeated identical Admin search requests produced stable result IDs, order, and
scores, but some hydrated fallback `playbackId` values varied for `jesus`
results. The ranking pipeline was stable; the nondeterminism came from fallback
dub hydration.

## Symptoms

- Same query returned the same ranked videos with the same scores.
- Some results showed different fallback `playbackId` values across runs.
- The instability appeared only during optimized hydration of playable
  `video_dub` rows.
- Primary search behavior, scoring, and semantic evidence were unchanged.

## What Didn't Work

- **Changing retrievers, RRF/fusion, or scoring.** Those layers already produced
  stable ranked results, so changing them would risk search quality without
  addressing the display-field drift.
- **Changing query embedding cache or trace writes.** Those are timing and
  observability concerns, not public response row-selection logic.
- **Testing TypeScript mapping only.** The bug lived in raw SQL row ordering
  before the mapping layer received hydrated rows.

## Solution

Add a deterministic tie-breaker to the `video_dub` hydration window.

Before:

```sql
row_number() OVER (
  PARTITION BY vd.video_id
  ORDER BY vd.duration DESC
) AS hydration_rank
```

After:

```sql
row_number() OVER (
  PARTITION BY vd.video_id
  ORDER BY vd.duration DESC, vd.id ASC
) AS hydration_rank
```

The TypeScript hydration layer still preserves the product contract: prefer the
primary-language Dub when one is available, otherwise use the first playable Dub
from the bounded hydration window.

The regression test asserts the SQL shape inside the `video_dub`
`row_number() OVER (...)` window:

```ts
expect(hydrationRawSqlContaining("FROM video_dub")).toMatch(
  /row_number\(\)\s+OVER\s*\(\s*PARTITION BY vd\.video_id\s+ORDER BY vd\.duration DESC,\s*vd\.id ASC\s*\)\s+AS hydration_rank/,
)
```

## Why This Works

Postgres does not guarantee a stable order for rows that compare equal on every
`ORDER BY` expression. When multiple playable dubs for the same Video had equal
duration, either row could receive `hydration_rank = 1`, producing different
fallback `playbackId` values.

Adding `vd.id ASC` gives the window a stable final sort key. It preserves search
result quality because it does not alter retrievers, RRF/fusion, scoring, trace
writes, query embedding cache behavior, or semantic evidence. It only makes the
display hydration choice deterministic when otherwise-equivalent dub candidates
tie.

## Prevention

- Include a unique, stable tie-breaker in SQL windows that select one hydrated
  row from multiple candidates.
- Keep SQL-shape tests for raw query behavior when the risk is database
  ordering, not service mapping.
- Prefer focused assertions around `row_number() OVER (...) ORDER BY ...` for
  hydration queries that use fallback selection.
- Preserve ranking and evidence layers when fixing hydration-only
  nondeterminism.

## Related Issues

- PR #1370: `fix(search): stabilize hydrated dub selection`
- `docs/solutions/performance-issues/admin-search-result-preserving-latency-optimization.md`
- `docs/solutions/integration-issues/semantic-search-video-card-display-metadata-hydration.md`
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md`
- `apps/admin/src/services/hybrid-search.service.ts`
- `apps/admin/src/services/hybrid-search.service.test.ts`
