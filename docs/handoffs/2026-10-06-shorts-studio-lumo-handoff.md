# Handoff: devotional shorts as editable Shorts Studio projects (LUMO)

Date: 2026-10-06. Owner: Lyuba. Branch: `feat/devotional-video-pipeline-handoff`
(worktree `devo-lab`).

## Goal (owner, 2026-10-06)

Every devotional short we cut should land as a **Shorts Studio project**
(manager.jesusfilm.org/dashboard/shorts) that the owner can open and fix by
hand: trim clips, edit text, nudge timing. The footage is **LUMO**, and the
look is ours (custom component blocks, not the editor's plain text). The
local Remotion pipeline (`cut-devotional-shorts.ts`) stays the source of
truth for planning; Studio is the review-and-fix surface.

## Why a new session

The Studio team shipped (2026-10-06): LUMO in search (no subtitles), a video
`focus` field `{x, y}` (0..1, frames an off-centre subject inside the source)
plus the `set-source-focus` operation, and fixed source tools. The updated
skill is installed at `~/.claude/skills/shorts-creator/` (old copy, if any,
in `shorts-creator.bak-20261006`). **The MCP tool schemas only refresh on a
new session**: the old session's `shorts_capture` required a string
`trackId` (LUMO needs `trackId: null`) and its video items had no `focus`.
First thing: check the loaded schemas accept `trackId: null` and `focus`;
read `~/.claude/skills/shorts-creator/SKILL.md` and
`references/authoring.md` before composing.

## What already exists in Studio

- Components (reuse by reference; ids in project
  `prodigal-history-devotional-look-20261005`, revision 2):
  - `film-look-v1` (cf5f75d9…): dim, grade, grain, vignette.
  - `kinetic-question-v2` (848e457b…): teaser "stack" captions; voice-synced
    `wordTimes` CSV, `bottomPercent`, `accentColor`, safe width ≤ x 920.
  - `history-credit-v1` (f9c7cb2b…): tilted book, "Historical Context",
    "SOURCE: …", cascade, fades out.
  - `serif-line-v1` (1ebf3ea4…): PT Serif italic line ("From Full
    Devotional"), Figma-unit position.
  - `close-question-v1` (09254565…): silent closing question, Inter caps.
  - `brand-mark-v1` (c7215d4d…), `kinetic-question-v1` (4160d470…): teaser.
    Sources + subset fonts: `~/Desktop/devo-data/studio-components/`
    (`check.cjs` compiles and server-renders each; fonts via the fonttools
    venv noted in memory). Limits: ≤ 32768 bytes, imports react + 7 remotion
    names, fonts embedded as base64 FontFace.
- Project `prodigal-history-devotional-look-20261005` rev 2: the Prodigal
  history short on "The Prodigal" (paper-cut animation, not LUMO; owner
  approved the result, no black). Narration (fca1fa2e…) and music
  (bafe2cac…) assets are uploaded and reusable. Downloaded render:
  `~/Desktop/Social Media/Prodigal/shorts/history-studio.mp4`.

## Next steps

1. **Pilot: Prodigal history on LUMO.** `shorts_search` "LUMO - Luke 15"
   → `LUMO - Luke 15:11-16:31` (videoId `cmp78pa4b0e1kqm01jg4bwvpf`, dub
   `eb39af05-…`, edition `cmp720j1u07d0o0010q6hz7fy`, fhd download
   `ff5c42ee-…`, 559.8 s; Arclight `6_GOLuke2616`, the same media our
   pipeline downloads, so film seconds map 1:1). Capture with
   `trackId: null`, swap the five shots in the existing project via
   `trim-source` / item `source` (read the project and history first;
   preserve human edits), frame with `set-source-focus` instead of x/scale.
   No letterbox on LUMO: scale back to 1.
2. **Which film seconds?** The local short's background is `bg.mp4`, a
   slowed (×0.7) and seamed cut of the film, so `bgStartOffsetSec` is NOT a
   film time. Persist the background plan in the source pack
   (`render.json` → `background.segments`: film start, length, speed, bg
   start) in `devotional-render.ts` (`planBackgroundSegments` /
   `planBrollSegments` output), then map each short shot back to film time.
   Studio has no playback-rate field: shots play at 1.0, fine for review.
   Martha/Prodigal packs predate this: re-run `--pack-only` (zero TTS).
3. **Exporter.** Add `cut-devotional-shorts.ts --studio=<dir>`: from the
   staged manifest (`--stage-out` already dumps it) write a Studio
   `document.json` (shots with film times + Smart Crop focus, component
   items with the same properties the Remotion short uses, narration laid out
   by `framesFromDurations`, music segment) plus the audio files and an
   upload list. The agent uploads assets and calls `shorts_create` /
   `shorts_apply`. Start with history, then language, reflection,
   film-verse, intro (each needs its own component; port from ShortFact.tsx /
   DevotionalVideo.tsx as the history ones were).
4. Smart Crop focus: `clip-smart-crop.ts` / `intro-smart-crop.ts` already
   produce per-shot x in source fractions; that is exactly Studio `focus.x`.

## Traps already hit

- Studio video is cover-fitted; item x/scale move the LAYER (black past
  ±(scale−1)·540). Use source `focus` now; never pan with x.
- Some Mux thumbnail requests return a 452-byte error; grab frames from the
  HLS stream with ffmpeg instead.
- `shorts_instructions` still answered "Studio agent unavailable" on
  2026-10-06 (not needed for this workflow).
- Renders take ~5 min; poll `renderStatus` no faster than `pollAfterMs`.
