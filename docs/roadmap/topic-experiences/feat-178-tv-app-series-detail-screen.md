---
id: "feat-178"
title: "TV App — Series Detail Screen"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
duration: 4
depends_on: []
blocks:
  - "feat-179"
tags:
  - "tv"
---

## Problem

TV has no series surface. Its watch screen is built for leaf videos — Up Next
siblings come from the parent's children (`apps/tv/src/lib/normalizeVideo.ts`),
so a series-shaped record (label `SERIES`/`COLLECTION`, or any record with
children) lands with no siblings and possibly nothing playable. TV search
results and the upcoming curated home (feat-179) both surface series-shaped
cards, so they need a dedicated screen: trailer-or-poster hero, title,
description, D-pad episode browsing, and language carry-through. Full
requirements: `docs/brainstorms/2026-06-11-tv-home-series-parity-requirements.md`
(R1–R7).

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-11-tv-home-series-parity-requirements.md` — R1–R7, F4, AE1–AE3
2. `docs/brainstorms/2026-06-08-mobile-series-detail-page-requirements.md` — the ethos being adapted (trailer rule, series discriminator, language carry-through)
3. `apps/tv/app/watch/[slug].tsx` — the watch screen that must redirect series-shaped records; pattern source for the new screen's structure
4. `apps/tv/src/lib/normalizeVideo.ts` — sibling derivation and the video shape the screen consumes
5. `apps/web/src/lib/content.ts` — `isSeriesRecord` (the label/children test to mirror)
6. `apps/mobile/src/components/home/HomeCard.tsx` — mobile's series-vs-watch routing rule
7. `apps/tv/CLAUDE.md` — Crimson Gallery design system, focus conventions, known pitfalls

## Grep These

- `isSeriesRecord` in `apps/web/src/` — the series-shaped test
- `siblings` in `apps/tv/src/lib/normalizeVideo.ts` — current leaf-video assumption
- `UpNextRail` in `apps/tv/src/components/watch/` — focus/glow rail pattern to adapt for episode cards
- `childDubLanguages` in `apps/mobile/src/lib/queries.ts` — language list source mobile used
- `LanguagePanel` in `apps/tv/src/components/watch/` — existing TV language selection to reuse

## What To Build

1. **Series-shaped discriminator**: label `SERIES`/`COLLECTION` or non-empty
   children — shared helper, mirroring web's `isSeriesRecord`.
2. **Series screen route**: SERIES label + title + description, artwork
   backdrop, focusable Play Trailer action only when the series' own dub has
   non-null `hls` (no dead action otherwise).
3. **Episode browsing**: children in defined order as D-pad-navigable cards
   (thumbnail + title) using existing rail/focus components
   (`FocusableCard`, `ContentRail`, `TVFocusGuideView`); select opens that
   episode's watch details.
4. **Language carry-through**: Language action opens TV's existing language
   selection; selection swaps the trailer dub when a match exists and is
   carried into opened episodes. No Share/Download/Subtitles actions.
5. **Watch-route redirect**: `apps/tv/app/watch/[slug].tsx` redirects to the
   series screen when its resolved record is series-shaped — covers TV
   search results and deep links.
6. **Loading / error-with-focusable-retry / empty states.**

## Constraints

- Zero `apps/admin` changes — `label`, `children`, series dubs,
  `childDubLanguages`, and images are already on the admin surface.
- Public queries only (watchSetting / experienceBySlug / videoBySlug /
  search); hardcoded `locale: "en"`; lazy Apollo client getter.
- No background video player mounted while browsing — tvOS decode slots are
  scarce; the hero is artwork until Play Trailer is selected.
- Episode browsing shape for large collections (rail vs. grid) is a
  planning decision — see the brainstorm's Outstanding Questions.

## Verification

- Deep link `exp+jesus-film-forge-tv:///watch/<series-slug>` redirects to
  the series screen; a leaf-video slug still renders watch details.
- A TV search result with label `SERIES` opens the series screen.
- Series without a playable trailer shows artwork with no Play Trailer
  action focusable.
- Language selected on the series screen carries into an opened episode.
- Cold-relaunch the sim before judging playback (Fast-Refresh zombie player
  gotcha); verify on TV Metro port 8082, not mobile's 8081.
