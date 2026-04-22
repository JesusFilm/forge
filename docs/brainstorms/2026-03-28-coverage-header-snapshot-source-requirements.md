---
date: 2026-03-28
topic: coverage-header-snapshot-source
---

# Coverage Header Diagram: Switch to Snapshot Data Source

## Problem Frame

The Coverage report header bar (None/Verified/AI segments) currently requires fetching ALL videos from Strapi and computing coverage client-side. This is slow (~4s with SWR cache) and blocks both the header and collection views. The new `CoverageSnapshot` content type already stores pre-computed per-language coverage totals — the header bar should read from it instead.

## Requirements

- R1. The CoverageBar header diagram reads coverage counts from the `CoverageSnapshot` API (latest snapshot) instead of computing them from the full video fetch.
- R2. Library-wide totals (when no language selected) use the snapshot's `totalVideos`, `videosWithAiMetadata`, and aggregated language coverage.
- R3. Per-language totals (when languages selected) sum the relevant entries from the snapshot's `languageCoverage` JSON for the selected languages.
- R4. The header bar renders immediately on page load without waiting for the full video collection fetch.
- R5. The existing `/api/videos` endpoint and collection rendering continue to work unchanged — only the header bar data source changes.

## Success Criteria

- Header bar renders with coverage percentages before collections load.
- Coverage percentages match (within expected daily-snapshot lag) what the live computation produces.

## Scope Boundaries

- **Not in scope:** Lazy-loading collections on scroll (enabled by this change, built separately).
- **Not in scope:** Changes to the CoverageSnapshot cron or content type.
- **Not in scope:** Removing the existing `/api/videos` coverage computation.

## Key Decisions

- **Snapshot as header source, live data for collections:** The header shows aggregated counts from pre-computed snapshots. Collections still load from `/api/videos` for per-video detail. This decouples the two, enabling future lazy-loading.

## Dependencies / Assumptions

- The `CoverageSnapshot` content type and Manager `/api/coverage-snapshots` endpoint exist (built in prior session).
- API token permissions for `coverage-snapshot` are granted in Strapi.

## Next Steps

→ `/ce:plan` for structured implementation planning
