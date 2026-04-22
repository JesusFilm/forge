---
status: complete
priority: p2
issue_id: "020"
tags: [code-review, manager, mux, enrichment, reliability]
dependencies: []
---

# Avoid unnecessary subtitle regeneration on reused Mux assets

The new direct-reuse enrichment path now calls Mux subtitle generation before
job creation for every reused asset that lacks a matching `generated_vod` text
track.

That is stricter than the current workflow needs to be. Transcription can
already consume any ready subtitle track, so forcing regeneration here adds
latency and another failure point even when the reused asset already has usable
uploaded subtitles.

## Findings

- `apps/manager/src/app/api/enrich/route.ts:295-299` always calls
  `ensureGeneratedSubtitlesForAsset(...)` for `direct_mux_asset_reuse` jobs.
- `apps/manager/src/services/mux.ts:89-146` only treats an existing
  `generated_vod` subtitle track as reusable and otherwise calls
  `video.assets.generateSubtitles(...)`.
- `apps/manager/src/services/transcription.ts:80-102` already accepts any ready
  subtitle track and only _prefers_ generated tracks. Uploaded subtitle tracks
  are still usable for transcription.
- Mux's current public docs say self-service customers can add captions to any
  asset, so the old 7-day limit is no longer a universal blocker. That means
  the real issue here is unnecessary regeneration work, not a guaranteed hard
  failure for all older assets.
- Combined impact: reused assets with ready uploaded subtitles now do extra
  work they do not need, and the route can fail earlier than necessary when
  regeneration encounters avoidable issues.

## Proposed Solutions

### Option 1: Reuse any ready subtitle track before requesting generation

**Approach:** Change the preflight helper so direct-reuse jobs skip generation
when the asset already has a ready subtitle track usable by
`waitForReadySubtitleTrack(...)`, even if that track was uploaded instead of
generated.

**Pros:**

- Preserves the new no-clone production path for older assets that already have
  subtitles
- Matches the existing transcription service contract
- Smallest behavior change

**Cons:**

- Does not solve assets that truly have no usable subtitle track
- Requires the route/helper contract to align more closely with transcription

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Keep generation as a fallback, but only when no ready subtitle track exists

**Approach:** Inspect the reused asset first. If any ready subtitle track exists,
skip generation entirely. Only call `generateSubtitles(...)` when the asset
truly has no usable ready track.

**Pros:**

- Preserves the ability to request fresh generated subtitles when actually needed
- Reduces avoidable latency and external writes in the common reusable-track case

**Cons:**

- Still leaves the helper more complex than simply trusting existing ready tracks
- Requires the preflight check to mirror transcription behavior more closely

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 3: Detect and reject unsupported reused assets explicitly

**Approach:** Inspect the reused asset before job creation and fail with a clear
unsupported reason when it has no usable subtitle track and regeneration is not
desired or fails.

**Pros:**

- Honest behavior with no silent fallback
- Gives operators actionable errors instead of opaque Mux failures

**Cons:**

- Still leaves some production assets unenrichable
- Requires stronger Mux-side capability detection than we have today

**Effort:** 3-5 hours

**Risk:** Medium

## Recommended Action

Skip subtitle regeneration when the reused asset already exposes a ready
subtitle track for the requested language (or `auto`), and keep generation as
the fallback only when no reusable ready track exists.

## Technical Details

**Affected files:**

- `apps/manager/src/app/api/enrich/route.ts`
- `apps/manager/src/services/mux.ts`
- `apps/manager/src/services/transcription.ts`
- `apps/manager/src/services/mux.test.ts`
- `apps/manager/src/app/api/enrich/route.test.ts`

**Related components:**

- Mux asset reuse policy helper
- direct-reuse materialization metadata
- transcription subtitle-track selection

**Database changes:**

- No

## Resources

- Plan:
  `docs/plans/2026-04-09-feat-gate-mux-clone-enrichment-by-environment-plan.md`
- Existing stage-materialization plan:
  `docs/plans/2026-04-01-feat-stage-materialization-for-snapshot-enrichment-plan.md`
- Mux SDK reference:
  `node_modules/.pnpm/@mux+mux-node@9.0.1/node_modules/@mux/mux-node/resources/video/assets.d.ts`

## Acceptance Criteria

- [x] Direct-reuse jobs do not call `generateSubtitles` when a reusable ready
      subtitle track already exists on the asset
- [x] Older reused assets with ready uploaded subtitles can still be enriched
      without cloning
- [x] Assets that truly cannot provide subtitles through the direct path fail
      with a clear, intentional error or fallback behavior
- [x] Automated tests cover the reused-asset/no-generated-track case

## Work Log

### 2026-04-09 - Review finding capture

**By:** Codex

**Actions:**

- Reviewed the local uncommitted diff for the new
  `MUX_ENRICHMENT_FORCE_STAGE_CLONE` direct-reuse path
- Traced direct job creation through `route.ts`, `mux.ts`, and
  `transcription.ts`
- Verified the Mux SDK contract for `generateSubtitles(...)`

**Learnings:**

- The transcription pipeline can already consume uploaded subtitle tracks; the
  new direct preflight is stricter than the workflow itself
- The 7-day Mux limitation makes unconditional subtitle regeneration unsafe for
  long-lived production assets

### 2026-04-09 - Fix implemented

**By:** Codex

**Actions:**

- Updated `apps/manager/src/services/mux.ts` so
  `ensureGeneratedSubtitlesForAsset(...)` returns early when the reused asset
  already has a ready subtitle track in the requested language or `auto`
- Added regression coverage in `apps/manager/src/services/mux.test.ts` for the
  uploaded-subtitle reuse case
- Ran `pnpm --filter @forge/manager test`
- Ran `pnpm --filter @forge/manager lint`
- Ran `pnpm --filter @forge/manager typecheck`

**Learnings:**

- Direct-reuse preflight should mirror the transcription contract closely
  instead of insisting on freshly generated tracks
- Reused uploaded subtitles are a valid happy path and should not trigger extra
  Mux work

## Notes

- Severity was downgraded from `P1` to `P2` after checking current Mux docs:
  the old 7-day asset-age limit no longer applies broadly to self-service
  customers, so this is now best framed as unnecessary work and extra failure
  surface rather than a universal hard blocker.
