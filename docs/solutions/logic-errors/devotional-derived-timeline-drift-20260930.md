---
title: Timelines derived outside the composition drift from it
date: "2026-09-30"
category: logic-errors
module: apps/mastra/src/services/devotional
problem_type: logic_error
component: service_object
symptoms:
  - "The finished devotional ends on 24 seconds of black after the last card"
  - "A backdrop shot meant for a paragraph arrives a fraction of a second early per seam, over a second after a wrap"
  - "Types, lint and unit tests pass; only a full render or a review shows it"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - testing_framework
  - tooling
tags:
  - devotional-pipeline
  - remotion
  - calculate-metadata
  - ffmpeg
  - xfade
  - backdrop
  - timeline
  - tail-sec
---

# Timelines derived outside the composition drift from it

## Problem

The devotional video's timing lives in one place, the composition's
`framesFromDurations` (`packages/shorts-compositions/src/devotional/timing.ts`).
Several other places re-derive it: Remotion's `calculateDevotionalMetadata`
(canvas length), the backdrop timeline in `devotional-render.ts` (how much
film to cut), and, new on 2026-09-30, `broll-plan.ts` (where each paragraph's
backdrop shot starts). When a card gained its own breath (`tailSec`, 0.35s
between two sentences of one voice instead of the fixed 0.8s), the composition
honoured it and the metadata did not. The Prodigal Son render came out 8:09
with its last 24 seconds black, over the 8-minute limit for no visible reason.

## Symptoms

- `ffprobe` duration 489s; the manifest's cards sum to 466s. Frames after the
  last card render black. The gap is the cards' count times (0.8 − 0.35)s.
- Backdrop anchors that land early: ~0.21s per seam at 0.85×, ~1.4s per wrap.
- Nothing fails. The metadata only sets the canvas; the composition happily
  renders empty frames past its last `Sequence`.

## What Didn't Work

- **Cutting the script to fit.** The first reading was "the video is 9s over,
  shorten it". The script had already been cut to the owner's approved length;
  the overage was the black tail. Sum the cards before cutting words.
- **Adding `tailSec` to the metadata sum.** A second sum in seconds, rounded
  once at the end, still differs from per-card frame rounding by a few frames.
  It fixes today's field and drifts on the next one.
- **Padding the backdrop by a dissolve of SCREEN time.** `concatWithSeamXfade`
  dissolves the source pieces and slows the joined file afterwards
  (`setpts=PTS/speed` after `xfade`), so each seam overlaps `dissolveSec` of
  SOURCE. Screen-time padding (`(screen + d) * speed`) is short by
  `d × (1 − speed)` per seam.

## Solution

**1. Metadata calls the composition's own layout.**

```ts
// calculate-metadata.ts
const durationInFrames = perCard
  ? framesFromDurations(
      props.cards,
      fps,
      CARD_TAIL_FRAMES,
      outroFrames,
      introFrames,
    ).reduce((sum, f) => sum + f.durationInFrames, 0)
  : Math.round((props.audioDurationSec + 1) * fps)
```

Pinned by `calculate-metadata.test.ts`: a card with `tailSec: 0.35` gives a
literal frame count (425). The literal matters: comparing against
`framesFromDurations` alone would pass even if both drifted together.

**2. Backdrop pieces are padded in source seconds, inside the window.**

```ts
// broll-plan.ts, planBrollSegments
const fits = (windowEnd - src - dissolveSec) / speed // room for the overlap
...
lengthSec: Math.min(p.screenSec * speed + extra, windowEnd - p.startSec) // extra = dissolveSec
```

Runs shorter than `2 × dissolve + 0.5s` are dropped: `concatWithSeamXfade`
caps the dissolve at half the SHORTEST piece, so one sliver shrinks every
seam. A piece that would start within that distance of the window's end wraps
to the window's start instead.

**3. The backdrop anchors walk the timeline the composition walks.**
`planBrollAnchors` counts in whole frames with the composition's rules: video
cards and quote openings with their own shot (`bgStartSec`) take no backdrop
time, `tailSec` overrides `CARD_TAIL_FRAMES`, the intro hold lands on card 0.

Tests (`broll-plan.test.ts`): anchor times equal `framesFromDurations` starts
for a mixed card list, and a join simulation that replays
`concatWithSeamXfade`'s arithmetic (piece k starts at the sum of earlier
lengths minus k dissolves, then ÷ speed) lands every anchor on its screen time
at 0.85× through a wrap, never reads past the window, and covers the timeline.

## Why This Works

The composition is the source of truth for where every frame is. Anything that
needs a position on that timeline must ask the composition's function, or be
tested against it with the composition's own rounding. The ffmpeg join is a
second source of truth for the backdrop, and its unit is set by where the
speed change sits in the filter graph: dissolve first, slow second.

## Prevention

- **One layout function, imported.** Metadata, backdrop and any future planner
  call `framesFromDurations` (exported as
  `@forge/shorts-compositions/devotional-card-timing`) or carry a parity test
  against it. `devotional-render.ts`'s `bgTimelineSec` still sums its own
  seconds; it over-provisions (harmless), but do not use it for positions.
- **When a card gains a timing field, grep every re-derivation.**
  `grep -rn "CARD_TAIL\|durationSec.*holdSec" apps/mastra/src packages/shorts-compositions/src`.
- **Check duration against the cards before editing content.** `ffprobe` total
  vs Σ card frames from `manifest.json`; a gap is a layout bug, not a script
  that is too long. Also look at the last seconds: black means the canvas
  outlived the cards.
- **Units follow the filter graph.** Before padding ffmpeg pieces, find where
  `setpts`/`atempo` sits relative to `xfade`/`acrossfade`, and pad in the units
  the dissolve sees.

## Backdrop relevance, for reference

`broll-plan.ts` also chooses the footage: each reflection paragraph is matched
to the film's own caption cues by IDF-weighted word overlap. Rare shared words
decide ("pigs", "fattened calf"); words in every cue ("son") weigh nothing;
verbs of giving are stop words because "share his gladness" matched the
share-of-the-estate scene. A match is skipped when the rolling footage reaches
it within 6s anyway, or when it would replay what the previous paragraph just
showed; unmatched paragraphs keep rolling. Anchors are logged
(`backdrop: 23.9s → film 195.9s (paragraph 2: home)`); check them against
stills, not against the planner's own list.

## Related Issues

- `docs/solutions/logic-errors/narration-cache-keyed-on-display-instead-of-spoken-text-20260905.md`
  — same day, same shape in the audio cache: a new input (the delivery take)
  honoured by one layer and dropped by another.
- `docs/solutions/design-patterns/devotional-opening-sequence-stepper-contract-20260905.md`
  — card layout and `durationInFrames` context.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — why the metadata test asserts a literal, not only equality with the helper.
- Files: `packages/shorts-compositions/src/devotional/{timing,calculate-metadata}.ts`,
  `apps/mastra/src/services/devotional/{broll-plan,devotional-render}.ts`.
