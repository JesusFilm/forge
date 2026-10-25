---
status: complete
priority: p1
issue_id: "025"
tags: [manager, mux, subtitles, stage-clone, elevenlabs]
dependencies: []
---

# Stop generating Mux subtitles on stage clone for source language

The stage-clone enrichment path currently creates a fresh Mux asset with
Mux-generated subtitles enabled for the source language. Later in the workflow,
the manager also generates its own subtitle artifact for that same language.
Because the Mux sync step skips any language that already exists on the target
asset, the uploaded subtitle track shown in Mux can diverge from the subtitle
artifact produced by the workflow.

## Problem Statement

Source-language jobs can finish with two different subtitle sources:

- the manager-generated subtitle artifact served from
  `/api/jobs/:id/artifacts/subtitles-en`
- the Mux-generated `generated_vod` subtitle track already present on the stage
  asset

This makes the dashboard artifact preview and the subtitle track visible in Mux
disagree on timing and phrasing. It also means `mux_upload` can report success
without actually syncing the workflow-generated source-language VTT.

## Findings

- `apps/manager/src/services/stageClone.ts` creates stage-clone assets with
  `generateSubtitles: true` and `subtitleLanguageCode: candidate.sourceLanguageCode`.
- `apps/manager/src/services/mux-sync/index.ts` skips upload when a text track
  already exists for the same language and records
  `status: "skipped_existing_mux_data"`.
- For job `nn7ebxug602bqmyniqy6b39d`, the Mux sync report recorded:
  - `artifactKey: "subtitles-en"`
  - `status: "skipped_existing_mux_data"`
  - `explanation: "Mux already has en subtitles"`
- The current stage asset `HvSTeW67PN92SG8bqin6d01PatjUSDiIrau8Cditchts`
  contains a Mux track with:
  - `text_source: "generated_vod"`
  - `name: "Generated subtitles"`
- The workflow-generated English subtitle artifact differs from the current Mux
  track:
  - manager artifact starts at `00:00:05.179`
  - current Mux track starts at `00:00:00.000`
  - wording also differs in the opening cues

## Proposed Solutions

### Option 1: Disable source-language Mux subtitle generation on stage clone

**Approach:** Stop passing `generateSubtitles: true` when creating stage-clone
assets for workflows that will produce source-language subtitle artifacts and
let `mux_upload` create the uploaded text track from `subtitles-{lang}`.

**Pros:**

- Keeps one canonical subtitle source for source-language jobs
- Avoids silent `skipped_existing_mux_data` behavior for source-language tracks
- Simplest mental model for operators comparing dashboard artifacts to Mux

**Cons:**

- Removes the current Mux-generated subtitle fallback on stage clones
- Requires confidence that workflow subtitle generation is the desired default

**Effort:** 2-4 hours

**Risk:** Medium

---

### Option 2: Keep generation, but auto-override source-language tracks in `mux_upload`

**Approach:** Continue creating generated subtitles on stage clone, but have the
workflow automatically replace that track with the manager-generated
`subtitles-{lang}` artifact during `mux_upload`.

**Pros:**

- Preserves an early fallback track on the stage asset
- Still ends with workflow-generated subtitles visible in Mux

**Cons:**

- More moving parts and more Mux track churn
- Harder to reason about timing if replacement races or fails midway

**Effort:** 4-6 hours

**Risk:** Medium / High

---

### Option 3: Compare tracks and only override when drift is detected

**Approach:** Diff the generated artifact preview against the existing Mux track
and replace only when they meaningfully differ.

**Pros:**

- Avoids unnecessary uploads in exact-match cases
- Preserves current behavior where Mux output is acceptable

**Cons:**

- Adds comparison heuristics and more brittle decision logic
- Most complex implementation and test surface

**Effort:** 1 day+

**Risk:** High

## Recommended Action

Implement Option 1. The user-facing request is to stop generating Mux subtitles
on stage clone for the source language. Update the stage-clone creation path so
it does not request `generated_vod` subtitles for these jobs, then verify that
`mux_upload` creates an uploaded subtitle track from `subtitles-{lang}` and
that Mux timing matches the workflow artifact for same-language jobs.

## Technical Details

**Affected files:**

- `apps/manager/src/services/stageClone.ts`
- `apps/manager/src/services/transcription.ts`
- `apps/manager/src/services/stageClone.test.ts`
- `apps/manager/src/services/transcription.test.ts`

**Related components:**

- stage-clone materialization
- Mux subtitle sync
- source-language no-op translation artifact generation

**Database changes (if any):**

- No

## Resources

