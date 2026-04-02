---
date: 2026-03-28
topic: coverage-snapshot-tracking
---

# Media Enrichment Coverage Snapshot Tracking

## Problem Frame

The Manager app enriches media content (transcription, translation, metadata, subtitles) but there is no historical record of library coverage over time. Leadership needs to see enrichment progress month-over-month via interactive animations. Today the `/dashboard/coverage` page shows real-time coverage but nothing is persisted for trend analysis.

## Requirements

- R1. A daily snapshot captures library-wide enrichment coverage, with per-language breakdowns for language-specific metrics and library-wide totals for language-independent metrics.
- R2. Per-language metrics: count of videos with subtitles (human vs AI), count of videos with audio variants (human vs AI).
- R3. Library-wide metrics: total video count, count with AI metadata extracted (since metadata is a property of the video, not language-specific).
- R4. Snapshots are stored as a Strapi content type (`CoverageSnapshot`) queryable via GraphQL.
- R5. A Strapi v5 cron task runs once per day (e.g., 02:00 UTC) to compute and persist the snapshot.
- R6. The cron task is idempotent — running it twice on the same date overwrites rather than duplicates.
- R7. Snapshot data is queryable by date range to support the monthly leadership animation.
- R8. The Manager dashboard exposes an API endpoint (or GraphQL query) to retrieve snapshot history for a given date range.

## Success Criteria

- After 7 days of running, querying snapshots returns 7 daily records with per-language coverage percentages.
- Leadership animation can be built from the snapshot API showing coverage trends over any time period.
- No manual intervention needed — snapshots accumulate automatically.

## Scope Boundaries

- **Not in scope:** The interactive leadership animation itself (built separately once data is available).
- **Not in scope:** Per-collection or per-video granularity — library-wide per-language totals only.
- **Not in scope:** Real-time event-driven tracking — daily batch snapshots are sufficient.
- **Not in scope:** Historical backfill from enrichment job history (nice-to-have, deferred).

## Key Decisions

- **Daily cron snapshot over event-driven:** Simpler, decoupled from enrichment workflow, easier to reason about. One snapshot per day is sufficient granularity for monthly leadership reports.
- **Strapi content type over external storage:** Keeps data in the same layer as all other content, queryable via existing GraphQL infrastructure.
- **Strapi cron over external scheduler:** Strapi v5 has built-in cron support with direct DB access. No additional infrastructure needed.
- **Per-language breakdown, not per-collection:** Right granularity for "watch Spanish coverage grow" narratives without excessive data volume.

## Dependencies / Assumptions

- Strapi v5 cron tasks are enabled in the deployment environment (Railway).
- The existing coverage computation logic in Manager's `/api/videos` can be adapted or reused for the cron task (it already computes per-language subtitle/variant/metadata status).

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Technical] Exact schema shape for the `CoverageSnapshot` content type — should per-language rows be a repeatable component or a JSON field?
- [Affects R5][Technical] Verify Strapi v5 cron configuration works on Railway (process stays alive, timezone handling).
- [Affects R5][Needs research] Can the cron task reuse the coverage computation from Manager's `/api/videos` route, or does it need a fresh implementation in Strapi?
- [Affects R8][Technical] Should the Manager dashboard query snapshots directly from Strapi GraphQL, or proxy through its own API?

## Next Steps

→ `/ce:plan` for structured implementation planning
