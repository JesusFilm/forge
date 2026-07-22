---
id: "feat-286"
title: "Watch Home editorial programming"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 5
depends_on:
  - feat-160
blocks: []
tags:
  - "web"
  - "watch"
  - "admin"
  - "admin-graphql"
  - "editorial"
---

# Watch Home editorial programming

## Resolution

Completed 2026-07-22. The Homepage Experience's `WatchHomeHeroBlock` now has a
strict, bounded editor for an optional intro, typed video/promo buckets, and an
ordered repeating rotation. Admin GraphQL exposes the program and resolves
stable catalog and managed-poster identities; Web performs bounded,
language-correct normalization before handing a serializable program to a pure
per-entry queue engine.

The Web runtime preserves the existing single-player TV-like surface while
adding independent no-repeat bucket cycles, fresh entry seeds, signed-in
history as a read-only preference, a versioned monthly browser exposure ledger,
meaningful visible-playback/skip exposure, runtime-failure quarantine, and
bounded fallback to the legacy static queue. Carousel previews never write
account watch progress. The fixed intro runs once per entry and is deliberately
outside exposure filtering.

Final focused regression evidence includes 133 Admin schema/editor assertions
and 126 Web normalization, engine, lifecycle, route, and component assertions,
in addition to the Admin GraphQL contract coverage. Relevant Admin, Admin
GraphQL, and Web typechecks, the full repository lint, and two clean Web
production builds are green.

The final in-app browser pass reached a complete `/watch` document, opened and
closed Search through the client UI, and reported no browser warnings or
errors. The local Admin data service was intentionally unavailable, so the
page exercised its upstream-data failure boundary rather than live authored
media; playback behavior remains covered by the focused component and hook
suites. A like-for-like production build comparison against the merge base
kept the Watch route at 24 startup chunks and added 4,717 gzip bytes (0.69%).
Server-side Watch inputs remain parallel, and authored catalog hydration is
deduplicated and split into at most 100 IDs per request.

The static placement seed remains intentionally placement-only because a valid
promo program requires approved Admin `MediaAsset` poster IDs. Production
editors publish program content through the normal Admin Experience workflow;
the seed does not embed environment-specific assets. Mobile and TV adoption is
an explicitly named residual, not part of this Web-scoped ticket.

## Problem

Forge's new Watch Home reproduces the TV-like player surface, but its playlist,
category cadence, intro, and promo inserts remain Web-owned static
configuration. The current queue is date-seeded and records a slide as played
as soon as it becomes active, so returning viewers neither receive a newly
assembled channel nor an accurate unseen-first experience.

## Goal

Let editors author one intro and a repeating sequence of typed video and promo
buckets on the Homepage Experience's `WatchHomeHeroBlock`. On every Watch page
entry, Web assembles a fresh sequence that follows the authored cadence, draws
from independent no-repeat shuffle bags, prefers videos absent from browser
preview exposure and signed-in watch history, and preserves the existing
single-player cinematic experience.

## Scope

- Extend the existing Experience block JSON contract and editor; no Prisma
  migration or new publishing entity.
- Expose the authored program through Admin GraphQL and regenerate committed
  schema/type artifacts.
- Add a pure Web programming engine, versioned browser exposure state, and
  event-based exposure recording.
- Keep the current static playlist and promo data as a migration fallback for
  placement-only or invalid hero blocks.
- Keep Mobile and TV behavior unchanged in this ticket.

## Entry Points

- Plan: `docs/plans/2026-07-22-001-feat-watch-home-editorial-programming-plan.md`
- Admin block: `apps/admin/src/domain/blocks.ts`
- Admin editor: `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- GraphQL block type: `apps/admin/src/graphql/types/blocks.ts`
- Web normalization: `apps/web/src/lib/watch-home.ts`
- Programming engine: `apps/web/src/lib/watch-home-carousel-sequence.ts`
- Playback lifecycle: `apps/web/src/components/home/useWatchHomeTvCarousel.ts`

## Verification

- Admin can create, edit, reorder, and publish intro, bucket, and rotation data.
- Intro plays once per entry; the authored rotation then repeats and skips
  empty/unplayable buckets without starving later slots.
- Each bucket avoids repeats until its own eligible set is exhausted and resets
  without resetting other buckets.
- Local exposure is recorded only after three visible playback seconds or an
  explicit skip; carousel previews never write account watch progress.
- Refresh and leave/return create fresh assemblies without SSR hydration drift.
- Existing takeover playback, poster-first loading, scroll pause, and Watch
  page-loading performance remain within the measured baseline.
