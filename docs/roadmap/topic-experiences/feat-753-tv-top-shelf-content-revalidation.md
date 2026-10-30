---
id: "feat-753"
title: "Refresh Top Shelf content without manual cache resets"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [tv, tvos, top-shelf, cache]
---

## Problem

The October 19 interception test found warm Journey copy stuck in the Home model
and same-day Continue metadata stuck in `watch.top-shelf.catalog.v1`, even across
reopening. Users should not need to clear storage to see refreshed published data.

## Entry Points

- `apps/tv/src/lib/topShelf/sync.ts` and `useTopShelfSync.ts`
- `apps/tv/src/hooks/useWatchHome.ts`
- `apps/tv/src/components/settings/SettingsScreen.tsx`
- `apps/tv/app/index.tsx`
- `docs/plans/2026-10-19-top-shelf-fresh-content.md`
- `docs/tv-system-home-validation-2026-10-02.md`

## Constraints and Verification

Keep real history, supported native layouts, existing player behavior, language
and privacy fencing, fast Home paint and unexpired-snapshot transport fallback.
Use isolated fixtures and actual Apple system Home evidence; preserve the earlier
failed/cached observations. Do not change Android behavior or publish to admin.
Verify request counts/timing and regression tests. Assess closed-app update work
separately; this ticket does not implement push or establish release readiness.

## Completion — October 20

Foreground revalidation and removal/error/concurrency protections are implemented.
Actual local API replay on the isolated Apple TV 4K passes all 21 UI executions;
real 159-second progress is preserved and no cache reset is required. Typecheck,
lint and 185 suites / 2,291 tests pass. Closed/background 60-second observations
remain unchanged until reopening: native extension fetching is assessed separately
under feat-630, not implemented here. Push was explicitly excluded. Exact evidence,
performance provenance and cleanup are linked from the implementation plan.
