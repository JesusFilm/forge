---
id: "feat-179"
title: "TV App — Home Watch-Content Parity (Focus-Driven Showcase)"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 6
depends_on:
  - "feat-178"
blocks:
  - "feat-246"
tags:
  - "tv"
---

## Problem

TV's home renders the homepage Experience via `watchSetting.homepageExperience`,
which is empty on prod admin — the screen shows a lone hero and a search chip.
Web and mobile homes are full because they render the code-curated Home
Curation (`WATCH_HOME_SECTIONS` + hero pool + `watchHomeVideos` fetch), which
mobile ported on 2026-06-09. TV is the last platform without it. Port the same
curated content one-to-one and lay it out as a focus-driven showcase. Full
requirements: `docs/brainstorms/2026-06-11-tv-home-series-parity-requirements.md`
(R8–R16).

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-11-tv-home-series-parity-requirements.md` — R8–R16, F1–F3, F5–F6
2. `apps/web/src/lib/watch-home-config.ts` — `WATCH_HOME_SECTIONS`, `WATCH_HOME_HERO_SOURCE_IDS` (the curation to port)
3. `apps/web/src/lib/watch-home.ts` + `apps/web/src/lib/fragments/watch-home.ts` — model builder and `watchHomeVideos` operation
4. `apps/mobile/src/lib/watchHome/config.ts` + `apps/mobile/src/hooks/useWatchHome.ts` — mobile's port of the same (precedent for the copy + fetch)
5. `apps/tv/app/index.tsx` — the Experience-driven home being replaced
6. `apps/tv/src/components/HomeHeader.tsx` — search chip + focus-return workaround that stays
7. `apps/tv/src/components/ContentRail.tsx`, `FocusableCard.tsx`, `TVFocusGuideView.tsx` — rail building blocks

## Grep These

- `WATCH_HOME_` in `apps/web/src/lib/` and `apps/mobile/src/lib/watchHome/` — both existing curation copies
- `watchHomeVideos` in `apps/mobile/src/lib/queries.ts` — the lean fragment shape (no dubs/variants; KTD-2 payload constraint)
- `onItemFocus` in `apps/tv/src/components/ContentRail.tsx` — the hook the showcase listens to
- `hasTVPreferredFocus` in `apps/tv/src/` — focus restore on back-navigation (#852 workaround)
- `GET_WATCH_SETTING` in `apps/tv/src/lib/queries.ts` — the home query path being retired from Home

## What To Build

1. **Curation port**: TV copy (or shared package — planning decides) of the
   `WATCH_HOME_*` config plus a `watchHomeVideos` operation following
   mobile's lean fragment. Document the sync obligation with web/mobile.
2. **Focus-driven showcase**: top-of-screen canvas showing the focused
   card's artwork/title/description; defaults to the first featured item;
   retains the last focused card when focus leaves the rows. Image-based —
   no mounted video player.
3. **Featured rail**: the hero pool as the first rail; focusing a card
   swaps the showcase.
4. **Section rails**: every configured section as a horizontal rail in
   config order (grid sections become rails), eyebrow + title.
5. **Card routing**: single video → watch details; series-shaped →
   series screen (feat-178's rule).
6. **Mission tail**: compact mission cards + QR code to the beta signup;
   no external-link actions on-device.
7. **Replace the Experience-driven home**: `apps/tv/app/index.tsx` stops
   reading `watchSetting.homepageExperience`; the SDUI pipeline remains for
   `apps/tv/app/experience/[slug].tsx`.
8. **Loading / error-with-focusable-retry / empty states.**

## Constraints

- Data parity is at the item/row level — web's hero autoplay playlist
  sequencing and Hero Inserts (Mux inserts) do NOT port; they are
  presentation, and an autoplay hero costs a tvOS decode slot.
- Search stays D-pad-reachable at the top of Home (keep the
  `HomeHeader` focus-return workaround).
- No footer, newsletter, or external marketing links on TV.
- Public queries only; hardcoded `locale: "en"`; lazy Apollo client getter;
  composite React keys for rail items.
- Depends on feat-178 — series-shaped cards must have somewhere to land
  before the rails ship.

## Verification

- TV home renders the same hero set and section rows (titles, order,
  cards) as `https://watch.jesusfilm.org/watch` for the same config.
- D-pad focus on any card swaps the showcase; moving focus to the search
  chip retains the last card; first featured item shows on cold launch.
- Selecting a series-shaped card (e.g., a Gospel collection) opens the
  series screen; a single-video card opens watch details.
- Mission section renders at the end with a scannable QR that resolves to
  the beta signup URL.
- Kill network → relaunch: error state with focusable Retry, no blank
  screen. Verify in the tvOS sim via TV Metro on 8082 with a cold relaunch.
