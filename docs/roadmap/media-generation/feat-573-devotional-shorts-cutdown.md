---
id: "feat-573"
title: "Cut a finished devotional into up to six vertical shorts"
owner: "vlad"
priority: "P2"
status: "complete"
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

1. ~~Persist the manifest next to the output video~~ done 2026-10-01: `<video>.manifest.json`.
2. `src/scripts/cut-devotional-shorts.ts --from=<manifest> [--only=history,question]`.
3. A planner that picks candidates from the manifest + `devo.json`:

```ts
type ShortKind =
  | "intro"
  | "film-turn"
  | "film-verse"
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

Deterministic for history / language / question / film-verse (role, timing,
the passage the reflection is about). A model call only to choose the
reflection run that stands alone and the `film-turn` window (the turn of the
scene). Both film shorts are cut as an A/B pair and keep the scrolling
Scripture captions.

4. Each short is rendered as its own portrait manifest through
   `DevotionalVideo` (not a crop of the 16:9 file), re-using cached audio.
   Only the intro teaser gets a music bed; shorts 2 to 6 keep the long-form's
   own audio.
5. Output `~/Desktop/Social Media/<Story>/shorts/<kind>.mp4` plus a `shorts.md`
   listing each short, its length and the text it says. English only for now;
   localized shorts are a later step.

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

## Built (2026-10-01)

- Every complete render writes `<video>.source/` (`source-pack.ts`); older
  devotionals get one with `render-one-devotional.ts ... --pack-only` (zero
  TTS, no encode).
- `apps/mastra/src/scripts/cut-devotional-shorts.ts --from=<pack> --out=<dir>`
  plans with `shorts-cutdown.ts` and renders each short in 9:16 through
  `DevotionalVideo` with the manifest flag `portraitMarks` (credits and the
  verse callout in portrait) and the new portrait scrolling Scripture.
  `--stills` previews, `--only=`, `--film-turn=a-b`, `--reflection=a-b`,
  `--no-model`.
- The film turn is picked by `DEVOTIONAL_MODEL`; code keeps its start and fits
  the end to whole caption lines (Haiku judges where, not how long).
- Prodigal: six shorts in `~/Desktop/Social Media/Prodigal/shorts/`, 20 to 42 s,
  -19.8 to -22.3 LUFS, no black frames, stills checked.

Follow-ups, not done: localized (ES/RU) shorts; a model pick for the
reflection run (today: the first run that stands alone); face-aware background
crop needs the OpenCV venv rebuilt (`DEVO_FACE_PYTHON`).
