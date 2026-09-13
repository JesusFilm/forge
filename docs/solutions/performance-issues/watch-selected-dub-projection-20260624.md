---
title: "Keep Watch preferred-dub projections bounded across lists"
date: "2026-06-24"
last_updated: "2026-09-14"
module: "apps/admin Watch GraphQL"
problem_type: "performance_issue"
tags:
  - "watch"
  - "dataloader"
  - "postgresql"
  - "connection-pool"
---

# Watch Selected Dub Projection

## Summary

The Watch single-video cold route should not project every `Video.dubs` row
just to choose the first playable language. Large videos can carry thousands
of dubs, so the route snapshot now asks Admin for one preferred playable dub
and a distinct playable-language count.

## Implementation Notes

- `apps/admin/src/graphql/types/video.ts` exposes
  `preferredPlayableDub(languageSlug:)` for the selected route playback and
  `playableDubLanguageCount` for the hero language-switch gate.
- `apps/admin/src/services/video.service.ts` keeps the selection order aligned
  with web: requested language slug or BCP-47, then primary language, then the
  longest playable dub.
- `apps/web/src/lib/fragments/watch-video.ts` no longer includes
  `variants: dubs` in `WatchVideoShell` or the cold route snapshot. The full
  slim dub list moved to `GetWatchLanguagePickerVariantsBySlug`, which is
  loaded lazily by the language picker.
- `apps/web/src/lib/content.ts` stores the admin count on
  `WatchVideoRecord.playableLanguageCount` and falls back to counting local
  variants for older test fixtures and non-route call sites.

## Why This Matters

Splitting the selected playback projection from the language inventory keeps
initial HTML render bounded while preserving the modal's complete language
list. This is the same pattern as child series languages: use scalar or
single-row route data for the cold path, and move broad language inventories
behind intent or a longer-lived cache.

## Verification

- `pnpm --filter @forge/admin test -- src/services/video.service.test.ts src/graphql/schema.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin-graphql typecheck`
- `pnpm --filter @forge/web test -- src/lib/fragments/__tests__/watch-video.test.ts src/lib/content.test.ts src/lib/__tests__/content-watch-merge.test.ts src/lib/__tests__/resolve-series-episode.test.ts src/lib/experience-metadata.test.ts`
- `pnpm --filter @forge/web lint -- src/lib/fragments/watch-video.ts src/lib/fragments/__tests__/watch-video.test.ts src/lib/content.ts`
- `pnpm --filter @forge/admin lint -- src/graphql/types/video.ts src/services/video.service.ts src/services/video.service.test.ts`
- `pnpm --filter @forge/web probe:watch-video-snapshot --slug <heavy-video-slug> --language-slug english --locale en --runs 9 --json /tmp/watch-video-snapshot.json`

Use the probe to prove or falsify the performance impact before claiming a
production win. It compares the legacy `variants: dubs` route snapshot against
the selected-dub projection on the same Admin endpoint and reports median/p95
latency plus response-byte reduction. Add
`--expect-byte-reduction-pct <number>` when using it as a deployment gate.

App-wide `@forge/web` and `@forge/admin` typechecks were not clean in this
workspace because of pre-existing missing dependency / generated-state issues
(`next-intl`, `@mastra/*`, stale `.next` validators). Focused tests, schema
print, generated GraphQL typecheck, and targeted lints passed.

## List queries still need batching — September 2026

A one-row field can still cause severe fanout when a homepage asks for hundreds
of videos and children. The actual homepage query performed 1,337 SQL statements
through independent `getPreferredPlayableDub` calls. Four concurrent reads
queued up to 1,003 operations behind the same ten-connection pool.

`graphql/loaders.ts` now groups preferred-dub keys by language and Pothos
selection, with a request-local cache and a maximum batch of 100. The service
`services/preferred-playable-dub.service.ts` selects winning IDs in SQL before
hydrating their requested relations. Preserve exact slug/BCP-47, primary and
longest fallback order, including duration-null ordering and ID ties. Recheck
publication, deletion and nonempty HLS during hydration because a selected dub
can be withdrawn between the two reads.

Measure actual emitted SQL, not only Prisma method invocations: Pothos fallback
checks may call ORM methods that issue no SQL. Verify the complete GraphQL
response as well as selected IDs, preserving ordered arrays in comparisons.
The final loader emits 40 SQL statements per homepage on the measured fixture.
Bounded concurrent reads substantially reduce queueing but retain multi-second
tails; they do not prove all playback timeouts are fixed. See
`docs/operations/watch-runtime-diagnosis-2026-09-14.md` for measured limits.
