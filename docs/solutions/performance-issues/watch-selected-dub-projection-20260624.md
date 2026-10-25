---
title: "Keep Watch preferred-dub projections bounded across lists"
date: "2026-06-24"
last_updated: "2026-09-23"
module: "apps/admin Watch GraphQL"
problem_type: "performance_issue"
component: "service_object"
severity: "medium"
symptoms:
  - "Cold Watch reads project many dubs to select one playable language"
  - "Authored settings blocks issue one scalar dub lookup per sibling"
  - "Concurrent scalar lookups queue unrelated reads behind a shared pool"
root_cause: "logic_error"
resolution_type: "code_fix"
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

## Authored block identities are a separate query path

Batching `Video.preferredPlayableDub` does not batch the authored block
`videoDub` fields. A retained September 23 settings trace contains 62 scalar
`VideoDub.findFirst` calls through `MediaCollectionItem`, `VideoCarouselItem`,
`VideoBlock` and `VideoHeroBlock`. Trace the actual consumer operation before
assuming a previously optimized field covers every playback projection.

The authored policy uses an exact **video/language pair**, with no preferred
language fallback. It also permits nonnull DASH/share and preserves existing
blank-HLS eligibility. Reusing the preferred-dub loader would change behavior.
The dedicated request-local `selectedBlockVideoDub` loader groups by Pothos
selection and bounds batches at 100. Its service selects at most one winner
per requested pair before hydrating relations. Preserve PostgreSQL's duration
DESC null ordering and ID tie-break; recheck publication, deletion, playability
and the exact identity after hydration. Withdrawal/reassignment returns null.

Actual GraphQL regressions must exercise every affected block field with
selection-aware mocks; otherwise a correct new loader can remain unwired or
lose nested fields. Real PostgreSQL parity checks compare the new query with
the old scalar predicate, including exact-language isolation, ties, null
durations and unavailable rows. Count emitted SQL as well as queued leases.

The controlled five-request, 62-item workload with a three-millisecond response
delay models connection contention; it is not proof of a historical natural
timeout. An ABBA comparison reduced 621 commands per round to 16, peak queued
calls from 301 to zero, and unrelated-read p95 from 200–311 ms to 7–9 ms.
Keep that causal result separate from production recovery. See
`docs/operations/watch-block-dub-fanout-2026-09-23.md` for scope and release gates.

Production verification must compare the full response as well as the query
shape. The September 23 release preserved English and Spanish settings data
including all nulls and array order. JSON object-key order changed, so use a
canonical-key digest for data equivalence and retain the raw digest difference
honestly. A natural settings trace on revision `911ad0058` shows one raw
winner-selection call and one hydration method span in place of scalar dub
calls. Method spans with collapsed children do not establish total SQL count.
