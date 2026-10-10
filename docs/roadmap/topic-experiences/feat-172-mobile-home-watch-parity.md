---
id: "feat-172"
title: "Mobile Home with watch-homepage content parity"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-06-10"
duration: 3
depends_on: []
blocks: []
tags:
  - "mobile"
---

## Problem

Mobile's Home tab rendered nothing in prod: it gated on
`watchSetting.homepageExperience`, which is null, while web's `/watch` home is
config-curated (feat-159) and never used Experiences. Mobile needs the same
curated content with a phone-native layout.

## Entry Points — Read These First

1. `docs/plans/2026-06-10-001-feat-mobile-home-watch-parity-plan.md` — the
   implementation plan (8 units, KTDs, acceptance examples).
2. `apps/mobile/src/lib/watchHome/heroConfig.ts` — the LIVE hero curation
   (sync obligation with `apps/web/src/lib/watch-home-config.ts` for hero
   sources / playlist / mux inserts until feat-160 moves curation into admin).
   `fallbackConfig.ts` is the FROZEN emergency body fallback — not mirrored;
   the live body now comes from the admin Experience (see next entry).
3. `apps/mobile/src/lib/watchHome/experienceAdapter.ts` — maps the prod
   `watch-home` homepage Experience's `MediaCollectionBlock`s into the home
   shelves (content parity with web; see
   `docs/plans/2026-07-08-001-feat-mobile-home-experience-parity-plan.md`).
4. `apps/mobile/src/components/home/HomeScreen.tsx` — the three-layer Home
   composition.
5. `apps/mobile/src/lib/watchHome/pagerReducer.ts` — hero pager state machine.
6. `apps/mobile/src/hooks/useWatchHome.ts` + `useHeroStream.ts` — lean bulk
   fetch + lazy per-slide stream resolution.

## Grep These

- `watchHomeVideos` — the public bulk resolver + mobile's lean fragment
- `buildWatchHomeHeroQueue` — queue assembly (pools + inserts + daily offset)
- `feat-160` — the admin-owned-curation migration that supersedes the config copy

## What To Build

Shipped by the plan above: curated Home (hero pager + chip rail, shelves,
mission section), Profile footer essentials, non-blocking root layout with
Experiences re-homed to `/experience/[slug]`.

## Constraints

- The bulk home fragment must stay card-lean — no `dubs` selections (jest
  guard in `watchHomeQueries.test.ts` enforces it; the 9.5MB payload trap).
- No react-native-gesture-handler; single hero player via `replaceAsync`.
- Hero curation edits must mirror web's config (`heroConfig.ts`) until feat-160
  lands; the body is Experience-driven and `fallbackConfig.ts` is frozen — do
  not mirror the body against web.

## Verification

- `pnpm --filter @forge/mobile test` — watchHome suites green.
- Fresh install against prod admin reaches all tabs (null homepage no longer
  blocks); Home renders hero + shelves; chip tap swaps hero in place.
