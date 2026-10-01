---
id: "feat-573"
title: "Cut a finished devotional into up to six vertical shorts"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-02"
duration: 7
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "mastra"
---

## Problem

A long-form devotional (16:9, 3 to 8 min) is posted once on YouTube. Social
platforms need 15 to 45 second vertical shorts that send viewers to it. Today
only the intro teaser can be cut (`--teaser-intro`); every other short would be
edited by hand. The owner wants it automatic: hand the agent a finished
devotional, get up to six shorts back (intro teaser, film moment, history fact,
language fact, reflection excerpt, question). Shorts carry no added hook and no
call to action (owner, 2026-10-01); only the intro teaser keeps its CTA.

## Entry Points — Read These First

1. `docs/handoffs/2026-10-01-devotional-shorts-cutdown-handoff.md`: context, owner decisions, open questions.
2. `apps/mastra/src/services/devotional/devotional-render.ts`: builds the manifest; the `options.introTeaser` branch is the one existing cut-down.
3. `packages/shorts-compositions/src/devotional/schema.ts`: card kinds, `sourceMark`, word timings.
4. `apps/mastra/src/services/devotional/storyteller-writer.ts`: paragraph roles (`history`, `language`, `classic`, `reflection`).
5. `apps/mastra/src/scripts/render-one-devotional.ts`: CLI flags, `--aspect=portrait`, `--frame-range`.
6. `packages/shorts-compositions/src/devotional/DevotionalVideo.tsx`: how each card lays out in 9:16.

## Grep These

- `introTeaser` (the existing cut-down path)
- `manifest.json` (where the manifest is written; today only to a temp stage dir)
- `sourceMark` (credited facts on reflection cards)
- `role: "history"` / `"language"` (paragraph roles)
- `reusing cached audio` (zero-cost render guard)

## What To Build

1. Persist the manifest next to the output video: `<out>/<name>.manifest.json`.
2. `src/scripts/cut-devotional-shorts.ts --from=<manifest> [--only=history,question]`.
3. A planner that picks candidates from the manifest + `devo.json`:

```ts
type ShortKind =
  | "intro"
  | "film"
  | "history"
  | "language"
  | "reflection"
  | "question"
type ShortPlan = {
  kind: ShortKind
  /** Cards (by index in the long-form manifest) the short is built from. */
  cards: number[]
  /** For `film`: the window of the clip, seconds. */
  film?: { fromSec: number; toSec: number }
  durationSec: number // 15..45
}
```

Deterministic for history / language / question (role + timing). A model
call only to choose the reflection run that stands alone and the film window. 4. Each short is rendered as its own portrait manifest through
`DevotionalVideo` (not a crop of the 16:9 file), re-using cached audio. 5. Output `~/Desktop/Social Media/<Story>/shorts/<kind>.mp4` plus a `shorts.md`
listing each short, its length and the text it says.

## Constraints

- Zero new ElevenLabs spend: shorts re-use the long-form's cached readings.
- No added hook line and no CTA in shorts 2 to 6.
- 15 to 45 seconds each; skip a kind the devotional does not have (no language fact means no language short).
- Never overwrite outputs; move older files to `archive/`.
- No em or en dashes in any on-screen text.

## Verification

- `pnpm --filter @forge/mastra exec vitest run src/services/devotional` passes, with planner tests on a real Prodigal manifest fixture.
- Run on Prodigal (`lumo-luke-15`, seq 0): up to six MP4s at 1080x1920, each 15 to 45 s (`ffprobe -show_entries format=duration`).
- Loudness about -20 LUFS (`ffmpeg -af ebur128`), no black frames (`blackdetect`).
- The render log shows "reusing cached audio" and "synthesised 0".
- Stills of every short checked by eye: captions in frame, credit mark on the history short, nothing clipped.
