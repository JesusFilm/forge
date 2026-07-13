---
id: "feat-250"
title: "Restore subtitles on single-video Watch pages"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch-page"
  - "subtitles"
  - "accessibility"
---

## Problem

Subtitles do not render on a dedicated single-video Watch route even when the
selected Admin dub has a valid VTT subtitle. The current path crosses selected
dub hydration, top-level subtitle normalization, RSC payload pruning, client
preference resolution, Forge-owned track injection, and cue observation. The
first boundary that drops or ignores the valid selected track must be
characterized before changing production behavior.

## Entry Points — Read These First

1. `docs/plans/2026-07-13-003-fix-watch-single-video-subtitles-plan.md` —
   requirements, constraints, and verification scenarios.
2. `apps/web/src/lib/content.ts` — selected-dub hydration and top-level
   `WatchVideoRecord.subtitles` normalization.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — single-video
   route rendering and client-payload pruning.
4. `apps/web/src/components/watch/WatchPageClient.tsx` — subtitle preference
   resolution and VTT selection.
5. `apps/web/src/components/watch/HeroPlayer.tsx` and
   `apps/web/src/components/watch/SubtitleOverlay.tsx` — Forge track injection
   and cue rendering.
6. `docs/solutions/ui-bugs/watch-caption-language-availability-20260615.md`
   and `docs/solutions/ui-bugs/watch-subtitle-overlay-mux-generated-track-leak.md`
   — established language and track-authority contracts.

## Grep These

- `hydrateSelectedVariant|hydrateAndNarrowSelectedVariant`
- `normalizeSubtitlesFromVariants|pruneWatchVideoForClient`
- `subtitleVttSrc|FORGE_SUBTITLE_TRACK_LABEL`
- `textTracks|cuechange`

## What To Build

1. Add a failing regression that models a single-video route whose selected
   Admin dub contains a valid same-audio-language VTT subtitle.
2. Identify and repair the first boundary where that subtitle is lost or stops
   producing active cues.
3. Preserve intentional translated subtitle preferences, subtitle-off behavior,
   and the guard that excludes Mux-native generated tracks.
4. Preserve the selected-dub projection: do not restore full per-dub subtitle,
   download, or Mux detail to the initial page payload.
5. Verify the viewer flow in a browser and confirm no material page-loading
   regression attributable to the fix.

## Constraints

- Admin-backed `VideoEdition.subtitles` remains the product authority.
- Do not generate or repair missing subtitle content in this ticket.
- Do not change TV, mobile, video routing, or the language-modal design.
- Do not hand-edit generated GraphQL output.

## Verification

- Focused regression for selected-dub subtitle hydration and client selection.
- Existing HeroPlayer, SubtitleOverlay, and LanguagePickerModal subtitle tests.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on a representative `/watch/{video}.html/{language}.html`
  route, including a screenshot with visible cues and inspection of the modal
  and media text-track authority.
