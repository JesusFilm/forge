---
id: "feat-890"
title: "Validate and refine the reviewed Watch TV UX shortlist"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-29"
duration: 3
depends_on: []
blocks: []
tags: [tv, apple-tv, android, ux, accessibility, playback, search]
---

## Problem

The owner selected review items 4, 8, 9, 10, 14, 16, 17, 18 and 19 for a bounded
follow-up. Some require clearer UI; restart placement, hero height, metadata and
recovery need evidence before changing behavior.

## Entry Points — Read These First

- `docs/plans/2026-10-29-tv-reviewed-shortlist.md`
- `apps/tv/src/components/home/HomeHeroCarousel.tsx`
- `apps/tv/app/search.tsx`
- `apps/tv/src/components/search/keyGrid.ts`
- `apps/tv/src/components/watch/DetailsActionRow.tsx`
- `apps/tv/src/lib/normalizeVideo.ts`
- `apps/tv/src/lib/videoQueries.ts`
- `apps/tv/src/components/watch/NativeDetailsTrackPanel.tsx`

## Grep These

`See more|Next featured title|buildActionRow|useSearchHistory|formatResumeLabel|relation.order|GetVideoDub|SearchBodyNativeTvos`

## What To Build

1. Measure restart placement and accidental activation in scripted remote trials
   before deciding whether confirmation is justified. Do not infer user incidence
   from an operator smoke test.
2. Compare the current Home-to-Resume path before changing hero height.
3. Label the hero destination accurately as Details and distinguish the focused
   next-title control without altering its focus geometry.
4. Expose useful topics and recent searches through the existing search/history
   pipeline; preserve native Apple search and dictation.
5. Try visible Space and Search labels within the existing Android key sizes.
6. Show saved-position context before Play while preserving Android's explicit
   Resume / Start over choice and Apple's native resume flow.
7. Establish the source of chapter order/duration and sibling metadata before
   adding labels. Never invent sibling episode ordinals or durations.
8. Exercise slow requests, failures, retry and cancellation on the native UI;
   repair demonstrated gaps and preserve input and focus during recovery.

## Constraints

Use separate managed worktrees and combine reviewed commits on
`codex/tv-reviewed-shortlist`. Keep Native A, Media3, hidden Profile, analytics,
recommendations and feedback. No schema/generated changes or bulk dub fetching
for labels. Preserve the original checkout and simulator data. No physical
Chromecast installation in this pass. The parent agent owns publication and merge.

## Verification

Run focused behavior tests, TV typecheck, lint, Jest and touched-file formatting.
Inspect native Apple and Android remote focus, labels, saved progress, Back and
recovery. Compare relevant loading/rendering timing and network work against the
same target/cache/build baseline. Keep inconclusive evidence explicit. Record
exact source, targets, screenshots and limitations in the plan and local harness.

## Completion evidence — 2026-10-29

The selected UI work is combined locally on `codex/tv-reviewed-shortlist`, with
current main merged and application source equivalent to `327c57a1d`. The final
TV harness passes static checks, both native UI scopes, all acceptance items and
bounded performance observations. Native physical-device/Siri validation and
strict whole-startup equivalence are not claimed. Historical startup validation
remains open in feat-889; separate bundled Release playback is unverified. See
the plan for all retained failures, measurements and limits.
