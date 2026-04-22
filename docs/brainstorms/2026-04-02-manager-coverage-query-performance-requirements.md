---
date: 2026-04-02
topic: manager-coverage-query-performance
---

# Manager Coverage Query Performance

## Problem Frame

The manager's `/api/videos` endpoint fetches all 414K video variant rows and 20K subtitle rows through GraphQL to compute per-video coverage status (human/ai/none) in JavaScript. A single cache refresh takes ~22-47 seconds and saturates the CMS, blocking authentication checks (`/api/users/me`) behind it. This causes sessions to appear "expired" — users sign in, see the dashboard briefly, then get logged out when their next auth check times out.

Additionally, the language picker only shows ~100 of 4,560 languages due to GraphQL pagination limits.

## Requirements

- R1. The `/api/videos` response must return coverage **counts** per video: `{ human: N, ai: N, none: N }` for each coverage type (subtitles, audio, metadata), where counts are based on selected language filters (or all languages if none selected).
- R2. Collections (parent videos) show coverage for their own data, not rolled up from children. Feature films have their own subtitles/variants.
- R3. Standalone videos (no parents, no children) are returned separately from collections.
- R4. Coverage must be computed server-side (SQL or CMS-level), not by fetching all variant/subtitle rows into the manager app.
- R5. The cache refresh must not block or noticeably slow authentication checks.
- R6. The language picker must show all available languages (currently 4,560), not just the first 100.
- R7. Revert the `maxLimit: 100` GraphQL config change from PR #626 — it capped top-level pagination to 100/page, breaking the intentional `pageSize: 5000` and causing 11 sequential round trips instead of 1.

## Success Criteria

- Dashboard loads without logging the user out
- CMS `/api/users/me` responds in <1s during cache refresh
- Video cache refresh completes in <5s (down from 22-47s)
- Language picker shows all languages

## Scope Boundaries

- Coverage snapshots (the daily stats bar) are a separate feature — not in scope
- No changes to the coverage report UI layout or visual design
- Metadata coverage remains a single boolean (`aiMetadata`) for now

## Key Decisions

- **Counts, not statuses**: Coverage per video is `{ human: N, ai: N, none: N }` rather than a single "human/ai/none" string. This lets the UI show richer info when multiple languages are selected.
- **Collections show own coverage**: A collection (e.g. feature film) shows its own subtitle/variant coverage, not a rollup of its children's coverage.
- **Global = any language**: When no language filter is active, coverage considers all languages.
- **Server-side computation**: The database computes coverage counts via SQL aggregation rather than the app downloading raw rows.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Needs research] Should coverage be computed via a custom Strapi endpoint (REST API with raw SQL), a custom GraphQL resolver, or a Knex query from the manager directly?
- [Affects R1][Technical] What's the best way to handle the "no language selected" aggregation efficiently — `COUNT(DISTINCT language_id)` per video, or a simpler `EXISTS` check?
- [Affects R6][Technical] How to serve 4,560 languages without the GraphQL pagination cap — bump `maxLimit` for languages specifically, use REST, or paginate client-side?

## Next Steps

-> `/ce:plan` for structured implementation planning
