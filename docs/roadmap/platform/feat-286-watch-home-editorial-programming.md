---
id: "feat-286"
title: "Watch Home editorial programming"
owner: "urim"
priority: "P1"
status: "in-progress"
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
