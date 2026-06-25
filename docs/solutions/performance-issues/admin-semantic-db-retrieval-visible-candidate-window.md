---
title: "Admin semantic DB retrieval visible candidate window"
date: "2026-06-25"
category: "performance-issues"
module: "apps/admin"
problem_type: "performance_issue"
component: "database"
symptoms:
  - "Production keyword-first search still spends seconds inside semantic-video.query"
  - "Joining video_locale during transcript collapse can multiply candidates because locale is not unique per video"
  - "Moving semantic candidate limits earlier risks changing recall and result quality"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "high"
tags:
  - "admin-search"
  - "semantic-video"
  - "pgvector"
  - "video-locale"
  - "transcripts"
  - "result-parity"
  - "raw-sql"
---

# Admin Semantic DB Retrieval Visible Candidate Window

## Problem

Admin search timing showed `semantic-video.query` remained a dominant
production cost after the earlier embedding-cache and hydration optimizations.
The next safe optimization had to reduce unbounded SQL work without changing
semantic ranking, result IDs, result order, scores, or display fields.

## Symptoms

- Keyword-first search can still spend several seconds in the semantic video DB
  retrieval path.
- `video_locale.locale` is not a unique display identity, so joining
  `video_locale` before candidate limiting can multiply rows for one video.
- A naive HNSW-first row window could return many chunks from one long video and
  reduce distinct-video recall before the per-video collapse.

## What Didn't Work

- **Joining display locale rows inside the unbounded transcript collapse.** That
  gives every transcript chunk the full display join cost and can duplicate a
  candidate when more than one published row shares the requested locale.
- **Moving display selection before the candidate limit with `JOIN LATERAL`.**
  It is deterministic, but still pays the display lookup for every visible
  semantic candidate instead of only bounded survivors.
- **Using an HNSW-first nearest-neighbor window as the first fix.** It may be
  faster, but it changes which chunks can compete before `DISTINCT ON
(video_id)`, so it needs separate recall and diversity proof.

## Solution

Keep the exact transcript best-evidence semantics, but split visibility,
candidate limiting, and display hydration into separate SQL stages:

```sql
WITH query_embedding AS MATERIALIZED (...),
best_transcript_per_video AS (
  SELECT DISTINCT ON (vt.video_id) ...
  FROM video_transcript_chunk vtc
  JOIN video_transcript vt ON vt.id = vtc.transcript_id
  WHERE vtc.embedding IS NOT NULL
  ORDER BY vt.video_id, vtc.embedding <=> qe.embedding, vtc.start_seconds, vtc.id
),
visible_semantic_candidates AS (
  SELECT b.*, v.core_id, v.slug
  FROM best_transcript_per_video b
  JOIN video v ON v.id = b.video_id AND v.deleted_at IS NULL
  WHERE EXISTS (
    SELECT 1
    FROM video_locale vl_visible
    WHERE vl_visible.video_id = v.id
      AND vl_visible.locale = $locale
      AND vl_visible.status = 'published'
      AND vl_visible.deleted_at IS NULL
  )
),
transcript_source AS (
  SELECT *
  FROM visible_semantic_candidates
  ORDER BY source_score DESC, start_seconds ASC NULLS LAST, evidence_id ASC
  LIMIT $candidate_limit
)
SELECT ...
FROM transcript_source ts
JOIN LATERAL (
  SELECT vl_display.title
  FROM video_locale vl_display
  WHERE vl_display.video_id = ts.video_id
    AND vl_display.locale = $locale
    AND vl_display.status = 'published'
    AND vl_display.deleted_at IS NULL
  ORDER BY
    vl_display.language_core_id ASC NULLS LAST,
    vl_display.language_slug ASC NULLS LAST,
    vl_display.id ASC
  LIMIT 1
) display_locale ON true
```

The load-bearing details are:

- `best_transcript_per_video` reads transcript tables only and has no candidate
  limit. This preserves the current "best chunk per video across the full
  transcript corpus" behavior.
- `visible_semantic_candidates` joins `video` after the collapse and uses
  `EXISTS` for published requested-locale visibility. That keeps one row per
  visible video before `transcript_source` applies the candidate limit.
- The final select hydrates deterministic display title, image, dub playback,
  and `embedding::text` only for bounded survivors.
- The DB timing label remains `semantic-video.query`, so production before/after
  timing logs stay comparable.

## Why This Works

The query still chooses the same best transcript evidence per video before the
semantic candidate window is bounded. Visibility remains before the limit, so a
hidden or unpublished video cannot take a candidate slot. Display title
selection moves after the limit, where it cannot multiply candidates or expand
the unbounded vector-distance work.

The `EXISTS` gate is the important shape. It answers "is this video visible in
the requested locale?" without selecting a display row. The later
`JOIN LATERAL` answers "which display title should this already-selected
survivor show?" with a deterministic tie-breaker.

## Prevention

- Treat visibility and display selection as separate operations in semantic
  search SQL. Visibility can gate candidate eligibility; display metadata should
  hydrate bounded survivors.
- Do not join non-unique locale/display tables before a candidate limit unless
  the SQL proves one row per candidate.
- Keep raw SQL invariant tests around CTE order, absence of `LIMIT` before the
  best-evidence collapse, `EXISTS`-based visibility, and deterministic display
  ordering.
- Pair SQL-shape tests with production canary result signatures. The always-on
  unit tests can prove the query topology, but this repo does not yet have an
  always-on pgvector fixture that proves data-level parity across production
  edge cases.
- Keep HNSW-first transcript windows as a separate PR that must prove distinct
  video recall and result quality before it ships.

## Related Issues

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/plans/2026-06-25-003-perf-admin-search-semantic-db-retrieval-plan.md`
- `docs/solutions/performance-issues/admin-search-result-preserving-latency-optimization.md`
- `docs/solutions/performance-issues/admin-search-stage-db-timing-instrumentation-20260624.md`
- `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
- `docs/solutions/platform/admin-mixed-video-semantic-evidence-pattern-20260521.md`
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
- `docs/solutions/database-issues/stable-admin-search-dub-hydration-ordering.md`