- **Job:** `nn7ebxug602bqmyniqy6b39d`
- **Manager artifact:** `http://localhost:3002/api/jobs/nn7ebxug602bqmyniqy6b39d/artifacts/subtitles-en`
- **Current Mux playback subtitle track:** `https://stream.mux.com/azVILEh8zf9xlQE00SKZJ8W02KKvbBV019Xx012biHMdrWE/text/0100ViXAb00uBuANzOUwEYljjOlcVShkcynhtkyXod7S1fWBw00k9SFNJQ.vtt`
- **Related todo:** `todos/001-complete-p1-elevenlabs-transcription-pipeline.md`

## Acceptance Criteria

- [x] Stage-clone asset creation no longer requests Mux-generated subtitles for
      the source language in this workflow path
- [x] Same-language jobs no longer finish `mux_upload` with
      `skipped_existing_mux_data` purely because of stage-clone-generated source
      subtitles
- [x] Mux receives the workflow-generated `subtitles-{lang}` track for the
      source language
- [x] A user-like verification confirms the subtitle timing shown in Mux matches
      the workflow-generated artifact for a same-language job
- [x] Regression tests cover stage-clone creation params and Mux sync behavior

## Work Log

### 2026-04-11 - Initial Discovery

**By:** Codex

**Actions:**

- Inspected job `nn7ebxug602bqmyniqy6b39d` and its artifact endpoints
- Confirmed the stage asset carried an existing `generated_vod` English subtitle
  track before `mux_upload`
- Verified `mux_upload` skipped syncing `subtitles-en` because the language
  already existed on Mux
- Compared the workflow artifact VTT and the live Mux text-track VTT and found
  timing drift starting at the opening cue
- Captured the requested follow-up as a durable ready todo

**Learnings:**

- The mismatch is caused by two subtitle generation systems running for the same
  language on the same stage asset
- The normal workflow keeps the preexisting Mux subtitle track instead of
  replacing it

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Removed `generateSubtitles` and `subtitleLanguageCode` from the
  stage-clone asset creation path so same-language stage clones no longer start
  with a pre-generated Mux subtitle track
- Added a Mux-path safeguard in transcription routing so explicit or fallback
  Mux runs still call `ensureGeneratedSubtitlesForAsset(...)` before fetching a
  generated track
- Updated regression coverage in `stageClone.test.ts` and
  `transcription.test.ts`
- Ran:
  - `pnpm --filter @forge/manager test -- src/services/stageClone.test.ts src/services/transcription.test.ts`
  - `pnpm --filter @forge/manager test -- src/services/mux-sync/index.test.ts src/workflows/videoEnrichment.test.ts src/app/api/enrich/route.test.ts`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`
- Ran user-like validation on local manager:
  - coverage UI created same-language Worker Bunny job
    `gs80ana8br7baang7wpaifk3`
  - confirmed that job synced `subtitles-en` instead of skipping it
  - exposed local manager through `https://fuzzy-taxes-knock.loca.lt` so Mux
    could fetch the subtitle artifact for a fully local end-to-end run
  - created final validation job `asw9lvc5wqaawf2mdrb58twv`

**Validation Evidence:**

- Job `asw9lvc5wqaawf2mdrb58twv` finished with
  `artifacts.muxSync.data.comparisons[0].status = "synced"`
- Stage asset `TI6d3HANt00Ug8aEyUWSn8Js5FMhm01Ki8Bd1wjgBn00zg` ended with a single
  English text track:
  - `text_source: "uploaded"`
  - `status: "ready"`
  - `name: "EN subtitles"`
- The manager artifact and the live Mux VTT matched after normalization:
  - 13 segments in manager artifact
  - 13 segments in Mux track
  - first cue `00:00:01.179 --> 00:00:05.799`
  - last cue `00:00:37.978 --> 00:00:40.238`
- Validation artifacts saved under `output/validation/`, including:
  - `asw9lvc5wqaawf2mdrb58twv-subtitles-en.vtt`
  - `asw9lvc5wqaawf2mdrb58twv-mux-en.vtt`
  - `screenshot-1775952046989.png`
  - `screenshot-1775952062205.png`

**Learnings:**

- `localhost` is not sufficient for local Mux subtitle sync validation because
  Mux must fetch the artifact from a publicly reachable URL
- The stage-clone fix is orthogonal to the Mux fallback path, so the fallback
  needed its own explicit subtitle-generation safeguard

## Notes

- This todo is intentionally scoped to the stage-clone source-language path. It
  does not decide whether Mux-generated subtitles should remain available for
  other workflows or fallback scenarios.
